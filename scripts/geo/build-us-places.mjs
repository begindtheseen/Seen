#!/usr/bin/env node
// Builds lib/geo/data/us-places.json and lib/geo/data/us-zips.json from US Census Bureau and USGS
// files (US federal government works: public domain, 17 U.S.C. § 105 — no license or attribution needed).
//
//   node scripts/geo/build-us-places.mjs            download the sources, then build
//   node scripts/geo/build-us-places.mjs --from DIR  build from files already in DIR (unzipped .txt / .csv)
//
// Sources (retrieved 2026-11-01):
//   Places (name, state, internal point): 2024 Gazetteer, every incorporated place + CDP
//     https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip
//   ZIP code areas (ZCTA internal point): 2024 Gazetteer
//     https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip
//   Population, incorporated places: Vintage 2024 estimates (POPESTIMATE2024)
//     https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv
//   Population, CDPs (no yearly estimate exists for them): 2010 Gazetteer POP10
//     https://www2.census.gov/geo/docs/maps-data/data/gazetteer/Gaz_places_national.zip
//   New York City boroughs (counties, not places): 2024 Gazetteer counties
//     https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip
//   Town-centre points: USGS GNIS Domestic Names, class "Populated Place" (file dated 2026-09-29)
//     https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/DomesticNames_National_Text.zip
// A Census internal point is the middle of the city's land, which for a sprawling city is far from
// downtown (Phoenix: 8.6 mi north; San Francisco: out by the Farallon Islands). Each place uses the
// nearest same-name GNIS populated place in its state instead (downtown / the town
// centre) — within 25 mi, or 50 mi for a city over 500k — and keeps the Census point otherwise.
// Population is only used to pick between places that share a name ("Springfield" → the biggest),
// so mixing vintages is fine for that job. `unzip` must be on PATH.

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, statSync, createReadStream, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'lib', 'geo', 'data');
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer';
const SOURCES = {
  places: { url: `${GAZ}/2024_Gazetteer/2024_Gaz_place_national.zip`, file: '2024_Gaz_place_national.txt' },
  zctas: { url: `${GAZ}/2024_Gazetteer/2024_Gaz_zcta_national.zip`, file: '2024_Gaz_zcta_national.txt' },
  places2010: { url: `${GAZ}/Gaz_places_national.zip`, file: 'Gaz_places_national.txt' },
  counties: { url: `${GAZ}/2024_Gazetteer/2024_Gaz_counties_national.zip`, file: '2024_Gaz_counties_national.txt' },
  popest: { url: 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv', file: 'sub-est2024.csv' },
  gnis: { url: 'https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/DomesticNames_National_Text.zip', file: 'Text/DomesticNames_National.txt' },
};

async function download(dir) {
  for (const { url, file } of Object.values(SOURCES)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (url.endsWith('.zip')) {
      const zip = join(dir, `${file.replace(/\//g, '_')}.zip`);
      writeFileSync(zip, buf);
      execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
    } else {
      writeFileSync(join(dir, file), buf);
    }
    console.log(`fetched ${url}`);
  }
}

// Tab-separated Gazetteer file → array of objects keyed by the (trimmed) header.
function readTsv(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    const o = {};
    head.forEach((h, i) => { o[h] = (cells[i] || '').trim(); });
    return o;
  });
}

// The place-type word the Gazetteer appends to each name, by LSAD code.
const LSAD_SUFFIX = {
  25: ' city', 43: ' town', 47: ' village', 21: ' borough', 57: ' CDP', 37: ' municipality', 53: ' city and borough',
  55: ' comunidad', 62: ' zona urbana', 35: ' metro township', CN: ' corporation', UC: ' urban county',
  UG: ' unified government', CG: ' consolidated government', MG: ' metropolitan government',
};
const GOV_TAIL = / (?:unified government|consolidated government|metropolitan government|metro government|urban county)$/;

function cleanName(raw, lsad) {
  let n = raw.replace(/ \(balance\)$/, '');
  const suf = LSAD_SUFFIX[lsad];
  if (suf && n.endsWith(suf)) n = n.slice(0, -suf.length);
  n = n.replace(GOV_TAIL, '').trim();
  return n;
}

// Other names people use for a place: the city part of a consolidated government
// ("Nashville-Davidson" → Nashville), a parenthetical ("San Buenaventura (Ventura)"), "Urban Honolulu".
function aliasesFor(name, raw, lsad) {
  const out = new Set();
  const consolidated = /\(balance\)| County|government|urban county/.test(raw) || ['00', 'UG', 'CG', 'MG', 'UC'].includes(lsad);
  if (consolidated && /[-/,]/.test(name)) out.add(name.split(/[-/,]/)[0].trim());
  const paren = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) { out.add(paren[1].trim()); out.add(paren[2].trim()); }
  if (/^Urban /.test(name)) out.add(name.replace(/^Urban /, ''));
  out.delete(name);
  return [...out].filter((a) => a.length >= 2);
}

const r3 = (n) => Math.round(Number(n) * 1000) / 1000;
const matchKey = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(?:saint|ste)\b/g, 'st')
  .replace(/\bft\b/g, 'fort').replace(/\bmt\b/g, 'mount').replace(/\s+/g, ' ').trim();
function miles(a, b) {
  const R = 3958.7613, rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// GNIS populated places → Map("<state fips>|<name key>" → [[lat, lng], …]).
async function readGnis(path) {
  const out = new Map();
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let head = null;
  for await (const line of rl) {
    const c = line.split('|');
    if (!head) { head = c.map((x) => x.replace(/^\uFEFF/, '')); continue; }
    if (c[2] !== 'Populated Place') continue;
    const lat = Number(c[15]), lng = Number(c[16]);
    if (!c[4] || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const k = `${c[4]}|${matchKey(c[1])}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([lat, lng]);
  }
  if (!head || head[1] !== 'feature_name' || head[15] !== 'prim_lat_dec') throw new Error('GNIS columns changed');
  return out;
}

async function build(dir) {
  const places = readTsv(join(dir, SOURCES.places.file));
  const zctas = readTsv(join(dir, SOURCES.zctas.file));
  const old = readTsv(join(dir, SOURCES.places2010.file));

  const pop10 = new Map(old.map((p) => [p.GEOID, Number(p.POP10) || 0]));
  const est = new Map();
  const csv = readFileSync(join(dir, SOURCES.popest.file), 'latin1').split(/\r?\n/);
  const h = csv[0].split(',');
  const iS = h.indexOf('SUMLEV'), iSt = h.indexOf('STATE'), iPl = h.indexOf('PLACE'), iPop = h.indexOf('POPESTIMATE2024');
  for (const line of csv.slice(1)) {
    const c = line.split(',');
    if (c[iS] !== '162' && c[iS] !== '170' && c[iS] !== '172') continue;
    const geoid = `${c[iSt]}${c[iPl]}`;
    const n = Number(c[iPop]) || 0;
    if (n > (est.get(geoid) || 0)) est.set(geoid, n);
  }

  // One row per (state, name) — the most populous wins when a name repeats inside a state.
  const byKey = new Map();
  let estHits = 0, oldHits = 0;
  for (const p of places) {
    const lat = Number(p.INTPTLAT), lng = Number(p.INTPTLONG);
    if (!p.USPS || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const name = cleanName(p.NAME, p.LSAD);
    if (!name) continue;
    let pop = est.get(p.GEOID);
    if (pop) estHits++; else { pop = pop10.get(p.GEOID) || 0; if (pop) oldHits++; }
    const row = [name, r3(lat), r3(lng), pop];
    const al = aliasesFor(name, p.NAME, p.LSAD);
    if (al.length) row.push(al);
    const key = `${p.USPS}|${name.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || prev.row[3] < pop) byKey.set(key, { st: p.USPS, fips: p.GEOID.slice(0, 2), row });
  }

  // The five boroughs are counties, so the places file lacks them; job text says "Brooklyn, NY".
  // They rank with New York's population so a bare "Brooklyn" means the borough.
  const nyc = byKey.get('NY|new york');
  const BOROUGHS = { 36061: ['Manhattan'], 36047: ['Brooklyn'], 36081: ['Queens'], 36005: ['Bronx', ['The Bronx']], 36085: ['Staten Island'] };
  for (const c of readTsv(join(dir, SOURCES.counties.file))) {
    const b = BOROUGHS[c.GEOID];
    if (!b || !nyc) continue;
    const row = [b[0], r3(c.INTPTLAT), r3(c.INTPTLONG), nyc.row[3]];
    if (b[1]) row.push(b[1]);
    byKey.set(`NY|${b[0].toLowerCase()}`, { st: 'NY', fips: '36', row });
  }

  // Town-centre points from GNIS (see the header).
  const gnis = await readGnis(join(dir, SOURCES.gnis.file));
  let moved = 0;
  for (const { fips, row } of byKey.values()) {
    const census = [row[1], row[2]];
    // 25 mi; a city over 500k may be further off its internal point (San Francisco: 33.6 mi).
    let best = null, bestD = row[3] >= 500000 ? 50 : 25;
    for (const n of [row[0], ...(row[4] || [])]) {
      for (const pt of gnis.get(`${fips}|${matchKey(n)}`) || []) {
        const d = miles(census, pt);
        if (d <= bestD) { bestD = d; best = pt; }
      }
    }
    if (best) { row[1] = r3(best[0]); row[2] = r3(best[1]); moved++; }
  }

  const states = {};
  const centroid = {};
  for (const { st, row } of byKey.values()) {
    (states[st] ||= []).push(row);
    const c = (centroid[st] ||= { w: 0, lat: 0, lng: 0, n: 0, sLat: 0, sLng: 0 });
    const w = row[3] || 0;
    if (row[3] === (nyc && nyc.row[3]) && row[0] !== 'New York') continue; // boroughs: counted once, as New York
    c.w += w; c.lat += row[1] * w; c.lng += row[2] * w; c.n++; c.sLat += row[1]; c.sLng += row[2];
  }
  for (const st of Object.keys(states)) states[st].sort((a, b) => b[3] - a[3]);
  // Population-weighted mean of the state's places: close to the Census center of population.
  const stateCenters = {};
  for (const [st, c] of Object.entries(centroid)) {
    stateCenters[st] = c.w > 0 ? [r3(c.lat / c.w), r3(c.lng / c.w)] : [r3(c.sLat / c.n), r3(c.sLng / c.n)];
  }

  const placesOut = {
    source: 'US Census Bureau 2024 Gazetteer (places, counties), Vintage 2024 population estimates, 2010 Gazetteer POP10 (CDPs); USGS GNIS populated-place points. Public domain.',
    retrieved: '2026-11-01',
    format: 'states[ST] = [[name, lat, lng, population, aliases?], …] most populous first; centers[ST] = [lat, lng]',
    centers: stateCenters,
    states,
  };

  // ZCTA internal points as one compact string: "zip,lat,lng;…" (sorted by zip).
  const zipRows = zctas
    .filter((z) => /^\d{5}$/.test(z.GEOID) && Number.isFinite(Number(z.INTPTLAT)) && Number.isFinite(Number(z.INTPTLONG)))
    .sort((a, b) => a.GEOID.localeCompare(b.GEOID))
    .map((z) => `${z.GEOID},${r3(z.INTPTLAT)},${r3(z.INTPTLONG)}`);
  const zipsOut = {
    source: 'US Census Bureau 2024 Gazetteer (ZIP Code Tabulation Areas). Public domain.',
    retrieved: '2026-11-01',
    format: 'zips = "zip,lat,lng;…"',
    zips: zipRows.join(';'),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const pPath = join(OUT_DIR, 'us-places.json');
  const zPath = join(OUT_DIR, 'us-zips.json');
  writeFileSync(pPath, JSON.stringify(placesOut));
  writeFileSync(zPath, JSON.stringify(zipsOut));
  const count = Object.values(states).reduce((n, a) => n + a.length, 0);
  console.log(`places: ${count} (${estHits} with a 2024 estimate, ${oldHits} with POP10, ${moved} on a GNIS town-centre point) → ${pPath} ${statSync(pPath).size} bytes`);
  console.log(`zips: ${zipRows.length} → ${zPath} ${statSync(zPath).size} bytes`);
}

const fromIdx = process.argv.indexOf('--from');
if (fromIdx > -1) {
  await build(process.argv[fromIdx + 1]);
} else {
  const dir = mkdtempSync(join(tmpdir(), 'us-places-'));
  try { await download(dir); await build(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
