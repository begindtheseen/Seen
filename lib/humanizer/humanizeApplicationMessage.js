// Humanize an application / cover message. NO external AI.
//
// Application messages from generators read stiff and generic ("I am writing to express
// my keen interest… I am a results-driven professional with a proven track record…").
// We rewrite to plain, sincere, specific wording, keeping ONLY supported claims. We
// never add a number, tool, or credential the user didn't provide.
import { humanizeBullet } from './humanizeBullet.js';
// Stiff opener clichés → plainer, sincere equivalents.
const OPENER_REPLACEMENTS = [
    { re: /\bI am writing to express my (keen )?interest in\b/gi, to: "I'm applying for" },
    { re: /\bI would like to express my interest in\b/gi, to: "I'm applying for" },
    { re: /\bplease accept my application for\b/gi, to: "I'm applying for" },
    { re: /\bI am confident that I would be a (great|perfect|valuable) (fit|asset|addition)\b/gi, to: 'I think my experience lines up well' },
    { re: /\bI possess\b/gi, to: 'I have' },
    { re: /\bin order to\b/gi, to: 'to' },
];
export function humanizeApplicationMessage(message, opts) {
    const original = String(message || '');
    if (!original.trim())
        return { text: original, changed: false, changes: [] };
    const changes = [];
    let working = original;
    for (const { re, to } of OPENER_REPLACEMENTS) {
        working = working.replace(re, (m) => {
            changes.push({ from: m, to, reason: 'Replaced a stiff cliché with plain, sincere wording.' });
            return to;
        });
    }
    // Apply dictionary + role-grounded replacements over the message body.
    const result = humanizeBullet(working, { rules: opts.rules, roleFamily: opts.roleFamily, resumeFacts: opts.resumeFacts });
    for (const c of result.changes)
        changes.push(c);
    return { text: result.text, changed: changes.length > 0, changes };
}
