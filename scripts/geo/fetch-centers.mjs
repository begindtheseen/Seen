#!/usr/bin/env node
// One-off helper for build-us-places.mjs: the downtown point (OpenStreetMap's place node) for every place of at least
// MIN residents, so a radius search around a long city is centred on its downtown, not on the Census "internal point"
// (Phoenix's is 8.5 miles north of downtown). Writes scripts/geo/centers.json. Nominatim policy: 1 request/second, a
// descriptive User-Agent. Usage: node scripts/geo/fetch-centers.mjs [min=150000]
import fs from 'node:fs';
import path from 'node:path';
import { US_PLACES } from '../../lib/geo/usPlaces.data.js';
const MIN = Number(process.argv[2] || 150000);
const here = path.dirname(new URL(import.meta.url).pathname);
const outPath = path.join(here, 'centers.json');
const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
const rows = US_PLACES.split('\n').map((l) => l.split('|')).filter((r) => Number(r[4]) >= MIN);
const seen = new Set();
for (const [st, name, lat, lng] of rows) {
  const key = `${st}|${name}`;
  if (out[key] || seen.has(`${st}|${lat}|${lng}`)) continue;
  seen.add(`${st}|${lat}|${lng}`);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=us&city=${encodeURIComponent(name)}&state=${encodeURIComponent(st)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'SeenJobs/1.0 (+https://seenjobs.io) build-time gazetteer' } });
    const j = r.ok ? await r.json() : [];
    const hit = (Array.isArray(j) ? j : []).find((x) => ['city', 'town', 'village', 'administrative'].includes(x.addresstype) || x.category === 'place' || x.category === 'boundary');
    if (hit) {
      const d = Math.hypot(Number(hit.lat) - Number(lat), (Number(hit.lon) - Number(lng)) * Math.cos(Number(lat) * Math.PI / 180)) * 69;
      // a hit more than 25 miles from the Census point is usually another place with the same name — kept only when
      // OpenStreetMap names this very city (San Francisco's Census point is 34 miles out, at the Farallon Islands)
      const named = String(hit.display_name || '').toLowerCase().startsWith(`${name.toLowerCase()},`);
      if (d <= 25 || (named && d <= 60)) out[key] = [Number(Number(hit.lat).toFixed(3)), Number(Number(hit.lon).toFixed(3))];
      console.log(key.padEnd(34), d.toFixed(1).padStart(5), 'mi', hit.display_name.slice(0, 60));
    } else console.log(key, 'no hit');
  } catch (e) { console.log(key, 'error', e.message); }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 0));
  await new Promise((res) => setTimeout(res, 1200));
}
console.log('centers:', Object.keys(out).length);
