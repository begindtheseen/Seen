// ONE sentence splitter for posting and résumé prose. Pure, deterministic, no I/O.
//
// Why it exists (paid-tool test, 2026-10-25): five readers each split sentences with their own
// regex, and every one of them broke on "e.g.":
//   • lib/jobs/descriptionText.js grouped a listing into paragraphs with a MATCH regex
//     (`[^.!?]+[.!?]+(?:\s+|$)`), which silently SKIPS any run it cannot match — Kunai's "What
//     you'll do … event-driven (e.g. Kafka/CDC)" lost 1,000 characters and "About this role" read
//     "consume this data safely. g. Kafka/CDC)";
//   • lib/optimizer/postingSections.js split after "(e.g." so "Kling, Higgsfield, Veo …" became a
//     sentence of its own, cut away from the requirement it belonged to.
// Rules: a boundary is sentence punctuation followed by whitespace and a sentence start, never
// after an abbreviation ("e.g.", "i.e.", "etc.", "Sr.", "U.S.", "a.m."), a single initial, or
// inside parentheses/brackets. Nothing is ever dropped: the pieces joined with single spaces are
// the input with its whitespace collapsed.

// Abbreviations whose period never ends a sentence. Lower-case compare on the token before the dot.
const ABBREVIATIONS = new Set([
  'e.g', 'eg', 'i.e', 'ie', 'etc', 'vs', 'v', 'incl', 'approx', 'est', 'dept', 'govt', 'misc', 'no', 'nos',
  'vol', 'fig', 'inc', 'ltd', 'co', 'corp', 'llc', 'jr', 'sr', 'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'ave',
  'mt', 'ft', 'u.s', 'u.k', 'u.s.a', 'a.m', 'p.m', 'ph.d', 'b.s', 'b.a', 'm.s', 'm.a', 'm.b.a', 'cf', 'al',
  'ca', 'yrs', 'yr', 'hrs', 'hr', 'mos', 'wk', 'wks', 'min', 'max', 'avg', 'ext', 'tel', 'attn', 'resp',
]);
// "etc." also ends sentences; it is treated as an abbreviation only when what follows is not a new
// sentence start word — see isBoundary.
const SENTENCE_START_RE = /^[\s]*["“‘'(\[]?[A-Z0-9•●▪◦*–—-]/;
const OPEN = new Set(['(', '[']);
const CLOSE = new Set([')', ']']);
// An unbalanced "(" (a dropped closer in scraped text) stops protecting after this many chars.
const PAREN_REACH = 240;

function tokenBefore(text, dotIndex) {
  let i = dotIndex - 1;
  while (i >= 0 && /[A-Za-z.]/.test(text[i])) i--;
  return text.slice(i + 1, dotIndex).replace(/^\.+/, '').toLowerCase();
}

/**
 * Split prose into sentences. Line breaks are kept as hard boundaries.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const out = [];
  for (const line of String(text || '').replace(/\r/g, '\n').split(/\n+/)) {
    const l = line.replace(/\s+/g, ' ').trim();
    if (l) out.push(...splitLine(l));
  }
  return out;
}

function splitLine(l) {
  const out = [];
  let start = 0;
  let depth = 0;
  let openedAt = -1;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (OPEN.has(ch)) { if (depth === 0) openedAt = i; depth++; continue; }
    if (CLOSE.has(ch)) { if (depth > 0) depth--; continue; }
    if (depth > 0 && i - openedAt > PAREN_REACH) depth = 0; // unbalanced: stop protecting
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    // the whole punctuation run ("?!", "...") plus closing quotes/brackets
    let j = i;
    while (j + 1 < l.length && /[.!?]/.test(l[j + 1])) j++;
    while (j + 1 < l.length && /["”’')\]]/.test(l[j + 1])) j++;
    if (j + 1 >= l.length || l[j + 1] !== ' ') { i = j; continue; }
    const rest = l.slice(j + 1);
    if (depth > 0 || !SENTENCE_START_RE.test(rest)) { i = j; continue; }
    if (ch === '.' && j === i) {
      const tok = tokenBefore(l, i);
      // a single initial ("J. Smith") or an abbreviation is not a sentence end
      if (/^[a-z]$/.test(tok) && /[A-Z]/.test(l[i - 1] || '')) { i = j; continue; }
      if (ABBREVIATIONS.has(tok) && !(tok === 'etc' && /^\s+(?:[A-Z][a-z]+\s|[0-9])/.test(rest))) { i = j; continue; }
    }
    out.push(l.slice(start, j + 1).trim());
    start = j + 1;
    i = j;
  }
  const tail = l.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Cut text to at most `max` characters at a sentence end, else at a word boundary with an
 * ellipsis — never mid-word.
 */
export function cutAtSentence(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  let acc = '';
  for (const s of splitSentences(t)) {
    if ((acc ? acc.length + 1 : 0) + s.length > max) break;
    acc = acc ? `${acc} ${s}` : s;
  }
  if (acc) return acc;
  const head = t.slice(0, max - 1);
  const ws = head.lastIndexOf(' ');
  return `${(ws > max * 0.5 ? head.slice(0, ws) : head).replace(/[\s,;:—–-]+$/, '')}…`;
}
