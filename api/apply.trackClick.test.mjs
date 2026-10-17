// Apply-click tracking must work for signed-OUT seekers: the beacon (lib/trackApply.ts) sends no
// token, and the click was 401'd by the sign-in gate, so apply_events never recorded anything.
// Run: node --test api/apply.trackClick.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { default: handler } = await import('./apply.js');

function mockRes() {
  return { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
}

test('anonymous track_click is recorded (no 401)', async () => {
  calls.length = 0;
  const res = mockRes();
  await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io' }, socket: { remoteAddress: '10.0.0.9' }, body: { action: 'track_click', jobId: 'j1', company: 'Seen Jobs', role: 'Software Engineer', location: 'Remote', applyUrl: 'https://example.com/apply' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true });
  const ev = calls.find((c) => c.url.includes('/rest/v1/apply_events') && c.method === 'POST');
  assert.ok(ev, 'apply_events insert attempted');
  assert.equal(ev.body.company_name, 'Seen Jobs');
  assert.equal(ev.body.user_id, null);
});

test('the email-sending apply path still requires sign-in', async () => {
  const res = mockRes();
  await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io' }, socket: { remoteAddress: '10.0.0.9' }, body: { applicantName: 'X', applicantEmail: 'x@example.com', company: 'Acme' } }, res);
  assert.equal(res.code, 401);
});
