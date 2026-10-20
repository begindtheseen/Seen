// Admin "Duplicate reports" (scan_report_dupes / dedupe_reports) end to end against a stubbed PostgREST:
// the doubled SpaceX import is marked once, audited, and the recomputed score counts each account once
// and carries the employee reviews. Run: node --test api/admin-stats.reportDupes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const { isScorableReport } = await import('../lib/server/reportCounts.js');
const { isEmployeeReview } = await import('../lib/server/employeeReviews.js');

const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const res200 = (body) => ({ ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get() { return null; } } });

// 5 hiring accounts + 30 employee reviews, every one stored twice; 1,100 unrelated filler rows so the
// scan has to page past PostgREST's 1,000-row cap.
function world() {
  const rows = [];
  let i = 1;
  const add = (o) => rows.push({ id: uid(i++), company_name: 'SpaceX', platform: 'Glassdoor', role: 'Unknown', needs_review: false, trust_reason: 'external_import', outcome_weight: 0.55, created_at: `2025-0${(i % 9) + 1}-01T00:00:00Z`, ...o });
  const hiring = ['interview', 'rejected', 'hired', 'interview', 'rejected'];
  for (const twice of [0, 1]) {
    hiring.forEach((o, k) => add({ outcome: o, report_text: `Hiring account number ${k} — engineer interview with several rounds and an onsite`, created_at: `202${4 + twice}-01-0${k + 1}T00:00:00Z` }));
    for (let k = 0; k < 30; k++) add({ outcome: 'human', platform: 'Indeed', role: 'Anonymous', trust_reason: 'external_employee_review', report_text: `Review ${k} [${k % 2 ? 'A' : 'D'}]. Reviewer reports … Source: Indeed employee review`, created_at: `202${4 + twice}-02-01T00:00:00Z` });
  }
  for (let k = 0; k < 1100; k++) add({ company_name: `Filler ${k}`, outcome: 'ghosted', platform: 'Seen', report_text: '' });
  return rows;
}

function install(rows) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url)); const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ u, method, body });
    if (u.includes('/admin_sessions?token=eq')) return res200([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role: 'super_admin', admin_id: 'admin-1' }]);
    const q = new URL(String(url)).searchParams;
    if (u.includes('/rest/v1/reports?') && method === 'GET' && u.includes('order=id.asc')) {
      const after = (q.get('id') || '').replace('gt.', '');
      return res200([...rows].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => !after || r.id > after).slice(0, 1000));
    }
    if (u.includes('/rest/v1/reports?') && method === 'PATCH') {
      const ids = /id=in\.\(([^)]*)\)/.exec(u)[1].split(',');
      const hit = rows.filter((r) => ids.includes(r.id) && r.trust_reason !== 'duplicate_import');
      for (const r of hit) Object.assign(r, body);
      return res200(hit.map((r) => ({ id: r.id })));
    }
    // Recompute reads (api/_utils/reportWrite.js).
    if (u.includes('/rest/v1/reports?company_name=ilike.spacex') && u.includes('trust_reason.eq.external_employee_review')) {
      return res200(rows.filter((r) => r.company_name.toLowerCase() === 'spacex' && isEmployeeReview(r)));
    }
    if (u.includes('/rest/v1/reports?company_name=ilike.spacex') && u.includes('and=(')) {
      return res200(rows.filter((r) => r.company_name.toLowerCase() === 'spacex' && isScorableReport(r)));
    }
    if (u.includes('/rest/v1/company_scores?select=')) return res200([]); // column probes succeed
    if (u.includes('/rest/v1/company_scores?company_name=eq.')) return res200([{ web_reviews: [] }]);
    return res200([]);
  };
  return calls;
}
async function call(body, rows) {
  const calls = install(rows);
  const r = { statusCode: 200, jsonBody: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(x) { this.jsonBody = x; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body }, r);
  return { res: r, calls };
}

test('scan finds every extra copy across pages, by company, and changes nothing', async () => {
  const rows = world();
  const { res, calls } = await call({ action: 'scan_report_dupes' }, rows);
  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
  assert.equal(res.jsonBody.total, rows.length);
  assert.equal(res.jsonBody.suspected, 35);
  assert.deepEqual(res.jsonBody.by_company, { SpaceX: 35 });
  assert.ok(!calls.some((c) => c.method === 'PATCH'));
});

test('one press marks every copy, audits it, and the rescored company counts each account once with its employee reviews', async () => {
  const rows = world();
  const { res, calls } = await call({ action: 'dedupe_reports' }, rows);
  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
  assert.equal(res.jsonBody.marked, 35);
  assert.equal(res.jsonBody.complete, true);
  assert.equal(rows.filter((r) => r.trust_reason === 'duplicate_import').length, 35);
  for (const p of calls.filter((c) => c.method === 'PATCH')) {
    assert.deepEqual(p.body, { needs_review: true, trust_reason: 'duplicate_import' }, 'nothing deleted, weight untouched');
    assert.match(p.u, /trust_reason\.neq\.duplicate_import/);
  }
  const audit = calls.filter((c) => c.u.includes('/admin_audit_log') && c.method === 'POST').flatMap((c) => c.body);
  assert.equal(audit.length, 35);
  assert.ok(audit.every((a) => a.action === 'mark_duplicate_report' && a.metadata.duplicate_of && a.metadata.prior));
  const saved = calls.find((c) => c.method === 'POST' && c.u.includes('/company_scores?on_conflict'));
  assert.ok(saved, 'the company score is recomputed');
  assert.equal(saved.body.first_party_report_count, 5, 'five hiring accounts, not ten');
  assert.equal(saved.body.employee_review_count, 30, 'thirty employee reviews, not sixty');
  const again = await call({ action: 'scan_report_dupes' }, rows);
  assert.equal(again.res.jsonBody.suspected, 0, 'a second press finds nothing');
});
