// A small, deterministic stemmer for requirement matching. "Trained" must match "training",
// "cashiers" must match "cashier", "balanced a drawer" must match "balance drawer" — the live
// audits (2026-10-24) saw "training" listed as a MISSING required skill against a résumé that
// says "Trained 4 new front-desk hires". Crude on purpose (no dictionary): the same function
// runs on both sides, so what matters is consistency, not linguistic correctness. The literal,
// un-stemmed check survives only in scoreAts ("what the bot literally sees").

const KEEP = new Set(['pos', 'gas', 'bus', 'plus', 'yes', 'ads', 'upt', 'crm', 'sql', 'aws', 'ged', 'ats', 'eeo', 'ems', 'rn', 'cpr', 'bls', 'osha', 'sms']);
// Words whose inflected shape is a different thing: "registered" (nurse) is not "register".
// Gerund NOUNS whose verb is a different, common word: "Account Management" is not accounting,
// a "work schedule" is not scheduling, "receive training" is not receiving (the dock function).
const EXCEPTIONS = {
  registered: 'registered', registration: 'registration', registrations: 'registration', billing: 'billing', billed: 'bill', bills: 'bill',
  accounting: 'accounting', marketing: 'marketing', scheduling: 'scheduling', receiving: 'receiving', shipping: 'shipping',
  packing: 'packing', staffing: 'staffing', banking: 'banking', catering: 'catering', routing: 'routing', housing: 'housing',
  engineering: 'engineering', programming: 'programming', networking: 'networking', budgeting: 'budgeting', planning: 'planning',
};

export function stemWord(w) {
  let t = String(w || '').toLowerCase();
  if (t.length <= 3 || KEEP.has(t) || /\d/.test(t)) return t;
  if (EXCEPTIONS[t]) return EXCEPTIONS[t];
  // plural first (trainings → training), then the verbal suffix (training → train)
  if (/ies$/.test(t) && t.length > 4) t = t.slice(0, -3) + 'y';
  else if (/(?:ches|shes|xes|zes)$/.test(t) && t.length > 5) t = t.slice(0, -2);
  else if (/s$/.test(t) && !/(?:ss|us|is)$/.test(t)) t = t.slice(0, -1);
  if (/ing$/.test(t) && t.length > 5) t = t.slice(0, -3);
  else if (/ied$/.test(t) && t.length > 4) t = t.slice(0, -3) + 'y';
  else if (/ed$/.test(t) && t.length > 4) t = t.slice(0, -2);
  // a doubled final consonant from inflection (planned → plann, stopping → stopp) and a silent e
  // both fold to the bare stem so "manage" / "managed" / "managing" meet at "manag"
  if (/([b-df-hj-np-tv-z])\1$/.test(t) && t.length > 4) t = t.slice(0, -1);
  if (/e$/.test(t) && t.length > 3) t = t.slice(0, -1);
  return t;
}

const SLASH_NAMES = new Set(['c/c++', 'ci/cd', 'a/b', 'pl/sql', 'tcp/ip', 'ui/ux', 'and/or', 'pub/sub', 'pick/pack', 'p/l', 'i/o', 'n/a', 'w/', 'r/w']);
/** Lower-case word tokens with their character offsets in the source text. */
export function tokenize(text) {
  const out = [];
  const re = /[a-z0-9][a-z0-9+#./'-]*/gi;
  let m;
  const src = String(text || '');
  while ((m = re.exec(src)) !== null) {
    const raw = m[0].replace(/^[./'-]+|[./'-]+$/g, '');
    if (!raw) continue;
    // A slash between two words is a list ("Kafka/CDC", "Instagram/TikTok", "primary/preferred"): each
    // word is its own token. A slash inside one name (C/C++, CI/CD, A/B, 24/7, and/or) is not.
    if (raw.includes('/') && !SLASH_NAMES.has(raw.toLowerCase()) && !/\d\/\d/.test(raw)) {
      let off = m.index + m[0].indexOf(raw);
      for (const part of raw.split('/')) {
        const p = part.replace(/^[.'-]+|[.'-]+$/g, '');
        if (p) { const at = src.indexOf(p, off); out.push({ raw: p.toLowerCase(), stem: stemWord(p), start: at, end: at + p.length }); }
        off += part.length + 1;
      }
      continue;
    }
    out.push({ raw: raw.toLowerCase(), stem: stemWord(raw), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function stemPhrase(phrase) {
  return tokenize(phrase).map((t) => t.stem);
}

/**
 * Every occurrence of `phrase` in `tokens` by stem equality. Returns [{ start, end, index }]
 * (character offsets of the whole match, token index of its first word).
 */
export function findStemmed(tokens, phrase) {
  const want = Array.isArray(phrase) ? phrase : stemPhrase(phrase);
  const out = [];
  if (!want.length) return out;
  for (let i = 0; i + want.length <= tokens.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) if (tokens[i + k].stem !== want[k]) { ok = false; break; }
    if (ok) out.push({ start: tokens[i].start, end: tokens[i + want.length - 1].end, index: i });
  }
  return out;
}

/** True when `phrase` occurs in `text` by stem (whole words). */
export function hasStemmed(text, phrase) {
  return findStemmed(tokenize(text), phrase).length > 0;
}

/**
 * The sentence (or bullet line) that contains character `index` — cut at sentence punctuation,
 * bullet glyphs and line breaks, never mid-word. Hyphenated line breaks ("full-\ntime") are
 * joined by the caller before extraction (dehyphenate), so no snippet starts with "time …".
 */
export function sentenceAt(text, index, max = 240) {
  const src = String(text || '');
  let s = index, e = index;
  const stop = /[.!?;\n•▪◦·‣]/;
  while (s > 0 && !stop.test(src[s - 1])) s--;
  while (e < src.length && !stop.test(src[e])) e++;
  return src.slice(s, e).replace(/^[\s•▪◦·‣\-–*]+/, '').trim().slice(0, max);
}

/** Join words broken across a line with a hyphen ("full-\ntime" → "full-time"). */
export function dehyphenate(text) {
  return String(text || '').replace(/([A-Za-z])-\n\s*([a-z])/g, '$1-$2');
}
