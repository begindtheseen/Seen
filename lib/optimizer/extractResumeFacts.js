// Deterministic résumé → facts extraction. NO external AI.
//
// We pull skills, tools, titles, seniority, metrics, education, certifications, total and
// management experience out of plain résumé text using the SAME vocabulary the posting side uses
// (extractJobFacts.KNOWN_SKILLS + the taxonomy aliases) and the SAME stemmer (lemma.js), so
// "Trained 4 new hires" meets a posting's "training" and "POS systems" meets "register". Every
// fact carries the exact source span (`evidenceText`) so downstream bullet generation can PROVE a
// claim is backed by the résumé (anti-hallucination is enforced here, not by a model promising to
// behave).
//
// v2 (2026-10-24, two expert audits):
//   • stem matching (lemma.js) instead of literal containment;
//   • verb-shaped tokens (excel, lead, go, rest, drive) count only with a tool cue on their line;
//   • education comes from real degree phrases ("Associate of Arts", "Bachelor's degree"), never
//     from a job title ("Sales Associate" is not an associate degree);
//   • a title is the whole title segment ("Membership Specialist", not "Specialist");
//   • total and supervisory experience are measured from the role date ranges (hard gates);
//   • METRIC_RE lists long units first ("20 months" is never "20 m");
//   • evidence outside a bullet is the SENTENCE it sits in, with "full-\ntime" re-joined — never a
//     line fragment that starts mid-word.
import { canonicalText, normalizeSkill, BUILTIN_TAXONOMY } from './normalizeSkills.js';
import { KNOWN_SKILLS } from './extractJobFacts.js';
import { AMBIGUOUS_TOKENS } from './hourlyVocabulary.js';
import { tokenize, findStemmed, stemPhrase } from './lemma.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';

const SENIORITY_TITLE = [
    { re: /\b(chief|c-level|cto|ceo|cfo|cio|vp|vice president)\b/i, level: 'executive', rank: 6 },
    { re: /\b(director|head of)\b/i, level: 'director', rank: 5 },
    { re: /\b(manager|supervisor|principal|staff)\b/i, not: /\bassistant\s+manager\b/i, level: 'lead', rank: 4 },
    { re: /\b(?:team|shift)\s+lead\b|\blead\s+(?:cashier|associate|barista|teller|server|technician)\b|\bassistant\s+manager\b|\bkey\s*holder\b/i, level: 'mid', rank: 2 },
    { re: /\blead\b/i, level: 'lead', rank: 4 },
    { re: /\b(senior|sr\.?)\b/i, level: 'senior', rank: 3 },
    { re: /\b(junior|jr\.?|entry[- ]?level|intern|trainee)\b/i, level: 'entry', rank: 1 },
];
// Store-level / hourly title nouns — an entry-level role when no seniority word is present.
const HOURLY_TITLE_RE = /\b(associate|cashier|clerk|crew|team member|attendant|representative|barista|server|host|hostess|stocker|picker|packer|driver|courier|valet|specialist|greeter|teller|receptionist|agent|guard|cook|dishwasher|busser|runner|merchandiser|warehouse)\b/i;
const LEVEL_RANK = { entry: 1, mid: 2, senior: 3, lead: 4, director: 5, executive: 6 };

// A real degree phrase. "Associate" alone is a job title; it is a degree only as "Associate of
// Arts/Science", "Associate's degree", "A.A./A.S." or "associate degree".
// The phrase must END at a non-letter: the old trailing `\b` could never match after the final
// "." of "B.S." (a "." followed by a space is not a word boundary), so "B.S. Computer Science —
// The University of Texas at Austin 2018" read as "no degree" (Dev, 2026-10-25). Abbreviations
// are accepted dotted, undotted only before "in" ("BS in", never "MS Excel") and as B.Sc./M.Sc.
const DEGREE_RE = /(?<![a-z0-9])(ph\.?\s?d\.?|doctorate|doctor of [a-z]+|master'?s?(?:\s+degree|\s+of\s+[a-z]+)|m\.?b\.?a\.?|m\.\s?sc?\.?|m\.\s?a\.|bachelor'?s?(?:\s+degree|\s+of\s+[a-z]+)?|b\.\s?sc?\.?|b\.\s?a\.|b\.?\s?b\.?\s?a\.?|b\.?\s?s\.?\s?n\.?|m\.?\s?s\.?\s?n\.?|(?:bs|ba|ms|bsc|msc)(?=\s+in\s)|associate'?s?\s+(?:degree|of\s+(?:arts|science|applied\s+science))|associate\s+degree|a\.a\.s?\.?|a\.s\.|b\.\s?ed\.?|m\.\s?ed\.?|(?:bed|med)(?=\s+in\s)|high\s+school\s+diploma|high\s+school|ged)(?![a-z0-9])/gi;
// A degree the line says is unfinished ("Coursework toward A.A.S.", "pursuing a B.A.", "expected
// 2027" is fine — that is a degree date) is not a degree held.
const UNFINISHED_RE = /\b(?:coursework|courses|credits|classes)\s+(?:toward|towards|in)\b|\b(?:pursuing|working\s+toward|incomplete|not\s+completed|some\s+college)\b/i;
const GPA_RE = /\bgpa\b[:\s]*(\d\.\d{1,2})|\b(\d\.\d{1,2})\s*(?:\/\s*4(?:\.0)?\s*)?gpa\b/i;
const CERT_RE = /\b(food\s+handler'?s?\s+(?:card|permit|certificat\w+)|servsafe|tips\s+certif\w+|forklift\s+(?:certif\w+|licen[sc]e[ds]?)|osha\s+(?:10|30)|cpr(?:\s*\/\s*first\s+aid)?|first\s+aid|guard\s+card|tabc|bls\b|cdl(?:\s+class\s+[abc])?|aws certified|pmp|cpa|cfa|cissp|comptia|scrum master|six sigma|notary|certifi(?:ed|cation)|licensed?)\b/gi;
// Long units first, and a unit must end at a word boundary: "20 months" → "20 months", never "20 m".
const METRIC_RE = /(\$?\d[\d,]*(?:\.\d+)?\+?\s*(?:%|percent|million|billion|months?|years?|weeks?|days?|hours?|customers?|clients?|members?|guests?|tickets?|calls?|orders?|deliveries|vehicles?|transactions?|users?|accounts?|reports?|employees?|hires?|people|items?|units?|stores?|sku|skus|k\b|m\b|x\b)|\btop\s+\d+\s+of\s+\d+\b|\b\d+\s+of\s+\d+\s+(?:months?|weeks?|shifts?|quarters?)\b)/gi;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const DATE_TOKEN = String.raw`(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{4}|(?:0?[1-9]|1[0-2])\/\d{2,4}|(?:19|20)\d{2})`;
const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(present|current|now|${DATE_TOKEN})`, 'i');
const SUPERVISE_RE = /\b(?:supervis(?:ed|ing|e)|managed\s+(?:a\s+)?(?:team|staff|crew|\d+\s+(?:employees|associates|people|staff|reps|agents))|led\s+(?:a\s+)?(?:team|crew|staff)\s+of|direct\s+reports|hired\s+and\s+(?:trained|managed)|people\s+manager)\b/i;

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
function lineContaining(text, index) {
    const start = text.lastIndexOf('\n', index) + 1;
    let end = text.indexOf('\n', index);
    if (end === -1) end = text.length;
    return text.slice(start, end).trim().slice(0, 240);
}

// ── Where in the résumé a line lives ────────────────────────────────────────────────────
// Only an experience bullet is a claim a rewrite may stand on — the summary sentence and the
// skills list are NOT bullets. Every skill fact carries `evidenceKind` and prefers a 'bullet'.
const SECTION_RE = [
    { kind: 'summary', re: /^\s*(professional\s+)?(summary|objective|profile|about( me)?)\b/i },
    { kind: 'skills', re: /^\s*(technical\s+|core\s+|key\s+)?(skills|competencies|proficiencies|technologies|tools)\b/i },
    { kind: 'experience', re: /^\s*(work\s+|professional\s+|relevant\s+|additional\s+|employment\s+)?(experience|employment|work history|history)\b/i },
    { kind: 'education', re: /^\s*(education|academic)\b/i },
    { kind: 'other', re: /^\s*(certifications?|licenses?|credentials|projects|portfolio|awards|volunteer\w*|references|languages|interests|availability)\b/i },
];
const BULLET_LINE_RE = /^\s*[•\-*▪◦·‣–—]\s+/;
const TITLE_NOUN_RE = /\b(Engineer|Developer|Manager|Director|Analyst|Specialist|Representative|Associate|Coordinator|Lead|Designer|Consultant|Administrator|Technician|Clerk|Driver|Cashier|Nurse|Assistant|Supervisor|Agent|Officer|Attendant|Barista|Server|Host|Hostess|Stocker|Picker|Packer|Courier|Receptionist|Teller|Cook|Crew Member|Team Member|Member|Merchandiser|Guard|Advisor|Consultant|Planner|Recruiter|Generalist|Accountant|Bookkeeper|Writer|Editor|Teacher|Tutor|Intern|Owner|Founder|President)\b/;
const HEADER_SPLIT_RE = /\s+[—–|]\s+|\s+-\s+|\s*,\s+|\s+@\s+|\s+at\s+/;
const SENTENCE_VERB_RE = /^(led|managed|built|created|developed|designed|implemented|resolved|handled|delivered|processed|coordinated|trained|reduced|increased|improved|maintained|operated|scheduled|documented|served|assisted|drove|parked|reconciled|analyzed|scanned|picked|packed|sold|advised|greeted|supported|answered|provided|prepared|completed|achieved|exceeded|oversaw|supervised|organized|planned|negotiated|closed|generated|recruited|onboarded|audited|tracked|restocked|stocked|cleaned|inspected|installed|repaired|tested|wrote|taught|cared|monitored|dispatched|loaded|unloaded|counted)\b/i;

/** The title segment of a role header line ("Membership Specialist — UFC Gym, Phoenix" → "Membership Specialist"). */
export function titleFromHeader(line) {
    const clean = String(line || '').replace(BULLET_LINE_RE, '').replace(DATE_RANGE_RE, '').trim();
    const first = clean.split(HEADER_SPLIT_RE)[0].trim();
    if (!first || first.length > 60 || !TITLE_NOUN_RE.test(first)) return null;
    if (!/^[A-Z]/.test(first)) return null;
    return first.replace(/[\s,;:–—-]+$/, '');
}

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
        else if (section === 'education') kind = 'education';
        else if (section === 'other') kind = 'other';
        else if (BULLET_LINE_RE.test(raw)) kind = 'bullet';
        else if (DATE_RANGE_RE.test(line) || (titleFromHeader(line) && line.length < 90)) kind = 'role';
        else if (section === 'experience' && SENTENCE_VERB_RE.test(line)) kind = 'bullet';
        else if (section === 'header') kind = /^[^a-z]*$/i.test(line) || line.length < 25 ? 'other' : (SENTENCE_VERB_RE.test(line) ? 'bullet' : 'summary');
        out.push({ start, end: start + raw.length, kind, section, text: line });
    }
    return out;
}
function lineAt(lineInfo, index) {
    return lineInfo.find((l) => index >= l.start && index <= l.end) || null;
}

// Evidence for a hit: a bullet is its own line (a literal span of the résumé — rewrites stand on
// it); anything else is the SENTENCE it sits in, with the paragraph's wrapped lines re-joined.
function evidenceFor(text, lineInfo, index) {
    const at = lineAt(lineInfo, index);
    if (!at) return lineContaining(text, index);
    if (at.kind === 'bullet' || at.kind === 'role' || at.kind === 'skills') return at.text.slice(0, 240);
    // the paragraph: contiguous non-empty lines of the same kind
    const i = lineInfo.indexOf(at);
    let a = i, b = i;
    while (a > 0 && lineInfo[a - 1].kind === at.kind && lineInfo[a - 1].text) a--;
    while (b < lineInfo.length - 1 && lineInfo[b + 1].kind === at.kind && lineInfo[b + 1].text) b++;
    const parts = lineInfo.slice(a, b + 1);
    let joined = '';
    let mapped = 0;
    for (const p of parts) {
        const raw = text.slice(p.start, p.end);
        const lead = raw.length - raw.trimStart().length;
        // a line that ends in a hyphen continues the word on the next line ("full-\ntime")
        const sep = joined ? (/[A-Za-z]-$/.test(joined) ? '' : ' ') : '';
        joined += sep;
        if (p === at) mapped = joined.length + Math.max(0, index - p.start - lead);
        joined += p.text;
    }
    let s = Math.max(0, Math.min(mapped, joined.length - 1));
    let e = s;
    while (s > 0 && !/[.!?;•·]/.test(joined[s - 1])) s--;
    while (e < joined.length && !/[.!?;•·]/.test(joined[e])) e++;
    return joined.slice(s, Math.min(joined.length, e + 1)).replace(/^[\s•·\-–*]+/, '').trim().slice(0, 240);
}

function monthIndex(tok, end = false) {
    const t = String(tok || '').toLowerCase().trim();
    if (/^(present|current|now)$/.test(t)) { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); }
    let m = t.match(/^([a-z]+)\.?\s*(\d{4})$/);
    if (m && MONTHS[m[1].slice(0, 4)] !== undefined) return Number(m[2]) * 12 + MONTHS[m[1].slice(0, 4)];
    if (m && MONTHS[m[1].slice(0, 3)] !== undefined) return Number(m[2]) * 12 + MONTHS[m[1].slice(0, 3)];
    m = t.match(/^(\d{1,2})\/(\d{2,4})$/);
    if (m) { const y = Number(m[2].length === 2 ? `20${m[2]}` : m[2]); return y * 12 + Number(m[1]) - 1; }
    m = t.match(/^(\d{4})$/);
    if (m) return Number(m[1]) * 12 + (end ? 11 : 0);
    return null;
}

// A date range the PDF wrapped across two lines ("…, Chicago, IL Jan 2025 –\nAug 2025") is one
// range: Tasha's internship had no dates at all, so it counted toward nothing (2026-10-25).
const WRAPPED_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(-|–|—|to)\\s*\\n\\s*(?=(?:present|current|now|${DATE_TOKEN})\\s*$)`, 'gim');
export function joinWrappedRanges(text) {
    return String(text || '').replace(WRAPPED_RANGE_RE, '$1 $2 ');
}

/** Roles with their date span (months), title and the bullets under them. */
export function rolesFromText(text) {
    text = joinWrappedRanges(text);
    const lineInfo = classifyLines(text);
    const roles = [];
    let cur = null;
    for (const l of lineInfo) {
        if (l.kind === 'role') {
            const dm = l.text.match(DATE_RANGE_RE);
            const title = titleFromHeader(l.text);
            if (dm || title) {
                const from = dm ? monthIndex(dm[1]) : null;
                const to = dm ? monthIndex(dm[2], true) : null;
                // a date-only line right after a title line belongs to that role
                if (cur && !title && dm && cur.from == null) { cur.from = from; cur.to = to; continue; }
                cur = { title: title || '', header: l.text, from, to, bullets: [] };
                roles.push(cur);
                continue;
            }
        }
        if (l.kind === 'bullet' && cur) cur.bullets.push(l.text);
    }
    return roles;
}

function mergedMonths(spans) {
    const s = spans.filter((x) => x.from != null && x.to != null && x.to >= x.from).sort((a, b) => a.from - b.from);
    let total = 0, curFrom = null, curTo = null;
    for (const x of s) {
        if (curTo == null || x.from > curTo + 1) { if (curTo != null) total += curTo - curFrom + 1; curFrom = x.from; curTo = x.to; }
        else curTo = Math.max(curTo, x.to);
    }
    if (curTo != null) total += curTo - curFrom + 1;
    return total;
}

// The domain a years requirement is about: "3+ years of experience in email marketing
// operations, CRM administration, or marketing operations" → ['email', 'marketing', 'crm']. Words
// that name no field (operations, administration, experience, related…) are dropped; an empty
// list means the requirement is about experience of any kind.
const DOMAIN_GENERIC = new Set(['experience', 'experienc', 'operation', 'administration', 'administr', 'related', 'relat', 'similar', 'equivalent', 'equival', 'field', 'role', 'position', 'setting', 'environment', 'environ', 'industry', 'professional', 'profession', 'work', 'working', 'job', 'year', 'the', 'and', 'or', 'a', 'an', 'of', 'in', 'with', 'as', 'at', 'for', 'similar', 'relevant', 'relev', 'progressive', 'progress', 'hands-on', 'direct', 'prior', 'minimum', 'least', 'plus', 'etc', 'other', 'any', 'combination', 'combin', 'including', 'includ', 'such', 'area', 'function', 'capacity', 'level']);
export function domainOfYearsSentence(sentence) {
    const m = String(sentence || '').match(/\byears?\b[^.;]*?\b(?:experience|work(?:ing)?)\s+(?:in|with|as|on|doing|across|supporting|within)\s+([^.;]+)/i)
        || String(sentence || '').match(/\byears?\s+(?:of\s+)?([a-z][a-z /&,+-]{2,60}?)\s+experience\b/i);
    if (!m) return [];
    return [...new Set(tokenize(m[1]).map((t) => t.stem).filter((st) => st.length >= 2 && !DOMAIN_GENERIC.has(st) && !/^\d/.test(st)))].slice(0, 8);
}

/**
 * Years of experience in roles whose title or bullets name the domain (each calendar month once).
 * With no domain terms, every role counts.
 */
export function relevantExperienceYears(resumeText, domainStems, { jobFamily = null } = {}) {
    const roles = rolesFromText(String(resumeText || ''));
    const want = (domainStems || []).filter(Boolean);
    // A role counts when it names the domain, or when its title is in the posting's own field
    // ("Backend Engineer" for "software development experience").
    const sameField = (r) => !!jobFamily && jobFamily !== 'general' && !!r.title && detectRoleFamily(r.title, '').family === jobFamily;
    const relevant = !want.length ? roles : roles.filter((r) => {
        const stems = new Set(tokenize([r.title, r.header, ...r.bullets].join(' ')).map((t) => t.stem));
        return want.some((w) => stems.has(w)) || sameField(r);
    });
    return { years: mergedMonths(relevant) / 12, roles: relevant.map((r) => r.title).filter(Boolean) };
}

function titleRank(title) {
    for (const { re, not, level } of SENIORITY_TITLE) if (re.test(title) && !(not && not.test(title))) return LEVEL_RANK[level];
    return HOURLY_TITLE_RE.test(title) ? 1 : 2;
}

export function extractResumeFacts(resumeText, taxonomy = BUILTIN_TAXONOMY) {
    const text = joinWrappedRanges(String(resumeText || ''));
    if (!text.trim())
        return [];
    const facts = [];
    const lineInfo = classifyLines(text);
    const toks = tokenize(text);

    // ── Skills & tools (dictionary + alias match, by stem) ──
    const phrases = [...new Set([...KNOWN_SKILLS, ...Object.keys(taxonomy.aliases)])];
    for (const phrase of phrases) {
        const stems = stemPhrase(phrase);
        if (!stems.length) continue;
        let hits = findStemmed(toks, stems);
        if (!hits.length) continue;
        const normalized = normalizeSkill(phrase, taxonomy);
        if (!normalized) continue;
        // verb-shaped tokens are a tool only with a tool cue on their own line ("excel at" ≠ Excel)
        const cue = AMBIGUOUS_TOKENS[normalized];
        // (a capitalised "Go" / "REST" mid-line is the language / the API style: "Built Go services")
        if (cue) hits = hits.filter((h) => cue.test(lineContaining(text, h.start)) || /^(?:microsoft|ms)\s/i.test(phrase)
            || (normalized === 'go' && text.slice(h.start, h.end) === 'Go' && !/^[\s•\-*]*$/.test(text.slice(text.lastIndexOf('\n', h.start) + 1, h.start)))
            || (normalized === 'rest' && /^REST/.test(text.slice(h.start, h.end))));
        // A word inside an EMPLOYER's name is not a skill: "Cox Communications" is not
        // communication (Maria, 2026-10-25). On a role header, a capitalised hit after the title
        // separator ("Title — Employer", "Title at Employer", "Title, Employer") is skipped.
        hits = hits.filter((h) => {
            const at = lineAt(lineInfo, h.start);
            if (!at || !(at.kind === 'role' || (at.kind === 'other' && at.section === 'experience'))) return true;
            const lineStart = at.start + (text.slice(at.start, at.end).length - text.slice(at.start, at.end).trimStart().length);
            const before = text.slice(lineStart, h.start);
            const word = text.slice(h.start, h.end);
            return !(/\s(?:—|–|-|\||@|at)\s|,\s/.test(before) && /^[A-Z]/.test(word));
        });
        if (!hits.length) continue;
        const kinds = hits.map((h) => (lineAt(lineInfo, h.start) || { kind: 'other' }).kind);
        const bulletAt = kinds.indexOf('bullet');
        const pick = bulletAt >= 0 ? bulletAt : 0;
        const idx = hits[pick].start;
        const factType = isTool(normalized) ? 'tool' : 'skill';
        facts.push({
            factType,
            label: phrase,
            normalizedLabel: normalized,
            evidenceText: evidenceFor(text, lineInfo, idx),
            evidenceKind: kinds[pick],
            confidence: 0.9,
        });
    }

    // Leadership is shown by leading: a line that led, supervised or managed a team is the fact, whether or
    // not the word "leadership" appears (round 6, Ray: a Warehouse Lead with "Led 2nd shift team of 15" was told
    // to "write a bullet for leadership")
    if (!facts.some((f) => f.normalizedLabel === 'leadership')) {
        const LEAD_RE = /\b(?:led|lead|leading|supervised|supervising|managed|managing|oversaw|overseeing|ran|running)\s+(?:a\s+|the\s+|an?\s+|my\s+)?(?:[\w-]+\s+){0,3}(?:team|crew|staff|shift|department|store|associates|employees|technicians|cashiers|drivers|reps|agents|engineers|nurses)\b/i;
        const line = lineInfo.find((l) => l.kind === 'bullet' && (LEAD_RE.test(l.text || '') || SUPERVISE_RE.test(l.text || '')));
        if (line) facts.push({ factType: 'skill', label: 'leadership', normalizedLabel: 'leadership', evidenceText: String(line.text || '').trim().slice(0, 240), evidenceKind: 'bullet', confidence: 0.8 });
    }

    // ── Roles: titles, seniority, total and supervisory experience ──
    const roles = rolesFromText(text);
    let maxRank = 0;
    for (const r of roles) {
        if (r.title) {
            facts.push({ factType: 'title', label: r.title, normalizedLabel: canonicalText(r.title), evidenceText: r.header.slice(0, 240), confidence: 0.75 });
            maxRank = Math.max(maxRank, titleRank(r.title));
        }
    }
    // a résumé with no role headers (a pasted paragraph): read seniority words from the text
    if (!maxRank) {
        for (const { re, not, level } of SENIORITY_TITLE) {
            if (re.test(text) && !(not && not.test(text))) { maxRank = LEVEL_RANK[level]; break; }
        }
    }
    if (maxRank) {
        const level = Object.keys(LEVEL_RANK).find((k) => LEVEL_RANK[k] === maxRank);
        facts.push({ factType: 'seniority', label: level, normalizedLabel: `seniority:${level}`, evidenceText: '', confidence: 0.7 });
    }
    const totalMonths = mergedMonths(roles);
    const mgmtMonths = mergedMonths(roles.filter((r) => titleRank(r.title) >= 4 || r.bullets.some((b) => SUPERVISE_RE.test(b))));
    if (totalMonths) facts.push({ factType: 'experience', label: `${Math.round(totalMonths / 12 * 10) / 10} years`, normalizedLabel: 'experience:total', value: totalMonths / 12, evidenceText: '', confidence: 0.7 });
    facts.push({ factType: 'experience', label: `${Math.round(mgmtMonths / 12 * 10) / 10} years supervisory`, normalizedLabel: 'experience:management', value: mgmtMonths / 12, evidenceText: '', confidence: 0.7 });

    // ── Education (real degree phrases only) + GPA ──
    let em;
    DEGREE_RE.lastIndex = 0;
    while ((em = DEGREE_RE.exec(text)) !== null) {
        const label = (em[1] || em[0]).replace(/\s+/g, ' ');
        const line = lineContaining(text, em.index);
        const before = line.slice(0, Math.max(0, line.toLowerCase().indexOf(label.toLowerCase())));
        if (UNFINISHED_RE.test(before)) continue;
        facts.push({ factType: 'education', label, normalizedLabel: `education:${canonicalText(label)}`, rank: degreeRank(label), evidenceText: lineContaining(text, em.index), confidence: 0.8 });
    }
    const gpa = text.match(GPA_RE);
    if (gpa) facts.push({ factType: 'gpa', label: gpa[1] || gpa[2], normalizedLabel: 'gpa', value: Number(gpa[1] || gpa[2]), evidenceText: lineContaining(text, gpa.index), confidence: 0.8 });

    // ── Certifications ──
    let cm;
    CERT_RE.lastIndex = 0;
    while ((cm = CERT_RE.exec(text)) !== null) {
        facts.push({ factType: 'certification', label: cm[1], normalizedLabel: `cert:${canonicalText(cm[1])}`, evidenceText: lineContaining(text, cm.index), confidence: 0.65 });
    }

    // ── Metrics (real numbers from the résumé — the ONLY numbers we may ever reuse) ──
    let mm;
    METRIC_RE.lastIndex = 0;
    while ((mm = METRIC_RE.exec(text)) !== null) {
        facts.push({ factType: 'metric', label: mm[1].trim(), normalizedLabel: `metric:${canonicalText(mm[1])}`, evidenceText: lineContaining(text, mm.index), confidence: 0.8 });
    }
    return uniqueByLabel(facts);
}

/** 1 high school · 2 associate · 3 bachelor · 4 master · 5 doctorate · 0 unknown. */
export function degreeRank(label) {
    const l = String(label || '').toLowerCase().replace(/\./g, '');
    if (/phd|ph d|doctorate|doctor of/.test(l)) return 5;
    if (/master|^mba$|^m ?(?:a|s|sc|ed)$/.test(l)) return 4;
    if (/^m ?s ?n$/.test(l)) return 4;
    if (/bachelor|^b ?(?:a|s|sc|ba|sn|ed)$/.test(l)) return 3;
    if (/associate|^aas?$|^as$/.test(l)) return 2;
    if (/high school|ged|diploma/.test(l)) return 1;
    return 0;
}

// Tools are concrete named software/equipment; everything else is a skill. Used only for
// fact_type tagging — matching treats them the same.
const TOOL_SET = new Set([
    'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust',
    'react', 'angular', 'vue', 'node.js', 'next.js', 'express', 'django', 'flask', 'rails', 'spring',
    'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'aws', 'google cloud', 'azure',
    'docker', 'kubernetes', 'terraform', 'git', 'tableau', 'power bi', 'excel', 'microsoft word',
    'microsoft powerpoint', 'google workspace', 'microsoft office', 'salesforce', 'quickbooks', 'sap', 'point of sale', 'forklift',
    'rf scanner', 'pallet jack',
]);
export function isTool(normalized) {
    return TOOL_SET.has(normalized);
}
// Convenience: just the normalized skill/tool labels present in the résumé.
export function resumeSkillLabels(facts) {
    return [...new Set(facts.filter((f) => f.factType === 'skill' || f.factType === 'tool').map((f) => f.normalizedLabel))];
}
// Highest seniority rank found in the résumé's role titles (0 if none).
export function resumeSeniorityRank(facts) {
    let max = 0;
    for (const f of facts) if (f.factType === 'seniority') max = Math.max(max, LEVEL_RANK[f.label] || 0);
    return max;
}
