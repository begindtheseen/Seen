// Detect overclaiming: numbers / tools / seniority in the TEXT that are NOT supported
// by the user's real facts, plus over-polished summary language. NO external AI.
//
// "Supported" means the claim is grounded in the résumé facts (ResumeFact) the user
// already has — extracted by the SeenFit fact extractor. Anything in the text that
// isn't grounded is flagged so it can be moved to confirm_before_using (never silently
// kept). We NEVER invent the missing fact; we only flag the unsupported one.
import { canonicalText, normalizeSkill, BUILTIN_TAXONOMY } from '../optimizer/normalizeSkills.js';
import { protectedRanges, overlapsProtected, numberSet } from './protect.js';
// Numbers / quantified claims in the text. Mirrors the SeenFit metric regex so we catch
// the same shapes (counts, %, $, durations, "Nx").
const METRIC_RE = /(\$?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|k\b|m\b|million|billion|hours?|customers?|clients?|tickets?|calls?|orders?|deliveries|users?|accounts?|reports?|employees?|people|days?|weeks?|months?|years?|x\b)?)/gi;
// Named tools/software we recognize — if the text names one the résumé doesn't contain,
// it's an unsupported-tool risk. Kept aligned with the SeenFit known-skill dictionary.
const KNOWN_TOOLS = [
    'salesforce', 'quickbooks', 'sap', 'tableau', 'power bi', 'excel', 'jira', 'zendesk',
    'hubspot', 'shopify', 'square', 'toast', 'aloha', 'micros', 'doordash', 'ubereats',
    'kubernetes', 'docker', 'terraform', 'aws', 'azure', 'react', 'python', 'java',
];
const SENIORITY_WORDS = [
    { word: 'senior', rank: 3 },
    { word: 'lead', rank: 4 },
    { word: 'principal', rank: 4 },
    { word: 'staff', rank: 4 },
    { word: 'manager', rank: 4 },
    { word: 'director', rank: 5 },
    { word: 'head of', rank: 5 },
    { word: 'vp', rank: 6 },
    { word: 'vice president', rank: 6 },
    { word: 'executive', rank: 6 },
    { word: 'chief', rank: 6 },
];
// Over-polished / machine-summary tells in a personal summary — these read like a model
// wrote them ("a highly accomplished professional with a proven ability to…").
const OVERPOLISHED_RE = [
    /\bhighly\s+(accomplished|skilled|experienced|motivated)\b/i,
    /\ba\s+proven\s+ability\s+to\b/i,
    /\bseasoned\s+professional\b/i,
    /\bwealth\s+of\s+experience\b/i,
    /\bconsistently\s+(deliver|exceed|surpass)/i,
    /\bunparalleled\b/i,
    /\bexceptional\s+(track record|ability|talent)\b/i,
];
function supportedNumbers(facts) {
    const out = new Set();
    for (const f of facts) {
        if (f.factType === 'metric') {
            const digits = (f.label.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((d) => d.replace(/,/g, ''));
            for (const d of digits)
                out.add(d);
        }
    }
    return out;
}
function supportedSkills(facts) {
    const out = new Set();
    for (const f of facts) {
        if (f.factType === 'skill' || f.factType === 'tool')
            out.add(f.normalizedLabel);
    }
    return out;
}
function resumeSeniorityRank(facts) {
    const levelRank = { entry: 1, mid: 2, senior: 3, lead: 4, director: 5, executive: 6 };
    let max = 0;
    for (const f of facts) {
        if (f.factType === 'seniority')
            max = Math.max(max, levelRank[f.label] || 0);
    }
    return max;
}
// opts.evidenceText — the user's own résumé text. A number or tool written ANYWHERE in it is the
// user's own claim, not an invention: the fact extractor's "metric" facts are only the shapes it
// recognises (Dev's "92%", "$1.2B", "180ms" were not among them, so his unchanged résumé was
// flagged number by number — 2026-10-25).
export function detectOverclaiming(text, resumeFacts, opts = {}) {
    const src = String(text || '');
    const evidence = String(opts.evidenceText || '');
    const flags = [];
    const unsupportedMetrics = [];
    const unsupportedTools = [];
    const okNumbers = supportedNumbers(resumeFacts);
    for (const n of numberSet(evidence))
        okNumbers.add(n);
    const okSkills = supportedSkills(resumeFacts);
    const evidenceLower = evidence.toLowerCase();
    const resumeRank = resumeSeniorityRank(resumeFacts);
    // Dates, phone numbers, e-mails and links hold digits but are not claims.
    const guarded = protectedRanges(src);
    // Only enforce grounding when we actually have facts to check against; with no facts
    // we cannot distinguish supported from unsupported, so we stay conservative (no false
    // "unsupported" flags) and let other detectors carry the signal.
    const haveFacts = resumeFacts.length > 0 || evidence.trim().length > 0;
    // ── Unsupported metrics ──
    if (haveFacts) {
        let mm;
        METRIC_RE.lastIndex = 0;
        const seen = new Set();
        while ((mm = METRIC_RE.exec(src)) !== null) {
            const span = mm[1].trim();
            if (!span || !/\d/.test(span))
                continue;
            // A digit run that is part of a longer token ("p99", "S3", "Sev-2") or a protected
            // span (a date, phone number, e-mail or link) is not a separate claim.
            const prev = mm.index > 0 ? src[mm.index - 1] : ' ';
            if (/[\w.,]/.test(prev) || overlapsProtected(guarded, mm.index, mm.index + mm[1].length))
                continue;
            const num = (span.match(/\d[\d,]*(?:\.\d+)?/) || [''])[0].replace(/,(?=\d{3}\b)/g, '').replace(/,+$/, '');
            if (!num || seen.has(num))
                continue;
            seen.add(num);
            // A bare year (1900–2099) is almost always a date, not a performance metric.
            if (/^(19|20)\d{2}$/.test(num))
                continue;
            if (!okNumbers.has(num)) {
                unsupportedMetrics.push(span);
                flags.push({
                    flagType: 'unsupported_metric',
                    severity: 'high',
                    originalPhrase: span,
                    explanation: 'This number is not backed by your résumé facts. Confirm the real figure before using it — we will not invent one.',
                    suggestedFix: null,
                });
            }
        }
    }
    // ── Unsupported tools ──
    if (haveFacts) {
        const lower = src.toLowerCase();
        for (const tool of KNOWN_TOOLS) {
            const re = new RegExp(`(^|[^a-z0-9])${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
            if (!re.test(lower))
                continue;
            const normalized = normalizeSkill(tool, BUILTIN_TAXONOMY);
            const inEvidence = evidenceLower && re.test(evidenceLower);
            if (!inEvidence && !okSkills.has(normalized) && !okSkills.has(canonicalText(tool))) {
                unsupportedTools.push(tool);
                flags.push({
                    flagType: 'unsupported_tool',
                    severity: 'medium',
                    originalPhrase: tool,
                    explanation: `"${tool}" appears in the text but isn't in your résumé. Only name tools you've actually used.`,
                    suggestedFix: null,
                });
            }
        }
    }
    // ── Unsupported seniority ──
    if (haveFacts && resumeRank > 0) {
        const lower = src.toLowerCase();
        for (const s of SENIORITY_WORDS) {
            const re = new RegExp(`(^|[^a-z])${s.word}([^a-z]|$)`, 'i');
            // A level word the user's own résumé uses ("Team Lead") is theirs, not an overclaim.
            if (re.test(lower) && s.rank > resumeRank + 1 && !(evidenceLower && re.test(evidenceLower))) {
                flags.push({
                    flagType: 'unsupported_seniority',
                    severity: 'medium',
                    originalPhrase: s.word,
                    explanation: `"${s.word}" suggests a higher level than your résumé supports. Match the language to your actual experience.`,
                    suggestedFix: null,
                });
                break; // one seniority flag is enough
            }
        }
    }
    // ── Over-polished summary language ──
    for (const re of OVERPOLISHED_RE) {
        const m = re.exec(src);
        if (m) {
            flags.push({
                flagType: 'overpolished',
                severity: 'medium',
                originalPhrase: m[0],
                explanation: 'Over-polished summary language reads machine-generated. Plain, specific wording is more believable.',
                suggestedFix: null,
            });
        }
    }
    return { flags, unsupportedMetrics, unsupportedTools };
}
