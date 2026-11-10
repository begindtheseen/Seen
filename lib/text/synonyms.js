// Same thing in work language? A distilled WordNet 3.1 synonym table (Princeton University; licence on
// /methods and in the data header) shipped in lib/text/data/synonyms.json — rebuild with
// scripts/text/build-synonyms.mjs. No network, no model.
//
//   sameWord(a, b, pos?)    → true when a and b are one word family (present / presented / presentation)
//                             or share a kept synonym set (educate ≈ teach, customer ≈ client)
//   relateWords(a, b, pos?, { strict? }) → { same, how: 'identical'|'family'|'synonym'|null, via? }
//                             strict (default): a synonym only through the FIRST WordNet sense of both words
//   synonymsOf(word, pos?)  → the word's kept synonyms (same part of speech, first one or two senses)
//   lemmaOf(word)           → the dictionary form the table knows ("scheduled" → "schedule"), or null
//
// Precision over recall: only a word's first sense (second when attested) is kept, and a member only when
// the set is among ITS first senses too. A word the table does not know is only ever equal to itself.
// Tests: synonyms.test.mjs.

import { readFileSync } from 'node:fs';
import { inflectionCandidates, derivationCandidates } from './morph.js';

/** @typedef {'n'|'v'} Pos */

/** @type {{ g: string[], w: Record<string, string>, cache: Map<string, { pos: string, n: number[], v: number[], first: Set<number> }> } | null} */
let S = null;
function table() {
  if (S) return S;
  const d = JSON.parse(readFileSync(new URL('./data/synonyms.json', import.meta.url), 'utf8'));
  S = { g: d.g, w: d.w, cache: new Map() };
  return S;
}

/** @param {string} w */
function entry(w) {
  const T = table();
  if (!Object.hasOwn(T.w, w)) return null;
  let e = T.cache.get(w);
  if (!e) {
    const [pos, n, v] = T.w[w].split('|');
    const pn = parseGroupIds(n);
    const pv = parseGroupIds(v);
    e = { pos, n: pn.ids, v: pv.ids, first: new Set([...pn.first, ...pv.first]) };
    T.cache.set(w, e);
  }
  return e;
}

/**
 * "*3,12,*40" → ids [3, 12, 40], first-sense ids {3, 40}. Every "*" marker is removed (global), and a
 * malformed id is dropped rather than read as NaN.
 * @param {string | undefined} field
 * @returns {{ ids: number[], first: Set<number> }}
 */
export function parseGroupIds(field) {
  /** @type {number[]} */
  const ids = [];
  const first = new Set();
  for (const raw of String(field || '').split(',')) {
    if (!raw) continue;
    const marked = raw.includes('*');
    const n = Number(raw.replace(/\*/g, ''));
    if (!Number.isInteger(n) || n < 0) continue;
    ids.push(n);
    if (marked) first.add(n);
  }
  return { ids, first };
}

/**
 * The dictionary form the table knows for a word (inflections only), or null.
 * @param {string} word
 */
export function lemmaOf(word) {
  for (const c of inflectionCandidates(word)) if (entry(c)) return c;
  return null;
}

/**
 * Every lexicon lemma a word belongs to: its inflectional lemma, plus the verb a noun of action names.
 * @param {string} word
 * @returns {string[]}
 */
function lemmas(word) {
  /** @type {string[]} */
  const out = inflectionCandidates(word).filter((c) => entry(c));   // "led" → led (the diode) and lead
  for (const form of [word, ...out]) {
    for (const d of derivationCandidates(/** @type {string} */ (form))) {
      const e = entry(d);
      if (e && e.pos.includes('v') && !out.includes(d)) out.push(d);
    }
  }
  return out;
}

/**
 * @param {string} w @param {Pos|undefined} pos @param {boolean} [strict] only the word's first WordNet sense
 * @returns {number[]}
 */
function groupsOf(w, pos, strict = false) {
  const e = entry(w);
  if (!e) return [];
  const all = pos === 'n' ? e.n : pos === 'v' ? e.v : [...e.n, ...e.v];
  return strict ? all.filter((g) => e.first.has(g)) : all;
}

/**
 * The kept synonyms of a word (not the word itself), sorted. Strict by default (see relateWords).
 * @param {string} word
 * @param {Pos} [pos]
 * @param {{ strict?: boolean }} [opts]
 * @returns {string[]}
 */
export function synonymsOf(word, pos, opts = {}) {
  const l = lemmaOf(word);
  if (!l) return [];
  const T = table();
  const out = new Set();
  const strict = opts.strict !== false;
  for (const gi of groupsOf(l, pos, strict)) {
    for (const m of T.g[gi].split(' ')) if (m !== l && (!strict || groupsOf(m, pos, true).includes(gi))) out.add(m);
  }
  return [...out].sort();
}

/**
 * Why two words are (or are not) the same thing.
 * @param {string} a
 * @param {string} b
 * @param {Pos} [pos]
 * @param {{ strict?: boolean }} [opts] strict (the default): a synonym only when the shared set is the FIRST WordNet
 *   sense of both words; { strict: false } also accepts a dominant second sense (more recall, less precision)
 * @returns {{ same: boolean, how: 'identical'|'family'|'synonym'|null, via?: string }}
 */
export function relateWords(a, b, pos, opts = {}) {
  const x = String(a || '').toLowerCase().trim();
  const y = String(b || '').toLowerCase().trim();
  if (!x || !y) return { same: false, how: null };
  if (x === y) return { same: true, how: 'identical' };
  const la = lemmas(x);
  const lb = lemmas(y);
  const fam = la.find((l) => lb.includes(l));
  if (fam) return { same: true, how: 'family', via: fam };
  const T = table();
  for (const p of la) {
    const strict = opts.strict !== false;
    const ga = new Set(groupsOf(p, pos, strict));
    if (!ga.size) continue;
    for (const q of lb) for (const gi of groupsOf(q, pos, strict)) if (ga.has(gi)) return { same: true, how: 'synonym', via: T.g[gi] };
  }
  return { same: false, how: null };
}

/**
 * Are a and b the same thing in work language (one word family, or a kept synonym set)?
 * @param {string} a
 * @param {string} b
 * @param {Pos} [pos]
 * @param {{ strict?: boolean }} [opts]
 */
export function sameWord(a, b, pos, opts) { return relateWords(a, b, pos, opts).same; }
