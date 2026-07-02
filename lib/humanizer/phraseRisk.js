// Local phrase-risk dictionary — the heart of the keyless humanizer. NO external AI.
//
// These are generic AI/résumé-generator phrases that read as machine-written or
// corporate filler. Each carries a category, severity, and a plain-language replacement
// hint. The DB table phrase_risk_rules (migration 029) seeds the same set so admins can
// extend it without a deploy; the server may pass those rows in as `extraRules`, but the
// engine is fully usable with these built-ins alone (so unit tests run with no DB).
//
// FRAMING: replacements make writing plainer, more specific, and easier to defend in an
// interview. They are NOT about defeating detectors.
// Built-in rules. `phrase` is the lowercased surface form we match (word-boundary,
// case-insensitive). `replacementHint` is a plain, believable alternative; some are
// context-dependent and resolved against résumé facts in humanizeBullet.ts.
export const BUILTIN_PHRASE_RULES = [
    // ── verbs / generator filler (ai_slop) ──
    // Common conjugations are listed explicitly so the matcher stays exact (no stemming).
    rule('leveraged', 'ai_slop', 'medium', 'used'),
    rule('leveraging', 'ai_slop', 'medium', 'using'),
    rule('leverage', 'ai_slop', 'medium', 'use'),
    rule('utilized', 'ai_slop', 'medium', 'used'),
    rule('utilizing', 'ai_slop', 'medium', 'using'),
    rule('utilize', 'ai_slop', 'medium', 'use'),
    rule('spearheaded', 'ai_slop', 'medium', 'led'),
    rule('spearheading', 'ai_slop', 'medium', 'leading'),
    rule('spearhead', 'ai_slop', 'medium', 'lead'),
    rule('optimized', 'ai_slop', 'medium', 'improved'),
    rule('optimizing', 'ai_slop', 'medium', 'improving'),
    rule('optimize', 'ai_slop', 'medium', 'improve'),
    rule('streamlined', 'ai_slop', 'medium', 'simplified'),
    rule('streamlining', 'ai_slop', 'medium', 'simplifying'),
    rule('demonstrated excellence', 'ai_slop', 'high', 'showed'),
    rule('responsible for ensuring', 'ai_slop', 'medium', 'helped make sure'),
    rule('successfully managed various tasks', 'vague_claim', 'high', 'handled specific tasks'),
    rule('played a key role', 'vague_claim', 'high', 'helped with'),
    rule('assisted with various duties', 'vague_claim', 'high', 'helped with specific duties'),
    rule('worked effectively', 'vague_claim', 'medium', 'worked on'),
    rule('contributed to success', 'vague_claim', 'high', 'helped with'),
    rule('ensured customer satisfaction', 'vague_claim', 'medium', 'helped customers'),
    // ── buzzwords / corporate self-description (buzzword) ──
    rule('proven track record', 'buzzword', 'high', 'experience with'),
    rule('results-driven', 'buzzword', 'high', null),
    rule('results driven', 'buzzword', 'high', null),
    rule('dynamic professional', 'buzzword', 'high', null),
    rule('fast-paced environment', 'buzzword', 'medium', 'busy shift'),
    rule('fast paced environment', 'buzzword', 'medium', 'busy shift'),
    rule('cross-functional collaboration', 'buzzword', 'medium', 'working with other teams'),
    rule('cross functional collaboration', 'buzzword', 'medium', 'working with other teams'),
    rule('detail-oriented professional', 'buzzword', 'high', 'careful with details'),
    rule('detail oriented professional', 'buzzword', 'high', 'careful with details'),
    rule('highly motivated individual', 'buzzword', 'high', null),
    rule('passionate about delivering results', 'buzzword', 'high', null),
    rule('strong communication skills', 'buzzword', 'medium', 'clear updates'),
];
function rule(phrase, category, severity, replacementHint) {
    return { phrase: phrase.toLowerCase(), category, severity, replacementHint };
}
// Merge DB rules over the built-ins, keyed by phrase (DB wins). Both are lowercased.
export function mergeRules(extra) {
    if (!extra || !extra.length)
        return [...BUILTIN_PHRASE_RULES];
    const byPhrase = new Map();
    for (const r of BUILTIN_PHRASE_RULES)
        byPhrase.set(r.phrase, r);
    for (const r of extra) {
        if (r && r.phrase)
            byPhrase.set(String(r.phrase).toLowerCase(), { ...r, phrase: String(r.phrase).toLowerCase() });
    }
    return [...byPhrase.values()];
}
export function findPhraseMatches(text, rules) {
    const src = String(text || '');
    if (!src.trim())
        return [];
    const lower = src.toLowerCase();
    const out = [];
    for (const r of rules) {
        const needle = r.phrase;
        if (!needle)
            continue;
        let from = 0;
        while (true) {
            const idx = lower.indexOf(needle, from);
            if (idx === -1)
                break;
            const before = idx === 0 ? ' ' : lower[idx - 1];
            const after = idx + needle.length >= lower.length ? ' ' : lower[idx + needle.length];
            const boundaryBefore = !/[a-z0-9]/.test(before);
            const boundaryAfter = !/[a-z0-9]/.test(after);
            if (boundaryBefore && boundaryAfter) {
                out.push({ rule: r, index: idx, matched: src.slice(idx, idx + needle.length) });
            }
            from = idx + needle.length;
        }
    }
    // Sort by position; when phrases overlap, prefer the longer (more specific) match.
    out.sort((a, b) => (a.index - b.index) || (b.rule.phrase.length - a.rule.phrase.length));
    const dedup = [];
    let lastEnd = -1;
    for (const m of out) {
        if (m.index >= lastEnd) {
            dedup.push(m);
            lastEnd = m.index + m.rule.phrase.length;
        }
    }
    return dedup;
}
// Preserve the original capitalization of the first character when substituting.
export function matchCase(replacement, original) {
    if (!replacement)
        return replacement;
    if (original && original[0] === original[0].toUpperCase() && /[a-z]/i.test(original[0])) {
        return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
}
