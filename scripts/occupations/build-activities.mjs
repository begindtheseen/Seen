#!/usr/bin/env node
// Builds lib/occupations/data/activities.json — the O*NET 31.0 work-activity hierarchy as a retrieval index:
// every Detailed Work Activity (DWA, ~2,000) with its Intermediate (IWA, 332) and Generalized (GWA, 41) parent, a
// plain-words title, the stems of its title and of every task statement O*NET analysts mapped to it (the tasks are
// the vocabulary: "trailers", "vitals", "putaway"), and the occupations whose tasks map to it.
//
//   node scripts/occupations/build-activities.mjs --from <dir with db_31_0_csv/>
//
// Source: O*NET 31.0 Database (USDOL/ETA), CC BY 4.0 — gwas_to_iwas_to_dwas.csv, tasks_to_dwas.csv. Attribution on
// /methods. Reads lib/occupations/data/occupations.json (build it first). Local files only; output written only from
// parsed rows; deterministic.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './build-occupations.mjs';
import { words, stem, isStopWord } from '../../lib/text/morph.js';
import { gerundTitle } from '../../lib/occupations/activityWords.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'lib', 'occupations', 'data', 'activities.json');
const BUDGET = 1.5 * 1024 * 1024;
const TOP_STEMS = Number(process.env.ACT_TOP_STEMS || 40);

// Words that say nothing about WHICH work act ("other", "activities", "using", "such as", "related").
const FILLER = new Set(['other', 'activ', 'relat', 'use', 'such', 'variou', 'ensur', 'necessari', 'appropri', 'specif', 'determin',
  'accord', 'requir', 'need', 'includ', 'perform', 'provid', 'etc', 'type', 'item', 'oper', 'work', 'job', 'task', 'proper', 'make']);

/** @param {string} text */
const stemsOf = (text) => words(text).filter((w) => w.length > 2 && !isStopWord(w) && !/^\d+$/.test(w)).map(stem).filter((s) => s.length > 2 && !FILLER.has(s));

/** @param {string} from @param {{ excludeTasks?: Set<string> }} [opts] excludeTasks: task IDs left out (calibration hold-out) */
export function build(from, opts = {}) {
  const dir = existsSync(join(from, 'db_31_0_csv')) ? join(from, 'db_31_0_csv') : from;
  const hier = parseCsv(readFileSync(join(dir, 'gwas_to_iwas_to_dwas.csv'), 'utf8'));
  const t2d = parseCsv(readFileSync(join(dir, 'tasks_to_dwas.csv'), 'utf8'));
  for (const [rows, cols, min] of [[hier, ['GWA Element ID', 'GWA Element Name', 'IWA Element ID', 'IWA Element Name', 'DWA Element ID', 'DWA Element Name'], 1500], [t2d, ['O*NET-SOC Code', 'Task', 'DWA Element ID'], 15000]]) {
    if (rows.length < min) throw new Error(`activity source has ${rows.length} rows (expected ≥ ${min})`);
    for (const c of cols) if (!(c in rows[0])) throw new Error(`activity source lost column "${c}" — the source changed shape`);
  }
  const occ = JSON.parse(readFileSync(join(HERE, '..', '..', 'lib', 'occupations', 'data', 'occupations.json'), 'utf8')).o;
  const occIdx = new Map(occ.map((/** @type {any[]} */ r, i) => [r[0], i]));

  const gwas = [...new Map(hier.map((r) => [r['GWA Element ID'], r['GWA Element Name']])).entries()].sort();
  const iwas = [...new Map(hier.map((r) => [r['IWA Element ID'], [r['IWA Element Name'], r['GWA Element ID']]])).entries()].sort();
  const dwas = [...new Map(hier.map((r) => [r['DWA Element ID'], [r['DWA Element Name'], r['IWA Element ID']]])).entries()].sort();
  const gI = new Map(gwas.map(([id], i) => [id, i]));
  const iI = new Map(iwas.map(([id], i) => [id, i]));
  const dI = new Map(dwas.map(([id], i) => [id, i]));

  /** @type {Map<number, Map<string, number>>} */
  const tf = new Map();
  /** @type {Map<number, Set<number>>} */
  const occOf = new Map();
  for (const r of t2d) {
    if (opts.excludeTasks && opts.excludeTasks.has(r['Task ID'])) continue;
    const d = dI.get(r['DWA Element ID']);
    if (d == null) continue;
    if (!tf.has(d)) tf.set(d, new Map());
    const m = tf.get(d);
    for (const s of new Set(stemsOf(r.Task))) m.set(s, (m.get(s) || 0) + 1);
    const o = occIdx.get(r['O*NET-SOC Code']);
    if (o != null) { if (!occOf.has(d)) occOf.set(d, new Set()); occOf.get(d)?.add(o); }
  }
  // the DWA's own title counts as several task statements
  dwas.forEach(([, [title]], d) => {
    if (!tf.has(d)) tf.set(d, new Map());
    const m = tf.get(d);
    for (const s of new Set(stemsOf(title))) m.set(s, (m.get(s) || 0) + 4);
  });
  // document frequency over DWAs
  /** @type {Map<string, number>} */
  const df = new Map();
  for (const m of tf.values()) for (const s of m.keys()) df.set(s, (df.get(s) || 0) + 1);
  const N = dwas.length;
  /** @type {Map<string, number>} */
  const vocabCount = new Map();
  const entries = dwas.map(([, [title, iwaId]], d) => {
    const m = tf.get(d) || new Map();
    const max = Math.max(1, ...m.values());
    const ranked = [...m.entries()].map(([s, c]) => [s, (c / max) * Math.log(1 + N / (df.get(s) || 1))])
      .sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_STEMS);
    for (const [s] of ranked) vocabCount.set(/** @type {string} */ (s), (vocabCount.get(/** @type {string} */ (s)) || 0) + 1);
    return { title, iwa: iI.get(iwaId), ranked: ranked.map(([s, c]) => [s, /** @type {number} */ (c) / max]), occ: [...(occOf.get(d) || [])].sort((a, b) => a - b) };
  });
  const vocab = [...vocabCount.keys()].sort();
  const vI = new Map(vocab.map((s, i) => [s, i]));
  const tfOf = (/** @type {number} */ d, /** @type {string} */ s) => (tf.get(d)?.get(s) || 0) / Math.max(1, ...(tf.get(d)?.values() || [1]));
  const file = {
    h: {
      source: 'O*NET 31.0 Database (August 2026 release): Generalized / Intermediate / Detailed Work Activities and the task statements mapped to them, National Center for O*NET Development for USDOL/ETA',
      retrieved: '2026-11-10',
      licence: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ ; https://www.onetcenter.org/license_db.html',
      attribution: 'This page includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. Seen has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications.',
      format: 'v = stem vocabulary; df = for each v, how many DWAs use it (in title or mapped tasks); g = [gwaPlainTitle]; i = [iwaPlainTitle, gwaIndex]; d = [[dwaPlainTitle, iwaIndex, [vIndex, weight×100, …] (top 40 by tf·idf, weight = tf relative to the DWA\'s commonest stem), [occIndex…] (occupations.json positions whose tasks map here), dwaElementId]]',
      build: 'scripts/occupations/build-activities.mjs',
    },
    v: vocab,
    df: vocab.map((s) => df.get(s) || 1),
    n: N,
    g: gwas.map(([, name]) => gerundTitle(name)),
    i: iwas.map(([, [name, g]]) => [gerundTitle(name), gI.get(g)]),
    d: entries.map((e, d) => [gerundTitle(e.title), e.iwa, e.ranked.flatMap(([s]) => [vI.get(/** @type {string} */ (s)), Math.round(tfOf(d, /** @type {string} */ (s)) * 100)]), e.occ, dwas[d][0]]),
  };
  return { file, stats: { gwas: gwas.length, iwas: iwas.length, dwas: dwas.length, vocab: vocab.length, mappedTasks: t2d.length } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2);
    const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : '';
    if (!from) throw new Error('pass --from <dir with the O*NET 31.0 CSVs>');
    const { file, stats } = build(from);
    const body = JSON.stringify(file);
    if (body.length > BUDGET) throw new Error(`activities.json is ${body.length} bytes, over ${BUDGET}`);
    writeFileSync(OUT, body);
    console.log(`activities.json: ${(body.length / 1024).toFixed(0)} KB`, JSON.stringify(stats));
  } catch (e) { console.error(e instanceof Error ? e.stack : e); process.exit(1); }
}
