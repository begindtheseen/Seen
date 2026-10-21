import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example.test';
process.env.SUPABASE_SERVICE_KEY = 'svc';
process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET = 'local';
const { runCloudCollection, default: handler } = await import('./cron-archive-reports.js');

function fakeDb(tried = []) {
  const rows = [{ companies: tried }]; const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname !== 'db.example.test') throw new Error(`unexpected host ${u.hostname}`);
    if (!init.method || init.method === 'GET') return new Response(JSON.stringify(rows), { status: 200 });
    writes.push({ method: init.method, path: u.pathname + u.search, body: JSON.parse(init.body) });
    return new Response(JSON.stringify([{ id: 7 }]), { status: 201 });
  };
  return writes;
}
const source = (accountsFor) => ({ id: 'reddit', label: 'Reddit',
  harvest: async (company, { onAccounts }) => { const a = accountsFor(company); if (a.length) await onAccounts(a); return { stoppedBy: 'exhausted', searches: 1 }; },
  toItem: (company, a) => ({ company, excerpt: a.excerpt }) });
const targetsCall = async (_h, req) => {
  assert.equal(req.headers.authorization, 'Bearer local');
  return { status: 200, body: { companies: ['Tried Co', 'Acme', 'Dry Inc'].map((company) => ({ company })), below_count: 3 } };
};

test('skips companies tried this week, sends accounts through the ingest, logs the run', async () => {
  const writes = fakeDb(['tried co']);
  const sent = [];
  const out = await runCloudCollection({ targetsCall, sources: [source((c) => (c === 'Acme' ? [{ outcome: 'ghosted', excerpt: 'x' }, { outcome: 'hired', excerpt: 'y' }] : []))],
    ingestCall: async (_h, req) => { sent.push(...req.body.items); assert.equal(req.body.require_existing, true); return { status: 200, body: { imported_reports: req.body.items.length, published_reports: req.body.items.length } }; } });
  assert.equal(out.status, 'complete');
  assert.deepEqual(out.summary.companies.map((c) => c.company), ['Acme', 'Dry Inc']);
  assert.equal(sent.length, 2);
  assert.deepEqual(writes[0].body, { pipeline: 'applicant_reports_cloud', companies: ['Acme', 'Dry Inc'], status: 'running' });
  assert.equal(writes[1].method, 'PATCH');
  assert.equal(writes[1].body.status, 'complete');
  assert.equal(writes[1].body.new_reports, 2);
});

test('an ingest failure marks the run failed with the reason', async () => {
  const writes = fakeDb([]);
  const out = await runCloudCollection({ targetsCall, sources: [source(() => [{ outcome: 'ghosted', excerpt: 'x' }])],
    ingestCall: async () => ({ status: 401, body: { error: 'Unauthorized' } }) });
  assert.equal(out.status, 'failed');
  assert.match(out.error, /Seen ingest failed \(401\)/);
  assert.equal(writes.at(-1).body.status, 'failed');
});

test('refuses callers without the cron header or secret', async () => {
  let code; const res = { status(c) { code = c; return this; }, json() { return this; } };
  await handler({ method: 'GET', query: {}, headers: {} }, res);
  assert.equal(code, 401);
  await handler({ method: 'GET', query: { runs: '1' }, headers: { authorization: 'Bearer wrong' } }, res);
  assert.equal(code, 401);
});
