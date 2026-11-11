#!/usr/bin/env node
// Fill lat/lng on stored jobs rows that have none, from their location text — lib/geo/radius.js placeListing,
// the same rule search measures by. New rows get coordinates at ingest (lib/server/jobSources.js fillCoords);
// rows already stored do not, because the dedupe trigger only refreshes last_seen_at/expires_at on a re-seen
// listing. With coordinates, a radius search reads a row through the indexed bounding box instead of its text.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/geo/backfill-job-coords.mjs                 dry run (counts only)
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/geo/backfill-job-coords.mjs --write         apply
//   … --write --after <uuid>   resume after the last id a stopped run printed
//
// Safe to stop and run again (idempotent): only rows with lat IS NULL are read, and every PATCH repeats
// `lat=is.null`, so a row filled meanwhile is never overwritten. Employer-posted rows are skipped (they are
// geocoded when posted). Remote-only, state-only, non-US and unplaceable text stays NULL. A listing that names
// several places stays NULL (search reads it by its text and measures every place it names).
// Reads are keyset-paged by id (1,000 a page — PostgREST's cap) and sequential; writes go 100 ids per PATCH.

import { placeListing } from '../../lib/geo/radius.js';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const WRITE = process.argv.includes('--write');
const ai = process.argv.indexOf('--after');
let last = ai > 0 ? process.argv[ai + 1] : null;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required'); process.exit(1); }
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const byLocation = new Map(); // location text → ids
let scanned = 0;
for (;;) {
  const after = last ? `&id=gt.${last}` : '';
  const r = await fetch(`${URL_}/rest/v1/jobs?lat=is.null&is_employer_posted=eq.false&select=id,location,type&order=id.asc&limit=1000${after}`, { headers });
  if (!r.ok) throw new Error(`read failed after id ${last}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  if (!rows.length) break;
  for (const { id, location, type } of rows) {
    const k = `${location || ''}\u0001${type || ''}`;
    if (!byLocation.has(k)) byLocation.set(k, []);
    byLocation.get(k).push(id);
  }
  scanned += rows.length;
  last = rows[rows.length - 1].id;
  if (scanned % 20000 === 0) console.log(`  read ${scanned} (last id ${last})`);
}

const plan = [];
const why = { multi: 0, remote: 0, state: 0, non_us: 0, none: 0 };
for (const [k, ids] of byLocation) {
  const [location, type] = k.split('\u0001');
  const p = placeListing({ location, type });
  // Several places named → left NULL on purpose: search reads such a row by its text and measures every place
  // it names; one stored point would hide the others from the bounding-box read.
  if (p.points.length > 1) { why.multi += ids.length; continue; }
  if (p.points.length) { const pt = p.points[0]; plan.push({ text: location, ids, lat: pt.lat, lng: pt.lng, place: pt.county ? `${pt.county}, ${pt.state}` : `${pt.name}, ${pt.state}` }); continue; }
  why[p.us === false ? 'non_us' : p.remote ? 'remote' : p.states.length ? 'state' : 'none'] += ids.length;
}
const placeable = plan.reduce((n, p) => n + p.ids.length, 0);
console.log(`scanned ${scanned} coordinate-less rows · ${byLocation.size} distinct locations · ${placeable} placeable`);
console.log(`stay NULL: ${why.multi} name several places · ${why.remote} remote · ${why.state} a whole state · ${why.non_us} outside the US · ${why.none} no place named`);
for (const p of plan.slice().sort((a, b) => b.ids.length - a.ids.length).slice(0, 15)) console.log(`  ${String(p.ids.length).padStart(5)}  "${p.text}" → ${p.place}`);
if (!WRITE) { console.log('dry run — pass --write to apply'); process.exit(0); }

let written = 0, batches = 0;
for (const p of plan) {
  for (let i = 0; i < p.ids.length; i += 100) {
    const ids = p.ids.slice(i, i + 100);
    const r = await fetch(`${URL_}/rest/v1/jobs?id=in.(${ids.join(',')})&lat=is.null&select=id`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ lat: p.lat, lng: p.lng }),
    });
    if (!r.ok) { console.error(`PATCH failed for "${p.text}": ${r.status} ${(await r.text()).slice(0, 200)}`); continue; }
    written += (await r.json()).length;
    if (++batches % 100 === 0) console.log(`  wrote ${written}`);
  }
}
console.log(`wrote coordinates on ${written} rows`);
