// Growth rewards (lib/server/growthRewards.js + lib/server/grantProDays.js) against an in-memory
// PostgREST that honours unique keys, ignore-duplicates, compare-and-set PATCHes, missing tables and the
// cap trigger. Every edge the owner-approved plan names is pinned here: the 7-day age gate, one reward
// per application, the 15-day California-month cap (at the Pacific boundary, not UTC), the same reward
// for every outcome, the referral claim rules, the first-application reward to both, the cap of 10,
// replays, and "no table yet" = silently nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installFakePostgrest, fakeDb } from './fakePostgrest.test-helper.mjs';
import { nextProUntil, grantProDays } from './grantProDays.js';
import {
  rewardReport, claimReferral, rewardReferralOnApplication, ensureReferralCode, referralStatus,
  newReferralCode, isMissingTable, nextPacificMonthStart, recentGrants,
} from './growthRewards.js';
import {
  REPORT_REWARD_PRO_DAYS, REPORT_REWARD_MONTHLY_CAP_DAYS, REPORT_REWARD_MIN_TRACKED_DAYS,
  REFERRAL_REWARD_PRO_DAYS, REFERRAL_MAX_REWARDED, REFERRAL_CLAIM_WINDOW_DAYS, WELCOME_CREDITS,
} from './creditRules.js';
import { isReferralCode, referralUrl, refFromSearch } from '../referral.js';

const DAY = 86400e3;
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const iso = (ms) => new Date(ms).toISOString();
const db = fakeDb();
const ALL = ['ai_credits', 'applications', 'growth_rewards', 'referral_codes', 'referrals', 'credit_transactions'];

const app = (id, user, createdMs) => ({ id, user_id: user, created_at: iso(createdMs) });
const appId = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const userId = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;

test('the constants are the owner-approved plan, and the migration trigger repeats the same caps', () => {
  assert.equal(REPORT_REWARD_PRO_DAYS, 3);
  assert.equal(REPORT_REWARD_MONTHLY_CAP_DAYS, 15);
  assert.equal(REPORT_REWARD_MIN_TRACKED_DAYS, 7);
  assert.equal(REFERRAL_REWARD_PRO_DAYS, 7);
  assert.equal(REFERRAL_MAX_REWARDED, 10);
  assert.equal(REFERRAL_CLAIM_WINDOW_DAYS, 30);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(here, '..', '..', 'supabase', 'migrations', '20261024160000_growth_rewards.sql'), 'utf8');
  assert.match(sql, new RegExp(`v_days \\+ new\\.days > ${REPORT_REWARD_MONTHLY_CAP_DAYS}\\b`));
  assert.match(sql, new RegExp(`v_count >= ${REFERRAL_MAX_REWARDED}\\b`));
  assert.match(sql, /America\/Los_Angeles/);
  assert.match(sql, /unique \(kind, ref_id\)/);
  assert.match(sql, /revoke all on public\.growth_rewards from anon, authenticated/);
});

test('nextProUntil: rewards stack after remaining Pro; a purchase keeps GREATEST(existing, now + days)', () => {
  const now = Date.UTC(2026, 9, 24, 12);
  assert.equal(nextProUntil(null, 3, { stack: true, nowMs: now }), iso(now + 3 * DAY));
  assert.equal(nextProUntil(iso(now - DAY), 3, { stack: true, nowMs: now }), iso(now + 3 * DAY), 'expired Pro starts from now');
  assert.equal(nextProUntil(iso(now + 5 * DAY), 3, { stack: true, nowMs: now }), iso(now + 8 * DAY), 'added on top of the 5 days left');
  assert.equal(nextProUntil(iso(now + 5 * DAY), 7, { stack: false, nowMs: now }), iso(now + 7 * DAY), 'purchase: overlap not added');
  assert.equal(nextProUntil(iso(now + 9 * DAY), 7, { stack: false, nowMs: now }), iso(now + 9 * DAY), 'purchase never shortens');
});

test('grantProDays stacks, creates a missing credits row with the welcome bonus, and survives a lost race', async () => {
  const now = Date.UTC(2026, 9, 24, 12);
  // No row yet → created with the welcome bonus, then extended.
  let f = installFakePostgrest();
  let g = await grantProDays(db, U1, 3, { nowMs: now, today: '2026-10-24' });
  assert.equal(g.ok, true);
  assert.equal(f.t.ai_credits[0].balance, WELCOME_CREDITS);
  assert.equal(f.t.ai_credits[0].pro_until, iso(now + 3 * DAY));
  // Three in a row are nine days.
  await grantProDays(db, U1, 3, { nowMs: now });
  await grantProDays(db, U1, 3, { nowMs: now });
  assert.equal(f.t.ai_credits[0].pro_until, iso(now + 9 * DAY));

  // A concurrent writer moves pro_until between our read and our write: the guarded PATCH matches
  // nothing, so we re-read and add on top of the NEW value instead of losing those days.
  let raced = false;
  f = installFakePostgrest({
    tables: { ai_credits: [{ user_id: U1, balance: 1, pro_until: iso(now + 2 * DAY) }] },
    onPatch: (name, u, t) => {
      if (name === 'ai_credits' && !raced) { raced = true; t.ai_credits[0].pro_until = iso(now + 10 * DAY); }
    },
  });
  g = await grantProDays(db, U1, 3, { nowMs: now });
  assert.equal(g.ok, true);
  assert.equal(f.t.ai_credits[0].pro_until, iso(now + 13 * DAY), 'the other grant’s 8 days are kept');
  assert.ok(f.log.filter((l) => l.startsWith('PATCH /rest/v1/ai_credits')).length >= 2, 'retried after the lost race');
});

test('report reward: under 7 days earns nothing and says how old the application is', async () => {
  const now = Date.UTC(2026, 9, 24, 18);
  const f = installFakePostgrest({ tables: { applications: [app(A1, U1, now - (7 * DAY - 60e3))] } });
  const r = await rewardReport(db, U1, A1, { nowMs: now });
  assert.equal(r.granted, false);
  assert.equal(r.reason, 'too_new');
  assert.equal(r.tracked_days, 6);
  assert.equal((f.t.growth_rewards || []).length, 0);
  assert.equal((f.t.ai_credits || []).length, 0, 'no Pro written');
});

test('report reward: 7+ days earns 3 days once per application; another account’s application earns nothing', async () => {
  const now = Date.UTC(2026, 9, 24, 18);
  const f = installFakePostgrest({ tables: { applications: [app(A1, U1, now - 7 * DAY)], ai_credits: [{ user_id: U1, balance: 1, pro_until: null }] }, now: () => now });
  const r = await rewardReport(db, U1, A1, { nowMs: now });
  assert.equal(r.granted, true);
  assert.equal(r.days, REPORT_REWARD_PRO_DAYS);
  assert.equal(f.t.ai_credits[0].pro_until, iso(now + 3 * DAY));
  assert.equal(f.t.growth_rewards.length, 1);
  assert.equal(f.t.growth_rewards[0].kind, 'report');
  assert.equal(f.t.growth_rewards[0].ref_id, A1);
  assert.equal(f.t.growth_rewards[0].pro_until_after, iso(now + 3 * DAY), 'the ledger records what it gave');
  // Replay (a retried request, or the card moved to ghosted again).
  const again = await rewardReport(db, U1, A1, { nowMs: now + DAY });
  assert.equal(again.reason, 'already_rewarded');
  assert.equal(f.t.ai_credits[0].pro_until, iso(now + 3 * DAY), 'no second grant');
  // U2 names U1's application id: the row is read by id AND user, so it is not found.
  const theirs = await rewardReport(db, U2, A1, { nowMs: now });
  assert.equal(theirs.reason, 'not_found');
  assert.equal((await rewardReport(db, U1, 'app_123', { nowMs: now })).reason, 'no_application', 'a client id never reaches a query');
});

test('report reward: the monthly cap is 15 days per CALIFORNIA month, judged at the Pacific boundary', async () => {
  // Oct 31 2026 23:00 PT = Nov 1 06:00 UTC (a UTC month would already say November).
  const oct31Late = Date.UTC(2026, 10, 1, 6, 0);
  const nov1Early = Date.UTC(2026, 10, 1, 7, 30); // Nov 1 00:30 PT
  let clock = Date.UTC(2026, 9, 20, 18);
  const apps = Array.from({ length: 8 }, (_, i) => app(appId(i + 1), U1, Date.UTC(2026, 8, 1)));
  const f = installFakePostgrest({ tables: { applications: apps, ai_credits: [{ user_id: U1, balance: 1, pro_until: null }] }, now: () => clock });
  for (let i = 1; i <= 5; i++) {
    const r = await rewardReport(db, U1, appId(i), { nowMs: clock });
    assert.equal(r.granted, true, `report ${i}`);
  }
  assert.equal(f.t.growth_rewards.reduce((s, r) => s + r.days, 0), REPORT_REWARD_MONTHLY_CAP_DAYS);
  clock = oct31Late;
  const capped = await rewardReport(db, U1, appId(6), { nowMs: clock });
  assert.equal(capped.granted, false);
  assert.equal(capped.reason, 'monthly_cap', 'still October in California');
  assert.equal(capped.resets_on, '2026-11-01');
  clock = nov1Early;
  const fresh = await rewardReport(db, U1, appId(6), { nowMs: clock });
  assert.equal(fresh.granted, true, 'November in California: the cap starts over');
  assert.equal(fresh.month_days, REPORT_REWARD_PRO_DAYS);
});

test('report reward: the cap trigger wins a race the pre-check missed', async () => {
  const now = Date.UTC(2026, 9, 20, 18);
  const f = installFakePostgrest({
    tables: {
      applications: [app(appId(9), U1, now - 30 * DAY)],
      ai_credits: [{ user_id: U1, balance: 1, pro_until: null }],
      // 12 days already used this month: the pre-check sees 3 left and tries; a concurrent grant
      // filled the month in between, which the database refuses.
      growth_rewards: [1, 2, 3, 4].map((n) => ({ id: `g${n}`, user_id: U1, kind: 'report', ref_id: appId(100 + n), days: 3, pacific_month: '2026-10' })),
    },
    now: () => now,
  });
  f.t.growth_rewards.pop(); // the pre-check reads 9 used...
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('growth_rewards?on_conflict') && f.t.growth_rewards.length === 3) {
      f.t.growth_rewards.push({ id: 'g9', user_id: U1, kind: 'report', ref_id: appId(200), days: 3, pacific_month: '2026-10' });
      f.t.growth_rewards.push({ id: 'g10', user_id: U1, kind: 'report', ref_id: appId(201), days: 3, pacific_month: '2026-10' });
    }
    return origFetch(url, opts);
  };
  const r = await rewardReport(db, U1, appId(9), { nowMs: now });
  assert.equal(r.reason, 'monthly_cap');
  assert.equal(f.t.ai_credits[0].pro_until, null, 'nothing granted past the cap');
});

test('report reward: before the migration nothing happens and nothing is written', async () => {
  const now = Date.UTC(2026, 9, 24, 18);
  const f = installFakePostgrest({ tables: { applications: [app(A1, U1, now - 30 * DAY)] }, missing: ['growth_rewards', 'referral_codes', 'referrals'] });
  const r = await rewardReport(db, U1, A1, { nowMs: now });
  assert.deepEqual(r, { granted: false, reason: 'not_ready' });
  assert.equal((f.t.ai_credits || []).length, 0);
  assert.equal((await rewardReferralOnApplication(db, U1, { nowMs: now })).reason, 'not_ready');
  assert.deepEqual(await referralStatus(db, U1, { nowMs: now }), { ready: false });
  assert.equal((await claimReferral(db, U1, 'abcd2345', { accountCreatedAt: iso(now) })).final, false, 'kept for later');
  assert.deepEqual(await recentGrants(db), { ready: false, grants: [] });
  assert.ok(isMissingTable(404, { code: 'PGRST205' }) && isMissingTable(400, { code: '42P01' }) && !isMissingTable(400, { code: '23505' }));
});

test('report reward: a failed Pro write removes the ledger row (the ledger never claims days not given)', async () => {
  const now = Date.UTC(2026, 9, 24, 18);
  const f = installFakePostgrest({
    tables: { applications: [app(A1, U1, now - 8 * DAY)], ai_credits: [{ user_id: U1, balance: 1, pro_until: null }] },
    failPatch: (name) => name === 'ai_credits',
  });
  const r = await rewardReport(db, U1, A1, { nowMs: now });
  assert.equal(r.granted, false);
  assert.equal(r.reason, 'failed');
  assert.equal(f.t.growth_rewards.length, 0);
});

// ── Invite a friend ──────────────────────────────────────────────────────────────────────────────

const CODE_TIME = Date.UTC(2026, 9, 1, 12);
function referralWorld(extra = {}) {
  return installFakePostgrest({
    tables: {
      referral_codes: [{ user_id: U1, code: 'abcd2345', created_at: iso(CODE_TIME) }],
      ai_credits: [{ user_id: U1, balance: 1, pro_until: null }],
      ...extra,
    },
  });
}

test('invite codes: random, well formed, one per user, and links carry them', async () => {
  const codes = new Set(Array.from({ length: 200 }, () => newReferralCode()));
  assert.equal(codes.size, 200);
  for (const c of codes) assert.ok(isReferralCode(c), c);
  const f = installFakePostgrest();
  const a = await ensureReferralCode(db, U2);
  const b = await ensureReferralCode(db, U2);
  assert.equal(a.code, b.code);
  assert.equal(f.t.referral_codes.length, 1);
  assert.equal(referralUrl('abcd2345'), 'https://seenjobs.io/?ref=abcd2345');
  assert.equal(referralUrl('abcd2345', '/company/acme-corp'), 'https://seenjobs.io/company/acme-corp?ref=abcd2345');
  assert.equal(referralUrl(null, '/company/acme'), 'https://seenjobs.io/company/acme', 'a guest shares the plain link');
  assert.equal(referralUrl('abcd2345', 'https://evil.example/x'), 'https://seenjobs.io/?ref=abcd2345', 'only internal paths');
  assert.equal(referralUrl('NOT A CODE', '/'), 'https://seenjobs.io/');
  assert.equal(refFromSearch('?ref=ABCD2345&x=1'), 'abcd2345');
  assert.equal(refFromSearch('?ref=abc'), null);
});

test('claim: a new account claims once; own link, unknown code, old accounts and a second referrer are refused', async () => {
  const f = referralWorld({ referral_codes: [
    { user_id: U1, code: 'abcd2345', created_at: iso(CODE_TIME) },
    { user_id: userId(7), code: 'zzzz2345', created_at: iso(CODE_TIME) },
  ] });
  const now = CODE_TIME + 3 * DAY;
  const fresh = iso(CODE_TIME + DAY);
  assert.deepEqual(await claimReferral(db, U1, 'abcd2345', { accountCreatedAt: fresh, nowMs: now }), { ok: false, reason: 'self_referral', final: true });
  assert.equal((await claimReferral(db, U2, 'nope2345', { accountCreatedAt: fresh, nowMs: now })).reason, 'unknown_code');
  assert.equal((await claimReferral(db, U2, 'x', { accountCreatedAt: fresh, nowMs: now })).reason, 'invalid_code');
  assert.equal((await claimReferral(db, U2, 'abcd2345', { accountCreatedAt: iso(CODE_TIME - DAY), nowMs: now })).reason, 'account_predates_link');
  assert.equal((await claimReferral(db, U2, 'abcd2345', { accountCreatedAt: iso(CODE_TIME + DAY), nowMs: CODE_TIME + DAY + (REFERRAL_CLAIM_WINDOW_DAYS + 1) * DAY })).reason, 'account_too_old');
  assert.equal((await claimReferral(db, U2, 'abcd2345', { accountCreatedAt: null, nowMs: now })).final, false, 'no sign-up time: try later, never guess');
  const ok = await claimReferral(db, U2, 'ABCD2345', { accountCreatedAt: fresh, nowMs: now });
  assert.deepEqual(ok, { ok: true, final: true });
  assert.equal(f.t.referrals.length, 1);
  assert.equal(f.t.referrals[0].referrer_id, U1);
  const replay = await claimReferral(db, U2, 'abcd2345', { accountCreatedAt: fresh, nowMs: now });
  assert.equal(replay.ok, true, 'the same claim again is harmless');
  const other = await claimReferral(db, U2, 'zzzz2345', { accountCreatedAt: fresh, nowMs: now });
  assert.deepEqual(other, { ok: false, reason: 'already_claimed', final: true });
  assert.equal(f.t.referrals.length, 1, 'one referrer per invitee');
});

test('first tracked application rewards both, once; no referral or a replay grants nothing', async () => {
  const now = CODE_TIME + 4 * DAY;
  const f = referralWorld({ referrals: [{ invitee_id: U2, referrer_id: U1, code: 'abcd2345', claimed_at: iso(CODE_TIME + DAY), rewarded_at: null }] });
  assert.equal((await rewardReferralOnApplication(db, userId(55), { nowMs: now })).reason, 'no_referral');
  const r = await rewardReferralOnApplication(db, U2, { nowMs: now });
  assert.equal(r.rewarded, true);
  assert.equal(r.days, REFERRAL_REWARD_PRO_DAYS);
  assert.equal(r.referrer_rewarded, true);
  const credit = (u) => f.t.ai_credits.find((c) => c.user_id === u);
  assert.equal(credit(U2).pro_until, iso(now + 7 * DAY), 'invitee: a week (row created with the welcome bonus)');
  assert.equal(credit(U2).balance, WELCOME_CREDITS);
  assert.equal(credit(U1).pro_until, iso(now + 7 * DAY), 'referrer: a week');
  assert.ok(f.t.referrals[0].rewarded_at);
  assert.equal(f.t.referrals[0].referrer_rewarded, true);
  assert.deepEqual(f.t.growth_rewards.map((g) => g.kind).sort(), ['referral_invitee', 'referral_referrer']);
  const replay = await rewardReferralOnApplication(db, U2, { nowMs: now + DAY });
  assert.equal(replay.rewarded, false);
  assert.equal(credit(U2).pro_until, iso(now + 7 * DAY));
  assert.equal(f.t.growth_rewards.length, 2);

  // A crash after the ledger rows but before rewarded_at: the next application finishes without granting twice.
  f.t.referrals[0].rewarded_at = null;
  const resumed = await rewardReferralOnApplication(db, U2, { nowMs: now + DAY });
  assert.equal(resumed.rewarded, false);
  assert.equal(f.t.growth_rewards.length, 2);
  assert.equal(credit(U1).pro_until, iso(now + 7 * DAY), 'unique (kind, ref_id) kept it to one week each');
  assert.ok(f.t.referrals[0].rewarded_at, 'and the referral is closed');
});

test('a referrer is rewarded for at most 10 invitees; the 11th invitee still gets their week', async () => {
  const now = CODE_TIME + 4 * DAY;
  const invitees = Array.from({ length: 11 }, (_, i) => userId(i + 1));
  const f = referralWorld({ referrals: invitees.map((id) => ({ invitee_id: id, referrer_id: U1, code: 'abcd2345', claimed_at: iso(CODE_TIME + DAY), rewarded_at: null })) });
  for (const id of invitees) await rewardReferralOnApplication(db, id, { nowMs: now });
  const mine = f.t.growth_rewards.filter((g) => g.user_id === U1);
  assert.equal(mine.length, REFERRAL_MAX_REWARDED);
  assert.equal(f.t.ai_credits.find((c) => c.user_id === U1).pro_until, iso(now + REFERRAL_MAX_REWARDED * 7 * DAY), 'ten weeks, stacked');
  const last = f.t.referrals.find((r) => r.invitee_id === invitees[10]);
  assert.equal(last.referrer_rewarded, false);
  assert.ok(last.rewarded_at);
  assert.equal(f.t.ai_credits.find((c) => c.user_id === invitees[10]).pro_until, iso(now + 7 * DAY));
  const st = await referralStatus(db, U1, { nowMs: now });
  assert.equal(st.rewarded, REFERRAL_MAX_REWARDED);
  assert.equal(st.joined, 11);
  assert.equal(st.waiting, 0);
  assert.equal(st.pro_days_earned, REFERRAL_MAX_REWARDED * REFERRAL_REWARD_PRO_DAYS);
  assert.equal(st.code, 'abcd2345');
});

test('nextPacificMonthStart rolls the year', () => {
  assert.equal(nextPacificMonthStart(new Date(Date.UTC(2026, 11, 31, 20))), '2027-01-01');
  assert.equal(nextPacificMonthStart(new Date(Date.UTC(2027, 0, 1, 5))), '2027-01-01', 'Dec 31 9 PM PT is still December');
});
