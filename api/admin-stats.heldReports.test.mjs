// Contract tests for the held-report review queue (list_held_reports / review_reports, and the old
// approve_report button now routed through the same path). Stubbed PostgREST + admin session.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');

const A = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';
const B = 'b1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';
const E = 'e1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';
const HELD = [
  { id: A, company_name: 'SpaceX', outcome: 'interview', trust_reason: 'external_import', report_text: 'Engineer interview. Hiring account', outcome_weight: 0.55, needs_review: true, created_at: '2026-10-18T00:00:00Z' },
  { id: B, company_name: 'Tesla', outcome: 'rejected', trust_reason: 'external_import', report_text: 'Engineer interview - no offer', outcome_weight: 0.55, needs_review: true, created_at: '2026-10-18T00:00:00Z' },
  { id: E, company_name: 'SpaceX', outcome: 'human', trust_reason: 'external_import', report_text: 'Great team. Source: Indeed employee review', outcome_weight: 0.55, needs_review: true, created_at: '2026-10-18T00:00:00Z' },
];
const res200 = (body) => ({ ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get() { return null; } } });

function install() {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url)); const method = opts.method || 'GET';
    calls.push({ u, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/admin_sessions?token=eq')) return res200([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role: 'super_admin', admin_id: 'admin-1' }]);
    if (u.includes('/rest/v1/reports?') && method === 'GET' && u.includes('needs_review=is.true')) {
      const m = /id=in\.\(([^)]*)\)/.exec(u);
      return res200(m ? HELD.filter((r) => m[1].split(',').includes(r.id)) : HELD);
    }
    // The single-report path (moderate_report, which the old approve_report button now uses).
    if (u.includes('/rest/v1/reports?') && method === 'GET' && /id=eq\./.test(u)) {
      const id = /id=eq\.([0-9a-f-]+)/.exec(u)[1];
      return res200(HELD.filter((r) => r.id === id).map((r) => ({ ...r })));
    }
    if (u.includes('/rest/v1/reports?') && method === 'PATCH') {
      const m = /id=in\.\(([^)]*)\)/.exec(u) || /id=eq\.([0-9a-f-]+)/.exec(u);
      return res200(m[1].split(',').map((id) => ({ id })));
    }
    return res200([]);
  };
  return calls;
}
async function call(body) {
  const calls = install();
  const r = { statusCode: 200, jsonBody: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.jsonBody = o; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body }, r);
  return { res: r, calls };
}

test('list_held_reports returns the pending queue, needs-your-eyes first, with group counts', async () => {
  const { res, calls } = await call({ action: 'list_held_reports' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody.counts, { total: 3, needs_eyes: 1, positive: 1, employee_review: 1 });
  assert.equal(res.jsonBody.reports[0].id, B, 'the rejection is first');
  const q = calls.find((c) => c.u.includes('/rest/v1/reports?')).u;
  assert.match(q, /needs_review=is\.true/);
  assert.match(q, /trust_reason\.not\.in\.\(admin_rejected,duplicate_import\)/, "rejected rows and duplicate copies never resurface");
});

test('approve: hiring rows keep their weight; employee reviews become never-scored; audit + recompute', async () => {
  const { res, calls } = await call({ action: 'review_reports', decision: 'approve', ids: [A, E] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
  assert.equal(res.jsonBody.changed, 2);
  const patches = calls.filter((c) => c.method === 'PATCH' && c.u.includes('/rest/v1/reports?'));
  assert.equal(patches.length, 2);
  for (const p of patches) {
    assert.match(p.u, /needs_review=is\.true/, 'only rows still pending are changed');
    assert.equal(p.body.outcome_weight, undefined, 'an approval never touches the trust weight');
  }
  assert.deepEqual(patches.find((p) => p.u.includes(E)).body, { needs_review: false, trust_reason: 'external_employee_review' });
  assert.deepEqual(patches.find((p) => p.u.includes(A)).body, { needs_review: false });
  const audit = calls.find((c) => c.u.includes('/admin_audit_log') && c.method === 'POST');
  assert.equal(audit.body.length, 2);
  assert.equal(audit.body[0].action, 'approve_held_report');
  assert.deepEqual(Object.keys(audit.body[0].metadata.prior).sort(), ['needs_review', 'outcome_weight', 'trust_reason']);
  // The stored score is recomputed from the (new) scorable corpus for the touched company.
  assert.ok(calls.some((c) => c.method === 'GET' && c.u.includes('/rest/v1/reports?company_name=ilike.spacex') && c.u.includes('trust_reason.not.in.(external_employee_review,admin_rejected,duplicate_import)')), 'the company score is recomputed');
  assert.equal(res.jsonBody.companies, 1);
});

test('reject keeps the row (hidden, unscored, reversible); the old approve button no longer forces weight 1.0', async () => {
  const { res, calls } = await call({ action: 'review_reports', decision: 'reject', ids: [B] });
  assert.equal(res.jsonBody.changed, 1);
  const p = calls.find((c) => c.method === 'PATCH' && c.u.includes('/rest/v1/reports?'));
  assert.deepEqual(p.body, { needs_review: true, trust_reason: 'admin_rejected', outcome_weight: 0 });
  assert.ok(!calls.some((c) => c.method === 'DELETE'), 'nothing is deleted');
  const old = await call({ action: 'approve_report', id: A });
  const op = old.calls.find((c) => c.method === 'PATCH' && c.u.includes('/rest/v1/reports?'));
  assert.deepEqual(op.body, { needs_review: false });
});

test('input validation', async () => {
  assert.equal((await call({ action: 'review_reports', decision: 'publish', ids: [A] })).res.statusCode, 400);
  assert.equal((await call({ action: 'review_reports', decision: 'approve', ids: [] })).res.statusCode, 400);
  assert.equal((await call({ action: 'review_reports', decision: 'approve', ids: ['1;drop table reports'] })).res.statusCode, 400);
  assert.equal((await call({ action: 'review_reports', decision: 'approve', ids: Array(501).fill(A) })).res.statusCode, 400);
});
