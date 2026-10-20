// Contract tests for Admin "Scan for dupes" / "Remove dupes" (scan_job_dupes / dedupe_jobs) and the
// company "Auto-merge" scan. Stubbed PostgREST + admin session. The stub honours PostgREST's 1,000-row
// cap, which is what made one press never finish.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');

const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const res200 = (body) => ({ ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get() { return null; } } });

// 2,600 distinct listings (same title + company, different places — NOT duplicates), plus
// 1,200 exact copies of the first 1,200 (duplicates), spread past the first 1,000-row page.
function world() {
  const jobs = [];
  for (let i = 1; i <= 2600; i++) jobs.push({ id: uid(i), title: 'Driver', company: 'Gopuff', location: `Town ${i}`, apply_url: null, source: 'Adzuna', external_id: null, is_employer_posted: false, availability_status: 'active', expires_at: '2099-01-01T00:00:00Z', last_seen_at: '2026-10-19T00:00:00Z', created_at: '2026-10-18T00:00:00Z' });
  for (let i = 1; i <= 1200; i++) jobs.push({ ...jobs[i - 1], id: uid(5000 + i), last_seen_at: '2026-10-01T00:00:00Z' });
  jobs[2600].is_employer_posted = true;                  // copy of Town 1 posted by an employer
  return { jobs, saved: [{ job_id: uid(5002) }, { job_id: uid(5) }, { job_id: uid(5005) }], apps: [{ job_id: uid(5003) }], seenApps: [{ job_id: uid(5004) }] };
}

function install(w, { failRefs = false } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url)); const method = opts.method || 'GET';
    calls.push({ u, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/admin_sessions?token=eq')) return res200([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role: 'super_admin', admin_id: 'admin-1' }]);
    const q = new URL(String(url)).searchParams;
    const page = (rows) => { const off = Number(q.get('offset') || 0); return rows.slice(off, off + Math.min(1000, Number(q.get('limit') || 1000))); };
    if (u.includes('/rest/v1/jobs?') && method === 'GET') {
      const after = (q.get('id') || '').replace('gt.', '');
      const rows = [...w.jobs].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => !after || r.id > after);
      return res200(rows.slice(0, 1000));
    }
    if (u.includes('/rest/v1/jobs?') && method === 'DELETE') {
      const ids = /id=in\.\(([^)]*)\)/.exec(u)[1].split(',');
      const gone = w.jobs.filter((r) => ids.includes(r.id) && (!u.includes('is_employer_posted=eq.false') || !r.is_employer_posted));
      w.jobs = w.jobs.filter((r) => !gone.includes(r));
      return res200(gone.map((r) => ({ id: r.id })));
    }
    if (u.includes('/rest/v1/saved_jobs?')) return failRefs ? { ok: false, status: 500, async json() { return {}; }, async text() { return 'boom'; }, headers: { get() { return null; } } } : res200(page(w.saved));
    if (u.includes('/rest/v1/applications?')) return res200(page(w.apps));
    if (u.includes('/rest/v1/seen_applications?')) return res200(page(w.seenApps));
    if (u.includes('/rest/v1/company_scores?')) {
      const all = Array.from({ length: 1718 }, (_, i) => ({ id: uid(i + 1), name: `Co ${i}`, report_count: 1718 - i }));
      all[1600].name = 'ShiftKey, LLC'; all[1700].name = 'ShiftKey';
      all[1650].name = 'Compass Group'; all[1710].name = 'Compass';
      return res200(page(all));
    }
    return res200([]);
  };
  return calls;
}
async function call(body, w, o) {
  const calls = install(w, o);
  const r = { statusCode: 200, jsonBody: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(x) { this.jsonBody = x; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body }, r);
  return { res: r, calls };
}

test('scan reads EVERY row (keyset pages past the 1,000 cap) and counts only true duplicates', async () => {
  const w = world();
  const { res, calls } = await call({ action: 'scan_job_dupes' }, w);
  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
  assert.equal(res.jsonBody.total, 3800);
  assert.equal(res.jsonBody.groups, 1200, 'same title + company in a different town is not a duplicate');
  // 1,200 extras. Where the copy is employer-posted (Town 1) or user-held (Towns 2–4) the copy is the
  // keeper and the original goes; Town 5 has BOTH rows saved → neither is deleted (1 protected extra).
  assert.equal(res.jsonBody.suspected, 1199);
  assert.equal(res.jsonBody.protected, 1);
  assert.ok(Array.isArray(res.jsonBody.sample) && res.jsonBody.sample.length > 0);
  assert.ok(calls.filter((c) => c.u.includes('/rest/v1/jobs?')).length >= 4, 'paged');
  assert.ok(!calls.some((c) => c.method === 'DELETE'), 'a scan never deletes');
});

test('one press removes every duplicate, never a protected row, audits what it removed', async () => {
  const w = world();
  const before = new Set(w.jobs.map((r) => r.id));
  const { res, calls } = await call({ action: 'dedupe_jobs' }, w);
  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
  assert.equal(res.jsonBody.deleted, 1199);
  assert.equal(res.jsonBody.remaining, 0);
  assert.equal(res.jsonBody.complete, true);
  const left = new Set(w.jobs.map((r) => r.id));
  for (const id of [uid(5001), uid(5002), uid(5003), uid(5004), uid(5), uid(5005)]) assert.ok(left.has(id), `protected ${id} kept`);
  const towns = new Map();
  for (const r of w.jobs) towns.set(r.location, (towns.get(r.location) || 0) + 1);
  assert.equal(towns.size, 2600, 'every distinct listing survives');
  assert.equal(towns.get('Town 5'), 2, 'both user-held copies survive');
  assert.equal([...towns.values()].filter((c) => c > 1).length, 1);
  assert.equal(before.size - left.size, 1199);
  for (const d of calls.filter((c) => c.method === 'DELETE')) assert.match(d.u, /is_employer_posted=eq\.false/);
  const audit = calls.find((c) => c.u.includes('/admin_audit_log') && c.method === 'POST');
  assert.equal(audit.body.action, 'dedupe_jobs');
  assert.equal(audit.body.metadata.deleted, 1199);
  // A second press finds nothing.
  const again = await call({ action: 'scan_job_dupes' }, w);
  assert.equal(again.res.jsonBody.suspected, 0);
});

test('if the user-reference read fails, nothing is deleted', async () => {
  const w = world();
  const { res, calls } = await call({ action: 'dedupe_jobs' }, w, { failRefs: true });
  assert.equal(res.statusCode, 500);
  assert.match(res.jsonBody.error, /nothing was deleted/);
  assert.ok(!calls.some((c) => c.method === 'DELETE'));
});

test('company scan covers all 1,718 companies; auto-merge only touches legal-suffix pairs', async () => {
  const { res } = await call({ action: 'find_duplicates' }, world());
  assert.equal(res.jsonBody.total, 1718);
  const keys = Object.fromEntries(res.jsonBody.duplicates.map((g) => [g.key, g.auto]));
  assert.deepEqual(keys, { shiftkey: true, compass: false }, 'groups below the old top-500 cut-off are found');
});
