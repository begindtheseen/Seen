#!/usr/bin/env node
// Builds lib/geo/usPlaces.data.js — the US places the job search can resolve a typed location to without
// calling a geocoder (typos, "City ST", nicknames). Source: U.S. Census Bureau, public domain:
//   • 2023 Gazetteer, places:   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip
//   • Vintage 2023 city estimates: https://www2.census.gov/programs-surveys/popest/datasets/2020-2023/cities/totals/sub-est2023.csv
//   • 2023 Gazetteer, ZCTAs:   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip
// Usage: node scripts/geo/build-us-places.mjs <2023_Gaz_place_national.txt> <sub-est2023.csv> <2023_Gaz_zcta_national.txt> [minPopulation=1000]
// Keeps incorporated places with at least minPopulation residents (2023 estimate) plus a few census-designated places
// that are cities in everyone's mind (Honolulu, Paradise NV / the Las Vegas Strip, East Los Angeles…).
import fs from 'node:fs';
import path from 'node:path';

const [gazPath, popPath, zctaPath, minArg] = process.argv.slice(2);
if (!gazPath || !popPath || !zctaPath) { console.error('usage: build-us-places.mjs <gazetteer places txt> <sub-est2023.csv> <gazetteer zcta txt> [minPopulation]'); process.exit(1); }
const MIN_POP = Number(minArg || 1000);

// census-designated places (no population estimate) worth resolving by name
const KEEP_CDP = new Map([
  ['HI|Urban Honolulu CDP', { name: 'Honolulu', pop: 345000 }],
  ['NV|Paradise CDP', { name: 'Paradise', pop: 190000 }],
  ['NV|Spring Valley CDP', { name: 'Spring Valley', pop: 215000 }],
  ['NV|Sunrise Manor CDP', { name: 'Sunrise Manor', pop: 205000 }],
  ['NV|Enterprise CDP', { name: 'Enterprise', pop: 220000 }],
  ['CA|East Los Angeles CDP', { name: 'East Los Angeles', pop: 118000 }],
  ['CA|Rowland Heights CDP', { name: 'Rowland Heights', pop: 48000 }],
  ['CA|Hacienda Heights CDP', { name: 'Hacienda Heights', pop: 54000 }],
  ['CA|Ladera Ranch CDP', { name: 'Ladera Ranch', pop: 26000 }],
  ['CA|Arden-Arcade CDP', { name: 'Arden-Arcade', pop: 94000 }],
  ['TX|The Woodlands CDP', { name: 'The Woodlands', pop: 114000 }],
  ['TX|Spring CDP', { name: 'Spring', pop: 62000 }],
  ['TX|Atascocita CDP', { name: 'Atascocita', pop: 88000 }],
  ['MD|Columbia CDP', { name: 'Columbia', pop: 105000 }],
  ['MD|Silver Spring CDP', { name: 'Silver Spring', pop: 81000 }],
  ['MD|Bethesda CDP', { name: 'Bethesda', pop: 68000 }],
  ['VA|Arlington CDP', { name: 'Arlington', pop: 235000 }],
  ['VA|Reston CDP', { name: 'Reston', pop: 63000 }],
  ['VA|Tysons CDP', { name: 'Tysons', pop: 26000 }],
  ['FL|Brandon CDP', { name: 'Brandon', pop: 115000 }],
  ['FL|Kendall CDP', { name: 'Kendall', pop: 80000 }],
  ['AZ|San Tan Valley CDP', { name: 'San Tan Valley', pop: 100000 }],
  ['NY|Hempstead CDP', { name: 'Hempstead', pop: 55000 }],
  ['PA|Levittown CDP', { name: 'Levittown', pop: 52000 }],
]);

// "Nashville-Davidson metropolitan government (balance)" → "Nashville-Davidson"; "Boise City city" → "Boise City"
function cleanName(raw) {
  return String(raw)
    .replace(/\s*\(balance\)$/i, '')
    .replace(/\s+(city and borough|consolidated government|unified government|metropolitan government|metro government|urban county|city|town|village|borough|municipality|corporation|CDP)$/i, '')
    .trim();
}
// the everyday name of a consolidated city: "Nashville-Davidson" → "Nashville", "Louisville/Jefferson County" → "Louisville"
function shortName(name) {
  if (/^Boise City$/i.test(name)) return 'Boise';
  const m = name.match(/^([A-Z][A-Za-z.' ]+?)[-/](?:[A-Z][A-Za-z.' ]+?)(?: County)?$/);
  if (m && /County$|-Davidson$|-Fayette$|-Clarke County$|-Richmond County$|-Bibb County$|\/Jefferson County$|-Silver Bow$|-Columbus$|-Wyandotte/.test(name)) return m[1].trim();
  return null;
}

const pop = new Map();
for (const line of fs.readFileSync(popPath, 'latin1').split('\n').slice(1)) {
  const c = line.split(',');
  if (c[0] !== '162') continue; // incorporated places
  pop.set(c[1] + c[3], Number(c[14]) || 0); // state fips + place fips → 2023 estimate
}

const places = [];
for (const line of fs.readFileSync(gazPath, 'utf8').split('\n').slice(1)) {
  const c = line.split('\t').map((s) => s.trim());
  if (c.length < 12) continue;
  const [st, geoid, , rawName] = c;
  const lat = Number(c[10]), lng = Number(c[11]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const cdp = KEEP_CDP.get(`${st}|${rawName}`);
  if (cdp) { places.push({ st, name: cdp.name, lat, lng, pop: cdp.pop }); continue; }
  if (/ CDP$/.test(rawName)) continue;
  const p = pop.get(geoid) || 0;
  if (p < MIN_POP) continue;
  const name = cleanName(rawName);
  places.push({ st, name, lat, lng, pop: p });
  const short = shortName(name);
  if (short && short !== name) places.push({ st, name: short, lat, lng, pop: p });
}
// downtown points for the larger cities (scripts/geo/fetch-centers.mjs → centers.json): a radius search centres on downtown,
// not on the Census internal point (Phoenix's is 8.6 miles north of downtown; San Francisco's is out at the Farallon Islands)
const centersPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'centers.json');
// read once (no exists-then-read check, which can race with another writer); a missing file means none yet
let centers = {};
try { centers = JSON.parse(fs.readFileSync(centersPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
let moved = 0;
for (const p of places) {
  const c = centers[`${p.st}|${p.name}`] || centers[`${p.st}|${places.find((q) => q.st === p.st && q.pop === p.pop && q.lat === p.lat && q.name !== p.name)?.name}`];
  if (c) { p.lat = c[0]; p.lng = c[1]; moved++; }
}
console.log(`downtown centers applied: ${moved}`);
places.sort((a, b) => (a.st < b.st ? -1 : a.st > b.st ? 1 : b.pop - a.pop));

// one line per place: ST|Name|lat|lng|population — coordinates to 3 decimals (~100 m)
const body = places.map((p) => `${p.st}|${p.name}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}|${p.pop}`).join('\n');
// the centre of each 3-digit ZIP prefix (mean of its ZCTA points): where a ZIP code is when the geocoder cannot say
const zip3 = new Map();
for (const line of fs.readFileSync(zctaPath, 'utf8').split('\n').slice(1)) {
  const c = line.split('\t').map((x) => x.trim());
  if (c.length < 7 || !/^\d{5}$/.test(c[0])) continue;
  const lat = Number(c[5]), lng = Number(c[6]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  const k = c[0].slice(0, 3);
  const z = zip3.get(k) || { lat: 0, lng: 0, n: 0 };
  z.lat += lat; z.lng += lng; z.n++;
  zip3.set(k, z);
}
const zipBody = [...zip3].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, z]) => `${k}|${(z.lat / z.n).toFixed(2)}|${(z.lng / z.n).toFixed(2)}`).join('\n');

const out = `// GENERATED by scripts/geo/build-us-places.mjs from U.S. Census Bureau data (public domain): the 2023 Gazetteer
// places file and the Vintage 2023 city population estimates. ${places.length} places (incorporated, population >= ${MIN_POP}, plus a
// few census-designated places). Do not edit by hand — re-run the script.
// Format: one place per line, "ST|Name|lat|lng|population".
export const US_PLACES = ${JSON.stringify(body)};
// The centre of each 3-digit ZIP prefix, "zip3|lat|lng" (Census ZCTA points averaged) — a ZIP code's area when no geocoder answers.
export const US_ZIP3 = ${JSON.stringify(zipBody)};
`;
const dest = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'lib', 'geo', 'usPlaces.data.js');
fs.writeFileSync(dest, out);
console.log(`wrote ${dest}: ${places.length} places, ${(out.length / 1024).toFixed(0)} KB`);
