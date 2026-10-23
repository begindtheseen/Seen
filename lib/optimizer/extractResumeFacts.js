// Deterministic résumé → facts extraction. NO external AI.
//
// We pull skills, tools, titles, seniority, metrics, education and certifications
// out of plain résumé text using a known skill dictionary + regexes. Every fact
// carries the exact source span (`evidenceText`) so downstream bullet generation can
// PROVE a claim is backed by the résumé (anti-hallucination is enforced here, not by a
// model promising to behave).
import { canonicalText, normalizeSkill, BUILTIN_TAXONOMY } from './normalizeSkills.js';
// A known-skill dictionary. Any phrase here that appears in the résumé becomes a
// `skill`/`tool` fact. This is intentionally explicit — we only ever recognize skills
// we know, so we can never "hallucinate" a skill that isn't grounded in text.
const KNOWN_SKILLS = [
    // tech
    'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust',
    'react', 'angular', 'vue', 'node.js', 'next.js', 'express', 'django', 'flask', 'rails', 'spring',
    'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest',
    'aws', 'google cloud', 'azure', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'git',
    'machine learning', 'data analytics', 'data science', 'tableau', 'power bi', 'excel',
    // office / general business
    'microsoft word', 'microsoft powerpoint', 'google workspace', 'salesforce', 'crm', 'quickbooks', 'sap',
    // non-tech / service / ops
    'customer service', 'customer intake', 'point of sale', 'cash handling', 'route planning', 'logistics',
    'inventory management', 'scheduling', 'data entry', 'accounting', 'bookkeeping', 'phlebotomy',
    'food safety', 'forklift', 'warehouse', 'shipping', 'receiving', 'merchandising', 'sales',
    // soft / leadership
    'leadership', 'team management', 'project management', 'communication', 'teamwork',
    'time management', 'problem solving', 'conflict resolution', 'training', 'onboarding',
];
// Aliases also count as evidence for their canonical skill.
const ALIAS_PHRASES = Object.keys(BUILTIN_TAXONOMY.aliases);
const SENIORITY_PATTERNS = [
    { re: /\b(chief|c-level|cto|ceo|cfo|cio|vp|vice president)\b/i, level: 'executive', rank: 6 },
    { re: /\b(director|head of)\b/i, level: 'director', rank: 5 },
    { re: /\b(principal|staff|lead|manager|supervisor)\b/i, level: 'lead', rank: 4 },
    { re: /\b(senior|sr\.?)\b/i, level: 'senior', rank: 3 },
    { re: /\b(mid[- ]?level|associate|ii|iii)\b/i, level: 'mid', rank: 2 },
    { re: /\b(junior|jr\.?|entry[- ]?level|intern|trainee|i)\b/i, level: 'entry', rank: 1 },
];
const EDU_RE = /\b(ph\.?d|doctorate|master'?s?|mba|bachelor'?s?|b\.?s\.?|b\.?a\.?|m\.?s\.?|associate'?s?|a\.?a\.?|diploma|ged|high school)\b/gi;
const CERT_RE = /\b(certifi(?:ed|cation)|licensed?|aws certified|pmp|cpa|cfa|cissp|comptia|scrum master|six sigma|cdl|rn|lpn|emt|notary)\b/gi;
const TITLE_LINE_RE = /^[\s•\-*]*([A-Z][A-Za-z/&]+(?:\s+[A-Za-z/&]+){0,4}(?:Engineer|Developer|Manager|Director|Analyst|Specialist|Representative|Associate|Coordinator|Lead|Designer|Consultant|Administrator|Technician|Clerk|Driver|Cashier|Nurse|Assistant|Supervisor|Agent|Officer))\b/;
const METRIC_RE = /(\$?\d[\d,]*(?:\.\d+)?\s*(?:%|percent|k|m|million|billion|hours?|customers?|clients?|tickets?|calls?|orders?|deliveries|users?|accounts?|reports?|employees?|people|days?|weeks?|months?|years?|\bx\b))/gi;
function uniqueByLabel(facts) {
    const seen = new Map();
    const out = [];
    for (const f of facts) {
        const key = `${f.factType}:${f.normalizedLabel}`;
        const prev = seen.get(key);
        if (prev !== undefined) {
            // Same skill reached through an alias — keep whichever occurrence is a real bullet.
            if (out[prev].evidenceKind !== 'bullet' && f.evidenceKind === 'bullet') out[prev] = f;
            continue;
        }
        seen.set(key, out.length);
        out.push(f);
    }
    return out;
}
// Pull the line containing a match — used as the evidence span.
function lineContaining(text, index) {
    const start = text.lastIndexOf('\n', index) + 1;
    let end = text.indexOf('\n', index);
    if (end === -1)
        end = text.length;
    return text.slice(start, end).trim().slice(0, 240);
}
// ── Where in the résumé a line lives ────────────────────────────────────────────────────
// A skill phrase usually appears several times: in the summary ("Looking for a customer
// service role…"), in the skills list, and in a real experience bullet. Only the bullet is a
// claim a rewrite may stand on — the summary sentence and the skills list are NOT bullets,
// and showing a summary fragment as a "before" bullet was the live-site defect. Every skill
// fact therefore carries `evidenceKind` and prefers a 'bullet' occurrence.
const SECTION_RE = [
    { kind: 'summary', re: /^\s*(professional\s+)?(summary|objective|profile|about( me)?)\b/i },
    { kind: 'skills', re: /^\s*(technical\s+|core\s+|key\s+)?(skills|competencies|proficiencies|technologies|tools)\b/i },
    { kind: 'experience', re: /^\s*(work\s+|professional\s+|relevant\s+|employment\s+)?(experience|employment|work history|history)\b/i },
    { kind: 'education', re: /^\s*(education|academic)\b/i },
    { kind: 'other', re: /^\s*(certifications?|licenses?|credentials|projects|portfolio|awards|volunteer\w*|references|languages|interests)\b/i },
];
const BULLET_LINE_RE = /^\s*[•\-*▪◦·‣–—]\s+/;
const DATE_RANGE_LINE_RE = /((?:0?[1-9]|1[0-2])\/\d{2,4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\b(?:19|20)\d{2})\s*(?:-|–|—|to)\s*(present|current|now|(?:0?[1-9]|1[0-2])\/\d{2,4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\b(?:19|20)\d{2})/i;
const SENTENCE_VERB_RE = /^(led|managed|built|created|developed|designed|implemented|resolved|handled|delivered|processed|coordinated|trained|reduced|increased|improved|maintained|operated|scheduled|documented|served|assisted|drove|parked|reconciled|analyzed|scanned|picked|packed|sold|advised|greeted|supported|answered|provided|prepared|completed|achieved|exceeded|oversaw|supervised|organized|planned|negotiated|closed|generated|recruited|onboarded|audited|tracked|restocked|stocked|cleaned|inspected|installed|repaired|tested|wrote|taught|cared|monitored|dispatched|loaded|unloaded|counted)\b/i;
// Classify every line once: { kind: 'bullet' | 'summary' | 'skills' | 'header' | 'other' }.
function classifyLines(text) {
    const lines = text.split('\n');
    const out = [];
    let section = 'header';
    let offset = 0;
    for (const raw of lines) {
        const line = raw.trim();
        const start = offset;
        offset += raw.length + 1;
        let kind = 'other';
        const sec = SECTION_RE.find(({ re }) => re.test(line) && line.length < 40);
        if (sec) { section = sec.kind; kind = 'header'; }
        else if (!line) kind = 'other';
        else if (section === 'summary') kind = 'summary';
        else if (section === 'skills') kind = 'skills';
        else if (section === 'education' || section === 'other') kind = 'other';
        else if (BULLET_LINE_RE.test(raw)) kind = 'bullet';
        else if (DATE_RANGE_LINE_RE.test(line) || (TITLE_LINE_RE.test(line) && line.length < 90)) kind = 'header';
        else if (section === 'experience' && SENTENCE_VERB_RE.test(line)) kind = 'bullet';
        else if (section === 'header') kind = /^[^a-z]*$/i.test(line) || line.length < 25 ? 'other' : (SENTENCE_VERB_RE.test(line) ? 'bullet' : 'summary');
        out.push({ start, end: start + raw.length, kind });
    }
    return out;
}
function kindAt(lineInfo, index) {
    const hit = lineInfo.find((l) => index >= l.start && index <= l.end);
    return hit ? hit.kind : 'other';
}
// Every whole-token occurrence of `needle`, in order.
function findAllPhrases(haystack, needle) {
    const out = [];
    let from = 0;
    while (true) {
        const idx = findPhrase(haystack, needle, from);
        if (idx === -1) return out;
        out.push(idx);
        from = idx + needle.length;
    }
}
export function extractResumeFacts(resumeText, taxonomy = BUILTIN_TAXONOMY) {
    const text = String(resumeText || '');
    if (!text.trim())
        return [];
    const lower = text.toLowerCase();
    const facts = [];
    const lineInfo = classifyLines(text);
    // ── Skills & tools (dictionary + alias match) ──
    // The evidence span is the FIRST occurrence that sits in an experience bullet; only when
    // the phrase never appears in a bullet do we fall back to wherever it is (summary/skills),
    // and the fact says so in `evidenceKind` so no generator mistakes it for a bullet.
    const phrases = [...new Set([...KNOWN_SKILLS, ...ALIAS_PHRASES])];
    for (const phrase of phrases) {
        const needle = canonicalText(phrase);
        if (!needle)
            continue;
        // word-boundary-ish search on the lowercased text
        const hits = findAllPhrases(lower, needle);
        if (!hits.length)
            continue;
        const kinds = hits.map((i) => kindAt(lineInfo, i));
        const bulletAt = kinds.indexOf('bullet');
        const pick = bulletAt >= 0 ? bulletAt : 0;
        const idx = hits[pick];
        const normalized = normalizeSkill(phrase, taxonomy);
        const factType = isTool(normalized) ? 'tool' : 'skill';
        facts.push({
            factType,
            label: phrase,
            normalizedLabel: normalized,
            evidenceText: lineContaining(text, idx),
            evidenceKind: kinds[pick],
            confidence: 0.9,
        });
    }
    // ── Seniority ──
    for (const { re, level, rank } of SENIORITY_PATTERNS) {
        const m = re.exec(text);
        if (m) {
            facts.push({
                factType: 'seniority',
                label: level,
                normalizedLabel: `seniority:${level}`,
                evidenceText: lineContaining(text, m.index),
                confidence: 0.7,
            });
            // Only the highest-ranked seniority signal matters; record rank in confidence tiers.
            void rank;
            break;
        }
    }
    // ── Titles ──
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        const tm = TITLE_LINE_RE.exec(line);
        if (tm) {
            const title = tm[1].trim();
            facts.push({
                factType: 'title',
                label: title,
                normalizedLabel: canonicalText(title),
                evidenceText: line.slice(0, 240),
                confidence: 0.6,
            });
        }
    }
    // ── Education ──
    let em;
    EDU_RE.lastIndex = 0;
    while ((em = EDU_RE.exec(text)) !== null) {
        facts.push({
            factType: 'education',
            label: em[1],
            normalizedLabel: `education:${canonicalText(em[1])}`,
            evidenceText: lineContaining(text, em.index),
            confidence: 0.7,
        });
    }
    // ── Certifications ──
    let cm;
    CERT_RE.lastIndex = 0;
    while ((cm = CERT_RE.exec(text)) !== null) {
        facts.push({
            factType: 'certification',
            label: cm[1],
            normalizedLabel: `cert:${canonicalText(cm[1])}`,
            evidenceText: lineContaining(text, cm.index),
            confidence: 0.65,
        });
    }
    // ── Metrics (real numbers from the résumé — the ONLY numbers we may ever reuse) ──
    let mm;
    METRIC_RE.lastIndex = 0;
    while ((mm = METRIC_RE.exec(text)) !== null) {
        facts.push({
            factType: 'metric',
            label: mm[1].trim(),
            normalizedLabel: `metric:${canonicalText(mm[1])}`,
            evidenceText: lineContaining(text, mm.index),
            confidence: 0.8,
        });
    }
    return uniqueByLabel(facts);
}
// Tools are concrete named software/equipment; everything else is a skill. Used only
// for fact_type tagging — matching treats them the same.
const TOOL_SET = new Set([
    'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust',
    'react', 'angular', 'vue', 'node.js', 'next.js', 'express', 'django', 'flask', 'rails', 'spring',
    'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'aws', 'google cloud', 'azure',
    'docker', 'kubernetes', 'terraform', 'git', 'tableau', 'power bi', 'excel', 'microsoft word',
    'microsoft powerpoint', 'google workspace', 'salesforce', 'quickbooks', 'sap', 'point of sale', 'forklift',
]);
function isTool(normalized) {
    return TOOL_SET.has(normalized);
}
// Whole-token phrase search on lowercased text. Returns index or -1. Handles phrases
// with internal spaces/punctuation; avoids matching inside larger words for short
// alpha tokens (e.g. "go", "i").
function findPhrase(haystack, needle, from = 0) {
    if (!needle)
        return -1;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1)
            return -1;
        const before = idx === 0 ? ' ' : haystack[idx - 1];
        const after = idx + needle.length >= haystack.length ? ' ' : haystack[idx + needle.length];
        const boundaryBefore = !/[a-z0-9]/.test(before) || !/[a-z0-9]/.test(needle[0]);
        const boundaryAfter = !/[a-z0-9]/.test(after) || !/[a-z0-9]/.test(needle[needle.length - 1]);
        if (boundaryBefore && boundaryAfter)
            return idx;
        from = idx + 1;
    }
}
// Convenience: just the normalized skill/tool labels present in the résumé.
export function resumeSkillLabels(facts) {
    return [...new Set(facts.filter((f) => f.factType === 'skill' || f.factType === 'tool').map((f) => f.normalizedLabel))];
}
// Highest seniority rank found in the résumé (0 if none).
export function resumeSeniorityRank(facts) {
    const levelRank = { entry: 1, mid: 2, senior: 3, lead: 4, director: 5, executive: 6 };
    let max = 0;
    for (const f of facts) {
        if (f.factType === 'seniority') {
            const lvl = f.label;
            max = Math.max(max, levelRank[lvl] || 0);
        }
    }
    return max;
}
