// Run: node --test api/jobs.listingSignals.test.mjs — the listing_signals action against stubbed PostgREST.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './jobs.js';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'svc';

const call = (body) => new Promise((resolve) => {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); }, end() { resolve({ code: this.statusCode }); } };
  handler({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body, query: {}, url: '/api/jobs' }, res);
});

test('rates only the posts of THIS employer (Amazon Flex is not Amazon); read failures refuse', async () => {
  const urls = [];
  const day = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
  global.fetch = async (u) => {
    const s = String(u); urls.push(s);
    const ok = (v) => ({ ok: true, status: 200, async json() { return v; }, async text() { return JSON.stringify(v); } });
    if (new URL(s).hostname === 'db.test' && new URL(s).pathname === '/rest/v1/jobs') return ok([
      { company: 'Amazon', salary: '$40k', source: 'Adzuna', score: 60, created_at: day(2) },
      { company: 'Amazon', salary: null, source: 'Greenhouse', source_type: 'ATS_DIRECT', score: 80, created_at: day(45) },
      { company: 'amazon', salary: '$22/hr', source: 'Adzuna', score: 55, created_at: day(1) },
      { company: 'Amazon Flex', salary: '$25/hr', source: 'Adzuna', score: 90, created_at: day(1) },
    ]);
    return ok([]);
  };
  const r = await call({ action: 'listing_signals', company: 'Amazon' });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.signals.rated, true);
  assert.equal(r.body.signals.listings, 3, 'Amazon Flex is a different employer');
  const q = new URL(urls.find((u) => new URL(u).pathname === '/rest/v1/jobs'));
  assert.equal(q.searchParams.get('availability_status'), 'eq.active');
  assert.match(q.searchParams.get('expires_at'), /^gt\./);
  global.fetch = async () => ({ ok: false, status: 500, async json() { return {}; }, async text() { return ''; } });
  const bad = await call({ action: 'listing_signals', company: 'Brand New Co' });
  assert.equal(bad.code, 502);
  assert.equal((await call({ action: 'listing_signals' })).code, 400);
});
