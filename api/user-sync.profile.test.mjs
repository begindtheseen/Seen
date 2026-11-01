// save_profile through the REAL api/user-sync.js handler: the client can never set the fields that
// decide privileges or who gets mail (email, type, account_type) — security audit 2026-11-01.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
delete process.env.STRIPE_SECRET_KEY;
const { default: userSync } = await import('./user-sync.js');
const { installFakePostgrest } = await import('../lib/server/fakePostgrest.test-helper.mjs');

const ME = '55555555-5555-4555-8555-555555555555';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(sub) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const pay = b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;
}
function call(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); },
    };
    userSync({ method: 'POST', url: '/api/user-sync', query: {}, headers: { authorization: `Bearer ${tokenFor(ME)}`, origin: 'https://seenjobs.io', 'x-real-ip': '1.2.3.4' }, body }, res);
  });
}

test('save_profile ignores email, type and account_type from the client', async () => {
  const f = installFakePostgrest();
  const r = await call({
    action: 'save_profile',
    profile: { name: '  Dana ', city: 'Phoenix', email: 'victim@example.com', type: 'employer', account_type: 'employer', id: 'someone-else', resume_text: 'x' },
  });
  assert.equal(r.status, 200);
  const row = f.t.profiles.at(-1);
  assert.equal(row.id, ME);
  assert.equal(row.name, 'Dana');
  assert.equal(row.city, 'Phoenix');
  for (const k of ['email', 'type', 'account_type', 'resume_text']) assert.equal(row[k], undefined, `${k} must not be written`);
});

test('save_profile type-checks experience, survey_completed and caps onboarding_survey', async () => {
  const f = installFakePostgrest();
  const bad = await call({ action: 'save_profile', profile: { experience: { evil: true } } });
  assert.equal(bad.status, 400);
  const big = await call({ action: 'save_profile', profile: { onboarding_survey: { blob: 'x'.repeat(9000) } } });
  assert.equal(big.status, 400);
  const ok = await call({ action: 'save_profile', profile: { experience: 'Mid-level', survey_completed: 'yes', onboarding_survey: { checklist_dismissed: true } } });
  assert.equal(ok.status, 200);
  const row = f.t.profiles.at(-1);
  assert.equal(row.experience, 'Mid-level');
  assert.equal(row.survey_completed, false, 'only a real true counts');
  assert.deepEqual(row.onboarding_survey, { checklist_dismissed: true });
});
