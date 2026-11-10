#!/usr/bin/env node
// Builds lib/occupations/data/{occupations,titles,military}.json from the O*NET 31.0 Database and the
// O*NET Military Occupational Classification (MOC) crosswalk.
//
//   node scripts/occupations/build-occupations.mjs              download the sources to a temp dir, then build
//   node scripts/occupations/build-occupations.mjs --from DIR   build from DIR/db_31_0_csv/*.csv + DIR/milx0724.csv
//   node scripts/occupations/build-occupations.mjs --dir DIR    download into DIR (kept), then build
//
// Sources (retrieved 2026-11-10):
//   O*NET 31.0 Database, CSV (August 2026)  https://www.onetcenter.org/dl_files/database/db_31_0_csv.zip
//   Military crosswalk (DMDC MOC → O*NET-SOC, updated August 2024)
//                                            https://www.onetcenter.org/dl_files/2019/military_crosswalk.zip
// Licence: O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration
// (USDOL/ETA), CC BY 4.0 (https://www.onetcenter.org/license_db.html). The attribution is printed on
// /methods. Seen modified the data: it keeps only the fields below, at most 15 tasks and 10 tools per
// occupation, and normalises titles into lookup keys (lib/occupations/normalize.js).
//
// Output is deterministic: the same source files give the same bytes. Raw sources are never committed.
// `unzip` must be on PATH. The build fails loudly when a source file's shape changes.

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normTitle, stripNoise } from '../../lib/occupations/normalize.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'lib', 'occupations', 'data');
const RETRIEVED = '2026-11-10';
const SOURCES = [
  { url: 'https://www.onetcenter.org/dl_files/database/db_31_0_csv.zip', check: 'db_31_0_csv/occupation_data.csv' },
  { url: 'https://www.onetcenter.org/dl_files/2019/military_crosswalk.zip', check: 'military_crosswalk/milx0724.csv' },
];
const MAX_TASKS = 15;
const MAX_TECH = 10;
const BUDGET = 2.5 * 1024 * 1024;

/** RFC 4180 CSV → array of objects keyed by header. @param {string} text */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}

/** @param {string} path @param {string[]} cols @param {number} minRows */
function readTable(path, cols, minRows) {
  if (!existsSync(path)) throw new Error(`missing source file ${path}`);
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const have = new Set(Object.keys(rows[0] || {}));
  for (const c of cols) if (!have.has(c)) throw new Error(`${path}: column "${c}" missing — the source changed shape (have: ${[...have].join(', ')})`);
  if (rows.length < minRows) throw new Error(`${path}: ${rows.length} rows, expected at least ${minRows}`);
  return rows;
}

async function download(dir) {
  for (const { url, check } of SOURCES) {
    if (existsSync(join(dir, check))) { console.log(`have ${check}`); continue; }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    const zip = join(dir, url.split('/').pop() || 'src.zip');
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
    console.log(`fetched ${url}`);
  }
}

const CODE_RE = /^\d\d-\d{4}\.\d\d$/;

/** Sorted-key JSON so the output is byte-stable. */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}

/** "Registered Nurses" → "Registered Nurse" (last word only; used for the occupation's own name). */
function singularTitle(t) {
  return t.replace(/\b(\w+?)(ies|sses|ches|shes|xes|s)$/i, (m, b, suf) => {
    if (/^(ies)$/i.test(suf)) return `${b}y`;
    if (/^(sses|ches|shes|xes)$/i.test(suf)) return `${b}${suf.slice(0, -2)}`;
    if (/(ss|us|is)$/i.test(m)) return m;
    return b + (suf.length > 1 ? suf.slice(0, -1) : '');
  });
}

export function build(from) {
  const onet = existsSync(join(from, 'db_31_0_csv')) ? join(from, 'db_31_0_csv') : from;
  const milPath = [join(from, 'military_crosswalk', 'milx0724.csv'), join(from, 'milx0724.csv')].find((p) => existsSync(p));
  if (!milPath) throw new Error(`military crosswalk milx0724.csv not found under ${from}`);

  const occ = readTable(join(onet, 'occupation_data.csv'), ['O*NET-SOC Code', 'Title', 'Description'], 900);
  const titles = readTable(join(onet, 'job_titles.csv'), ['O*NET-SOC Code', 'Job Title', 'Short Title', 'Source(s)'], 40000);
  const reported = readTable(join(onet, 'sample_of_reported_titles.csv'), ['O*NET-SOC Code', 'Reported Job Title', 'Shown in My Next Move'], 6000);
  const tasks = readTable(join(onet, 'task_statements.csv'), ['O*NET-SOC Code', 'Task ID', 'Task', 'Task Type'], 15000);
  const ratings = readTable(join(onet, 'task_ratings.csv'), ['O*NET-SOC Code', 'Task ID', 'Scale ID', 'Data Value'], 50000);
  const related = readTable(join(onet, 'related_occupations.csv'), ['O*NET-SOC Code', 'Related O*NET-SOC Code', 'Relatedness Tier', 'Index'], 10000);
  const zones = readTable(join(onet, 'job_zones.csv'), ['O*NET-SOC Code', 'Job Zone'], 800);
  const tech = readTable(join(onet, 'software_skills.csv'), ['O*NET-SOC Code', 'Workplace Example', 'Hot Technology', 'In Demand'], 20000);
  const mil = readTable(milPath, ['SVC', 'MOC', 'MOC_TITLE', 'MPC', 'STATUS', 'ONET1', 'ONET2', 'ONET3', 'ONET4'], 20000);

  const codes = occ.map((r) => r['O*NET-SOC Code']).sort();
  for (const c of codes) if (!CODE_RE.test(c)) throw new Error(`occupation_data: bad code ${c}`);
  const idx = new Map(codes.map((c, i) => [c, i]));
  const byCode = new Map(occ.map((r) => [r['O*NET-SOC Code'], r]));

  const zone = new Map(zones.map((r) => [r['O*NET-SOC Code'], Number(r['Job Zone']) || 0]));
  const imp = new Map();
  for (const r of ratings) if (r['Scale ID'] === 'IM') imp.set(`${r['O*NET-SOC Code']}|${r['Task ID']}`, Number(r['Data Value']) || 0);

  /** @type {Map<string, any[]>} */
  const taskBy = new Map();
  for (const r of tasks) {
    const c = r['O*NET-SOC Code'];
    if (!taskBy.has(c)) taskBy.set(c, []);
    taskBy.get(c).push({ id: Number(r['Task ID']), text: r.Task.trim(), core: r['Task Type'] === 'Core' ? 1 : 0, im: imp.get(`${c}|${r['Task ID']}`) || 0 });
  }
  /** @type {Map<string, any[]>} */
  const techBy = new Map();
  for (const r of tech) {
    const c = r['O*NET-SOC Code'];
    if (!techBy.has(c)) techBy.set(c, []);
    techBy.get(c).push({ name: r['Workplace Example'].trim(), hot: r['Hot Technology'] === 'Y' ? 1 : 0, dem: r['In Demand'] === 'Y' ? 1 : 0 });
  }
  /** @type {Map<string, any[]>} */
  const relBy = new Map();
  const TIER = { 'Primary-Short': 1, 'Primary-Long': 2, Supplemental: 3 };
  for (const r of related) {
    const t = TIER[r['Relatedness Tier']];
    if (!t) throw new Error(`related_occupations: unknown tier "${r['Relatedness Tier']}"`);
    const c = r['O*NET-SOC Code'];
    if (!idx.has(r['Related O*NET-SOC Code'])) continue;
    if (!relBy.has(c)) relBy.set(c, []);
    relBy.get(c).push({ i: idx.get(r['Related O*NET-SOC Code']), t, n: Number(r.Index) || 0 });
  }
  /** @type {Map<string, number>} */
  const toolSpread = new Map();
  for (const [, list] of techBy) for (const n of new Set(list.map((t) => t.name))) toolSpread.set(n, (toolSpread.get(n) || 0) + 1);
  const altCount = new Map();
  for (const r of titles) altCount.set(r['O*NET-SOC Code'], (altCount.get(r['O*NET-SOC Code']) || 0) + 1);

  const o = codes.map((c) => {
    const r = byCode.get(c);
    const ts = (taskBy.get(c) || []).sort((a, b) => b.core - a.core || b.im - a.im || a.id - b.id).slice(0, MAX_TASKS).map((t) => t.text);
    // Tools listed for more than a fifth of all occupations (office suites, browsers) say nothing about the job.
    const tk = [...new Map((techBy.get(c) || []).map((t) => [t.name, t])).values()]
      .filter((t) => (toolSpread.get(t.name) || 0) <= codes.length / 5)
      .sort((a, b) => b.hot + b.dem - (a.hot + a.dem) || (toolSpread.get(a.name) || 0) - (toolSpread.get(b.name) || 0) || a.name.localeCompare(b.name))
      .slice(0, MAX_TECH).map((t) => t.name);
    const rel = (relBy.get(c) || []).sort((a, b) => a.n - b.n).flatMap((x) => [x.i, x.t]);
    return [c, r.Title, zone.get(c) || 0, rel, ts, tk, altCount.get(c) || 0];
  });

  // ---- titles: key "rest of title" under its head word; value n = occupationIndex*8 + weight (0–7).
  // Evidence per (title, occupation) is ADDED: O*NET source count (≤3) + 2 when incumbents reported it +
  // 1 when My Next Move shows it − 1 for an "All Other" catch-all; 7 = the occupation's own name, at least 5 for one
  // name out of a listed name ("Director" out of "Producers and Directors").
  /** @type {Map<string, Map<number, { src: number, rep: number, mnm: number, own: number }>>} */
  const keyMap = new Map();
  const addTitle = (/** @type {string} */ raw, /** @type {string} */ code, /** @type {{ src?: number, rep?: number, mnm?: number, own?: number }} */ w) => {
    if (!idx.has(code)) return;
    const variants = [raw];
    const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);   // "RN (Registered Nurse)" → both forms
    if (m) { variants.length = 0; variants.push(m[1], m[2]); }
    for (const v of variants) {
      const k = stripNoise(normTitle(v));
      if (!k || k.length > 80) continue;
      if (!keyMap.has(k)) keyMap.set(k, new Map());
      const e = keyMap.get(k);
      const i = idx.get(code);
      const cur = e.get(i) || { src: 0, rep: 0, mnm: 0, own: 0 };
      e.set(i, { src: Math.max(cur.src, w.src || 0), rep: Math.max(cur.rep, w.rep || 0), mnm: Math.max(cur.mnm, w.mnm || 0), own: Math.max(cur.own, w.own || 0) });
    }
  };
  const allOther = (/** @type {string} */ c) => /All Other/.test(byCode.get(c)?.Title || '');
  for (const r of titles) {
    const c = r['O*NET-SOC Code'];
    const w = { src: Math.min(3, r['Source(s)'].split(',').filter(Boolean).length) };
    addTitle(r['Job Title'], c, w);
    if (r['Short Title']) addTitle(r['Short Title'], c, w);
  }
  for (const r of reported) {
    const c = r['O*NET-SOC Code'];
    addTitle(r['Reported Job Title'], c, { src: 1, rep: 2, mnm: r['Shown in My Next Move'] === 'Y' ? 1 : 0 });
  }
  for (const c of codes) {
    if (allOther(c)) continue;
    const t = byCode.get(c).Title;
    const helper = /^Helpers--/.test(t);
    const name = t.replace(/^Helpers--/, '');
    // "Plumbers, Pipefitters, and Steamfitters" is a list of names (Oxford comma); in "Cooks, Restaurant",
    // "Buyers and Purchasing Agents, Farm Products" or "Painters, Construction and Maintenance" the text after
    // the last comma QUALIFIES the name: the bare name is then weak evidence ("buyer" is not mostly a farm buyer)
    // and the qualified form ("Restaurant Cook") is the occupation's own name.
    const oxford = /, and /.test(name);
    const cut = oxford ? -1 : name.lastIndexOf(', ');
    const base = cut > 0 ? name.slice(0, cut) : name;
    const qual = cut > 0 ? name.slice(cut + 2) : '';
    const AGENT = /(ers|ors|ists|ians|ants|ents|men|ees|eers|aides|clerks|cooks|chefs|guards|pilots|nurses|attendants|agents|assistants|technicians|teachers|mechanics|operators|workers|specialists|analysts|officers|managers|directors|scientists|engineers|counselors|therapists|physicians|surgeons|dentists|pharmacists|hosts|hostesses|waitresses|cashiers|tellers|maids|janitors|barbers|dancers|actors|models|judges|chiropractors|podiatrists|veterinarians|optometrists|audiologists|paralegals|carpenters|plumbers|roofers|glaziers|millwrights|machinists|welders|bakers|butchers|tailors|upholsterers|jewelers|embalmers|undertakers|morticians|ushers|porters|bellhops|concierges|nannies|sailors|captains|mates|conductors|yardmasters|dispatchers|inspectors|appraisers|assessors|adjusters|examiners|investigators|underwriters|actuaries|economists|historians|sociologists|geographers|archivists|curators|librarians|editors|writers|authors|reporters|photographers|designers|architects|surveyors|drafters)$/i;
    const parts = base.split(/,\s*(?:and\s+)?|\s+and\s+(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
    const isList = parts.length > 1 && parts.every((p) => AGENT.test(p) && p.split(' ').length <= 3);
    const suffix = helper ? ' Helper' : '';
    const own = qual ? 1 : isList ? 2 : 3;   // strength: 3 the whole name, 2 one name of a list, 1 a qualified name bare
    for (const part of isList ? parts : [base]) if (part.split(' ').length <= 7) addTitle(singularTitle(part) + suffix, c, { own });
    if (qual && !/^(Except|Including|All Other)\b/.test(qual) && qual.split(' ').length <= 3 && !isList) {
      addTitle(`${qual} ${singularTitle(base)}${suffix}`, c, { own: 3 });
    }
  }
  /** @type {Record<string, any[]>} */
  const t = Object.create(null);
  for (const k of [...keyMap.keys()].sort()) {
    const toks = k.split(' ');
    const head = toks[toks.length - 1];
    const rest = toks.slice(0, -1).join(' ');
    const vals = [...keyMap.get(k).entries()]
      .map(([i, e]) => { const w = Math.max(0, Math.min(6, e.src + e.rep + e.mnm - (allOther(codes[i]) ? 1 : 0))); return [i, e.own === 3 ? 7 : e.own === 2 ? Math.max(5, w) : e.own === 1 ? Math.max(3, w) : w]; })
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([i, w]) => i * 8 + w);
    (t[head] ||= []).push([rest, ...vals]);
  }

  // ---- military: [service, code, title, active(1/0), ...occupationIndexes]
  /** @type {Map<string, any[]>} */
  const milMap = new Map();
  let milDropped = 0;
  for (const r of mil) {
    const ix = [r.ONET1, r.ONET2, r.ONET3, r.ONET4].filter((c) => idx.has(c)).map((c) => idx.get(c));
    if (!ix.length || !r.MOC || !r.MOC_TITLE || r.MOC === '-') { milDropped++; continue; }
    const key = `${r.SVC}|${r.MOC}|${r.MOC_TITLE}|${r.MPC}`;
    const prev = milMap.get(key);
    const active = r.STATUS === 'A' ? 1 : 0;
    if (prev) { prev[4] = Math.max(prev[4], active); for (const i of ix) if (!prev.slice(5).includes(i)) prev.push(i); continue; }
    milMap.set(key, [r.SVC, r.MOC, r.MOC_TITLE.trim(), r.MPC || '', active, ...ix]);
  }
  const m = [...milMap.keys()].sort().map((k) => milMap.get(k));

  const attribution = 'This page includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. Seen has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications.';
  const head = (/** @type {string} */ format) => ({
    source: 'O*NET 31.0 Database (August 2026 release) and the O*NET military crosswalk (DMDC MOC, August 2024), National Center for O*NET Development for USDOL/ETA',
    retrieved: RETRIEVED, licence: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ ; https://www.onetcenter.org/license_db.html',
    attribution, format, build: 'scripts/occupations/build-occupations.mjs',
  });
  const files = {
    'occupations.json': stable({
      h: head('o = [[code, title, jobZone(0 = none), related = [occIndex, tier(1 Primary-Short, 2 Primary-Long, 3 Supplemental), …], tasks (Core first, by importance, ≤15), tools (hot/in-demand first, then the most specific; tools listed for >20% of occupations dropped; ≤10), alternateTitleCount], …] sorted by code; an occIndex is a position in o'),
      o,
    }),
    'titles.json': stable({
      h: head('t[headWord] = [[restOfTitle, n, n…], …]; key = rest + " " + head, normalised by lib/occupations/normalize.js (normTitle + stripNoise); n = occIndex*8 + weight (0–7: O*NET source count, +reported title, +My Next Move, −All Other; 7 = the occupation\'s own name), strongest first'),
      t,
    }),
    'military.json': stable({
      h: head('m = [[service (A Army, N Navy, F Air Force, M Marine Corps, C Coast Guard, other letters = officer/warrant/reserve designators as published), MOC code, MOC title, personnel category (E enlisted, O officer, W warrant), active(1/0), occIndex…], …] sorted'),
      m,
    }),
  };
  return { files, stats: { occupations: o.length, titleKeys: keyMap.size, heads: Object.keys(t).length, military: m.length, milDropped, withTasks: o.filter((x) => x[4].length).length } };
}

async function main() {
  const args = process.argv.slice(2);
  let from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
  if (!from) {
    from = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : mkdtempSync(join(tmpdir(), 'onet-'));
    mkdirSync(from, { recursive: true });
    await download(from);
  }
  const { files, stats } = build(from);
  mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  for (const [name, data] of Object.entries(files)) {
    const body = JSON.stringify(data);
    if (body.length > BUDGET) throw new Error(`${name} is ${body.length} bytes, over the ${BUDGET}-byte budget`);
    total += body.length;
    writeFileSync(join(OUT_DIR, name), body);
    console.log(`${name}: ${(body.length / 1024).toFixed(0)} KB`);
  }
  console.log(JSON.stringify(stats), `total ${(total / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.stack || e); process.exit(1); });
}
