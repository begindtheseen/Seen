// Search must answer from our own corpus immediately and never wait on the live top-up
// (owner directive 2026-10-17: "should be instant ... no matter what").
// The live feed is mocked to take 3s; the handler must respond well before that, flag
// topup:'pending', and a db_only refresh must never start a pull. Run: node --test api/jobs.instant.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.ADZUNA_APP_ID = 'id';
process.env.ADZUNA_APP_KEY = 'key';

const NOW = new Date(Date.now() + 86_400_000).toISOString();
const row = (i) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, title: `Cashier ${i}`, company: `Store ${i}`, location: 'Austin, TX', lat: 30.27, lng: -97.74, apply_url: `https://example.com/${i}`, description: 'cashier job', search_query: 'cashier', expires_at: NOW, created_at: new Date().toISOString(), score: 60 });
let liveCalls = 0, liveDone = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (/adzuna|greenhouse|lever|ashby/i.test(u)) {
    liveCalls++;
    await new Promise((r) => setTimeout(r, 3000));
    liveDone++;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/rest/v1/jobs')) return new Response(JSON.stringify([row(1), row(2), row(3)]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('geocode_cache')) return new Response(JSON.stringify([{ lat: 30.27, lng: -97.74 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  // rate limits, flags, pull log, expansion cache, perks, suppressed …: empty / allowed
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { default: handler } = await import('./jobs.js');

function call(body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { 'x-forwarded-for': `10.7.${Math.floor(Math.random() * 200)}.1` }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}

test('a thin search answers from the corpus without waiting on the live pull', async () => {
  const t0 = Date.now();
  const res = await call({ query: 'cashier', location: 'Austin, TX', radius: '25' });
  const ms = Date.now() - t0;
  assert.equal(res.code, 200);
  assert.ok(ms < 1500, `responded in ${ms}ms (live feed takes 3000ms)`);
  assert.ok(res.body.jobs.length > 0, 'served corpus results');
  assert.equal(res.body.topup, 'pending');
  assert.equal(liveDone, 0, 'live pull had not finished when the response was sent');
});

test('the db_only refresh never starts a live pull', async () => {
  const before = liveCalls;
  const res = await call({ query: 'barista', location: 'Austin, TX', radius: '25', db_only: true });
  assert.equal(res.code, 200);
  assert.equal(res.body.topup, null);
  assert.equal(res.body._src, 'db-refresh');
  assert.equal(liveCalls, before);
});
