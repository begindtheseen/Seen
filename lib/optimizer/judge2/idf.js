// How SPECIFIC a word is — the weight a matched word carries in judge2. From document frequencies over real job
// postings (data/idf.json, built by build-idf.mjs): "experience", "team", "manage", "support" appear in most postings
// and say almost nothing about what a person did; "tray", "drawer", "deposit", "Splunk" say a lot.
// Browser-safe: in a bundle without the data every word reads as moderately specific (0.5).
import { loadKnowledge } from '../../text/knowledgeData.js';
import { stem } from '../../text/morph.js';

/** @type {Record<string, number> | null} */
let S = null;
let loaded = false;
function table() {
  if (!loaded) {
    loaded = true;
    const d = loadKnowledge('lib/optimizer/judge2/data', 'idf.json', import.meta.url);
    S = d && d.s ? d.s : null;
  }
  return S;
}

/**
 * Specificity of one word in [0, 1]. A stem the table leaves out is in fewer than 3 of ~950 postings: rare, read as
 * specific (0.85). Numbers and one-letter tokens carry nothing.
 * @param {string} word
 */
export function spec(word) {
  const w = String(word || '').toLowerCase();
  if (!/[a-z]/.test(w) || w.length < 2) return 0;
  const t = table();
  if (!t) return 0.5;
  const s = stem(w);
  return Object.hasOwn(t, s) ? t[s] : 0.85;
}

/** Specificity of a unit of several words: its most specific word. @param {string[]} tokens */
export function specOf(tokens) {
  let m = 0;
  for (const t of tokens) m = Math.max(m, spec(t));
  return m;
}

/** Is the specificity table loaded (false in a browser bundle)? */
export function hasIdf() { return !!table(); }
