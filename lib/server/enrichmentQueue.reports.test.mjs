// The REAL api/reports.js company-score handler with a mocked fetch: proves the enqueue hook fires
// exactly when a lookup has zero first-party reports, passes the status to the page, and that a
// missing/broken queue leaves the response exactly as before.
// Run: node --test lib/server/enrichmentQueue.reports.test.mjs

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'svc';

const { default: handler } = await import('../../api/reports.js');

const realFetch = globalThis.fetch;
let calls;
let routes;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (u, o = {}) => {
    const url = String(u);
    calls.push({ url, body: o.body ? JSON.parse(o.body) : null });
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, o);
    return json(200, []);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function run(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
    };
    handler({ method: 'POST', headers: { 'x-real-ip': '1.2.3.4' }, query: {}, body }, res);
  });
}

const enqueueCalls = () => calls.filter((c) => c.url.endsWith('/rpc/enqueue_company_enrichment'));

test('no reports at all → enqueued, status returned with the honest no-data payload', async () => {
  routes = [
    [/rpc\/increment_rate_limit/, () => json(200, 1)],
    [/rpc\/enqueue_company_enrichment/, () => json(200, [{ status: 'queued', requested_at: '2026-10-17T00:00:00Z', done_at: null }])],
  ];
  const r = await run({ name: 'Acme Corp' });
  assert.equal(r.body.no_data, true);
  assert.equal(r.body.score, null);
  assert.deepEqual(r.body.enrichment, { status: 'queued', requested_at: '2026-10-17T00:00:00Z', done_at: null });
  assert.deepEqual(enqueueCalls().map((c) => c.body), [{ p_key: 'acme', p_name: 'acme corp' }]);
});

test('queue missing (pre-migration 404) → response identical to before, no enrichment key', async () => {
  routes = [
    [/rpc\/increment_rate_limit/, () => json(200, 1)],
    [/rpc\/enqueue_company_enrichment/, () => json(404, { code: 'PGRST202' })],
  ];
  const r = await run({ name: 'Acme Corp' });
  assert.equal(r.body.no_data, true);
  assert.equal('enrichment' in r.body, false);
});

test('web-research-only cached score (0 first-party) → enqueued under the STORED name', async () => {
  routes = [
    [/rpc\/increment_rate_limit/, () => json(200, 1)],
    [/company_scores\?company_name=ilike/, () => json(200, [{ company_name: "lowe's", overall_score: 60, ghost_rate: 0.4, response_rate: 0.3, report_count: 40, first_party_report_count: 0, web_report_count: 40, data_source: 'web_search', created_at: '2026-10-01T00:00:00Z' }])],
    [/rpc\/enqueue_company_enrichment/, () => json(200, [{ status: 'running', requested_at: null, done_at: null }])],
  ];
  const r = await run({ name: "Lowe's" });
  assert.equal(r.body._src, 'cache');
  assert.equal(r.body.enrichment.status, 'running');
  assert.deepEqual(enqueueCalls().map((c) => c.body), [{ p_key: "lowe's", p_name: "lowe's" }]);
});

test('company WITH first-party reports → never enqueued', async () => {
  routes = [
    [/rpc\/increment_rate_limit/, () => json(200, 1)],
    [/company_scores\?company_name=ilike/, () => json(200, [{ company_name: 'globex', overall_score: 70, ghost_rate: 0.2, response_rate: 0.6, report_count: 9, first_party_report_count: 9, web_report_count: 0, data_source: 'reports', created_at: '2026-10-01T00:00:00Z' }])],
  ];
  const r = await run({ name: 'Globex' });
  assert.equal(r.body._src, 'cache');
  assert.equal('enrichment' in r.body, false);
  assert.equal(enqueueCalls().length, 0);
});

test('reports exist but no cached score → aggregated, never enqueued', async () => {
  routes = [
    [/rpc\/increment_rate_limit/, () => json(200, 1)],
    [/reports\?company_name=ilike/, () => json(200, [{ outcome: 'ghosted', platform: 'Seen' }, { outcome: 'interview', platform: 'Seen' }])],
  ];
  const r = await run({ name: 'Initech' });
  assert.equal(r.body._src, 'reports');
  assert.equal(enqueueCalls().length, 0);
});

test('placeholder names never reach the queue', async () => {
  routes = [[/rpc\/increment_rate_limit/, () => json(200, 1)]];
  const r = await run({ name: 'unknown' });
  assert.equal(r.body.no_data, true);
  assert.equal(enqueueCalls().length, 0);
});
