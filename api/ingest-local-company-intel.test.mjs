// Ingest of Mac-collected company intel (api/ingest-local-company-intel.js).
// 2026-10-20: a re-run of 25 companies sent 84 excerpts Seen already had. The registry insert used
// ignore-duplicates WITHOUT on_conflict, so PostgREST resolved against the primary key, the
// source_hash unique index answered 409 for every row, and the run read "0 accepted · 84 rejected".
// Run: node --test api/ingest-local-company-intel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './ingest-local-company-intel.js';

process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET = 'intel-secret';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'svc';

const item = (i, over = {}) => ({ company: 'SpaceX', source: 'Reddit r/spacex', source_url: `https://www.reddit.com/r/spacex/comments/abc${i}/x/`, excerpt: `Interviewed there last spring, round ${i}, and the recruiter was responsive throughout.`, kind: 'public_commentary', ...over });

function stubDb({ existingHashes = new Set(), known = true } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push({ u, method: opts.method || 'GET' });
    if (u.includes('/company_scores?company_name=eq.') && u.includes('select=company_name')) return { ok: true, status: 200, async json() { return known ? [{ company_name: 'spacex' }] : []; } };
    if (u.includes('/jobs?company=ilike.')) return { ok: true, status: 200, async json() { return known ? [{ id: 1 }] : []; } };
    if (u.includes('/company_intel_imports')) {
      const row = JSON.parse(opts.body);
      if (!u.includes('on_conflict=source_hash')) return existingHashes.has(row.source_hash) ? { ok: false, status: 409, async json() { return {}; } } : { ok: true, status: 201, async json() { return [row]; } };
      if (existingHashes.has(row.source_hash)) return { ok: true, status: 201, async json() { return []; } }; // ignored duplicate
      existingHashes.add(row.source_hash); return { ok: true, status: 201, async json() { return [row]; } };
    }
    if (u.includes('/company_scores?company_name=eq.') && u.includes('web_reviews')) return { ok: true, status: 200, async json() { return [{ web_reviews: [] }]; } };
    if (u.includes('/company_scores?on_conflict=company_name')) return { ok: true, status: 201, async json() { return []; } };
    throw new Error(`unexpected ${opts.method || 'GET'} ${u}`);
  };
  return calls;
}
function call(body) {
  return new Promise((resolve) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'POST', headers: { authorization: 'Bearer intel-secret' }, body }, res);
  });
}

test('a re-sent excerpt counts as a duplicate, not a rejection', async () => {
  const hashes = new Set();
  stubDb({ existingHashes: hashes });
  const first = await call({ items: [item(1), item(2)], require_existing: true });
  assert.equal(first.body.accepted, 2);
  assert.equal(first.body.commentary, 2);
  const calls = stubDb({ existingHashes: hashes });
  const again = await call({ items: [item(1), item(2)], require_existing: true });
  assert.equal(again.body.duplicates, 2);
  assert.equal(again.body.rejected, 0);
  assert.ok(calls.some((c) => c.u.includes('/company_intel_imports?on_conflict=source_hash')), 'the insert names the unique column');
});

test('a 409 from the other unique index is still a duplicate', async () => {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/company_intel_imports')) return { ok: false, status: 409, async json() { return {}; } };
    return { ok: true, status: 200, async json() { return [{ company_name: 'spacex' }]; } };
  };
  const r = await call({ items: [item(3)], require_existing: true });
  assert.equal(r.body.duplicates, 1);
  assert.equal(r.body.rejected, 0);
});

test('every rejection says why, once per reason', async () => {
  stubDb({ known: false });
  const r = await call({ items: [item(4), item(5, { company: 'SpaceX' }), item(6, { source_url: '/r/x/comments/1' })], require_existing: true });
  assert.equal(r.body.rejected, 3);
  assert.deepEqual(r.body.errors.sort(), ['invalid item: needs a company, an https source link and an excerpt of 20+ characters', 'unknown company: SpaceX']);
});
