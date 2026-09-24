// Company detection inside harvested Reddit text.
//
// WHY THIS SHAPE: the old ingest asked "for company X, find posts" — one Reddit search per
// company. With 37,791 companies and a batch of 25 per run it reached 0.09% of the catalogue
// in two months, and almost every search was empty because most companies are never discussed.
// This module inverts it: harvest posts first, then ask "which companies does this post name?"
// One post is then a candidate for every company at once.
//
// The naive inversion — loop all 37,791 names per post — is 37M substring tests per run and
// is riddled with false positives, because real company names include Target, Apple, Meta,
// Block, Stripe, Square, Oracle and Gap. So instead we tokenize the POST and look candidate
// n-grams up in a prebuilt index: cost scales with text length, not catalogue size.
//
// Every match is a CLAIM, not a fact (CLAUDE.md anti-gaming): each carries a confidence and
// the evidence that produced it, so a weak match can be weighted down rather than silently
// treated as equal to an unambiguous one.

// Legal suffixes stripped so "Stripe, Inc." and "Stripe" are the same key.
const LEGAL_SUFFIX = /\b(inc|inc\.|llc|l\.l\.c|ltd|ltd\.|limited|corp|corp\.|corporation|co|co\.|company|plc|gmbh|s\.a|sa|nv|ag|holdings|group|technologies|technologie s|labs|software|systems)\b\.?$/i;

// Single-word names that are ordinary English and therefore unsafe to match on their own.
// A post saying "I hit my target" is not a report about Target. These require corroborating
// job context AND a capitalised occurrence in the source text before they count.
const AMBIGUOUS = new Set([
  'target','apple','meta','block','stripe','square','oracle','gap','visa','shell','box',
  'slack','discord','notion','figma','ramp','brex','plaid','chime','robinhood','coinbase',
  'amazon','google','uber','lyft','door','indeed','monster','snap','x','next','arc','path',
  'lever','greenhouse','workday','ashby','angel','wave','bolt','rippling','gusto','deel',
]);

// Words that are never a company on their own even if the catalogue contains them.
const STOPNAME = new Set([
  'the','a','an','and','or','it','is','was','we','they','you','i','my','me','he','she',
  'hr','ceo','cto','pm','swe','sre','job','jobs','work','role','team','company','recruiter',
]);

// Job context — a match is only trustworthy when the surrounding post is about hiring.
export const JOB_CONTEXT = [
  'hiring','interview','interviewed','ghosted','ghosting','rejected','rejection','offer',
  'recruiter','application','applied','applying','onsite','phone screen','final round',
  'heard back','never heard','no response','background check','offer letter','laid off',
  'let go','hiring manager','take home','coding challenge','oa ','assessment','referral',
  'resume','cv','salary','compensation','onboarding','start date','accepted','declined',
];

/** Lowercase, strip punctuation and a trailing legal suffix, collapse whitespace. */
export function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  let s = name.toLowerCase().trim();
  s = s.replace(/[’']/g, '').replace(/[^a-z0-9&+ .-]/g, ' ').replace(/\s+/g, ' ').trim();
  // Strip a trailing legal suffix repeatedly ("Foo Holdings Inc" → "foo").
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEGAL_SUFFIX, '').replace(/[ ,.]+$/, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Build the lookup index once per run.
 * @param {Array<{id?:string,name:string}>} companies
 * @returns {{byKey:Map<string,{id:any,name:string,key:string,words:number,ambiguous:boolean}>, maxWords:number}}
 */
export function buildCompanyIndex(companies) {
  const byKey = new Map();
  let maxWords = 1;
  for (const c of companies || []) {
    const raw = typeof c === 'string' ? c : c?.name;
    const key = normalizeName(raw);
    if (!key || key.length < 2) continue;
    if (STOPNAME.has(key)) continue;
    const words = key.split(' ').length;
    if (words > maxWords) maxWords = Math.min(words, 5);
    // First writer wins so the canonical catalogue name is kept for display.
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: typeof c === 'string' ? null : (c?.id ?? null),
        name: raw,
        key,
        words,
        ambiguous: words === 1 && (AMBIGUOUS.has(key) || key.length <= 3),
      });
    }
  }
  return { byKey, maxWords: Math.min(maxWords, 5) };
}

/** Split text into comparable word tokens, preserving original casing alongside. */
function tokenize(text) {
  const out = [];
  const rx = /[A-Za-z0-9&+.-]+/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const raw = m[0];
    const norm = raw.toLowerCase().replace(/^[.-]+|[.-]+$/g, '');
    if (norm) out.push({ raw, norm });
  }
  return out;
}

function hasJobContext(lowerText) {
  return JOB_CONTEXT.some(k => lowerText.includes(k));
}

/**
 * Detect companies named in a post.
 * @param {{title?:string, body?:string, comments?:string[]}} post
 * @param {{byKey:Map,maxWords:number}} index
 * @returns {Array<{id:any,name:string,key:string,confidence:number,evidence:string,occurrences:number}>}
 */
export function detectCompanies(post, index, opts = {}) {
  const { requireJobContext = true } = opts;
  const title = post?.title || '';
  const body  = post?.body || '';
  const comments = Array.isArray(post?.comments) ? post.comments.join('\n') : '';
  const text  = `${title}\n${body}\n${comments}`;
  if (!text.trim() || !index?.byKey?.size) return [];

  const lower = text.toLowerCase();
  const jobContext = hasJobContext(lower);
  if (requireJobContext && !jobContext) return [];

  const tokens = tokenize(text);
  const found = new Map(); // key → { entry, occurrences, sawCapitalized, inTitle }
  const titleLower = title.toLowerCase();

  for (let i = 0; i < tokens.length; i++) {
    // Longest match wins: try the widest n-gram first so "american express" beats "american".
    for (let n = Math.min(index.maxWords, tokens.length - i); n >= 1; n--) {
      const slice = tokens.slice(i, i + n);
      const key = slice.map(t => t.norm).join(' ');
      const entry = index.byKey.get(key);
      if (!entry) continue;
      const prev = found.get(key) || { entry, occurrences: 0, sawCapitalized: false, inTitle: false };
      prev.occurrences += 1;
      // Capitalisation is the main signal separating the brand Target from the noun target.
      if (slice.some(t => /^[A-Z]/.test(t.raw))) prev.sawCapitalized = true;
      if (titleLower.includes(key)) prev.inTitle = true;
      found.set(key, prev);
      i += n - 1; // consume the matched span so it is not re-counted by shorter n-grams
      break;
    }
  }

  const out = [];
  for (const [key, hit] of found) {
    const { entry } = hit;

    // Ambiguous single words need BOTH job context and a capitalised use. Without this,
    // "we hit our target this quarter" registers as a Target hiring report.
    if (entry.ambiguous && !(jobContext && hit.sawCapitalized)) continue;

    // Confidence is evidence-derived, never asserted: multiword names are inherently
    // unambiguous, title mentions are stronger than body mentions, repetition corroborates.
    let confidence = entry.words >= 2 ? 0.8 : 0.5;
    if (hit.sawCapitalized) confidence += 0.1;
    if (hit.inTitle)        confidence += 0.1;
    if (hit.occurrences > 1) confidence += 0.05;
    if (entry.ambiguous)    confidence -= 0.15;
    confidence = Math.max(0.2, Math.min(0.99, Number(confidence.toFixed(2))));

    const evidence = [
      `${entry.words}-word name`,
      hit.inTitle ? 'in title' : 'in body',
      hit.sawCapitalized ? 'capitalized' : 'lowercase only',
      `${hit.occurrences}x`,
      jobContext ? 'job context present' : 'no job context',
    ].join(' · ');

    out.push({ id: entry.id, name: entry.name, key, confidence, evidence, occurrences: hit.occurrences });
  }

  // Strongest first so a caller taking the top N gets the best-evidenced matches.
  return out.sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);
}

export const _internals = { AMBIGUOUS, STOPNAME, LEGAL_SUFFIX, tokenize, hasJobContext };
