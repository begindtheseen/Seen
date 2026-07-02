// Deterministic job description → facts extraction. NO external AI.
//
// We split the description into requirement-ish sentences, detect whether each is a
// hard requirement ("required", "must have") or a preference ("preferred", "nice to
// have", "a plus"), and pull the known skills/tools out of each. Skills found in a
// "required" context become required JobFacts; everything else is preferred. We also
// detect the role's seniority for the seniority-alignment term.
import { canonicalText, normalizeSkill, BUILTIN_TAXONOMY } from './normalizeSkills.js';
// Same recognized vocabulary as the résumé side, so a job skill and a résumé skill
// normalize to the same canonical token.
const KNOWN_SKILLS = [
    'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust',
    'react', 'angular', 'vue', 'node.js', 'next.js', 'express', 'django', 'flask', 'rails', 'spring',
    'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest',
    'aws', 'google cloud', 'azure', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'git',
    'machine learning', 'data analytics', 'data science', 'tableau', 'power bi', 'excel',
    'microsoft word', 'microsoft powerpoint', 'google workspace', 'salesforce', 'crm', 'quickbooks', 'sap',
    'customer service', 'customer intake', 'point of sale', 'cash handling', 'route planning', 'logistics',
    'inventory management', 'scheduling', 'data entry', 'accounting', 'bookkeeping', 'phlebotomy',
    'food safety', 'forklift', 'warehouse', 'shipping', 'receiving', 'merchandising', 'sales',
    'leadership', 'team management', 'project management', 'communication', 'teamwork',
    'time management', 'problem solving', 'conflict resolution', 'training', 'onboarding',
];
const ALIAS_PHRASES = Object.keys(BUILTIN_TAXONOMY.aliases);
const REQUIRED_CUE = /\b(require[ds]?|must have|must be|need(?:ed)?|essential|mandatory|minimum|at least|proven|demonstrated|years? of experience)\b/i;
const PREFERRED_CUE = /\b(prefer(?:red)?|nice to have|a plus|bonus|ideal(?:ly)?|desired|would be great|familiarity with|exposure to)\b/i;
const SENIORITY_PATTERNS = [
    { re: /\b(chief|vp|vice president|c-level)\b/i, level: 'executive', rank: 6 },
    { re: /\b(director|head of)\b/i, level: 'director', rank: 5 },
    { re: /\b(principal|staff|lead|manager|supervisor)\b/i, level: 'lead', rank: 4 },
    { re: /\b(senior|sr\.?)\b/i, level: 'senior', rank: 3 },
    { re: /\b(mid[- ]?level|associate|intermediate)\b/i, level: 'mid', rank: 2 },
    { re: /\b(junior|jr\.?|entry[- ]?level|intern|trainee|graduate)\b/i, level: 'entry', rank: 1 },
];
function splitClauses(text) {
    return text
        .split(/\n+|(?<=[.!?])\s+|•|•|;/)
        .map((s) => s.trim())
        .filter((s) => s.length > 2);
}
function findPhrase(haystack, needle) {
    if (!needle)
        return false;
    let from = 0;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1)
            return false;
        const before = idx === 0 ? ' ' : haystack[idx - 1];
        const after = idx + needle.length >= haystack.length ? ' ' : haystack[idx + needle.length];
        const bb = !/[a-z0-9]/.test(before) || !/[a-z0-9]/.test(needle[0]);
        const ba = !/[a-z0-9]/.test(after) || !/[a-z0-9]/.test(needle[needle.length - 1]);
        if (bb && ba)
            return true;
        from = idx + 1;
    }
}
export function extractJobFacts(jobDescription, opts = {}) {
    const taxonomy = opts.taxonomy || BUILTIN_TAXONOMY;
    const text = String(jobDescription || '');
    const title = String(opts.jobTitle || '');
    const clauses = splitClauses(`${title}\n${text}`);
    const phrases = [...new Set([...KNOWN_SKILLS, ...ALIAS_PHRASES])];
    // skill -> best importance found (required beats preferred beats nice_to_have)
    const found = new Map();
    const rank = { nice_to_have: 0, preferred: 1, required: 2 };
    for (const clause of clauses) {
        const lc = canonicalText(clause);
        const isReq = REQUIRED_CUE.test(clause);
        const isPref = PREFERRED_CUE.test(clause);
        const importance = isPref && !isReq ? 'preferred' : isReq ? 'required' : 'nice_to_have';
        for (const phrase of phrases) {
            const needle = canonicalText(phrase);
            if (!findPhrase(lc, needle))
                continue;
            const normalized = normalizeSkill(phrase, taxonomy);
            const prev = found.get(normalized);
            if (!prev || rank[importance] > rank[prev.importance]) {
                found.set(normalized, { importance, label: phrase });
            }
        }
    }
    // If nothing was explicitly cued as required, promote the most-mentioned skills to
    // required so the score still discriminates (a job always needs *something*).
    const facts = [];
    const anyRequired = [...found.values()].some((v) => v.importance === 'required');
    for (const [normalized, { importance, label }] of found) {
        let imp = importance;
        if (!anyRequired && imp === 'nice_to_have')
            imp = 'required';
        facts.push({
            factType: 'skill',
            label,
            normalizedLabel: normalized,
            importance: imp,
            weight: imp === 'required' ? 1 : imp === 'preferred' ? 0.6 : 0.4,
            confidence: 0.8,
        });
    }
    // Seniority of the role (from title first, then body).
    for (const { re, level, rank: r } of SENIORITY_PATTERNS) {
        if (re.test(title) || re.test(text)) {
            facts.push({
                factType: 'seniority',
                label: level,
                normalizedLabel: `seniority:${level}`,
                importance: 'required',
                weight: 1,
                confidence: 0.7,
            });
            void r;
            break;
        }
    }
    return facts;
}
export function jobSeniorityRank(facts) {
    const levelRank = { entry: 1, mid: 2, senior: 3, lead: 4, director: 5, executive: 6 };
    for (const f of facts) {
        if (f.factType === 'seniority')
            return levelRank[f.label] || 0;
    }
    return 0;
}
