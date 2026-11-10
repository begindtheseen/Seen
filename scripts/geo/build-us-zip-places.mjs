#!/usr/bin/env node
// Builds lib/geo/data/us-zip-places.json: each ZIP code area's OWN state and city, from the Census 2020 ZCTA
// relationship files (public domain):
//   state — the county holding most of the ZCTA's land (tab20_zcta520_county20_natl.txt)
//   city  — the incorporated place or CDP holding most of its land (tab20_zcta520_place20_natl.txt); none when
//           the ZIP lies outside every place (rural) — lib/geo/usPlaces.js then names the nearest place IN THAT STATE.
// A ZIP is never labelled with the nearest town across a state line ("10001 (Hoboken, NJ)" was the bug).
//
//   node scripts/geo/build-us-zip-places.mjs                          download, validate, build
//   node scripts/geo/build-us-zip-places.mjs --county F --place F     from local copies
//
// Downloads are read in memory and never written as received; every field is validated (scripts/geo/_gazetteer.mjs)
// and the output is built from validated values only; any mismatch refuses to write. Fixed output path.

import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusText, cleanName, expectCount } from './_gazetteer.mjs';
import { prefixState } from '../../lib/geo/zipPrefixes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'lib', 'geo', 'data', 'us-zip-places.json'); // fixed path
const REL = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520';
const FIPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', 10: 'DE', 11: 'DC', 12: 'FL', 13: 'GA', 15: 'HI', 16: 'ID',
  17: 'IL', 18: 'IN', 19: 'IA', 20: 'KS', 21: 'KY', 22: 'LA', 23: 'ME', 24: 'MD', 25: 'MA', 26: 'MI', 27: 'MN', 28: 'MS', 29: 'MO', 30: 'MT', 31: 'NE',
  32: 'NV', 33: 'NH', 34: 'NJ', 35: 'NM', 36: 'NY', 37: 'NC', 38: 'ND', 39: 'OH', 40: 'OK', 41: 'OR', 42: 'PA', 44: 'RI', 45: 'SC', 46: 'SD', 47: 'TN',
  48: 'TX', 49: 'UT', 50: 'VT', 51: 'VA', 53: 'WA', 54: 'WV', 55: 'WI', 56: 'WY', 72: 'PR' };
const BOROUGH = { 36005: 'Bronx', 36047: 'Brooklyn', 36081: 'Queens', 36085: 'Staten Island', 36061: 'New York' };
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const fail = (m) => { throw new Error(`${m} — refusing to write`); };
const HEAD_RE = /^﻿?OID_ZCTA5_20\|GEOID_ZCTA5_20\|NAMELSAD_ZCTA5_20\|AREALAND_ZCTA5_20\|AREAWATER_ZCTA5_20\|MTFCC_ZCTA5_20\|CLASSFP_ZCTA5_20\|FUNCSTAT_ZCTA5_20\|OID_(?:COUNTY|PLACE)_20\|GEOID_(?:COUNTY|PLACE)_20\|NAMELSAD_(?:COUNTY|PLACE)_20\|/;

function rows(text, label) {
  const lines = text.split(/\r?\n/);
  if (!HEAD_RE.test(lines[0] || '')) fail(`unexpected ${label} header`);
  const out = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split('|');
    if (c.length < 18) fail(`malformed ${label} row: ${line.slice(0, 80)}`);
    const zip = c[1], geoid = c[9], part = c[16];
    if (!zip || !geoid) continue; // a part outside every ZCTA, or a ZCTA part outside every place (rural)
    if (!/^\d{5}$/.test(zip) || !/^\d{5,7}$/.test(geoid) || !/^\d+$/.test(part)) fail(`malformed ${label} row: ${line.slice(0, 80)}`);
    out.push({ zip, geoid, name: c[10], part: Number(part) });
  }
  return out;
}

const best = (list, key) => {
  const m = new Map();
  for (const r of list) { const cur = m.get(r.zip); if (!cur || r.part > cur.part) m.set(r.zip, r); }
  return m;
};

const countyRows = rows(await censusText(`${REL}/tab20_zcta520_county20_natl.txt`, arg('--county')), 'county');
const placeRows = rows(await censusText(`${REL}/tab20_zcta520_place20_natl.txt`, arg('--place')), 'place');
const counties = best(countyRows);
expectCount('ZCTAs with a county', counties.size, 32000, 35000);
// The state: the USPS state of the ZIP's first three digits when the ZIP area has land there (a ZIP that crosses a
// line — 42223 Fort Campbell, KY/TN — is addressed in its USPS state), else the state holding most of its land.
const statesOf = new Map();
for (const r of countyRows) { const st = FIPS[r.geoid.slice(0, 2)]; if (!st) continue; if (!statesOf.has(r.zip)) statesOf.set(r.zip, new Set()); statesOf.get(r.zip).add(st); }
const stateFor = (zip, c) => { const ps = prefixState(zip); return ps && statesOf.get(zip)?.has(ps) ? ps : FIPS[c.geoid.slice(0, 2)]; };
// The city: the place holding the LARGEST share of the ZIP area's land inside that state (90210 is Beverly Hills).
const POP = new Map();
for (const [st, list] of Object.entries(JSON.parse(readFileSync(join(HERE, '..', '..', 'lib', 'geo', 'data', 'us-places.json'), 'utf8')).states)) {
  for (const [name, , , pop] of list) POP.set(`${st}|${String(name).toLowerCase()}`, pop || 0);
}
const bare = (n) => n.replace(/\s*\((?:pt\.|balance)\)/gi, '').replace(/\s+(?:city and borough|metropolitan government|consolidated government|unified government|urban county|charter township|township|city|town|village|borough|municipality|CDP|comunidad|zona urbana)$/i, '').trim();
const partsIn = new Map();
for (const r of placeRows) { const k = `${r.zip}|${FIPS[r.geoid.slice(0, 2)]}`; if (!partsIn.has(k)) partsIn.set(k, []); partsIn.get(k).push(r); }
const placeIn = new Map();
for (const [k, list] of partsIn) {
  const st = k.split('|')[1];
  const max = Math.max(...list.map((r) => r.part));
  const pop = (r) => POP.get(`${st}|${bare(r.name).toLowerCase()}`) ?? POP.get(`${st}|${r.name.toLowerCase()}`) ?? 0;
  void max; void pop;
  placeIn.set(k, list.slice().sort((a, b) => b.part - a.part)[0]);
}

const zips = {};
let named = 0;
for (const [zip, c] of [...counties].sort()) {
  const st = stateFor(zip, c);
  if (!st) continue;
  let name = null;
  const p = placeIn.get(`${zip}|${st}`);
  if (p) {
    const v = cleanName(p.name);
    if (!v) fail(`bad place name for ${zip}: ${p.name}`);
    name = v.replace(/\s*\((?:balance)\)/gi, '');
    // The legal kind is ONE trailing word group ("Kansas City city" → "Kansas City", never "Kansas").
  name = name.replace(/\s+(?:city and borough|metropolitan government|consolidated government|unified government|urban county|charter township|township|city|town|village|borough|municipality|CDP|comunidad|zona urbana)$/i, '').trim();
    named++;
  }
  // New York City ZIPs carry their borough, by county (Manhattan stays "New York").
  if (st === 'NY' && name === 'New York') name = BOROUGH[c.geoid] || name;
  zips[zip] = name ? [st, name] : [st];
}
expectCount('ZIPs written', Object.keys(zips).length, 32000, 35000);
writeFileSync(OUT, JSON.stringify({
  source: 'US Census Bureau, 2020 ZCTA relationship files (county, place) — public domain',
  retrieved: new Date().toISOString().slice(0, 10),
  format: 'zips[zip] = [state] or [state, place] — the county / place holding most of the ZIP area\'s land',
  zips,
}));
console.log(`wrote ${Object.keys(zips).length} ZIPs (${named} with a place)`);
