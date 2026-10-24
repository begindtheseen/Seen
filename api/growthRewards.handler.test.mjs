// The growth loops through the REAL handlers (api/reports.js quick_submit + create_from_tracker,
// api/user-sync.js add_application / claim_referral / referral_status) with a locally signed token
// and the in-memory PostgREST. Pins the frontend→API contract: the field names the tracker sends
// (application_id), the `reward` the client reads back, and that a report or an add NEVER fails
// because the reward tables are missing (code ships before the migration).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: reports } = await import('./reports.js');
const { default: userSync } = await import('./user-sync.js');
const { installFakePostgrest } = await import('../lib/server/fakePostgrest.test-helper.mjs');
const { REPORT_REWARD_PRO_DAYS, REFERRAL_REWARD_PRO_DAYS } = await import('../lib/server/creditRules.js');
const { reportRewardMessage } = await import('../lib/growthCopy.js');

const DAY = 86400e3;
const ME = '44444444-4444-4444-8444-444444444444';
const FRIEND = '55555555-5555-4555-8555-555555555555';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(sub) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const pay = b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;
}
function call(handler, body, sub = ME) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); },
    };
    handler({ method: 'POST', url: '/api/x', query: {}, headers: { authorization: `Bearer ${tokenFor(sub)}`, origin: 'https://seenjobs.io', 'x-real-ip': '1.2.3.4' }, body }, res);
  });
}
const appRow = (id, user, ageDays) => ({ id, user_id: user, company_name: 'Acme', role: 'Clerk', created_at: new Date(Date.now() - ageDays * DAY).toISOString() });
const A = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

test('quick_submit with the tracked application id: the report is written AND earns 3 days of Pro', async () => {
  const f = installFakePostgrest({ tables: { applications: [appRow(A(1), ME, 10)], ai_credits: [{ user_id: ME, balance: 1, pro_until: null }] } });
  const r = await call(reports, { action: 'quick_submit', company: 'Acme', outcome: 'ghosted', role: 'Clerk', application_id: A(1) });
  assert.equal(r.status, 200);
  assert.equal(r.body.submitted, true);
  assert.equal(f.t.reports.length, 1, 'the report itself');
  assert.equal(f.t.reports[0].outcome_weight, 1, 'the reward never changes the report’s weight');
  assert.equal(r.body.reward.granted, true);
  assert.equal(r.body.reward.days, REPORT_REWARD_PRO_DAYS);
  assert.ok(Date.parse(f.t.ai_credits[0].pro_until) > Date.now() + 2.9 * DAY);
  assert.equal(reportRewardMessage(r.body.reward).title, `+${REPORT_REWARD_PRO_DAYS} days of Seen Pro`);
});

test('every outcome earns the same reward (never biases what people report)', async () => {
  const outcomes = ['ghosted', 'rejected', 'interview', 'offer', 'hired', 'autoreject'];
  const f = installFakePostgrest({ tables: { applications: outcomes.map((_, i) => appRow(A(10 + i), ME, 20)), ai_credits: [{ user_id: ME, balance: 1, pro_until: null }] } });
  const days = [];
  for (let i = 0; i < outcomes.length; i++) {
    const r = await call(reports, { action: 'quick_submit', company: `Co ${i}`, outcome: outcomes[i], application_id: A(10 + i) });
    days.push(r.body.reward.granted ? r.body.reward.days : r.body.reward.reason);
  }
  // 5 × 3 = 15 days, then the month is full — whatever the outcome.
  assert.deepEqual(days, [3, 3, 3, 3, 3, 'monthly_cap']);
  assert.equal(new Set(f.t.growth_rewards.map((g) => g.days)).size, 1);
});

test('quick_submit before the migration: the report still succeeds, the reward is silently "not ready"', async () => {
  const f = installFakePostgrest({ tables: { applications: [appRow(A(1), ME, 10)] }, missing: ['growth_rewards', 'referral_codes', 'referrals'] });
  const r = await call(reports, { action: 'quick_submit', company: 'Acme', outcome: 'rejected', application_id: A(1) });
  assert.equal(r.status, 200);
  assert.equal(r.body.submitted, true);
  assert.equal(f.t.reports.length, 1);
  assert.equal(r.body.reward.reason, 'not_ready');
  assert.equal(reportRewardMessage(r.body.reward), null, 'the tracker shows nothing');
  assert.equal((f.t.ai_credits || []).length, 0);
  // No application id (an old client): no reward key at all.
  const old = await call(reports, { action: 'quick_submit', company: 'Acme', outcome: 'rejected' });
  assert.equal(old.body.reward, undefined);
});

test('quick_submit on someone else’s or a too-new application: report written, no Pro', async () => {
  const f = installFakePostgrest({ tables: { applications: [appRow(A(1), FRIEND, 30), appRow(A(2), ME, 2)] } });
  const theirs = await call(reports, { action: 'quick_submit', company: 'Acme', outcome: 'ghosted', application_id: A(1) });
  assert.equal(theirs.body.reward.reason, 'not_found');
  const young = await call(reports, { action: 'quick_submit', company: 'Acme', outcome: 'ghosted', application_id: A(2) });
  assert.equal(young.body.reward.reason, 'too_new');
  assert.match(reportRewardMessage(young.body.reward).sub, /has been on it for 2 days\.$/);
  assert.equal(f.t.reports.length, 2);
  assert.equal((f.t.ai_credits || []).length, 0);
});

test('create_from_tracker (the /report outcome card) earns through the same one-per-application rule', async () => {
  const f = installFakePostgrest({ tables: { applications: [appRow(A(3), ME, 9)], ai_credits: [{ user_id: ME, balance: 1, pro_until: null }] } });
  const r = await call(reports, { action: 'create_from_tracker', company: 'Acme', outcome: 'ghosted', application_id: A(3) });
  assert.equal(r.status, 200);
  assert.equal(r.body.reward.granted, true);
  const again = await call(reports, { action: 'quick_submit', company: 'Acme', outcome: 'ghosted', application_id: A(3) });
  assert.equal(again.body.reward.reason, 'already_rewarded', 'one reward per application, whichever path reports it');
  assert.equal(f.t.growth_rewards.length, 1);
});

test('invite loop end to end: status makes a code, a new account claims it, its first application rewards both', async () => {
  const codeTime = Date.now() - 3 * DAY;
  const f = installFakePostgrest({
    tables: { ai_credits: [{ user_id: ME, balance: 1, pro_until: null }] },
    authUsers: { [FRIEND]: { id: FRIEND, created_at: new Date(Date.now() - DAY).toISOString() }, [ME]: { id: ME, created_at: new Date(Date.now() - 90 * DAY).toISOString() } },
    now: () => codeTime,
  });
  const st = await call(userSync, { action: 'referral_status' });
  assert.equal(st.body.ready, true);
  assert.match(st.body.code, /^[a-z2-9]{8}$/);
  assert.equal(st.body.rewarded, 0);
  // Own link: refused for good.
  const self = await call(userSync, { action: 'claim_referral', code: st.body.code });
  assert.equal(self.body.reason, 'self_referral');
  assert.equal(self.body.final, true);
  // The friend's account was created after the code existed and is a day old.
  const claim = await call(userSync, { action: 'claim_referral', code: st.body.code }, FRIEND);
  assert.deepEqual(claim.body, { ok: true, final: true });
  // First tracked application → both get a week; the response tells the friend's browser.
  const add = await call(userSync, { action: 'add_application', application: { id: 'app_1', company: 'Acme', role: 'Clerk' } }, FRIEND);
  assert.equal(add.status, 200);
  assert.ok(add.body.id);
  assert.equal(add.body.reward.kind, 'referral');
  assert.equal(add.body.reward.days, REFERRAL_REWARD_PRO_DAYS);
  const pro = (u) => Date.parse(f.t.ai_credits.find((c) => c.user_id === u).pro_until);
  assert.ok(pro(FRIEND) > Date.now() + 6.9 * DAY);
  assert.ok(pro(ME) > Date.now() + 6.9 * DAY);
  // A second application is not a second reward.
  const add2 = await call(userSync, { action: 'add_application', application: { id: 'app_2', company: 'Other', role: 'Clerk' } }, FRIEND);
  assert.equal(add2.body.reward, undefined);
  assert.equal(f.t.growth_rewards.length, 2);
  const after = await call(userSync, { action: 'referral_status' });
  assert.equal(after.body.rewarded, 1);
  assert.equal(after.body.pro_days_earned, REFERRAL_REWARD_PRO_DAYS);
});

test('a claim on an account older than the link, and add_application before the migration, are both harmless', async () => {
  let f = installFakePostgrest({
    tables: { referral_codes: [{ user_id: ME, code: 'abcd2345', created_at: new Date(Date.now() - DAY).toISOString() }] },
    authUsers: { [FRIEND]: { id: FRIEND, created_at: new Date(Date.now() - 10 * DAY).toISOString() } },
  });
  const old = await call(userSync, { action: 'claim_referral', code: 'abcd2345' }, FRIEND);
  assert.equal(old.body.reason, 'account_predates_link');
  assert.equal((f.t.referrals || []).length, 0);

  f = installFakePostgrest({ missing: ['growth_rewards', 'referral_codes', 'referrals'] });
  const add = await call(userSync, { action: 'add_application', application: { id: 'app_9', company: 'Acme', role: 'Clerk' } }, FRIEND);
  assert.equal(add.status, 200);
  assert.ok(add.body.id, 'the application is saved');
  assert.equal(add.body.reward, undefined);
  assert.equal(f.t.applications.length, 1);
  const st = await call(userSync, { action: 'referral_status' }, FRIEND);
  assert.deepEqual(st.body, { ready: false });
});
