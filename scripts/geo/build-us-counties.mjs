#!/usr/bin/env node
// Builds lib/geo/data/us-counties.json (public domain Census data):
//   counties — every county / parish / borough with its state, land area and internal point
//              (2024 Gazetteer counties file);
//   members  — which incorporated places lie in which county, with the population of each part
//              (Vintage 2024 population estimates, sub-est2024.csv, summary level 157).
// lib/geo/usPlaces.js uses it so "Corona, Riverside County" is the city of Corona and a county alone is its
// most populous place (Riverside County → Riverside), never the county's geometric middle — desert, for
// Riverside, San Bernardino, Kern, Maricopa and Clark.
//
//   node scripts/geo/build-us-counties.mjs                                  download, validate, build
//   node scripts/geo/build-us-counties.mjs --from TXT --members CSV          build from local copies
//
// Downloads are read in memory and never written as received; every field is validated (scripts/geo/_gazetteer.mjs)
// and the output is built from the validated values only. Any mismatch refuses to write. Fixed output path.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusText, STATE_RE, NAME_RE, FIPS_RE, usPoint, expectCount, cleanName } from './_gazetteer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'lib', 'geo', 'data', 'us-counties.json'); // fixed path
const COUNTIES_URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip';
const MEMBERS_URL = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv';
const ST = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME',
  Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const fail = (msg) => { throw new Error(`${msg} — refusing to write`); };

// ── Counties ──
const cLines = (await censusText(COUNTIES_URL, arg('--from'))).split(/\r?\n/);
if (!/^USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG/.test(cLines[0] || '')) fail('unexpected counties header');
const counties = [];
for (const line of cLines.slice(1)) {
  if (!line.trim()) continue;
  const c = line.split('\t').map((x) => x.trim());
  const [st, geoid, , name, , , sqmi] = c;
  if (!STATE_RE.test(st) || !/^\d{5}$/.test(geoid) || !NAME_RE.test(name) || !/^\d+(?:\.\d*)?$/.test(sqmi)) fail(`malformed county row: ${line.slice(0, 80)}`);
  if (!/(?:County|Parish|Borough|Census Area|Municipality|City and Borough)$/.test(name)) continue;
  const pt = usPoint(c[8], c[9]);
  if (!pt) fail(`county point outside the US: ${line.slice(0, 80)}`);
  counties.push([st, name, pt[0], pt[1], Math.round(Number(sqmi))]);
}
expectCount('counties', counties.length, 2900, 3300);

// ── Place parts by county ──
const mLines = (await censusText(MEMBERS_URL, arg('--members'), 'latin1')).split(/\r?\n/);
if (!/^SUMLEV,STATE,COUNTY,PLACE,COUSUB,CONCIT,PRIMGEO_FLAG,FUNCSTAT,NAME,STNAME,/.test(mLines[0] || '')) fail('unexpected estimates header');
const countyName = new Map();
const rows = mLines.slice(1).filter((l) => l.trim()).map((l) => l.split(','));
for (const c of rows) {
  if (c.length < 16 || !/^\d{3}$/.test(c[0]) || !FIPS_RE.test(c[1]) || !FIPS_RE.test(c[2]) || !FIPS_RE.test(c[3])) fail(`malformed estimates row: ${c.join(',').slice(0, 80)}`);
  if (c[0] === '050') { if (!NAME_RE.test(c[8])) fail(`bad county name: ${c[8]}`); countyName.set(`${c[1]}|${c[2]}`, c[8]); }
}
const members = {};
let parts = 0;
for (const c of rows) {
  if (c[0] !== '157' || c[3] === '99990') continue; // 99990 = the part of a county outside any place
  const st = ST[c[9]], county = countyName.get(`${c[1]}|${c[2]}`);
  if (!st || !county) continue;
  const valid = cleanName(c[8]);
  if (!valid || !/^\d{1,8}$/.test(c[15])) fail(`malformed place part: ${c.join(',').slice(0, 80)}`);
  let name = valid.replace(/\s*\((?:pt\.|balance)\)/gi, '').trim();
  // The legal kind is ONE trailing word group ("Kansas City city" → "Kansas City", never "Kansas").
  name = name.replace(/\s+(?:city and borough|metropolitan government|consolidated government|unified government|urban county|charter township|township|city|town|village|borough|municipality|plantation|CDP)$/i, '').trim();
  if (!name) continue;
  (members[`${st}|${county}`] ||= []).push([name, Number(c[15])]);
  parts++;
}
expectCount('place parts', parts, 18000, 23000);
for (const k of Object.keys(members)) members[k].sort((a, b) => b[1] - a[1]);

writeFileSync(OUT, JSON.stringify({
  source: 'US Census Bureau: 2024 Gazetteer counties; Vintage 2024 subcounty population estimates (public domain)',
  retrieved: new Date().toISOString().slice(0, 10),
  format: 'counties: [state, name, lat, lng, land sq mi] (internal point of the land); members["ST|County"]: [[place, population of its part], …] most populous first',
  counties,
  members,
}));
console.log(`wrote ${counties.length} counties, ${parts} place parts`);
