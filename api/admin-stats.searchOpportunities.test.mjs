// GET /api/admin-stats?action=search_opportunities: admin session required, engine output + freshness, and a
// clean ready:false before the migration. Stubbed PostgREST. Run: node --test api/admin-stats.searchOpportunities.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');

const res = (body, status = 200) => ({ ok: status < 300, status, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get() { return null; } } });
function install({ session = true, missing = false } = {}) {
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/admin_sessions')) return res(session ? [{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role: 'super_admin' }] : []);
    if (u.pathname.endsWith('/search_daily')) {
      if (missing) return res({ code: 'PGRST205' }, 404);
      if (u.searchParams.get('select') === 'date') return res([{ date: '2026-10-22' }]);
      return res(Number((u.searchParams.get('id') || 'gt.0').slice(3)) ? [] : [
        { id: 1, date: '2026-10-22', source: 'google', query: 'target application status', page: 'https://seenjobs.io/company/target', clicks: 0, impressions: 60, position: 10.5 },
      ]);
    }
    if (u.pathname.endsWith('/company_scores')) return res(u.searchParams.get('select') === 'mention_count' ? [] : (Number(u.searchParams.get('offset') || 0) ? [] : [{ company_name: 'target', first_party_report_count: 48 }]));
    return res([]);
  };
}
async function call(headers) {
  const r = { statusCode: 200, jsonBody: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.jsonBody = o; return this; }, end() { return this; } };
  await handler({ method: 'GET', headers: { origin: '', ...headers }, query: { action: 'search_opportunities' } }, r);
  return r;
}

test('needs an admin session', async () => {
  install({ session: false });
  assert.equal((await call({ 'x-admin-token': 'tok' })).statusCode, 401);
  assert.equal((await call({})).statusCode, 401);
});

test('returns the engine output with freshness and the digest', async () => {
  install();
  const r = await call({ 'x-admin-token': 'tok' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.jsonBody.ready, true);
  assert.equal(r.jsonBody.freshness.google, '2026-10-22');
  assert.equal(r.jsonBody.striking_distance[0].query, 'target application status');
  assert.ok(r.jsonBody.digest);
  assert.ok(!('users' in r.jsonBody), 'not the dashboard stats payload');
});

test('before the migration: ready:false with the reason, not an error', async () => {
  install({ missing: true });
  const r = await call({ 'x-admin-token': 'tok' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.jsonBody.ready, false);
  assert.match(r.jsonBody.reason, /20261024170000_search_data/);
});
