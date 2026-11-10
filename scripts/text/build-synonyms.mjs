#!/usr/bin/env node
// Builds lib/text/data/synonyms.json — a DISTILLED synonym table for work language — from WordNet 3.1
// (Princeton University; the npm package `wordnet-db`, a build-time devDependency only: nothing under
// lib/ may import it).
//
//   node scripts/text/build-synonyms.mjs --corpus FILE.json [--onet DIR] [--dict DIR] [--size 15000]
//     --onet DIR: the O*NET 31.0 CSV folder (task_statements.csv, job_titles.csv) — adds work vocabulary
//
// Vocabulary: the most frequent noun/verb lemmas in real job postings (the corpus JSON, rows with
// title + description), the persona résumés in lib/fixtures/personas and O*NET task statements and job
// titles. For each word and part of speech, a sense is kept only when it is among the word's first two
// senses AND carries at least a quarter of the word's sense-tagged uses (index.sense counts); a synset
// member is kept only when the synset is a kept sense for the member too (mutual), single-word,
// lower-case and in the vocabulary. A word with fewer than 4 tagged uses keeps only its first noun sense. Person nouns
// are kept only as one-word O*NET titles of a shared occupation. No
// hypernyms, no antonyms, nothing past the second sense: wide synonymy is how false matches get in.
//
// WordNet licence (kept in the output header and on /methods): "WordNet 3.0 Copyright 2006 by Princeton
// University. All rights reserved." — permission to use, copy, modify and distribute for any purpose,
// with the notice and the disclaimer kept (THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" …).
// Output is deterministic: the same inputs give the same bytes.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { inflectionCandidates } from '../../lib/text/morph.js';
import { parseCsv } from '../occupations/build-occupations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'lib', 'text', 'data', 'synonyms.json');
const BUDGET = 2.5 * 1024 * 1024;
const SHARE = Number(process.env.SYN_SHARE || 0.25);
const RATIO = Number(process.env.SYN_RATIO || 50);

/** @param {string} dict @param {'noun'|'verb'} pos */
function readIndex(dict, pos) {
  /** @type {Map<string, { offsets: number[], tagged: number }>} */
  const m = new Map();
  for (const line of readFileSync(join(dict, `index.${pos}`), 'latin1').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const f = line.trim().split(' ');
    const lemma = f[0];
    const pCnt = Number(f[3]);
    const senseCnt = Number(f[4 + pCnt]);
    const tagged = Number(f[5 + pCnt]);
    const offsets = f.slice(6 + pCnt, 6 + pCnt + senseCnt).map(Number);
    if (!Number.isFinite(senseCnt) || offsets.length !== senseCnt || offsets.some((x) => !Number.isFinite(x))) throw new Error(`index.${pos}: bad line "${line.slice(0, 80)}" — the source changed shape`);
    m.set(lemma, { offsets, tagged });
  }
  return m;
}

/** @param {Buffer} data @param {number} offset */
function synsetWords(data, offset) {
  let end = data.indexOf(10, offset);
  if (end < 0) end = data.length;
  const f = data.toString('latin1', offset, end).split(' ');
  if (Number(f[0]) !== offset) throw new Error(`synset at ${offset} does not start with its offset — the source changed shape`);
  const n = parseInt(f[3], 16);
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < n; i++) out.push(f[4 + 2 * i].replace(/\(.*\)$/, ''));
  return { words: out, lexfile: Number(f[1]) };
}

/**
 * Per-sense tag counts from index.sense: how often each (word, sense) was seen in WordNet's sense-tagged
 * text. A sense is "dominant" for a word when it is one of the word's first two senses AND carries at
 * least a quarter of the word's tagged uses (at least 2 of them). A word with almost no tagged uses
 * (fewer than 4) keeps only its first sense.
 * @param {string} dict
 */
function readSenseCounts(dict) {
  /** @type {Map<string, number>} */
  const cnt = new Map();
  /** @type {Map<string, number>} */
  const total = new Map();
  const POS = { 1: 'n', 2: 'v' };
  for (const line of readFileSync(join(dict, 'index.sense'), 'latin1').split('\n')) {
    if (!line) continue;
    const [key, off, , c] = line.split(' ');
    const [lemma, rest] = key.split('%');
    const pos = POS[rest?.[0]];
    if (!pos) continue;
    cnt.set(`${lemma}|${pos}|${Number(off)}`, Number(c) || 0);
    total.set(`${lemma}|${pos}`, (total.get(`${lemma}|${pos}`) || 0) + (Number(c) || 0));
  }
  if (cnt.size < 100000) throw new Error(`index.sense has ${cnt.size} rows — the source changed shape`);
  return { cnt, total };
}

/** @param {string} w @param {'n'|'v'} pos @param {{ offsets: number[] } | undefined} entry @param {ReturnType<typeof readSenseCounts>} sc */
function keptSenses(w, pos, entry, sc) {
  if (!entry) return [];
  const tot = sc.total.get(`${w}|${pos}`) || 0;
  if (tot < 4) return pos === 'n' ? entry.offsets.slice(0, 1) : []; // too rare to trust a verb sense ("ready", "secure" as verbs)
  return entry.offsets.slice(0, 2).filter((off) => {
    const c = sc.cnt.get(`${w}|${pos}|${off}`) || 0;
    return c >= 2 && c / tot >= SHARE;
  });
}

/** Single-word O*NET title → its occupations (from the shipped lib/occupations/data/titles.json), or null. */
function readTitleOccupations() {
  const p = join(ROOT, 'lib', 'occupations', 'data', 'titles.json');
  if (!existsSync(p)) return null;
  const t = JSON.parse(readFileSync(p, 'utf8')).t;
  /** @type {Map<string, Set<number>>} */
  const m = new Map();
  for (const head of Object.keys(t)) for (const e of t[head]) if (e[0] === '') m.set(head, new Set(e.slice(1).filter((n) => n % 8 >= 2).map((n) => Math.floor(n / 8))));
  for (const [k, v] of m) if (!v.size) m.delete(k);
  return m;
}

/** @param {string} text */
function tokens(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && w.length <= 20);
}

export function build({ dict, corpus, onet = '', size = 15000 }) {
  const idx = { n: readIndex(dict, 'noun'), v: readIndex(dict, 'verb') };
  const sc = readSenseCounts(dict);
  const kept = (/** @type {string} */ w, /** @type {'n'|'v'} */ pos) => keptSenses(w, pos, idx[pos].get(w), sc);
  if (idx.n.size < 100000 || idx.v.size < 10000) throw new Error(`WordNet index too small (noun ${idx.n.size}, verb ${idx.v.size})`);
  const data = { n: readFileSync(join(dict, 'data.noun')), v: readFileSync(join(dict, 'data.verb')) };
  const inWn = (/** @type {string} */ w) => idx.n.has(w) || idx.v.has(w);

  // ---- vocabulary: frequency of noun/verb lemmas (inflection only) over postings + résumés
  /** @type {string[]} */
  const texts = [];
  const rows = JSON.parse(readFileSync(corpus, 'utf8'));
  if (!Array.isArray(rows) || rows.length < 100) throw new Error(`${corpus}: expected an array of postings`);
  for (const r of rows) texts.push(`${r.title || ''}\n${r.description || ''}`);
  const personas = join(ROOT, 'lib', 'fixtures', 'personas');
  for (const f of readdirSync(personas).sort()) if (f.endsWith('.txt')) texts.push(readFileSync(join(personas, f), 'utf8'));
  // O*NET task statements and job titles: the duties and titles of ~1,000 occupations, in work language.
  if (onet) {
    for (const [file, col, min] of [['task_statements.csv', 'Task', 15000], ['job_titles.csv', 'Job Title', 40000]]) {
      const rowsO = parseCsv(readFileSync(join(onet, file), 'utf8'));
      if (rowsO.length < min || !(col in rowsO[0])) throw new Error(`${file}: unexpected shape`);
      for (const r of rowsO) texts.push(r[col]);
    }
  }
  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const t of texts) for (const w of tokens(t)) {
    const l = inflectionCandidates(w).find(inWn) || null;
    if (l) freq.set(l, (freq.get(l) || 0) + 1);
  }
  // Person nouns (WordNet lexicographer file 18, noun.person) are job titles in work language: a set of
  // them is kept only when EVERY member is a one-word O*NET title and they share an occupation
  // ("physician" ≈ "doctor", "attorney" ≈ "lawyer"; not "coach" ≈ "manager", "partner" ≈ "spouse").
  const titleOcc = readTitleOccupations();
  const splitDistinctOccupations = (/** @type {string[]} */ members, /** @type {string} */ pos, /** @type {number} */ lexfile) => {
    if (pos !== 'n' || lexfile !== 18) return members;
    if (!titleOcc) return [];
    const titled = members.filter((m) => titleOcc.has(m));     // "doc" is not a title; "doctor" and "physician" are
    for (let i = 0; i < titled.length; i++) for (let j = i + 1; j < titled.length; j++) {
      const a = /** @type {Set<number>} */ (titleOcc.get(titled[i]));
      if (![...a].some((x) => titleOcc.get(titled[j])?.has(x))) return [];
    }
    return titled.length >= 2 ? titled : [];
  };
  const vocab = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, size).map(([w]) => w).sort();
  const inVocab = new Set(vocab);

  // ---- groups: kept synsets with ≥2 mutual, in-vocabulary, single-word members
  /** @type {Map<string, string[]>} */
  const groups = new Map();      // "pos:offset" → members
  /** @type {Record<'n'|'v', Map<string, string[]>>} */
  const wordGroups = { n: new Map(), v: new Map() };
  for (const pos of /** @type {const} */ (['n', 'v'])) {
    for (const w of vocab) {
      for (const off of kept(w, pos)) {
        const key = `${pos}:${off}`;
        if (!groups.has(key)) {
          const ss = synsetWords(data[pos], off);
          const members = ss.words
            .filter((m) => /^[a-z]+$/.test(m) && inVocab.has(m) && kept(m, pos).includes(off));
          // A member fifty times rarer in work text than the set's commonest word is a sense work
          // language does not use ("board" the committee is common; "plank" is not).
          const top = Math.max(0, ...members.map((m) => freq.get(m) || 0));
          const common = members.filter((m) => (freq.get(m) || 0) * RATIO >= top);
          groups.set(key, splitDistinctOccupations([...new Set(common)].sort(), pos, ss.lexfile));
        }
        const g = groups.get(key) || [];
        if (g.length >= 2 && g.includes(w)) {
          if (!wordGroups[pos].has(w)) wordGroups[pos].set(w, []);
          wordGroups[pos].get(w)?.push(key);
        }
      }
    }
  }
  const used = [...new Set([...wordGroups.n.values(), ...wordGroups.v.values()].flat())]
    .map((k) => ({ k, m: groups.get(k) || [] }))
    .sort((a, b) => (a.k[0] < b.k[0] ? -1 : a.k[0] > b.k[0] ? 1 : a.m.join(' ') < b.m.join(' ') ? -1 : a.m.join(' ') > b.m.join(' ') ? 1 : 0));
  const gid = new Map(used.map((g, i) => [g.k, i]));
  const g = used.map((x) => x.m.join(' '));
  /** @type {Record<string, string>} */
  const lex = {};
  for (const w of vocab) {
    const p = `${idx.n.has(w) ? 'n' : ''}${idx.v.has(w) ? 'v' : ''}`;
    // "*" marks the group that is the word's WordNet FIRST sense (used by the strict mode)
    const mark = (/** @type {'n'|'v'} */ pos) => (/** @type {string} */ k) => `${idx[pos].get(w)?.offsets[0] === Number(k.slice(2)) ? '*' : ''}${gid.get(k)}`;
    const ng = (wordGroups.n.get(w) || []).map(mark('n'));
    const vg = (wordGroups.v.get(w) || []).map(mark('v'));
    lex[w] = [p, ng.join(','), vg.join(',')].join('|').replace(/\|+$/, '');
  }
  return {
    file: {
      h: {
        source: 'WordNet 3.1 (Princeton University), via the npm package wordnet-db 3.1.14; vocabulary from Seen\'s job-posting corpus and persona résumés',
        retrieved: '2026-11-10',
        licence: 'WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved. THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS. (Full licence: https://wordnet.princeton.edu/license-and-commercial-use)',
        format: 'w[word] = "pos|nounGroups|verbGroups" (pos: n and/or v as WordNet lists the word; groups = comma-separated indexes into g, "*" = the word\'s first WordNet sense); g[i] = space-separated members of one kept synset (a dominant sense — first or second, ≥25% of the word\'s tagged uses — for every member; single words in the vocabulary; members 50× rarer in work text than the commonest dropped; person nouns only as one-word O*NET titles of a shared occupation). Every vocabulary word is in w, with or without groups — it is also the lexicon for lemmatisation.',
        build: 'scripts/text/build-synonyms.mjs',
      },
      g,
      w: lex,
    },
    stats: { vocab: vocab.length, groups: g.length, withNoun: wordGroups.n.size, withVerb: wordGroups.v.size },
  };
}

function main() {
  const args = process.argv.slice(2);
  const arg = (/** @type {string} */ k, /** @type {string} */ d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const require = createRequire(import.meta.url);
  const dict = arg('--dict', require('wordnet-db').path);
  const corpus = arg('--corpus', '');
  const onet = arg('--onet', '');
  if (!corpus || !existsSync(corpus)) throw new Error('pass --corpus <postings.json> (an array of {title, description})');
  const { file, stats } = build({ dict, corpus, onet, size: Number(arg('--size', '15000')) });
  const body = JSON.stringify(file);
  if (body.length > BUDGET) throw new Error(`synonyms.json is ${body.length} bytes, over the ${BUDGET}-byte budget`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, body);
  console.log(`synonyms.json: ${(body.length / 1024).toFixed(0)} KB`, JSON.stringify(stats));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.stack : e); process.exit(1); }
}
