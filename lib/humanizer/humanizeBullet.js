// Rewrite a single generic bullet into a specific, plain, human one. NO external AI.
//
// CORE RULE (anti-hallucination): we only ever ADD context that is supported by the
// user's real facts (résumé facts / job facts / optimizer matches / role family). We
// replace generic phrasing with plainer wording from the phrase dictionary, and we add
// human work texture drawn from the role-family detail map — but ONLY details that the
// facts support. We NEVER invent numbers, tools, certs, titles, or seniority. If a
// number/tool/claim would help but isn't verified, it is NOT placed in the bullet — the
// caller routes it to confirm_before_using instead.
//
// INTEGRITY RULE (2026-10-25, Dev's "92% → 9%"): an edit never reaches inside a number, a date,
// a phone number, an e-mail address or a link (lib/humanizer/protect.js), a line with nothing to
// change is returned byte-for-byte (no added period, no re-capitalized "Linkedin.com"), and every
// edited line is checked against `numbersIntact` — an edit that lost or altered a number is
// thrown away and the user's own line is kept.
import { findPhraseMatches, matchCase } from './phraseRisk.js';
import { resolveContextReplacement, inferRoleFamily, ROLE_DETAILS } from './roleDetails.js';
import { protectedRanges, overlapsProtected, numbersIntact } from './protect.js';

// Marks the place a phrase was removed, so the clean-up only ever touches what the removal left
// behind (a dangling "and", a doubled space) and never the rest of the user's line.
const GAP = '\u0000';

// Apply dictionary replacements to a single bullet. Context-dependent hints (e.g.
// "fast-paced environment" → a role-specific phrase) are resolved against the role
// family and the supported facts. Hints that are null (pure buzzwords with no plain
// equivalent, like "results-driven") are removed cleanly.
//
// opts.source — the user's text before an earlier pass (summary/message openers) edited it; the
// integrity check and the punctuation/capitalization rules compare against it.
export function humanizeBullet(bullet, opts = {}) {
    const working = String(bullet || '');
    const source = typeof opts.source === 'string' ? opts.source : working;
    const unchanged = { text: source, changed: false, evidenceUsed: [], changes: [] };
    if (!working.trim())
        return unchanged;
    const guarded = protectedRanges(working);
    const matches = findPhraseMatches(working, opts.rules)
        .filter((m) => !overlapsProtected(guarded, m.index, m.index + m.rule.phrase.length));
    if (matches.length === 0 && working === source)
        return unchanged;
    const changes = [];
    // Rebuild the string left-to-right, substituting each matched span.
    let out = '';
    let cursor = 0;
    for (const m of matches) {
        out += working.slice(cursor, m.index);
        const replacement = resolveContextReplacement(m.rule, {
            roleFamily: opts.roleFamily,
            resumeFacts: opts.resumeFacts,
            jobFacts: opts.jobFacts,
        });
        if (replacement === null) {
            // Pure buzzword with no plain equivalent → drop it (cleanup handles the connector).
            changes.push({ from: m.matched, to: '(removed)', reason: 'Removed an empty buzzword that added no work context.' });
            out += GAP;
        }
        else {
            const cased = matchCase(replacement, m.matched);
            out += cased;
            changes.push({ from: m.matched, to: cased, reason: 'Replaced generic phrasing with plainer, more specific wording.' });
        }
        cursor = m.index + m.rule.phrase.length;
    }
    out += working.slice(cursor);
    const text = cleanupEdit(out, source);
    if (!text.trim() || !numbersIntact(source, text))
        return unchanged;
    return { text, changed: text !== source, evidenceUsed: [], changes: text !== source ? changes : [] };
}

// Collapse the artifacts of removals — only around the removal marks — then restore the
// original's sentence shape: its first-letter case and its terminal punctuation (or lack of it).
export function cleanupEdit(edited, original) {
    let t = String(edited || '');
    if (t.includes(GAP)) {
        t = t
            .replace(new RegExp(`(^|[.;:]\\s*)${GAP}[\\s,]*(?:and|with|to|by|for)?\\s*`, 'gi'), '$1')
            .replace(new RegExp(`\\s*(?:\\b(?:and|with|to|by|for|a|an))?\\s*${GAP}\\s*([,.;:!?)]|$)`, 'gi'), '$1')
            .replace(new RegExp(`\\s*${GAP}\\s*`, 'g'), ' ');
    }
    t = t
        .replace(/,\s*,/g, ',')
        // Drop an article ("a"/"an") left stranded in front of a plural replacement, e.g.
        // "in a busy shifts" → "during busy shifts". Only when the next word ends in "s".
        .replace(/\b(in|on|at|during)\s+an?\s+(busy shifts|time-sensitive routes|arrival and departure rushes)\b/gi, '$1 $2')
        .replace(/\ba\s+(busy shifts|time-sensitive routes|arrival and departure rushes)\b/gi, '$1')
        // Fix article agreement before a vowel ("a experience" → "experience"; drop the
        // article rather than guess "an", since the replacement is a mass/plural noun).
        .replace(/\b(with|of|in|for)\s+a\s+(experience|updates|details|records)\b/gi, '$1 $2')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/^[\s,;:]+/, '')
        .replace(/\s+$/, '');
    const src = String(original || '');
    // First letter: keep the original's case (never re-capitalize "linkedin.com/…").
    const firstSrc = src.trim()[0] || '';
    if (t && /[a-z]/.test(t[0]) && /[A-Z]/.test(firstSrc))
        t = t[0].toUpperCase() + t.slice(1);
    // Terminal punctuation: the original's — added back only if it had one, never invented.
    const endSrc = (src.trim().match(/[.!?]$/) || [''])[0];
    if (endSrc && t && !/[.!?]$/.test(t))
        t += endSrc;
    return t;
}

// A number phrase as written in the text, bounded so it is never a piece of a longer number:
// "2" never matches inside "92%", "2022" or "Sev-2"-style tokens unless it stands alone.
function numberPhraseRe(phrase) {
    const esc = String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\w$.,])(?:(?:by|of|to|over|reaching)\\s+)?(${esc})(?![\\w%]|[.,]\\d)`, 'gi');
}

// Remove unsupported claims (numbers/tools not in the user's facts) from already-
// humanized text, so the deliverable NEVER asserts something the résumé can't back. The
// removed claims are surfaced separately via confirm_before_using. A number is removed only as a
// whole token outside any protected span (date, phone, e-mail, link); if the result fails the
// integrity check the text is returned unchanged and the claim is still surfaced.
export function stripUnsupportedClaims(text, unsupported) {
    const source = String(text || '');
    let out = source;
    const changes = [];
    const removed = [];
    for (const metric of unsupported.metrics || []) {
        if (!metric)
            continue;
        const guarded = protectedRanges(out);
        const re = numberPhraseRe(metric);
        let m;
        let hit = null;
        while ((m = re.exec(out)) !== null) {
            const start = m.index + m[1].length;
            const end = m.index + m[0].length;
            if (!overlapsProtected(guarded, start, end)) { hit = { start, end }; break; }
            if (re.lastIndex === m.index) re.lastIndex++;
        }
        if (!hit)
            continue;
        out = out.slice(0, hit.start) + GAP + out.slice(hit.end);
        removed.push(metric);
        changes.push({ from: metric, to: '(moved to confirm-before-using)', reason: 'Removed an unsupported number; surfaced it for you to confirm instead of asserting it.' });
    }
    for (const tool of unsupported.tools || []) {
        if (!tool)
            continue;
        const esc = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b(in|with|using|on)\\s+${esc}\\b|\\b${esc}\\b`, 'i');
        if (re.test(out)) {
            out = out.replace(re, GAP);
            changes.push({ from: tool, to: '(moved to confirm-before-using)', reason: 'Removed a tool not in your résumé; surfaced it for you to confirm instead of asserting it.' });
        }
    }
    if (!changes.length)
        return { text: source, changes: [] };
    const cleaned = cleanupEdit(out, source);
    if (!numbersIntact(source, cleaned, removed))
        return { text: source, changes: [] };
    return { text: cleaned, changes };
}
export { inferRoleFamily, ROLE_DETAILS };
