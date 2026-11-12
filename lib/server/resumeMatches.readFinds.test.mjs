// Rule-accepts ⇒ read-finds (director round 3): every listing that matchListing + placeMatch accept for a person
// must actually be loaded by the rail's / cron's database read (findResumeMatches), over a 3,000+ row fake jobs
// table served by a small PostgREST evaluator (title / location ilike inside or=(), bounding boxes, is.null, eq).
// The read is derived from the SAME keys the rule judges with (jobKeys.readOccupations / readTermsFor).
// Run: node --test lib/server/resumeMatches.readFinds.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as places from '../geo/usPlaces.js';
import { buildJobKeys, matchListing, placeMatch, normTitle, _resetJobKeysProbe } from './jobKeys.js';
import { findResumeMatches, RAIL_MILES } from './resumeMatches.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => (rel.startsWith('inline/') ? INLINE[rel] : fs.readFileSync(path.join(HERE, '..', 'fixtures', rel), 'utf8'));
const CORPUS_PATH = process.env.SEEN_MATCH_CORPUS || '/tmp/claude-0/-home-user-Seen/b30eccfc-31e3-5e58-94c8-e02565dad614/scratchpad/corpus/all.json';
const corpus = fs.existsSync(CORPUS_PATH) ? JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8')) : [];
const NOW = new Date();
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();

const INLINE = {
  'inline/kitchen-manager': `Luis Ortega\nDenver, CO\nEXPERIENCE\nKitchen Manager | 2021 – Present\n• Run a 12-person kitchen; order food and write the prep schedule.\nLine Cook | 2017 – 2021\n• Grill and sauté stations.`,
  'inline/junior-web-dev': `Sam Park\nAustin, TX\nEXPERIENCE\nWeb Developer — Bitly | Jun 2024 – Present\n• Build React and TypeScript features for the link dashboard.\nEDUCATION\nB.S. in Computer Science — UT Austin | 2024`,
  'inline/support-lead': `Morgan Fox\nAustin, TX\nEXPERIENCE\nCustomer Support Team Lead — Dell Technologies | Mar 2022 – Present\n• Lead a team of 8 support agents; coach and onboard every new hire through a 3-week program.\nCustomer Support Specialist — Dell Technologies | Jun 2018 – Feb 2022\n• Phone and chat support, 60 contacts a day.`,
};
const LONG = (x) => `${x} `.repeat(Math.ceil(900 / (x.length + 1)));
// Rows the director's kit showed were accepted by the rule but never read (round 3).
const SEEDED = [
  { title: 'Sous Chef', company: 'Hash Kitchen', location: 'Denver, CO', description: LONG('Lead the line, order product and train cooks in a busy brunch restaurant.') },
  { title: 'Frontend Engineer', company: 'Linkly', location: 'Remote', description: LONG('Build React and TypeScript features for our web app. US-based team.') },
  { title: 'Customer Support Manager', company: 'Indeed', location: 'Austin, TX', description: LONG('Manage a team of 10 support agents and own CSAT for our customers.') + '\nRequirements\n• 3+ years of customer support experience, including 2 years leading a team.' },
  { title: 'Call Center Trainer', company: 'Concentrix', location: 'United States', description: LONG('This is a fully remote position. Train new call center agents on systems and service standards.') },
];
const PEOPLE = [
  ['inline/kitchen-manager', 'Denver, CO'], ['inline/junior-web-dev', 'Austin, TX'], ['inline/support-lead', 'Austin, TX'],
  ['matching/cashier.txt', 'Mesa, AZ'], ['matching/cook.txt', 'Denver, CO'], ['matching/driver.txt', 'Fort Worth, TX'],
  ['matching/cna.txt', 'Houston, TX'], ['matching/admin.txt', 'Sacramento, CA'], ['matching/security.txt', 'Los Angeles, CA'],
  ['personas/dev.txt', 'Austin, TX'], ['personas/maria.txt', 'Phoenix, AZ'], ['personas/nurse.txt', 'Las Vegas, NV'],
  ['personas/warehouse.txt', 'Joliet, IL'], ['personas/electrician.txt', 'Phoenix, AZ'], ['personas/accountant.txt', 'Chicago, IL'],
];

// The table: every corpus listing once as posted, and once moved into each person's city (with or without
// coordinates, alternating) — 682 × (1 + 12) ≈ 8,900 rows.
// ids are uuids spread over the id space, as in production (the area reader splits a big read by id range).
const uuid = (n) => `${(Math.imul(n + 1, 2654435761) >>> 0).toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
function buildTable() {
  const rows = [];
  let n = 0;
  for (const j of corpus) rows.push({ ...j, id: uuid(n++), lat: null, lng: null, expires_at: FUTURE, created_at: NOW.toISOString(), availability_status: 'active' });
  for (const [, city] of PEOPLE) {
    const g = places.geocodePlace(city);
    corpus.forEach((j, i) => rows.push({ ...j, id: uuid(n++), company: `${j.company} (${city})`, location: city, lat: i % 2 ? g.lat : null, lng: i % 2 ? g.lng : null, expires_at: FUTURE, created_at: NOW.toISOString(), availability_status: 'active' }));
  }
  SEEDED.forEach((j, i) => rows.push({ ...j, id: uuid(900000 + i), lat: null, lng: null, expires_at: FUTURE, created_at: NOW.toISOString(), availability_status: 'active' }));
  return rows;
}

// ── A small PostgREST evaluator ──────────────────────────────────────────────────────────────────
function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const ilike = (val, pat) => new RegExp(`^${pat.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*')}$`, 'is').test(String(val ?? ''));
function cond(row, c) {
  if (c.startsWith('and(')) return splitTop(c.slice(4, -1)).every((x) => cond(row, x));
  const [col, op, ...rest] = c.split('.');
  const v = rest.join('.');
  if (op === 'ilike') return ilike(row[col], v);
  if (op === 'eq') return String(row[col] ?? '') === v;
  if (op === 'is') return v === 'null' ? row[col] == null || row[col] === '' : false;
  // numbers compare as numbers, everything else (uuids, timestamps) as text — as Postgres compares those columns
  const cmp = (a, b) => { const x = Number(a), y = Number(b); return Number.isFinite(x) && Number.isFinite(y) && a !== '' ? x - y : String(a).localeCompare(String(b)); };
  if (op === 'in') return v.slice(1, -1).split(',').includes(String(row[col] ?? ''));
  if (op === 'gte') return row[col] != null && cmp(row[col], v) >= 0;
  if (op === 'lte') return row[col] != null && cmp(row[col], v) <= 0;
  if (op === 'gt') return row[col] != null && cmp(row[col], v) > 0;
  if (op === 'lt') return row[col] != null && cmp(row[col], v) < 0;
  return true;
}
function serveJobs(rows, url) {
  const u = new URL(url);
  let out = rows;
  for (const [k, v] of u.searchParams.entries()) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    if (k === 'or') { const parts = splitTop(v.slice(1, -1)); out = out.filter((r) => parts.some((p) => cond(r, p))); continue; }
    out = out.filter((r) => cond(r, `${k}.${v}`));
  }
  return out.slice(0, Number(u.searchParams.get('limit')) || 1000);
}

test(`rule-accepts ⇒ read-finds for ${PEOPLE.length} people over a ${corpus.length * 13}-row table`, { skip: corpus.length < 100 ? 'corpus not present' : false }, async () => {
  const table = buildTable();
  assert.ok(table.length >= 3000);
  let checked = 0;
  for (const [file, city] of PEOPLE) {
    const resumeText = read(file);
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/rest/v1/profiles')) {
        if (u.includes('select=job_keys&limit=1')) return Response.json({ code: '42703', message: 'column profiles.job_keys does not exist' }, { status: 400 });
        return Response.json([{ resume_text: resumeText, resume_updated_at: null, city }]);
      }
      if (u.includes('/rest/v1/applications') || u.includes('/rest/v1/seen_applications')) return Response.json([]);
      if (u.includes('/rest/v1/jobs')) return Response.json(serveJobs(table, u));
      return Response.json([]);
    };
    _resetJobKeysProbe();
    const keys = buildJobKeys({ resumeText, profile: { city }, now: NOW });
    const g = places.geocodePlace(city);
    const home = { city, point: { lat: g.lat, lng: g.lng } };
    const accepted = new Set();
    for (const row of table) {
      if (!placeMatch(row, home, places, RAIL_MILES).ok) continue;
      const m = matchListing(row, keys, { now: NOW });
      if (m.ok && m.reason) accepted.add(`${normTitle(row.title)}|${normTitle(row.company)}`);
    }
    // email mode: every candidate the read loaded and the rule accepted, before the rail trims to its gated top rows
    const res = await findResumeMatches({ supabaseUrl: 'https://db.example', serviceKey: 'k', userId: 'u', persist: false, now: NOW, geo: places, mode: 'email' });
    const found = new Set(res.ranked.map((r) => `${normTitle(r.title)}|${normTitle(r.company)}`));
    const missed = [...accepted].filter((k) => !found.has(k));
    assert.deepEqual(missed, [], `${file}: the rule accepts ${missed.length} listing(s) the read never loaded: ${missed.slice(0, 5).join(' ; ')}`);
    if (file.startsWith('inline/')) assert.ok(SEEDED.some((j) => found.has(`${normTitle(j.title)}|${normTitle(j.company)}`)), `${file}: its seeded listing was read and matched`);
    checked += accepted.size;
  }
  assert.ok(checked > 30, `listings checked: ${checked}`);
});
