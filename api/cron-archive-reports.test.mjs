import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example.test';
process.env.SUPABASE_SERVICE_KEY = 'svc';
process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET = 'local';
const { runCloudCollection, retryAfterDays, skippedCompanies, runVerdict, default: handler } = await import('./cron-archive-reports.js');

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-21T19:35:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

// Stubbed PostgREST: GET collector_runs answers `rows`; every write is recorded.
function fakeDb(rows = []) {
  const writes = []; const reads = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname !== 'db.example.test') throw new Error(`unexpected host ${u.hostname}`);
    if (!init.method || init.method === 'GET') { reads.push(u.pathname + u.search); return new Response(JSON.stringify(rows), { status: 200 }); }
    writes.push({ method: init.method, path: u.pathname + u.search, body: JSON.parse(init.body) });
    return new Response(JSON.stringify([{ id: 7 }]), { status: 201 });
  };
  return Object.assign(writes, { reads });
}
const source = (accountsFor, stats = () => ({ stoppedBy: 'exhausted', searches: 1 })) => ({ id: 'reddit', label: 'Reddit',
  harvest: async (company, { onAccounts }) => { const a = accountsFor(company); if (a.length) await onAccounts(a); return stats(company); },
  toItem: (company, a) => ({ company, excerpt: a.excerpt }) });
const targetsFor = (names) => async (_h, req) => {
  assert.equal(req.headers.authorization, 'Bearer local');
  assert.equal(req.query.below, '10');
  return { status: 200, body: { companies: names.map((company) => ({ company })), below_count: names.length } };
};
const targetsCall = targetsFor(['Tried Co', 'Acme', 'Dry Inc']);
const okIngest = (sent = []) => async (_h, req) => { sent.push(...req.body.items); assert.equal(req.body.require_existing, true); return { status: 200, body: { imported_reports: req.body.items.length, published_reports: req.body.items.length } }; };

test('skips companies tried recently, sends accounts through the ingest, logs the run with its search stats', async () => {
  const writes = fakeDb([{ started_at: hoursAgo(5), status: 'complete', companies: ['Tried Co'], summary: { companies: [{ company: 'Tried Co', found: 0, searches: 12, failed_searches: 1, stopped_by: 'time' }] } }]);
  const sent = [];
  const out = await runCloudCollection({ now: () => NOW, targetsCall, sources: [source((c) => (c === 'Acme' ? [{ outcome: 'ghosted', excerpt: 'x' }, { outcome: 'hired', excerpt: 'y' }] : []))],
    ingestCall: okIngest(sent) });
  assert.equal(out.status, 'complete');
  assert.deepEqual(out.summary.companies.map((c) => c.company), ['Acme', 'Dry Inc']);
  assert.equal(sent.length, 2);
  assert.deepEqual(writes[0].body, { pipeline: 'applicant_reports_cloud', companies: ['Acme', 'Dry Inc'], status: 'running' });
  assert.equal(writes[1].method, 'PATCH');
  assert.equal(writes[1].body.status, 'complete');
  assert.equal(writes[1].body.new_reports, 2);
  // The log keeps what the old one dropped: how many searches ran and how many the archive refused.
  assert.deepEqual(Object.keys(writes[1].body.summary.companies[0]).filter((k) => ['searches', 'failed_searches', 'threads_read'].includes(k)).sort(), ['failed_searches', 'searches', 'threads_read']);
  assert.match(writes.reads[0], /select=started_at,status,companies,summary/);
});

test('a run the archive refused is never a clean "found 0": every search refused → failed with the reason; most → partial', async () => {
  const writes = fakeDb([]);
  const refused = source(() => [], () => ({ stoppedBy: 'archive_busy', searches: 6, failedSearches: 6, searchErrors: ['Timeout. Maybe slow down a bit'] }));
  const out = await runCloudCollection({ now: () => NOW, targetsCall, sources: [refused], ingestCall: okIngest() });
  assert.equal(out.status, 'failed');
  assert.match(out.error, /the archive refused every search \(18\): Reddit: Timeout\. Maybe slow down a bit/);
  assert.equal(writes.at(-1).body.status, 'failed');
  assert.match(writes.at(-1).body.error, /refused every search/);
  assert.deepEqual(writes.at(-1).body.summary.companies[0].search_errors, ['Reddit: Timeout. Maybe slow down a bit']);
  assert.equal(writes.at(-1).body.summary.failed_searches, 18);

  assert.deepEqual(runVerdict({ ok: true, searches: 10, failed_searches: 6, search_errors: ['Reddit: Timeout. Maybe slow down a bit'] }, null),
    { status: 'partial', error: 'the archive refused 6 of 10 searches: Reddit: Timeout. Maybe slow down a bit' });
  assert.deepEqual(runVerdict({ ok: true, searches: 10, failed_searches: 2, search_errors: ['x'], not_reached: ['Later Co'], stopped_early: 'time' }, null),
    { status: 'complete', error: null }, 'companies the clock did not reach are normal, not a partial run');
});

test('an ingest failure marks the run failed with the reason', async () => {
  const writes = fakeDb([]);
  const out = await runCloudCollection({ now: () => NOW, targetsCall, sources: [source(() => [{ outcome: 'ghosted', excerpt: 'x' }])],
    ingestCall: async () => ({ status: 401, body: { error: 'Unauthorized' } }) });
  assert.equal(out.status, 'failed');
  assert.match(out.error, /Seen ingest failed \(401\)/);
  assert.equal(writes.at(-1).body.status, 'failed');
});

test('each run offers up to 8 candidates and asks for the long fill queue; the clock decides how many are reached', async () => {
  const names = Array.from({ length: 12 }, (_, i) => `Company ${i}`);
  let asked;
  const writes = fakeDb([]);
  let t = NOW;
  const out = await runCloudCollection({ now: () => (t += 50_000), targetsCall: async (h, req) => { asked = req.query.limit; return targetsFor(names)(h, req); },
    sources: [source(() => [])], ingestCall: okIngest() });
  assert.equal(asked, '1000');
  assert.deepEqual(writes[0].body.companies, names.slice(0, 8));
  assert.ok(out.summary.not_reached.length > 0);
  assert.deepEqual(writes.at(-1).body.companies, out.summary.companies.map((c) => c.company), 'only reached companies are logged as tried');
  assert.equal(out.status, 'complete');
});

test('rotation: how long a company is skipped follows how its last run ended', () => {
  assert.equal(retryAfterDays({ found: 0, searches: 40, failed_searches: 2, stopped_by: 'exhausted' }), 30, 'read to the end, nothing there');
  assert.equal(retryAfterDays({ found: 3, searches: 40, failed_searches: 2, stopped_by: 'exhausted' }), 14);
  assert.equal(retryAfterDays({ found: 10, searches: 9, failed_searches: 0, stopped_by: 'goal' }), 7);
  assert.equal(retryAfterDays({ found: 4, searches: 9, failed_searches: 1, stopped_by: 'time' }), 2, 'still finding accounts');
  assert.equal(retryAfterDays({ found: 0, searches: 9, failed_searches: 1, stopped_by: 'time' }), 7);
  assert.equal(retryAfterDays({ found: 0, searches: 3, failed_searches: 0, stopped_by: 'time' }), 1, 'started in the last seconds of a run');
  assert.equal(retryAfterDays({ found: 0, searches: 10, failed_searches: 6, stopped_by: 'time' }), 1, 'the archive refused most of it');
  assert.equal(retryAfterDays({ found: 0, searches: 5, failed_searches: 4, stopped_by: 'archive_busy' }), 1);
  assert.equal(retryAfterDays({ found: 0, stopped_by: 'time' }), 7, 'a row logged without stats (the first three prod runs)');
  const rows = [
    { started_at: hoursAgo(30), status: 'complete', companies: ['Busy Co', 'Dry Co'], summary: { companies: [
      { company: 'Busy Co', found: 0, searches: 6, failed_searches: 5, stopped_by: 'archive_busy' },
      { company: 'Dry Co', found: 0, searches: 30, failed_searches: 3, stopped_by: 'exhausted' }] } },
    { started_at: hoursAgo(20 * 24), status: 'complete', companies: ['Dry Co'], summary: null },
    { started_at: hoursAgo(10 * 24), status: 'complete', companies: ['Old Co'], summary: { companies: [{ company: 'Old Co', found: 0, searches: 9, failed_searches: 0, stopped_by: 'time' }] } },
    { started_at: hoursAgo(26), status: 'running', companies: ['Crashed Co'], summary: null },
  ];
  assert.deepEqual([...skippedCompanies(rows, NOW)].sort(), ['dry co'], 'busy: retried after a day; old 7-day skip over; a crashed run: 1 day; the LATEST result counts');
});

test('refuses callers without the cron header or secret', async () => {
  let code; const res = { status(c) { code = c; return this; }, json() { return this; } };
  await handler({ method: 'GET', query: {}, headers: {} }, res);
  assert.equal(code, 401);
  await handler({ method: 'GET', query: { runs: '1' }, headers: { authorization: 'Bearer wrong' } }, res);
  assert.equal(code, 401);
});
