#!/usr/bin/env node
// Fill lat/lng on stored jobs rows that have none, from their location text (lib/geo/usPlaces.js).
// New rows get this at ingest (lib/server/jobSources.js fillCoords); rows already stored do not,
// because the dedupe trigger only refreshes last_seen_at/expires_at on a re-seen listing.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/geo/backfill-job-coords.mjs          dry run (counts only)
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/geo/backfill-job-coords.mjs --write  apply
//
// Only rows with lat IS NULL are touched (the PATCH repeats the condition); employer-posted rows are
// skipped (they are geocoded when posted). Remote, state-only and non-US text stays NULL.

import { geocodePlace } from '../../lib/geo/usPlaces.js';
import { locationScope } from '../../lib/jobs/usLocation.js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const WRITE = process.argv.includes('--write');
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required'); process.exit(1); }
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const byLocation = new Map(); // location text → ids
let scanned = 0, last = null;
for (;;) {
  const after = last ? `&id=gt.${last}` : '';
  const r = await fetch(`${URL_}/rest/v1/jobs?lat=is.null&is_employer_posted=eq.false&select=id,location&order=id.asc&limit=1000${after}`, { headers });
  if (!r.ok) throw new Error(`read failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (!rows.length) break;
  for (const { id, location } of rows) {
    const k = String(location || '');
    if (!byLocation.has(k)) byLocation.set(k, []);
    byLocation.get(k).push(id);
  }
  scanned += rows.length;
  last = rows[rows.length - 1].id;
}

const plan = [];
let unplaced = 0;
for (const [text, ids] of byLocation) {
  const g = text && locationScope(text) !== 'non_us' ? geocodePlace(text) : null;
  if (g && !g.stateOnly) plan.push({ text, ids, lat: g.lat, lng: g.lng, place: `${g.name}, ${g.state}` });
  else unplaced += ids.length;
}
const placeable = plan.reduce((n, p) => n + p.ids.length, 0);
console.log(`scanned ${scanned} coordinate-less rows · ${byLocation.size} distinct locations · ${placeable} placeable · ${unplaced} stay NULL`);
for (const p of plan.slice().sort((a, b) => b.ids.length - a.ids.length).slice(0, 15)) console.log(`  ${String(p.ids.length).padStart(5)}  "${p.text}" → ${p.place}`);
if (!WRITE) { console.log('dry run — pass --write to apply'); process.exit(0); }

let written = 0;
for (const p of plan) {
  for (let i = 0; i < p.ids.length; i += 100) {
    const ids = p.ids.slice(i, i + 100);
    const r = await fetch(`${URL_}/rest/v1/jobs?id=in.(${ids.join(',')})&lat=is.null&select=id`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ lat: p.lat, lng: p.lng }),
    });
    if (!r.ok) { console.error(`PATCH failed for "${p.text}": ${r.status} ${(await r.text()).slice(0, 200)}`); continue; }
    written += (await r.json()).length;
  }
}
console.log(`wrote coordinates on ${written} rows`);
