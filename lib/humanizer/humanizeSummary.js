// Humanize an over-polished résumé summary paragraph. NO external AI.
//
// Summaries are the most AI-tell-heavy part of a résumé ("a highly accomplished,
// results-driven professional with a proven track record…"). We strip the over-polished
// framing and generic buzzwords, keeping only plain statements that the résumé facts
// support. We NEVER add a credential, number, or claim the facts don't already contain.
import { humanizeBullet } from './humanizeBullet.js';
const OVERPOLISHED_STRIP = [
    /\bhighly\s+(accomplished|skilled|experienced|motivated)\b/gi,
    /\ba\s+proven\s+ability\s+to\b/gi,
    /\bseasoned\s+professional\b/gi,
    /\bwealth\s+of\s+experience\b/gi,
    /\bunparalleled\b/gi,
    /\bexceptional\s+(track record|ability|talent)\b/gi,
    /\bconsistently\s+(deliver|exceed|surpass)\w*\b/gi,
];
export function humanizeSummary(summary, opts) {
    const original = String(summary || '');
    if (!original.trim())
        return { text: original, changed: false, changes: [] };
    const changes = [];
    let working = original;
    // 1. Strip over-polished framing outright.
    for (const re of OVERPOLISHED_STRIP) {
        working = working.replace(re, (m) => {
            changes.push({ from: m, to: '(removed)', reason: 'Removed over-polished, machine-sounding summary language.' });
            return '';
        });
    }
    // 2. Run the bullet humanizer over the remaining sentences for dictionary replacements
    //    and role-grounded context (it tidies leftover spacing/connectors too).
    const result = humanizeBullet(working, { rules: opts.rules, roleFamily: opts.roleFamily, resumeFacts: opts.resumeFacts });
    for (const c of result.changes)
        changes.push(c);
    return { text: result.text, changed: changes.length > 0, changes };
}
