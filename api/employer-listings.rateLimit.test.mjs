// Employer actions that can email an applicant carry a per-employer hourly cap (security audit 2026-11-01).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-key-for-test';
delete process.env.SUPABASE_JWT_SECRET;
delete process.env.RESEND_KEY; delete process.env.RESEND_API_KEY;

const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
const res = () => ({ statusCode: 200, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });

test('application_message / application_status over the cap → 429 before any write; other actions are not counted', async (t) => {
  const buckets = [];
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return json({ id: 'emp-1' });
    if (u.includes('/rest/v1/rpc/increment_rate_limit')) { buckets.push(JSON.parse(opts.body).p_key); return json(61); }
    if (u.includes('/rest/v1/employer_company_claims')) return json([{ company_name: 'acme', company_display_name: 'Acme' }]);
    if ((opts.method || 'GET') !== 'GET') writes.push(u);
    return json([]);
  });
  const { default: handler } = await import('./employer-listings.js');
  for (const body of [{ action: 'application_message', id: 'a1', text: 'hi' }, { action: 'application_status', id: 'a1', status: 'interviewing' }]) {
    const r = res();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, r);
    assert.equal(r.statusCode, 429, body.action);
  }
  assert.equal(writes.length, 0);
  assert.ok(buckets.every((k) => k.startsWith('user:emp-1:employer-applicant-email:')), buckets.join());
  const list = res();
  buckets.length = 0;
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'disputes' } }, list);
  assert.equal(buckets.length, 0);
});
