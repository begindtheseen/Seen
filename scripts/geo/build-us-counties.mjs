#!/usr/bin/env node
// Builds lib/geo/data/us-counties.json from the 2024 Census Gazetteer counties file (public domain):
// every county / parish / borough with its state, land area and internal point. lib/geo/usPlaces.js uses it
// to read listings that name a county — "Glendale, Los Angeles County" is the Glendale in that county, not
// the bigger one in Arizona; "Stock Yards, Cook County" (a neighbourhood we do not know) is placed at the
// county's principal city.
//
//   node scripts/geo/build-us-counties.mjs                              download the sources, then build
//   node scripts/geo/build-us-counties.mjs --from FILE --members CSV     build from local copies
//
// Which incorporated places lie in which county comes from the Census Vintage 2024 population estimates
// (sub-est2024.csv, summary level 157 = the part of a place inside one county), so "Corona, Riverside County"
// is the city of Corona, and a county's principal city is its most populous place (Riverside County →
// Riverside), never the county's geometric middle (desert, for Riverside, San Bernardino, Kern, Maricopa, Clark).

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'lib', 'geo', 'data', 'us-counties.json');
const URL_ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip';
const MEMBERS_URL = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv';
const ST = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME',
  Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };

async function membersText() {
  const i = process.argv.indexOf('--members');
  if (i > 0) return readFileSync(process.argv[i + 1], 'latin1');
  const r = await fetch(MEMBERS_URL);
  if (!r.ok) throw new Error(`${MEMBERS_URL} → HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('latin1');
}

async function sourceText() {
  const i = process.argv.indexOf('--from');
  if (i > 0) return readFileSync(process.argv[i + 1], 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'counties-'));
  try {
    const r = await fetch(URL_);
    if (!r.ok) throw new Error(`${URL_} → HTTP ${r.status}`);
    writeFileSync(join(dir, 'c.zip'), Buffer.from(await r.arrayBuffer()));
    execFileSync('unzip', ['-o', '-q', join(dir, 'c.zip'), '-d', dir]);
    return readFileSync(join(dir, '2024_Gaz_counties_national.txt'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const counties = [];
for (const line of (await sourceText()).split(/\r?\n/).slice(1)) {
  const c = line.split('\t').map((x) => x.trim());
  if (c.length < 10) continue;
  const [st, , , name, , , aland] = c;
  const lat = Number(c[8]), lng = Number(c[9]);
  if (!/(?:County|Parish|Borough|Census Area|Municipality|City and Borough)$/.test(name) || !Number.isFinite(lat)) continue;
  counties.push([st, name, Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000, Math.round(Number(aland))]);
}
// County FIPS → name per state (summary level 050), then each place part (157) under its county.
const lines = (await membersText()).split(/\r?\n/);
const countyName = new Map();
for (const l of lines) { const c = l.split(','); if (c[0] === '050') countyName.set(`${c[1]}|${c[2]}`, c[8]); }
const members = {};
for (const l of lines) {
  const c = l.split(',');
  if (c[0] !== '157' || c[3] === '99990') continue; // 99990 = the balance of a county outside any place
  const st = ST[c[9]], county = countyName.get(`${c[1]}|${c[2]}`);
  if (!st || !county) continue;
  let name = c[8].replace(/\s*\((?:pt\.|balance)\)/gi, '').trim();
  for (let k = 0; k < 3; k++) name = name.replace(/\s+(?:city and borough|metropolitan government|consolidated government|unified government|urban county|charter township|township|city|town|village|borough|municipality|plantation|CDP)$/i, '').trim();
  const pop = Number(c[15]) || 0;
  (members[`${st}|${county}`] ||= []).push([name, pop]);
}
for (const k of Object.keys(members)) members[k].sort((a, b) => b[1] - a[1]);

writeFileSync(OUT, JSON.stringify({
  members,
  source: 'US Census Bureau, 2024 Gazetteer counties (public domain)',
  retrieved: new Date().toISOString().slice(0, 10),
  format: 'counties: [state, name, lat, lng, land sq mi] (internal point of the land); members["ST|County"]: [[place, population of its part], …] most populous first',
  counties,
}));
console.log(`wrote ${counties.length} counties, ${Object.values(members).reduce((n, m) => n + m.length, 0)} place parts`);
