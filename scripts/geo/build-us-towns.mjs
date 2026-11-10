#!/usr/bin/env node
// Builds lib/geo/data/us-towns.json: the towns and townships job listings name that are NOT Census places.
// In New England, New Jersey, New York, Pennsylvania, Michigan, Wisconsin and Minnesota the town people
// write on an address ("Edison, NJ", "Mount Laurel, NJ", "Radnor, PA", "Canton, MI") is often a county
// subdivision (a township or town), which the places file (us-places.json) does not hold. Source: the
// 2024 Census Gazetteer county subdivisions file (US federal government work — public domain).
//
//   node scripts/geo/build-us-towns.mjs              download the source, then build
//   node scripts/geo/build-us-towns.mjs --from FILE   build from an unzipped 2024_Gaz_cousubs_national.txt
//
// Kept: functioning governments (FUNCSTAT A) in the states above, land ≤ 150 sq mi (a point stands for the
// town), a name that is unique in its state among these and is not already a Census place there (the place
// wins). Each town is one point, its land's internal point. lib/geo/usPlaces.js reads it with population 0,
// so a Census place of the same name always wins a bare-name lookup.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'lib', 'geo', 'data');
const URL_ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cousubs_national.zip';
const STATES = new Set(['CT', 'MA', 'ME', 'NH', 'NJ', 'NY', 'PA', 'RI', 'VT', 'MI', 'WI', 'MN']);
const SUFFIX_RE = /\s+(?:charter township|township|town|plantation|borough|city|village)$/i;

async function sourceText() {
  const i = process.argv.indexOf('--from');
  if (i > 0) return readFileSync(process.argv[i + 1], 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'cousubs-'));
  try {
    const r = await fetch(URL_);
    if (!r.ok) throw new Error(`${URL_} → HTTP ${r.status}`);
    writeFileSync(join(dir, 'c.zip'), Buffer.from(await r.arrayBuffer()));
    execFileSync('unzip', ['-o', '-q', join(dir, 'c.zip'), '-d', dir]);
    return readFileSync(join(dir, '2024_Gaz_cousubs_national.txt'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const key = (s) => s.toLowerCase().replace(/['’.]/g, '').replace(/\s+/g, ' ').trim();

const places = JSON.parse(readFileSync(join(DATA, 'us-places.json'), 'utf8')).states;
const placeNames = new Map();
for (const [st, rows] of Object.entries(places)) {
  const s = new Set();
  for (const [name, , , , aliases] of rows) {
    s.add(key(name)); s.add(key(name.replace(SUFFIX_RE, '')));
    for (const a of aliases || []) s.add(key(a));
  }
  placeNames.set(st, s);
}

const lines = (await sourceText()).split(/\r?\n/).slice(1);
const byState = new Map(); // st → Map(key → [name, lat, lng] | null when the name repeats)
for (const line of lines) {
  const c = line.split('\t').map((x) => x.trim());
  if (c.length < 11) continue;
  const [st, , , rawName, funcstat, , , aland] = c;
  if (!STATES.has(st) || funcstat !== 'A' || !(Number(aland) <= 150)) continue;
  const name = rawName.replace(SUFFIX_RE, '').trim();
  if (!name || /\bunorganized\b|\bgore\b|\bgrant\b|\bpurchase\b|\blocation\b/i.test(name)) continue;
  const k = key(name);
  if (placeNames.get(st)?.has(k)) continue;
  const lat = Number(c[9]), lng = Number(c[10]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  if (!byState.has(st)) byState.set(st, new Map());
  const m = byState.get(st);
  m.set(k, m.has(k) ? null : [name, Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000]);
}
const towns = {};
let n = 0;
for (const [st, m] of [...byState].sort()) {
  towns[st] = [...m.values()].filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]));
  n += towns[st].length;
}
writeFileSync(join(DATA, 'us-towns.json'), JSON.stringify({
  source: 'US Census Bureau, 2024 Gazetteer county subdivisions (public domain)',
  retrieved: new Date().toISOString().slice(0, 10),
  format: 'towns[state] = [name, lat, lng] — towns/townships that are not Census places',
  towns,
}));
console.log(`wrote ${n} towns across ${Object.keys(towns).length} states`);
