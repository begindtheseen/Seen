// One-click unsubscribe: each list stops only itself; POST is the mail-app one-click path.
// Run: node --test api/unsubscribe.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.EMAIL_UNSUB_SECRET = 'unsub-secret';

let writes;
beforeEach(() => { writes = []; });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== 'db.example') throw new Error(`unexpected host ${u.hostname}`);
  writes.push({ path: u.pathname, body: JSON.parse(opts.body) });
  return new Response('', { status: 201 });
};
const { default: handler } = await import('./unsubscribe.js');
const { unsubToken } = await import('../lib/server/outcomeEmails.js');

function call(method, query) {
  const res = { code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; }, json(o) { this.body = o; return this; } };
  return handler({ method, query, headers: {} }, res).then(() => res);
}

test('job_matches link sets job_match_opt_out only', async () => {
  const res = await call('GET', { list: 'job_matches', uid: 'u1', token: unsubToken('u1', 'unsub-secret', 'job_matches') });
  assert.equal(res.code, 200);
  assert.match(res.body, /job match emails/);
  assert.deepEqual(Object.keys(writes[0].body).sort(), ['job_match_opt_out', 'updated_at', 'user_id']);
  assert.equal(writes[0].body.job_match_opt_out, true);
});

test('the old outcome links keep working and stop only check-ins', async () => {
  const res = await call('GET', { uid: 'u1', token: unsubToken('u1', 'unsub-secret') });
  assert.equal(res.code, 200);
  assert.equal(writes[0].body.outcome_opt_out, true);
  assert.equal(writes[0].body.job_match_opt_out, undefined);
});

test('a token for one list cannot unsubscribe another', async () => {
  const res = await call('GET', { list: 'outcome', uid: 'u1', token: unsubToken('u1', 'unsub-secret', 'job_matches') });
  assert.equal(res.code, 400);
  assert.equal(writes.length, 0);
});

test('one-click POST from a mail app', async () => {
  const res = await call('POST', { list: 'job_matches', uid: 'u1', token: unsubToken('u1', 'unsub-secret', 'job_matches') });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(writes[0].body.job_match_opt_out, true);
});
