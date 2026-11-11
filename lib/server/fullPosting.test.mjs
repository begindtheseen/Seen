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
  assert.deepEqual(thin, { ok: false, reason: 'thin', apply_url: ROW.apply_url });
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

// 2026-11-08: the resolver answers { fields, rungs, blocked } and fetchFullPosting read `.description` off the
// wrapper, so every fetch came back empty and every teaser fell to the paste box. These tests use the REAL shape.
import fs from 'node:fs';
import { postingUrls } from './fullPosting.js';
import { validateListingUrl, extractListingFromHtml } from './listingImport.js';

test('the resolver\'s real answer shape ({ fields, rungs, blocked }) yields the posting', async () => {
  const { db, calls } = fakeDb(ROW);
  const resolve = async () => ({ fields: { title: 'Overnight Cashier', company: 'Marriott', description: FULL, via: 'jsonld' }, rungs: [], blocked: false });
  const got = await fetchFullPosting({ jobId: 'a24524bc', db, resolve });
  assert.equal(got.ok, true);
  assert.match(got.description, /REQUIREMENTS/);
  assert.ok(calls.some((c) => c.method === 'PATCH'));
});

test('an Adzuna row is read from Adzuna\'s own job page first, the partner tag kept; then its own link', async () => {
  const land = 'https://www.adzuna.com/land/ad/5957040118?se=oL3c&utm_medium=api&utm_source=be8427c6&v=A3C0';
  assert.deepEqual(postingUrls(land), ['https://www.adzuna.com/details/5957040118?utm_medium=api&utm_source=be8427c6', land]);
  const details = 'https://www.adzuna.com/details/5957078141?utm_medium=api&utm_source=be8427c6';
  assert.deepEqual(postingUrls(details), [details]);
  assert.deepEqual(postingUrls('https://boards.greenhouse.io/acme/jobs/1'), ['https://boards.greenhouse.io/acme/jobs/1']);
  // the URL check keeps Adzuna's partner tag (Adzuna answers 405 without it) and still strips everyone else's
  assert.match(validateListingUrl(details).url, /utm_source=be8427c6/);
  assert.doesNotMatch(validateListingUrl('https://jobs.example.com/1?utm_source=x&id=2').url, /utm_source/);
  // the first address that holds the posting wins; a wall on the first does not stop the second
  const seen = [];
  const resolve = async (v) => { seen.push(v.url); return seen.length === 1 ? { fields: { description: 'Sign in to continue' } } : { fields: { description: FULL } }; };
  const got = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb({ ...ROW, apply_url: land }).db, resolve });
  assert.equal(got.ok, true);
  assert.equal(seen.length, 2);
  assert.match(seen[0], /\/details\/5957040118\?utm_medium=api&utm_source=be8427c6$/);
});

test('a real Adzuna job page (saved copy) reads as the full posting through the importer', () => {
  const html = fs.readFileSync(new URL('./fixtures/adzuna-details-page.html', import.meta.url), 'utf8');
  const f = extractListingFromHtml(html, 'https://www.adzuna.com/details/5957078141');
  assert.equal(f.company, 'SpaceX');
  assert.ok(f.description.length > 3000, `got ${f.description.length}`);
  assert.match(f.description, /RESPONSIBILITIES/);
});

test('two calls for one row at once share one fetch', async () => {
  let n = 0;
  const resolve = async () => { n++; await new Promise((r) => setTimeout(r, 10)); return { fields: { description: FULL } }; };
  const db = fakeDb({ ...ROW, apply_url: 'https://jobs.example.com/1' }).db;
  const [a, b] = await Promise.all([fetchFullPosting({ jobId: 'a24524bc', db, resolve }), fetchFullPosting({ jobId: 'a24524bc', db, resolve })]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(n, 1);
});

test('refresh: a full-length row that reads as empty is re-read, and replaced only by a clearly longer posting', async () => {
  const intro = `Cirrus Logic intro. ${'We build chips for the world. '.repeat(30)}`;
  const row = { ...ROW, source: 'Lever', description: intro, apply_url: 'https://jobs.eu.lever.co/cirrus/49018156-fb14-4e3c-a874-b3d8677785b3/apply' };
  const longer = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb(row).db, refresh: true, resolve: async () => ({ fields: { description: intro + '\n' + FULL } }) });
  assert.equal(longer.ok, true); assert.equal(longer.fetched, true);
  const same = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb(row).db, refresh: true, resolve: async () => ({ fields: { description: intro + ' More.' } }) });
  assert.equal(same.ok, false); assert.equal(same.reason, 'no_more');
});

test('the gate re-reads a saved posting that reads as no requirements, and leaves a readable one alone', async () => {
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'k' };
  const intro = `Cirrus Logic has been propelled by the top engineers. ${'Join our award-winning culture. '.repeat(30)}`;
  const body = { jobDescription: intro, jobSource: 'Lever', jobId: 'lever-row-1', job: 'Senior Network Engineer' };
  let calls = 0;
  const fetchFull = async (a) => { calls++; assert.equal(a.refresh, true); return { ok: true, fetched: true, description: intro + '\n' + FULL }; };
  assert.equal(await previewOnlyOrFetch(body, { env, fetchFull }), null);
  assert.equal(calls, 1);
  assert.match(body.jobDescription, /REQUIREMENTS/);
  // once per job per instance in the refresh window
  const again = { jobDescription: intro, jobSource: 'Lever', jobId: 'lever-row-1' };
  await previewOnlyOrFetch(again, { env, fetchFull });
  assert.equal(calls, 1);
  // a posting that already reads its requirements is never re-fetched
  const readable = { jobDescription: FULL, jobSource: 'Greenhouse', jobId: 'gh-row-2' };
  await previewOnlyOrFetch(readable, { env, fetchFull: async () => { throw new Error('must not fetch'); } });
});

test('a listing the source took down (410 on a page that SAYS so → the closed rung) is reported as gone, not as a wall', async () => {
  const resolve = async () => ({ fields: { title: 'Team Member', description: '' }, rungs: [{ rung: 'direct', status: 410, blocked: true }, { rung: 'closed', status: 410 }], blocked: true });
  const got = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb(ROW).db, resolve });
  assert.deepEqual(got, { ok: false, reason: 'gone', apply_url: ROW.apply_url });
});

test('a bare 410 on the page (no closed text, so no closed rung) is not gone — it can be a refusal — and writes nothing', async () => {
  const resolve = async () => ({ fields: { title: '', description: '' }, rungs: [{ rung: 'direct', status: 410, blocked: true }], blocked: true });
  const { db, calls } = fakeDb(ROW);
  const got = await fetchFullPosting({ jobId: 'a24524bc', db, resolve });
  assert.notEqual(got.reason, 'gone');
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
  const link = await readPostingLink('https://jobs.example.com/bare-410', { resolve: async () => ({ fields: { description: '' }, rungs: [{ rung: 'direct', status: 410 }] }) });
  assert.notEqual(link.reason, 'gone');
});

test('Adzuna says 410 on its own page and the employer link refuses: the listing is gone, not "paste it"', async () => {
  const land = 'https://www.adzuna.com/land/ad/5949779993?se=x&utm_medium=api&utm_source=be8427c6';
  const resolve = async (v) => (/\/details\//.test(v.url)
    ? { fields: { description: '' }, rungs: [{ rung: 'direct', status: 410 }, { rung: 'closed', status: 410 }], blocked: true }
    : { fields: { description: '' }, rungs: [{ rung: 'direct', status: 403 }], blocked: true });
  const got = await fetchFullPosting({ jobId: 'a24524bc', db: fakeDb({ ...ROW, apply_url: land }).db, resolve });
  assert.equal(got.reason, 'gone');
});

import { postingLink, readPostingLink } from './fullPosting.js';

test('a pasted link is recognised — alone or with a short note — and a posting that cites a URL is not a link', () => {
  assert.equal(postingLink('https://jobs.lever.co/acme/49018156-fb14-4e3c-a874-b3d8677785b3'), 'https://jobs.lever.co/acme/49018156-fb14-4e3c-a874-b3d8677785b3');
  assert.equal(postingLink("here's the job: https://boards.greenhouse.io/acme/jobs/123 thanks"), 'https://boards.greenhouse.io/acme/jobs/123');
  assert.match(postingLink('careers-tmo.icims.com/jobs/10489/maintenance-technician/job'), /^https:\/\/careers-tmo\.icims\.com\/jobs\/10489/);
  assert.equal(postingLink(FULL), null);
  assert.equal(postingLink(`Apply at https://acme.com/jobs/1. ${'We need a forklift driver with two years of experience. '.repeat(3)}`), null);
  assert.equal(postingLink('http://localhost/admin'), null);
});

test('the gate reads a pasted link as the posting, and says plainly when the link\'s job is closed', async () => {
  const body = { jobDescription: 'https://careers-tmo.icims.com/jobs/10489/maintenance-technician/job', postingPasted: true };
  const ok = await previewOnlyOrFetch(body, { env: {}, readLink: async (u) => ({ ok: true, url: u, description: FULL, title: 'Maintenance Technician', company: 'The Michaels Organization' }) });
  assert.equal(ok, null);
  assert.equal(body.jobDescription, FULL);
  assert.equal(body.job, 'Maintenance Technician');
  assert.equal(body.postingLink, 'https://careers-tmo.icims.com/jobs/10489/maintenance-technician/job');
  const closed = await previewOnlyOrFetch({ jobDescription: 'https://jobs.jobvite.com/provisur/job/o6AqAfwq' }, { env: {}, readLink: async (u) => ({ ok: false, url: u, reason: 'gone' }) });
  assert.equal(closed.status, 422);
  assert.equal(closed.body.reason, 'gone');
  assert.equal(closed.body.from_link, true);
});

test('readPostingLink reads through the resolver once per link (cached), and reports a closed job as gone', async () => {
  let n = 0;
  const resolve = async () => { n++; return { fields: { title: 'Electrician', company: 'SpaceX', description: FULL }, rungs: [] }; };
  const a = await readPostingLink('https://jobs.example.com/electrician-1', { resolve });
  const b = await readPostingLink('https://jobs.example.com/electrician-1', { resolve });
  assert.equal(a.ok && b.ok, true); assert.equal(n, 1);
  const gone = await readPostingLink('https://jobs.example.com/closed-2', { resolve: async () => ({ fields: { description: '' }, rungs: [{ rung: 'closed', status: 410 }] }) });
  assert.equal(gone.reason, 'gone');
});
