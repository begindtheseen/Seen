// Employer-board sync (api/refresh-employer-boards.js). Run: node --test api/refresh-employer-boards.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { syncBoards, sourcesForCompanies } from './refresh-employer-boards.js';

const src = (i, provider = 'greenhouse') => ({ id: `s${i}`, company_name: `Co ${i}`, provider, tenant: `co${i}`, consecutive_failures: 0 });
const row = (loc, i) => ({ title: `Role ${i}`, company: 'Co', location: loc, apply_url: `https://x/${i}` });

test('keeps only US/remote rows, writes in batches of 100, and reports every count', async () => {
  const boards = Array.from({ length: 30 }, (_, i) => src(i, i % 3 ? 'greenhouse' : 'lever'));
  const writes = [];
  const recorded = [];
  const out = await syncBoards(boards, {
    supabaseUrl: 'u', serviceKey: 'k',
    fetchJobs: async ({ tenant }) => (tenant === 'co5'
      ? { ok: false, rows: [] }
      : { ok: true, rows: [row('Austin, TX', 1), row('Remote', 2), row('London', 3), row('Bengaluru, India', 4), row('', 5)] }),
    upsert: async (rows) => { writes.push(rows.length); return { upserted: rows.length }; },
    record: async (r) => { recorded.push(r); },
  });
  assert.equal(out.boards, 30);
  assert.equal(out.synced, 29);
  assert.equal(out.failed, 1);
  assert.equal(out.fetched, 29 * 5);
  assert.equal(out.kept, 29 * 3);
  assert.equal(out.dropped_outside_market, 29 * 2);
  assert.equal(out.upserted, 29 * 3);
  assert.ok(writes.every((n) => n <= 100));
  assert.equal(recorded.length, 30, 'every board records its outcome');
  const failed = recorded.find((r) => r.id === 's5');
  assert.equal(failed.ok, false);
  // The circuit breaker sees the board's full size, not the US share.
  assert.equal(recorded.find((r) => r.id === 's1').jobCount, 5);
  assert.equal(out.by_provider.lever.boards, 10);
});

test('a board whose openings are all abroad is healthy, not dead', async () => {
  const recorded = [];
  const out = await syncBoards([src(1)], {
    fetchJobs: async () => ({ ok: true, rows: [row('London', 1), row('Paris', 2)] }),
    upsert: async () => { throw new Error('nothing to write'); },
    record: async (r) => { recorded.push(r); },
  });
  assert.equal(out.kept, 0);
  assert.equal(recorded[0].ok, true);
});

test('stops starting new waves at the deadline and says so', async () => {
  const out = await syncBoards(Array.from({ length: 50 }, (_, i) => src(i)), {
    deadline: Date.now() - 1,
    fetchJobs: async () => ({ ok: true, rows: [] }), upsert: async () => ({}), record: async () => {},
  });
  assert.equal(out.out_of_time, true);
  assert.equal(out.synced, 0);
});

test('company lookup quotes names and reports the ones with no board', async () => {
  let asked = '';
  const fetchImpl = async (url) => { asked = decodeURIComponent(String(url)); return { ok: true, async json() { return [{ ...src(1), company_name: 'Stripe' }]; } }; };
  const { sources, notFound } = await sourcesForCompanies(['Stripe', 'Acme, Inc.'], 'https://db', 'k', fetchImpl);
  assert.equal(sources.length, 1);
  assert.ok(asked.includes('company_name=in.("Stripe","Acme, Inc.")'), asked);
  assert.deepEqual(notFound, ['Acme, Inc.']);
});

function call(req) {
  return new Promise((resolve) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'POST', headers: {}, ...req }, res);
  });
}

test('auth: no secret → 401; the local secret is accepted; bad input → 400', async () => {
  process.env.LOCAL_INDEED_INGEST_SECRET = 'local-secret';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.SUPABASE_URL = 'https://db';
  process.env.SUPABASE_SERVICE_KEY = 'k';
  assert.equal((await call({ headers: {} })).code, 401);
  assert.equal((await call({ headers: { authorization: 'Bearer wrong' } })).code, 401);
  const auth = { authorization: 'Bearer local-secret' };
  assert.equal((await call({ headers: auth, body: { limit: 0 } })).code, 400);
  assert.equal((await call({ headers: auth, body: { limit: 401 } })).code, 400);
  assert.equal((await call({ headers: auth, body: { companies: [] } })).code, 400);
  assert.equal((await call({ headers: auth, body: { companies: Array(51).fill('x') } })).code, 400);
  assert.equal((await call({ method: 'PUT', headers: auth })).code, 405);
});


test('a board whose feed states its name writes the name back; counts come from the fetch result', async () => {
  const recorded = [];
  const out = await syncBoards([{ ...src(1), company_name: 'plscareers', tenant: 'plscareers' }, { ...src(2), company_name: 'Stripe', tenant: 'stripe' }], {
    supabaseUrl: 'u', serviceKey: 'k',
    fetchJobs: async ({ tenant }) => (tenant === 'plscareers'
      ? { ok: true, rows: [row('Phoenix, AZ', 1)], total: 3, droppedOutsideMarket: 2, companyName: 'PLS' }
      : { ok: true, rows: [row('Remote', 2)], total: 1, droppedOutsideMarket: 0, companyName: 'Stripe' }),
    upsert: async (rows) => ({ upserted: rows.length }),
    record: async (r) => { recorded.push(r); },
  });
  assert.equal(out.fetched, 4);
  assert.equal(out.kept, 2);
  assert.equal(out.dropped_outside_market, 2);
  const pls = recorded.find((r) => r.id === 's1');
  assert.equal(pls.jobCount, 3);
  assert.equal(pls.companyName, 'PLS', 'the learned name is written back');
  assert.equal(recorded.find((r) => r.id === 's2').companyName, null, 'an unchanged name is not rewritten');
});
