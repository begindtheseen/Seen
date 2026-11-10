// Requirement matching + required/preferred fit sub-scores. NO external AI.
//
// Matches every job requirement against the résumé's normalized skills using the
// taxonomy graph (exact > alias > related). Produces the required_match and
// preferred_match sub-scores plus the per-requirement breakdown the UI shows under
// "Why you match" and "Missing keywords".
import { bestMatch, BUILTIN_TAXONOMY } from './normalizeSkills.js';
import { resumeSkillLabels } from './extractResumeFacts.js';
import { termStemVariants } from './postingTerms.js';
import { termProof, aliasProof, titleProof, fundamentalOf, bestLine, proofLines, aliasEntriesFor } from './lineProof.js';
import { isTool } from './extractResumeFacts.js';
import { tokenize } from './lemma.js';
// A related (non-exact) match counts partially toward "matched" — strong enough to claim
// transferable experience, but flagged so we don't overstate it. Credit follows the edge
// strength within [0.6, 0.75]: "cash handling ~ point of sale" (0.7) earns more than a 0.5 hop.
const RELATED_MIN = 0.6;
const RELATED_MAX = 0.75;
function relatedCredit(strength) {
    return Math.max(RELATED_MIN, Math.min(RELATED_MAX, Number(strength) || 0));
}
// A résumé line that is schooling (a degree, a course, a certification) — counted, never shown as hands-on proof.
const SCHOOL_LINE_RE = /\b(?:certif\w*|certificate|academy|coursework|course|minor in|major in|bachelor|associate of|degree|university|college|bootcamp|b\.?s\.?|b\.?a\.?|m\.?s\.?)\b/i;
export function scoreFit(jobFacts, resumeFacts, taxonomy = BUILTIN_TAXONOMY, resumeText = '') {
    const resumeSkills = resumeSkillLabels(resumeFacts);
    const skillReqs = jobFacts.filter((f) => f.factType === 'skill');
    const matches = [];
    for (const req of skillReqs) {
        // A requirement in the posting's own words (postingTerms.js): met only by the same words on one résumé line.
        if (req.term) {
            const tm = termProof({ label: req.label, ...req.term }, resumeText, termStemVariants({ label: req.label, ...req.term }));
            const schooled = tm.matched && SCHOOL_LINE_RE.test(tm.line || '');
            const viaTitle = tm.matched && tm.lineKind === 'role';
            matches.push({
                requirement: req.normalizedLabel, surface: req.label, postingPhrases: req.postingPhrases || [req.label],
                importance: req.importance, hard: false, soft: false, matched: tm.matched, inferred: schooled,
                via: tm.matched ? (viaTitle ? 'title' : tm.partial ? 'related' : 'exact') : 'none', strength: tm.matched ? (tm.partial ? 0.7 : 1) : 0,
                relatedTo: null, evidence: tm.matched ? tm.line : null, evidenceKind: tm.matched ? (schooled ? 'education' : viaTitle ? 'title' : 'experience') : null,
                section: req.section || null, termAcronym: req.term.acronym || null,
                postingEvidence: req.evidence || null, weight: req.weight, anyOf: req.anyOf || null, examples: req.examples || null, exampleOf: req.exampleOf || null, term: true,
            });
            continue;
        }
        const bm = bestMatch(req.normalizedLabel, resumeSkills, taxonomy);
        const viaFact = bm.via ? resumeFacts.find((f) => f.normalizedLabel === bm.via) : null;
        // a related match is real only when the evidence is work: never a soft skill inferred from a neighbour
        // ("attention to detail" ← cash handling), never a certification or course line standing in for hands-on
        // use of a related tool ("CRM" ← "HubSpot Academy — Social Media Marketing Certification") — round 5, Tasha
        const trained = !!viaFact && (/\b(?:certif\w*|academy|course|training|coursework|bootcamp|certificate)\b/i.test(String(viaFact.evidenceText || '')) || ['other', 'education'].includes(String(viaFact.evidenceKind || '')));
        const relatedOk = bm.kind === 'related' && bm.strength >= 0.5 && !trained;
        const matched = bm.kind === 'exact' || relatedOk;
        // a soft skill met through related work still counts for the score, but is never SHOWN as proof — the
        // page said "attention to detail (related experience) — Serve 200+ customers per shift" (round 5, Tasha)
        const evFact = matched && bm.via ? resumeFacts.find((f) => f.normalizedLabel === bm.via) : null;
        // a minor, a degree or a certification line is schooling — it counts, but it is never SHOWN as proof of
        // hands-on work ("communication ← Minor in Communication.", "HubSpot ← HubSpot Academy — Social Media
        // Marketing Certification" — round 6, Tasha)
        const schooled = !!evFact && (['education', 'other'].includes(String(evFact.evidenceKind || '')) || /\b(?:certif\w*|certificate|academy|coursework|minor in|major in|bachelor|associate of|degree|university|college|bootcamp)\b/i.test(String(evFact.evidenceText || '')));
        const inferred = (relatedOk && !!req.soft) || (matched && schooled);
        const evidence = matched && bm.via ? evFact?.evidenceText || null : null;
        matches.push({
            requirement: req.normalizedLabel,
            surface: req.label,
            postingPhrases: req.postingPhrases || [req.label],
            importance: req.importance,
            hard: req.hard !== undefined ? !!req.hard : req.importance === 'required',
            soft: !!req.soft,
            matched,
            inferred,
            via: bm.kind === 'none' ? 'none' : bm.kind === 'exact' ? (bm.strength >= 0.99 ? 'exact' : 'alias') : 'related',
            strength: Number((bm.strength || 0).toFixed(2)),
            relatedTo: bm.kind === 'related' ? bm.via : null,
            evidence,
            evidenceKind: evFact ? evFact.evidenceKind || null : null,
            postingEvidence: req.evidence || null,
            weight: req.weight,
            anyOf: req.anyOf || null,
            examples: req.examples || null,
            exampleOf: req.exampleOf || null,
            section: req.section || null,
        });
    }
    proveTheRest(matches, resumeText);
    for (const m of matches) m.kind = requirementKind(m);
    creditExamples(matches);
    collapseAlternatives(matches);
    const required = matches.filter((m) => m.importance === 'required');
    const preferred = matches.filter((m) => m.importance === 'preferred' || m.importance === 'nice_to_have');
    const required_match = weightedCoverage(required, matches, 'required');
    const preferred_match = weightedCoverage(preferred, matches, 'preferred');
    const matched_requirements = matches.filter((m) => m.matched);
    const unsupported_requirements = matches.filter((m) => !m.matched);
    // Only HARD requirements (a stated requirement, not a duty or a soft skill) count as
    // "missing required" — the risk penalty and the risk flag read this list.
    const missing_required = required.filter((m) => !m.matched && m.hard).map((m) => m.surface);
    return {
        required_match,
        preferred_match,
        matches,
        matched_requirements,
        unsupported_requirements,
        missing_required,
    };
}
// What the stemmer cannot see, a person in the field does (2026-11-10 judge, optimize #3 / prep D10): an unmatched
// requirement is proved, in this order, by
//   1. a field-standard alias or a pair either text spells out (fieldAliases.js: "AP" ← "Accounts payable
//      processing", "electrical codes" ← "NEC", "CPR" ← "BLS", "EMR" ← "HCHB") — via 'alias';
//   2. the same words on ONE line, for a multi-word skill the vocabulary only knew as a contiguous phrase ("patient
//      care" ← "Provide care for 4-5 telemetry patients") — via 'exact';
//   3. the person's own job title ("software engineering" ← "Software Engineer") — via 'title';
//   4. a fundamental of the person's field (algorithms for an engineer) — via 'field', counted, never shown as proof.
// A requirement a résumé line already contradicts is never upgraded; nothing here invents a line.
function proveTheRest(matches, resumeText) {
    if (!String(resumeText || '').trim()) return;
    for (const m of matches) {
        if (m.matched) continue;
        const labels = [m.surface, ...(m.postingPhrases || [])].filter(Boolean);
        const set = (line, via, extra = {}) => Object.assign(m, { matched: true, via, strength: 1, evidence: (line.sentence || line.text).slice(0, 240), evidenceKind: line.kind === 'role' ? 'title' : line.kind === 'bullet' ? 'bullet' : line.kind, inferred: false }, extra);
        const al = aliasProof(resumeText, { labels, acronym: m.termAcronym || null });
        if (al) { set(al.line, al.line.kind === 'role' ? 'title' : 'alias', { aliasKind: al.kind || null }); continue; }
        if (!m.term) {
            // a multi-word canonical whose words sit on one line: its head noun and every other content word
            const variants = labels.map((l) => tokenize(l).map((t) => t.stem).filter((x) => x.length > 2 && !/^(?:and|the|for|with)$/.test(x))).filter((v) => v.length >= 2);
            const line = variants.length ? bestLine(resumeText, variants) : null;
            if (line) { set(line, line.kind === 'role' ? 'title' : 'exact'); continue; }
        }
        const full = tokenize(m.surface || '').map((t) => t.stem).filter((x) => x.length > 2);
        const tl = titleProof(resumeText, labels, full);
        if (tl) { set(tl, 'title'); continue; }
        const fam = fundamentalOf(resumeText, labels);
        if (fam) {
            const role = proofLines(resumeText).find((l) => l.kind === 'role' && l.title);
            set(role || { text: '', kind: 'role' }, 'field', { inferred: true, fundamental: true, evidence: role ? role.text.slice(0, 240) : null });
        }
    }
}
const CREDENTIAL_RE = /\b(?:licen[sc]\w*|certif\w*|registered nurse|RN|LPN|LVN|CNA|BLS|ACLS|PALS|NRP|CPR|CDL|CPA|PMP|STCW|COC|OSHA\s*\d+|servsafe|food handler|EPA\s*608|first aid|journeyman|master electrician)\b/i;
const LANGUAGE_RE = /\b(?:spanish|french|german|mandarin|chinese|cantonese|japanese|korean|vietnamese|tagalog|arabic|russian|portuguese|italian|hindi|bilingual|asl|sign language)\b/i;
const SCHEDULE_RE = /\b(?:shifts?|weekends?|nights?|overnight|holidays?|on[- ]call|availability|schedule flexibility|overtime)\b/i;
const FIELD_RE = /^(?:software (?:engineering|development)|patient care|nursing(?: practice| care)?|accounting|bookkeeping|customer service|sales|marketing|electrical(?: systems| work)?|engineering|data analytics|data science|machine learning|hospitality|retail|warehouse|logistics|teaching|project management|human resources|finance|operations|acute care|post-acute care|home health|med-surg|telemetry|critical care|public accounting|corporate accounting|construction|manufacturing|food service)$/i;
/**
 * The KIND of a requirement, best effort, so every consumer can phrase it the same way without its own classifier:
 * 'tool' (a named product or system), 'skill', 'field' (an area of work: patient care, accounting), 'credential'
 * (licence / certification), 'duty' (what the job does, read from a duty line), 'trait' (a soft skill), 'language',
 * 'schedule'.
 */
export function requirementKind(m) {
    const label = String(m.surface || m.requirement || '').trim();
    if (m.soft) return 'trait';
    const entry = aliasEntriesFor([label, ...(m.postingPhrases || [])])[0];
    if (entry && entry.kind) return entry.kind;
    if (m.aliasKind === 'credential' || CREDENTIAL_RE.test(label)) return 'credential';
    if (LANGUAGE_RE.test(label)) return 'language';
    if (SCHEDULE_RE.test(label) && label.split(/\s+/).length <= 3) return 'schedule';
    if (FIELD_RE.test(label)) return 'field';
    if (/\b(?:degree|diploma|bachelor|master|associate|BSN|MSN|ADN|BA|BS|MBA|GED)\b/.test(label)) return 'credential';
    if (/^(?:HIPAA|OSHA|GAAP|SOX|FERPA|PCI(?:-DSS)?|GDPR|FDA|EEOC|ADA)$/.test(label)) return 'skill';
    if (m.aliasKind === 'tool' || isTool(m.requirement)) return 'tool';
    // a product name / acronym the posting names ("Cameo", "HCHB", "Google Tag Manager", "NetSuite")
    if (/^[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+$|^[A-Z0-9][A-Z0-9&/+.-]{1,9}$/.test(label) || /^(?:[A-Z][\w+#.-]*\s?){1,4}$/.test(label)) return 'tool';
    if (m.term && m.section === 'responsibilities') return 'duty';
    return 'skill';
}
// A skill the posting illustrates with examples ("an ERP system (SAP, Oracle, or NetSuite)", "a
// ticketing system such as Zendesk, Freshdesk, or ServiceNow") is met by any one example; when the
// skill itself is met, its examples are not separate gaps (an accountant on NetSuite was told
// "missing: sap", 2026-10-25). Mutates `matches`.
function creditExamples(matches) {
    const byReq = new Map(matches.map((m) => [m.requirement, m]));
    for (const head of matches) {
        if (!head.examples || head.matched) continue;
        const ex = head.examples.map((e) => byReq.get(e)).find((m) => m && m.matched);
        if (!ex) continue;
        Object.assign(head, { matched: true, via: 'alias', strength: Math.max(head.strength, ex.strength), evidence: ex.evidence, evidenceKind: ex.evidenceKind, relatedTo: ex.requirement });
    }
    const drop = new Set();
    for (const m of matches) {
        if (m.matched || !m.exampleOf) continue;
        const head = byReq.get(m.exampleOf);
        if (head && head.matched) drop.add(m);
    }
    for (let i = matches.length - 1; i >= 0; i--) if (drop.has(matches[i])) matches.splice(i, 1);
}
// A set of ALTERNATIVES ("at least one of Go, Java, C/C++ etc.") is ONE requirement, met by any
// member. Met → the members the résumé does not show are dropped (the posting never asked for all
// of them); unmet → one row stands for the set, labelled "one of go, java". Before this the free
// fit check told a Go engineer "Missing required skill: java" (2026-10-25). Mutates `matches`.
function collapseAlternatives(matches) {
    const groups = new Map();
    for (const m of matches)
        if (m.anyOf)
            groups.set(m.anyOf, [...(groups.get(m.anyOf) || []), m]);
    if (!groups.size)
        return;
    const drop = new Set();
    for (const members of groups.values()) {
        const met = members.filter((m) => m.matched);
        if (met.length) {
            for (const m of members)
                if (!m.matched)
                    drop.add(m);
            continue;
        }
        const [first, ...rest] = members;
        first.surface = `one of ${members.map((m) => m.surface).join(', ')}`;
        first.alternatives = members.map((m) => m.surface);
        first.weight = Math.max(...members.map((m) => m.weight));
        for (const m of rest)
            drop.add(m);
    }
    for (let i = matches.length - 1; i >= 0; i--)
        if (drop.has(matches[i]))
            matches.splice(i, 1);
}
// Weighted coverage: each requirement contributes its weight; a related-only match
// contributes RELATED_CREDIT of full credit. Returns 1 when there are no
// requirements in the bucket (a job with no preferred skills isn't "failing").
function weightedCoverage(bucket, allMatches, which) {
    void allMatches;
    void which;
    if (bucket.length === 0)
        return 1;
    let total = 0;
    let got = 0;
    for (const m of bucket) {
        total += m.weight;
        if (m.matched) {
            // a soft skill is never stated literally; shown through a related hard skill it is
            // as proven as a soft skill gets (RELATED_MAX)
            got += m.weight * (m.via === 'related' ? (m.soft ? RELATED_MAX : relatedCredit(m.strength)) : 1);
        }
    }
    return total === 0 ? 1 : Math.max(0, Math.min(1, got / total));
}
// Seniority alignment 0–1. Perfect when ranks match; degrades with distance.
// Being one level under the role is a bigger miss than being one level over.
export function seniorityAlignment(jobRank, resumeRank) {
    if (!jobRank || !resumeRank)
        return 0.6; // unknown on either side → neutral-ish
    const diff = resumeRank - jobRank;
    if (diff === 0)
        return 1;
    if (diff > 0)
        return Math.max(0.5, 1 - diff * 0.15); // overqualified, mild penalty
    return Math.max(0, 1 + diff * 0.25); // underqualified, steeper penalty
}
