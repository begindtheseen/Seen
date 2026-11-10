// Deterministic application message generation. NO external AI.
//
// Produces a 3–5 sentence, role-specific message using ONLY supported facts (matched
// skills with résumé evidence). Confident but not fake: no exaggerated claims, no
// unsupported tools, no invented numbers. Pure string assembly from templates.
function pretty(s) {
    return s.replace(/^(metric:|seniority:|cert:|education:)/, '');
}
function joinList(items) {
    if (items.length === 0)
        return '';
    if (items.length === 1)
        return items[0];
    if (items.length === 2)
        return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
// The résumé's own spelling of a skill ("Salesforce", "SQL", "Bilingual English/Spanish"), never the
// engine's lower-cased label ("my experience with python, go, and sql", harness 2026-10-25).
import { escapeRegExp } from '../text/escapeRegExp.js';
import { isTool } from './extractResumeFacts.js';
import { readableStatement, shortRole } from '../resume/tailor/paid.js';
import { baseFromPast } from '../resume/rewrite/inflect.js';
const LANGS = /\b(spanish|french|german|mandarin|chinese|cantonese|japanese|korean|vietnamese|tagalog|arabic|russian|portuguese|italian|hindi|english)\b/g;
function ownSpelling(label, resumeText) {
    const esc = escapeRegExp(String(label)).replace(/\s+/g, '\\s+');
    const all = [...String(resumeText || '').matchAll(new RegExp(`(?<![A-Za-z0-9])(${esc})(?![A-Za-z0-9])`, 'gi'))];
    if (all.length) {
        // A plain word capitalised only by its position (a sentence start, a Title Case skills list:
        // "Retail team lead…", "Loss prevention, Training") is written lower-case mid-sentence; a name
        // keeps its casing — a tool, an acronym, an inner capital ("QuickBooks", "SQL").
        const plain = /^[A-Z][a-z]+(?: [A-Za-z][a-z]*)*$/;
        const forms = all.map((m) => m[1].replace(/\s+/g, ' '));
        const word = forms.find((w) => !plain.test(w) && w !== w.toLowerCase()) || forms.find((w) => w === w.toLowerCase()) || forms[0];
        if (plain.test(word) && !isTool(String(label).toLowerCase())) return word.toLowerCase().replace(LANGS, (w) => w[0].toUpperCase() + w.slice(1));
        return word;
    }
    if (/^[a-z]{2,4}$/.test(label) && /^(sql|crm|pos|aws|gcp|seo|sem|api|erp|hr|it|qa|ux|ui|bi)$/.test(label)) return label.toUpperCase();
    return String(label).replace(LANGS, (w) => w[0].toUpperCase() + w.slice(1));
}
export function generateApplicationMessage(opts) {
    const role = (opts.jobTitle || 'this role').trim();
    const company = (opts.company || '').trim();
    const at = company ? ` at ${company}` : '';
    const resumeText = opts.resumeText || '';
    // Only fully-supported (exact/alias) matched requirements may be named as strengths.
    const direct = opts.matches
        .filter((m) => m.matched && (m.via === 'exact' || m.via === 'alias'))
        .map((m) => ownSpelling(pretty(m.surface), resumeText));
    // A related-only match is NOT experience in the posting's skill: Maria's message said "I also
    // bring transferable experience in merchandising" — a word her résumé never uses (2026-10-25).
    // What she has is the RELATED skill on her résumé, and that is what the message may name.
    const related = opts.matches
        .filter((m) => m.matched && m.via === 'related' && m.relatedTo && !m.inferred)
        .map((m) => ownSpelling(pretty(m.relatedTo), resumeText));
    const topDirect = [...new Set(direct)].slice(0, 3);
    const lower = new Set(topDirect.map((d) => d.toLowerCase()));
    const topRelated = [...new Set(related)].filter((r) => !lower.has(r.toLowerCase())).slice(0, 2);
    const sentences = [];
    // 1. Intent — role-specific.
    sentences.push(`I'm applying for the ${role} position${at}.`);
    // 2. Direct strengths (only supported facts).
    if (topDirect.length) {
        sentences.push(`My experience with ${joinList(topDirect)} lines up directly with what the role calls for.`);
    }
    else if (topRelated.length) {
        sentences.push(`My background in ${joinList(topRelated)} carries over to the work this role describes.`);
    }
    else {
        sentences.push(`I'd bring the experience on my résumé to the responsibilities of this role.`);
    }
    // 3. Related experience — the résumé's own skill, framed as related, never as the posting's.
    if (topDirect.length && topRelated.length) {
        sentences.push(`I also bring related experience in ${joinList(topRelated)}.`);
    }
    // 4. Close — confident, not fake.
    sentences.push(`I'd welcome the chance to discuss how I can contribute, and I appreciate your consideration.`);
    // Keep it to 3–5 sentences.
    return sentences.slice(0, 5).join(' ');
}

// ── The message to the employer, composed from the verdict (T3, 2026-11-10) ──
// The template above printed the same four sentences for every job ("…believe my background is a strong match…").
// This one is built from THIS posting and THIS résumé: the two strongest things the posting asks for that the résumé
// proves, each with the person's own line (their number when they have one), one sentence on the work as the posting
// itself describes it, in the person's register (hourly vs professional), 90–130 words. No claim the résumé does not
// support; no "match" language at all (the evidence speaks); nothing when the application is blocked.
const HOURLY = new Set(['retail', 'customer_service', 'food_service', 'hospitality', 'valet_parking', 'warehouse', 'delivery_logistics', 'security', 'healthcare_support']);
const words = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const trimLine = (t, max = 24) => {
    const s = String(t || '').replace(/^[\s•·\-–—*]+/, '').replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '').trim();
    const w = s.split(' ');
    if (w.length <= max) return s;
    const cut = w.slice(0, max).join(' ');
    const at = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(';'));
    return (at > 30 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, '');
};
const firstLower = (s) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const coName = (c) => String(c || '').replace(/\s*\([^)]*\)/g, '').split(/,|\s\|\s|\s[—–-]\s/)[0].trim();
// a proof line must say the thing: at least half the requirement's content words (stems) appear in it; a duty is "what I
// do" only when its line shares two content words with it (the reader once cited "Worked during COVID surge…" for
// "Coordinate VA-to-DoD patient transfers")
const STOPW = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'with', 'at', 'by', 'from', 'as', 'all', 'any', 'our', 'your']);
const stems = (t) => String(t || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 2 && !STOPW.has(w)).map((w) => w.replace(/(?:ing|ed|es|s|ion|ions|ment|ments)$/, '').slice(0, 6));
const overlap = (a, b) => { const B = new Set(stems(b)); return [...new Set(stems(a))].filter((x) => B.has(x)).length; };
const sharesHalf = (label, line) => { const L = [...new Set(stems(label))]; return L.length > 0 && overlap(label, line) >= Math.ceil(L.length / 2); };
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * @param {{ out: object, doc: object, jobTitle?: string, employer?: string, blocked?: object|null, family?: string,
 *           self?: { identity?: string, years?: number|null }, verbs?: Set<string> }} p
 * @returns {string} '' when there is nothing true to say, or the application is blocked
 */
export function composeApplicationMessage({ out, doc, jobTitle = '', employer = '', blocked = null, family = '', self = {}, verbs = null } = {}) {
    if (blocked || !out || !doc) return '';
    const role = shortRole(jobTitle) || 'this role';
    const at = employer ? ` at ${employer}` : '';
    const imp = (m) => (m.importance === 'required' ? 2 : m.importance === 'preferred' ? 1 : 0);
    const statement = (m) => readableStatement(m, out) || ownSpelling(pretty(String(m.surface || m.requirement || '').replace(/^term:/, '')), doc ? JSON.stringify(doc.experience || []) : '');
    // where each proving line lives: its role (company, current?)
    const roleOf = (line) => {
        const flat = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const l = flat(line);
        for (const e of doc.experience || []) for (const b of e.bullets || []) if (l && (flat(b.text) === l || (l.length > 20 && flat(b.text).includes(l)))) return { e, text: b.text };
        return null;
    };
    const proven = (out.matched_requirements || []).filter((m) => m.matched && !m.soft && !m.inferred && m.via !== 'related' && m.evidence)
        .map((m) => ({ m, at: roleOf(m.evidence) })).filter((x) => x.at && sharesHalf(String(x.m.surface || x.m.requirement || '').replace(/^term:/, ''), x.at.text))
        .sort((a, b) => imp(b.m) - imp(a.m) || (/\d/.test(b.at.text) - /\d/.test(a.at.text)) || ((b.m.weight || 0) - (a.m.weight || 0)));
    const picks = [];
    for (const p of proven) {
        if (picks.some((q) => q.at.text === p.at.text || statement(q.m).toLowerCase() === statement(p.m).toLowerCase())) continue;
        picks.push(p);
        if (picks.length >= 2) break;
    }
    if (!picks.length) return '';
    // the current (or latest) job speaks first
    const endOf = (e) => (e.end === 'present' || (!e.end && e.start) ? '9999' : String(e.end || '0000'));
    picks.sort((x, y) => (endOf(y.at.e) > endOf(x.at.e) ? 1 : endOf(y.at.e) < endOf(x.at.e) ? -1 : 0));
    const hourly = HOURLY.has(family);
    const isVerb = (w) => !!w && ((verbs && verbs.has(w)) || /ed$/.test(w) || (verbs && !!baseFromPast(w, verbs)));
    // the line in the first person, in the person's own words and tense
    const clause = (p) => {
        const e = p.at.e;
        const current = e.end === 'present' || (!e.end && e.start);
        const line = trimLine(p.at.text);
        const resp = line.match(/^(?:was\s+)?responsible\s+for\s+(.+)$/i);
        if (resp) return `I ${current ? 'am' : 'was'} responsible for ${resp[1]}`;
        const w0 = line.split(' ')[0].toLowerCase().replace(/[^a-z-]/g, '');
        if (isVerb(w0)) return `I ${firstLower(line)}`;
        return `my work included ${firstLower(line)}`;
    };
    const a = picks[0], b = picks[1] || null;
    const label = (m) => ownSpelling(pretty(String(m.surface || m.requirement || '').replace(/^term:/, '')), JSON.stringify(doc.experience || []) + JSON.stringify(doc.skills || []));
    const asks = [label(a.m), ...(b ? [label(b.m)] : [])];
    const identity = self.identity ? String(self.identity).split(/\s+/).map((w) => (/^[A-Z]{2,}$/.test(w) || /[a-z][A-Z]/.test(w) ? w : w.toLowerCase())).join(' ') : '';
    const article = /^[aeiou]/i.test(identity) ? 'an' : 'a';
    const coA = coName(a.at.e.displayCompany || a.at.e.company), coB = b ? coName(b.at.e.displayCompany || b.at.e.company) : '';
    const S = [];
    if (hourly) S.push(`I'd like to apply for the ${role} job${at}. You're looking for someone with ${listAnd(asks)}, and that is work I already do.`);
    else S.push(`Your ${role} opening${at} asks for ${listAnd(asks)}${identity ? `, which is the core of my work as ${article} ${identity}` : ''}.`);
    const ca = clause(a), cb = b ? clause(b) : '';
    if (b && coA && coA === coB) S.push(`At ${coA}, ${ca}, and ${cb.replace(/^I /, '')}.`.replace(/, and my work included/, ', and my work there included'));
    else {
        S.push(`${coA ? `At ${coA}, ` : ''}${ca}.`.replace(/^At ([^,]+), my/, 'At $1, my'));
        if (b) S.push(`${coB ? `At ${coB}, ` : ''}${cb.replace(/^I /, 'I also ')}.`);
    }
    for (let i = 0; i < S.length; i++) S[i] = S[i].charAt(0).toUpperCase() + S[i].slice(1);
    // the work as the posting describes it (a duty line the résumé shows), never a claim it does not show
    const duty = (Array.isArray(out.statements) ? out.statements : []).find((st) => st.kind === 'duty' && st.status === 'shown' && readableStatement({ statementId: st.id }, out) && !asks.some((x) => st.text.toLowerCase().includes(x.toLowerCase())));
    if (duty) {
        const ev = (duty.evidence || []).map((x) => roleOf(x.line)).find((r) => r && overlap(duty.text, r.text) >= 2);
        const where = ev && (ev.e.end === 'present' || (!ev.e.end && ev.e.start)) ? `what I do now at ${coName(ev.e.displayCompany || ev.e.company)}` : ev ? `what I did at ${coName(ev.e.displayCompany || ev.e.company)}` : '';
        if (where) S.push(`You describe the job as "${firstLower(duty.text)}", which is ${where}.`);
    }
    S.push(hourly
        ? `I'd be glad to talk about the ${role} job${employer ? ` at ${employer}` : ''} whenever it suits you.`
        : `I'd welcome a conversation about the role and how my ${asks[0]} work${coA ? ` at ${coA}` : ''} would carry over${employer ? ` to ${employer}` : ''}.`);
    let text = S.join(' ').replace(/\s+/g, ' ').replace(/\.\./g, '.').trim();
    // at most 130 words: the duty sentence goes first
    if (words(text) > 130 && duty) { S.splice(S.findIndex((x) => x.startsWith('You describe')), 1); text = S.join(' '); }
    return text;
}
