// Tests for the ADMIN side of the Reddit-dispute loop:
//   1. the pure review helpers (status validation, status tally, open-first ordering) in
//      _utils/companyReddit.js, and
//   2. the admin-stats.js handler contract for `list_reddit_disputes` / `update_reddit_dispute`,
//      exercised against a mocked Supabase REST layer (auth via X-Admin-Token) — same idiom as
//      admin-stats.recentEvents.test.mjs. Network-free.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isDisputeStatus, isDisputeReviewStatus, disputeStatusCounts, orderDisputesOpenFirst,
} from './_utils/companyReddit.js';

// ── Pure helpers ─────────────────────────────────────────────────────────────────────

test('isDisputeStatus accepts any lifecycle state, rejects junk / non-strings', () => {
  for (const s of ['open', 'reviewed', 'actioned', 'dismissed']) assert.equal(isDisputeStatus(s), true);
  assert.equal(isDisputeStatus('resolved'), false); // a dispute reason, not a status
  assert.equal(isDisputeStatus('nope'), false);
  assert.equal(isDisputeStatus(''), false);
  assert.equal(isDisputeStatus(123), false);
  assert.equal(isDisputeStatus(undefined), false);
});

test('isDisputeReviewStatus allows only the states an admin can SET (never open)', () => {
  for (const s of ['reviewed', 'actioned', 'dismissed']) assert.equal(isDisputeReviewStatus(s), true);
  assert.equal(isDisputeReviewStatus('open'), false); // can't move a dispute back to intake
  assert.equal(isDisputeReviewStatus('foo'), false);
  assert.equal(isDisputeReviewStatus(null), false);
});

test('disputeStatusCounts tallies known buckets + total, and ignores unknown statuses safely', () => {
  const counts = disputeStatusCounts([
    { status: 'open' }, { status: 'open' }, { status: 'actioned' }, { status: 'dismissed' }, { status: 'weird' },
  ]);
  assert.deepEqual(counts, { open: 2, reviewed: 0, actioned: 1, dismissed: 1, total: 5 });
});

test('disputeStatusCounts handles empty / non-array input without throwing', () => {
  assert.deepEqual(disputeStatusCounts([]), { open: 0, reviewed: 0, actioned: 0, dismissed: 0, total: 0 });
  assert.deepEqual(disputeStatusCounts(undefined), { open: 0, reviewed: 0, actioned: 0, dismissed: 0, total: 0 });
  // A row whose status is literally "total" must not corrupt the total bucket.
  assert.deepEqual(disputeStatusCounts([{ status: 'total' }]), { open: 0, reviewed: 0, actioned: 0, dismissed: 0, total: 1 });
});

test('orderDisputesOpenFirst floats open rows up, stable within each group, no mutation', () => {
  // Input is already newest-first (created_at desc); open rows should surface but keep recency order.
  const input = [
    { id: 5, status: 'actioned' }, { id: 4, status: 'open' }, { id: 3, status: 'dismissed' },
    { id: 2, status: 'open' }, { id: 1, status: 'reviewed' },
  ];
  const out = orderDisputesOpenFirst(input);
  assert.deepEqual(out.map(r => r.id), [4, 2, 5, 3, 1]); // open (newest→oldest) then the rest (order preserved)
  assert.deepEqual(input.map(r => r.id), [5, 4, 3, 2, 1]); // input untouched
});

test('orderDisputesOpenFirst tolerates empty / non-array input', () => {
  assert.deepEqual(orderDisputesOpenFirst([]), []);
  assert.deepEqual(orderDisputesOpenFirst(undefined), []);
});

// ── Handler contract (mocked Supabase REST) ────────────────────────────────────────────

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { default: handler } = await import('./admin-stats.js');

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get() { return null; } } };
}

// Records every DB call so update-path assertions can inspect the issued PATCH.
function installFetch({ session = true, listRows = [], countRows = [] } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    if (u.includes('/admin_sessions?token=eq')) {
      return session
        ? mockResponse([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role: 'super_admin', admin_id: 'a1' }])
        : mockResponse([]);
    }
    if (u.includes('company_reddit_disputes') && u.includes('select=id,')) return mockResponse(listRows);
    if (u.includes('company_reddit_disputes') && u.includes('select=status')) return mockResponse(countRows);
    return mockResponse([]); // PATCH / audit-log writes
  };
  return calls;
}

function makeRes() {
  const r = { statusCode: 200, jsonBody: null };
  r.setHeader = () => {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.jsonBody = o; return r; }; r.end = () => r;
  return r;
}

test('list_reddit_disputes returns open-first disputes + a status tally', async () => {
  installFetch({
    countRows: [{ status: 'open' }, { status: 'open' }, { status: 'actioned' }, { status: 'dismissed' }],
    listRows: [ // as the DB returns them: newest-first, mixed statuses
      { id: 3, company_name: 'Acme', reason: 'not_us', detail: 'name collision', status: 'actioned', created_at: '2026-07-05T12:00:00Z' },
      { id: 2, company_name: 'Globex', reason: 'outdated', detail: 'old thread', status: 'open', created_at: '2026-07-05T11:00:00Z' },
      { id: 1, company_name: 'Initech', reason: 'misleading', detail: 'misrepresents us', status: 'dismissed', created_at: '2026-07-05T10:00:00Z' },
    ],
  });
  const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'list_reddit_disputes' } };
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.deepEqual(res.jsonBody.counts, { open: 2, reviewed: 0, actioned: 1, dismissed: 1, total: 4 });
  assert.equal(res.jsonBody.disputes[0].id, 2, 'the open dispute floats to the top of the queue');
  assert.deepEqual(res.jsonBody.disputes.map(d => d.id), [2, 3, 1]);
});

test('list_reddit_disputes passes a valid status filter through to the query', async () => {
  const calls = installFetch({ listRows: [], countRows: [] });
  const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'list_reddit_disputes', status: 'actioned' } };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.filter, 'actioned');
  const listCall = calls.find(c => c.url.includes('company_reddit_disputes') && c.url.includes('select=id,'));
  assert.ok(listCall && listCall.url.includes('status=eq.actioned'), 'the filter reaches the list query');
});

test('list_reddit_disputes ignores a bogus status filter (returns unfiltered)', async () => {
  const calls = installFetch({ listRows: [], countRows: [] });
  const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'list_reddit_disputes', status: 'garbage' } };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.filter, null);
  const listCall = calls.find(c => c.url.includes('company_reddit_disputes') && c.url.includes('select=id,'));
  assert.ok(listCall && !listCall.url.includes('status=eq.'), 'no status filter is applied for junk input');
});

test('update_reddit_dispute PATCHes status by id (and only status — no invented columns)', async () => {
  const calls = installFetch();
  const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'update_reddit_dispute', id: 5, status: 'actioned' } };
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  const patch = calls.find(c => c.method === 'PATCH' && c.url.includes('company_reddit_disputes?id=eq.5'));
  assert.ok(patch, 'issues a PATCH scoped to the dispute id');
  assert.deepEqual(JSON.parse(patch.body), { status: 'actioned' }, 'sets status only');
});

test('update_reddit_dispute rejects a non-review status (e.g. open) with 400', async () => {
  installFetch();
  const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'update_reddit_dispute', id: 5, status: 'open' } };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('update_reddit_dispute rejects a non-numeric / non-positive id with 400', async () => {
  for (const badId of ['abc', 0, -3]) {
    installFetch();
    const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'update_reddit_dispute', id: badId, status: 'reviewed' } };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400, `id=${JSON.stringify(badId)} → 400`);
  }
});

test('the dispute actions require a valid admin session', async () => {
  installFetch({ session: false });
  const req = { method: 'POST', headers: { 'x-admin-token': 'bad', origin: '' }, body: { action: 'list_reddit_disputes' } };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});
