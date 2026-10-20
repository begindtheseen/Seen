// Contract test for `moderate_report` — Admin → "Recent hiring reports" ✓ / ? / ✕ / ↺.
// The bug this pins (owner, 2026-10-20: "Approving these does nothing"): ✓ on a LIVE report answered
// "ok" and changed nothing, and ✕ only zeroed outcome_weight, which the grade never reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');

const ID = '11111111-2222-4333-8444-555555555555';
const okRes = (body) => ({ ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get: () => null } });
const session = [{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role: 'super_admin', admin_id: 'a1' }];

function stubDb(row, { auditPrior = null } = {}) {
  const calls = { patches: [], audits: [] };
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url)); const m = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (u.pathname.endsWith('/admin_sessions')) return okRes(session);
    if (u.pathname.endsWith('/reports') && m === 'GET') return okRes(row ? [{ ...row }] : []); // a fresh copy, like the database
    if (u.pathname.endsWith('/reports') && m === 'PATCH') { calls.patches.push({ query: u.search, body }); Object.assign(row, body); return okRes([{ id: ID }]); }
    if (u.pathname.endsWith('/admin_audit_log') && m === 'GET') return okRes(auditPrior ? [{ metadata: { prior: auditPrior } }] : []);
    if (u.pathname.endsWith('/admin_audit_log') && m === 'POST') { calls.audits.push(body); return okRes([]); }
    return okRes([]);
  };
  return calls;
}
const post = (body) => new Promise((resolve) => {
  const out = {};
  const res = { status(c) { out.code = c; return this; }, json(p) { out.payload = p; resolve(out); return this; }, setHeader() { return this; }, end() { resolve(out); return this; } };
  handler({ method: 'POST', headers: { 'x-admin-token': 'tok' }, body, query: {} }, res);
});
const liveRow = () => ({ id: ID, company_name: 'walmart', outcome: 'offer', role: '', platform: 'Public review · reddit.com', source: 'web_public', created_at: '2026-10-20T05:38:00Z',
  report_text: 'If you can show up sober and on time you are hired basically. [Source: https://www.reddit.com/r/walmart/x]', outcome_weight: 0.3, trust_reason: 'external_import', needs_review: false });

test('✓ on a live report says so and writes nothing', async () => {
  const calls = stubDb(liveRow());
  const out = await post({ action: 'approve_report', id: ID }); // the old button name still works
  assert.equal(out.code, 200);
  assert.equal(out.payload.changed, 0);
  assert.match(out.payload.message, /Already live/);
  assert.equal(calls.patches.length, 0);
});

test('✕ really takes it out of the grade, audits the prior values, and ↺ restores exactly them', async () => {
  const row = liveRow();
  const calls = stubDb(row);
  const out = await post({ action: 'moderate_report', decision: 'reject', id: ID });
  assert.equal(out.code, 200, JSON.stringify(out.payload));
  assert.equal(out.payload.state, 'rejected');
  assert.equal(out.payload.counted, false);
  assert.deepEqual(calls.patches[0].body, { needs_review: true, trust_reason: 'admin_rejected', outcome_weight: 0 });
  assert.match(decodeURIComponent(calls.patches[0].query), /trust_reason\.not\.in\.\(admin_rejected,duplicate_import\)/, 'the PATCH repeats the condition');
  assert.deepEqual(calls.audits[0].metadata.prior, { needs_review: false, trust_reason: 'external_import', outcome_weight: 0.3 });
  const calls2 = stubDb(row, { auditPrior: calls.audits[0].metadata.prior });
  const back = await post({ action: 'moderate_report', decision: 'restore', id: ID });
  assert.equal(back.payload.state, 'live');
  assert.equal(back.payload.counted, true);
  assert.deepEqual(calls2.patches[0].body, { needs_review: false, trust_reason: 'external_import', outcome_weight: 0.3 });
});

test('the legacy ✕ action name now rejects for real; bad input is refused', async () => {
  const calls = stubDb(liveRow());
  await post({ action: 'deny_hiring_report', id: ID });
  assert.equal(calls.patches[0].body.trust_reason, 'admin_rejected');
  stubDb(null);
  assert.equal((await post({ action: 'moderate_report', decision: 'reject', id: ID })).code, 404);
  assert.equal((await post({ action: 'moderate_report', decision: 'nuke', id: ID })).code, 400);
  assert.equal((await post({ action: 'moderate_report', decision: 'reject', id: 'x' })).code, 400);
});
