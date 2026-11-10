// Health "Fix all" guard: a fix may change HOW a line says something, never WHAT it says.
//
// The Studio judge saw "Wound care for 20+ patients a day" offered as "Wind care…" (the present-tense
// pass read the noun "Wound" as the past of "wind") and "…, documented in HCHB" turned into
// "…, document in HCHB" (a participle tensed as an imperative) — 2026-11-10. The inflection engine
// lives in rewrite/; this is the check on the health side: a proposed rewrite is applied only when
//   • every word it substitutes past the lead (the first word) is a number re-format, and
//   • a lead word that is also a common noun or adjective ("wound", "ground", "found", "bound",
//     "lead", "record"…) is re-tensed only when an object follows it ("Found 3 errors"), never when a
//     noun it forms a compound with does ("Wound care", "Ground crew").
// Removing filler words, re-punctuating and the lead-verb upgrade itself stay allowed. Pure, no I/O.

const HOMOGRAPH = new Set(['wound', 'wind', 'ground', 'grind', 'found', 'find', 'bound', 'bind', 'lead', 'led', 'record', 'present',
  'project', 'process', 'contract', 'conduct', 'object', 'content', 'close', 'live', 'set', 'cut', 'run', 'read', 'shed', 'spread',
  'cast', 'fit', 'split', 'left', 'leave', 'saw', 'see', 'felt', 'feel', 'well', 'rose', 'lay', 'lie', 'tear', 'wake', 'sink', 'spring',
  'fly', 'show', 'sow', 'sew', 'meet', 'build', 'built', 'point', 'stock', 'staff', 'order', 'plan', 'test', 'design', 'support', 'care',
  'document', 'documented', 'complete', 'completed', 'clean', 'cleaned', 'stand', 'stood']);
// words that open a verb's object: "Found 3 errors", "Wound the cable", "Led a team"
const OBJECT_START = /^(?:a|an|the|my|our|their|his|her|its|all|each|every|new|over|up|out|down|and|\d[\d,.%+]*|\$\d.*|[a-z]+s)$/;

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9$%+.,'\s-]/g, ' ').split(/\s+/).map((w) => w.replace(/^[^a-z0-9$]+|[^a-z0-9%+]+$/g, '')).filter(Boolean);

/** LCS alignment of two word lists → [{ a: string[], b: string[], at: number }] substitution runs. */
function substitutions(A, B) {
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const runs = [];
  let i = 0, j = 0, cur = null;
  const close = () => { if (cur && (cur.a.length || cur.b.length)) runs.push(cur); cur = null; };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { close(); i++; j++; continue; }
    if (!cur) cur = { a: [], b: [], at: i };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) cur.b.push(B[j++]);
    else cur.a.push(A[i++]);
  }
  close();
  return runs;
}

/**
 * @param {string} from the person's line
 * @param {string} to the proposed rewrite
 * @returns {{ ok: boolean, reason?: string }}
 */
export function rewriteKeepsMeaning(from, to) {
  const A = words(from), B = words(to);
  if (!A.length || !B.length) return { ok: false, reason: 'empty' };
  for (const r of substitutions(A, B)) {
    if (!r.a.length || !r.b.length) continue; // pure removal (filler) or insertion (lead upgrade)
    const unit = (w) => /\d/.test(w) || /^(?:percent|per|cent|dollars?|thousand|million|billion|k|m|x|times)$/.test(w);
    const numeric = r.a.every(unit) && r.b.every(unit) && r.a.some((w) => /\d/.test(w)) && r.b.some((w) => /\d/.test(w));
    if (numeric) continue;
    if (r.at === 0) {
      // the lead word: a homograph is re-tensed only before an object
      const lead = A[0];
      if (HOMOGRAPH.has(lead) && r.a.length === 1 && A[1] && !OBJECT_START.test(A[1])) return { ok: false, reason: `"${lead} ${A[1]}" reads as a noun phrase` };
      continue;
    }
    // a lead phrase being replaced ("Responsible for" → "Ran") starts at 0; anything later is a
    // changed word in the middle of the person's line
    if (r.at <= 2 && /^(?:responsible|in|charge|tasked|duties|helped|help|assisted|assist|worked|work|for|with|of|on)$/.test(A[r.at] || '')) continue;
    return { ok: false, reason: `"${r.a.join(' ')}" would become "${r.b.join(' ')}"` };
  }
  return { ok: true };
}
