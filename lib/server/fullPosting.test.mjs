// Before a résumé tool says "paste the full posting", Seen follows the row's own link. Fake db, injected resolver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFullPosting, MIN_FULL_POSTING } from './fullPosting.js';
import { previewOnlyOrFetch } from './postingGate.js';

const TEASER = `Marriott International Overnight Cashier Valet Parking. Pay Range: $29.35-$29.35 per hour POSITION SUMMARY Monitor and direct personal and commercial vehicle traffic on property,${' x'.repeat(150)}…`;
const FULL = `POSITION SUMMARY\nMonitor and direct personal and commercial vehicle traffic on property, including guest vehicles, taxi cabs, limousines, and buses, to ensure vehicles are legally parked.\nRESPONSIBILITIES\n${'Greet guests and open doors. Park and retrieve vehicles safely. Record vehicle details on the valet ticket. '.repeat(12)}\nREQUIREMENTS\nHigh school diploma or GED. Valid driver's license. Able to drive manual and automatic vehicles.`;

function fakeDb(row) {
  const calls = [];
  const db = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body });
    if ((opts.method || 'GET') === 'GET') return { ok: true, async json() { return row ? [row] : []; } };
    return { ok: true, async json() { return null; } };
  };
  return { db, calls };
}
const ROW = { id: 'a24524bc', title: 'Overnight Cashier Valet Parking', company: 'Marriott', source: 'Adzuna', description: TEASER, apply_url: 'https://www.adzuna.com/land/ad/5918826753?se=x' };

test('a teaser row with a link: the posting is fetched, stored on the row, and returned', async () => {
  const { db, calls } = fakeDb(ROW);
  const resolve = async (v) => { assert.match(v.url, /adzuna\.com/); return { title: 'Overnight Cashier Valet Parking', company: 'Marriott', description: FULL }; };
  const got = await fetchFullPosting({ jobId: 'a24524bc', db, resolve });
  assert.equal(got.ok, true);
  assert.equal(got.fetched, true);
  assert.ok(got.description.length >= MIN_FULL_POSTING && /RESPONSIBILITIES/.test(got.description));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch && /jobs\?id=eq\.a24524bc/.test(patch.path), 'stored for the next person');
  assert.match(JSON.parse(patch.body).description, /REQUIREMENTS/);
});

test('a row that already holds the posting is returned as is; a thin or unreachable fetch fails honestly with the link', async () => {
  const full = { ...ROW, source: 'Greenhouse', description: FULL };
  const got = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb(full).db, resolve: async () => { throw new Error('must not fetch'); } });
  assert.equal(got.ok, true); assert.equal(got.fetched, false);
  const thin = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb(ROW).db, resolve: async () => ({ description: 'Just a title.' }) });
  assert.equal(thin.ok, false); assert.equal(thin.reason, 'thin'); assert.equal(thin.apply_url, ROW.apply_url);
  assert.equal(thin.row.title, ROW.title, 'the row rides along so a basis can be built from it');
  const down = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb(ROW).db, resolve: async () => { throw new Error('unreachable'); } });
  assert.equal(down.ok, false); assert.equal(down.reason, 'unreachable'); assert.equal(down.apply_url, ROW.apply_url);
  const slow = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb(ROW).db, resolve: () => new Promise(() => {}), timeoutMs: 20 });
  assert.equal(slow.reason, 'unreachable');
  const noUrl = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb({ ...ROW, apply_url: null }).db, resolve: async () => ({ description: FULL }) });
  assert.equal(noUrl.reason, 'no_url');
});

test('the gate: a teaser with a job id becomes the posting on the request; without one it is the paste box with the link', async () => {
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'k' };
  const body = { jobDescription: TEASER, jobSource: 'Adzuna', jobId: 'a24524bc' };
  const ok = await previewOnlyOrFetch(body, { env, fetchFull: async () => ({ ok: true, description: FULL, source: 'Adzuna', fetched: true }) });
  assert.equal(ok, null);
  assert.equal(body.jobDescription, FULL);
  assert.equal(body.postingPasted, true);
  assert.equal(body.postingFetched, true);
  const body2 = { jobDescription: TEASER, jobSource: 'Adzuna', jobId: 'a24524bc' };
  const no = await previewOnlyOrFetch(body2, { env, fetchFull: async () => ({ ok: false, reason: 'unreachable', apply_url: ROW.apply_url }) });
  assert.equal(no.status, 422);
  assert.equal(no.body.error, 'preview_only');
  assert.equal(no.body.apply_url, ROW.apply_url);
  // the full posting pasted over an Adzuna job is a posting: no gate, no fetch
  const pasted = { jobDescription: FULL, jobSource: 'Adzuna', jobId: 'a24524bc' };
  assert.equal(await previewOnlyOrFetch(pasted, { env, fetchFull: async () => { throw new Error('must not fetch'); } }), null);
});
