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
import { isTool } from './extractResumeFacts.js';
const LANGS = /\b(spanish|french|german|mandarin|chinese|cantonese|japanese|korean|vietnamese|tagalog|arabic|russian|portuguese|italian|hindi|english)\b/g;
function ownSpelling(label, resumeText) {
    const esc = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
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
        .filter((m) => m.matched && m.via === 'related' && m.relatedTo)
        .map((m) => ownSpelling(pretty(m.relatedTo), resumeText));
    const topDirect = [...new Set(direct)].slice(0, 3);
    const lower = new Set(topDirect.map((d) => d.toLowerCase()));
    const topRelated = [...new Set(related)].filter((r) => !lower.has(r.toLowerCase())).slice(0, 2);
    const sentences = [];
    // 1. Intent — role-specific.
    sentences.push(`I'm applying for the ${role} position${at} and believe my background is a strong match.`);
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
