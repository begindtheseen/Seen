// Rewrite a single generic bullet into a specific, plain, human one. NO external AI.
//
// CORE RULE (anti-hallucination): we only ever ADD context that is supported by the
// user's real facts (résumé facts / job facts / optimizer matches / role family). We
// replace generic phrasing with plainer wording from the phrase dictionary, and we add
// human work texture drawn from the role-family detail map — but ONLY details that the
// facts support. We NEVER invent numbers, tools, certs, titles, or seniority. If a
// number/tool/claim would help but isn't verified, it is NOT placed in the bullet — the
// caller routes it to confirm_before_using instead.
import { findPhraseMatches, matchCase } from './phraseRisk.js';
import { resolveContextReplacement, inferRoleFamily, ROLE_DETAILS } from './roleDetails.js';
// Apply dictionary replacements to a single bullet. Context-dependent hints (e.g.
// "fast-paced environment" → a role-specific phrase) are resolved against the role
// family and the supported facts. Hints that are null (pure buzzwords with no plain
// equivalent, like "results-driven") are removed cleanly.
export function humanizeBullet(bullet, opts) {
    const original = String(bullet || '');
    if (!original.trim())
        return { text: original, changed: false, evidenceUsed: [], changes: [] };
    const matches = findPhraseMatches(original, opts.rules);
    if (matches.length === 0) {
        return { text: tidy(original), changed: false, evidenceUsed: [], changes: [] };
    }
    const changes = [];
    // Rebuild the string left-to-right, substituting each matched span.
    let out = '';
    let cursor = 0;
    for (const m of matches) {
        out += original.slice(cursor, m.index);
        const replacement = resolveContextReplacement(m.rule, {
            roleFamily: opts.roleFamily,
            resumeFacts: opts.resumeFacts,
            jobFacts: opts.jobFacts,
        });
        if (replacement === null) {
            // Pure buzzword with no plain equivalent → drop it (and a trailing connector).
            changes.push({ from: m.matched, to: '(removed)', reason: 'Removed an empty buzzword that added no work context.' });
            // skip the matched span; tidy() later collapses leftover spaces/connectors
        }
        else {
            const cased = matchCase(replacement, m.matched);
            out += cased;
            changes.push({ from: m.matched, to: cased, reason: 'Replaced generic phrasing with plainer, more specific wording.' });
        }
        cursor = m.index + m.rule.phrase.length;
    }
    out += original.slice(cursor);
    return { text: tidy(out), changed: changes.length > 0, evidenceUsed: [], changes };
}
// Collapse the artifacts of removals: doubled spaces, dangling connectors, leading
// punctuation, and orphaned "and/with/to" left behind when a phrase was dropped.
function tidy(s) {
    let t = s
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.;:])/g, '$1')
        .replace(/(^|[.;:]\s*)(and|with|to|by|for)\s+/gi, '$1')
        .replace(/\s+(and|with|to|by|for)\s*([,.;])/gi, '$2')
        .replace(/,\s*,/g, ',')
        // Drop an article ("a"/"an") left stranded in front of a plural replacement, e.g.
        // "in a busy shifts" → "during busy shifts". Only when the next word ends in "s".
        .replace(/\b(in|on|at|during)\s+an?\s+(\w+s\b)/gi, '$1 $2')
        .replace(/\ba\s+(busy shifts|time-sensitive routes|arrival and departure rushes)\b/gi, '$1')
        // Fix article agreement before a vowel ("a experience" → "experience"; drop the
        // article rather than guess "an", since the replacement is a mass/plural noun).
        .replace(/\b(with|of|in|for)\s+a\s+(experience|updates|details|records)\b/gi, '$1 $2')
        .replace(/\s{2,}/g, ' ')
        .trim();
    // Capitalize the first letter if it was lost.
    if (t && /[a-z]/.test(t[0]))
        t = t[0].toUpperCase() + t.slice(1);
    // Ensure terminal punctuation.
    if (t && !/[.!?]$/.test(t))
        t += '.';
    return t;
}
// Remove unsupported claims (numbers/tools not in the user's facts) from already-
// humanized text, so the deliverable NEVER asserts something the résumé can't back. The
// removed claims are surfaced separately via confirm_before_using. We strip whole
// clauses where possible (e.g. "Served 9999 guests and …" → "Served guests and …") and
// tidy the result. Returns the cleaned text + a record of what was pulled.
export function stripUnsupportedClaims(text, unsupported) {
    let out = String(text || '');
    const changes = [];
    for (const metric of unsupported.metrics) {
        if (!metric)
            continue;
        const esc = metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Try to remove a quantifier clause around the number ("by 80%", "5000 customers").
        const patterns = [
            new RegExp(`\\b(by|of|to|over|reaching)\\s+${esc}`, 'i'),
            new RegExp(`${esc}\\s+`, 'i'),
            new RegExp(esc, 'i'),
        ];
        for (const re of patterns) {
            if (re.test(out)) {
                out = out.replace(re, '');
                changes.push({ from: metric, to: '(moved to confirm-before-using)', reason: 'Removed an unsupported number; surfaced it for you to confirm instead of asserting it.' });
                break;
            }
        }
    }
    for (const tool of unsupported.tools) {
        if (!tool)
            continue;
        const esc = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b(in|with|using|on)\\s+${esc}\\b|\\b${esc}\\b`, 'i');
        if (re.test(out)) {
            out = out.replace(re, '');
            changes.push({ from: tool, to: '(moved to confirm-before-using)', reason: 'Removed a tool not in your résumé; surfaced it for you to confirm instead of asserting it.' });
        }
    }
    return { text: tidy(out), changes };
}
export { inferRoleFamily, ROLE_DETAILS };
