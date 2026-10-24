// Growth rewards: Seen Pro days for reporting outcomes from the tracker and for inviting friends.
// The rules (owner-approved 2026-10-24, numbers in lib/server/creditRules.js):
//
//   Report and get Pro: an outcome reported from a tracked application earns REPORT_REWARD_PRO_DAYS,
//   once per application ever, only when the application row was created (tracked) at least
//   REPORT_REWARD_MIN_TRACKED_DAYS before the report, up to REPORT_REWARD_MONTHLY_CAP_DAYS per
//   California month. The application is read from the DB by id AND the caller's user id; its age is
//   the row's own created_at (the user-editable applied_at is never used). The outcome is not an input:
//   every outcome earns the same, so the reward can never bias what people report.
//
//   Invite a friend: each user has a random code (referral_codes). A new account claims the code it
//   arrived with (one referrer per invitee, no self-referral, the account must be newer than the code
//   and at most REFERRAL_CLAIM_WINDOW_DAYS old). When the invitee tracks their first application both
//   get REFERRAL_REWARD_PRO_DAYS; the referrer's share stops after REFERRAL_MAX_REWARDED invitees.
//
// Every grant is a growth_rewards row first (unique per kind + ref_id, so retries and races grant once;
// the DB trigger enforces both caps) and then Pro time through grantProDays. If the Pro write fails the
// row is removed again, so the ledger never claims days that were not given. Rewards never touch a
// report, a weight, a score or a grade.
//
// Deploy order: this code ships before migration 20261024160000_growth_rewards.sql. A missing table
// (PostgREST 404 / PGRST205 / 42P01) is "not ready": no reward, no error, and the report or application
// the reward rides on is unaffected.
import {
  REPORT_REWARD_PRO_DAYS, REPORT_REWARD_MONTHLY_CAP_DAYS, REPORT_REWARD_MIN_TRACKED_DAYS,
  REFERRAL_REWARD_PRO_DAYS, REFERRAL_MAX_REWARDED, REFERRAL_CLAIM_WINDOW_DAYS,
} from './creditRules.js';
import { grantProDays } from './grantProDays.js';
import { pacificDate, pacificMonth } from '../time/pacific.js';
import { isReferralCode, REFERRAL_CODE_LENGTH } from '../referral.js';

const DAY_MS = 86400e3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID.test(String(v || ''));

// No 0/1/o/l confusion when a code is read aloud (same alphabet as Inbox Autopilot addresses).
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz23456789';

/** A new random invite code (platform CSPRNG, ~40 bits). */
export function newReferralCode(random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < REFERRAL_CODE_LENGTH) {
    for (const b of random(REFERRAL_CODE_LENGTH)) {
      if (b < limit && out.length < REFERRAL_CODE_LENGTH) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

/** True when PostgREST says the table is not there yet (before the migration). */
export function isMissingTable(status, body) {
  const code = body && typeof body === 'object' ? String(body.code || '') : '';
  const msg = body && typeof body === 'object' ? String(body.message || '') : String(body || '');
  return status === 404 || code === 'PGRST205' || code === '42P01' || /relation .* does not exist|Could not find the table/i.test(msg);
}

/** The cap trigger's refusal (migration 20261024160000). */
const isCapError = (body) => /growth_reward_cap/.test(String((body && body.message) || body || ''));

/** One PostgREST call, read once: { ok, status, body, missing }. Never throws. */
async function call(db, path, opts) {
  let r;
  try { r = await db(path, opts); } catch { return { ok: false, status: 0, body: null, missing: false }; }
  if (!r) return { ok: false, status: 0, body: null, missing: false };
  const text = await r.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body, missing: !r.ok && isMissingTable(r.status, body) };
}
const rowsOf = (res) => (res.ok && Array.isArray(res.body) ? res.body : []);

/** First day of the next California month as 'YYYY-MM-01' (when the monthly report cap starts over). */
export function nextPacificMonthStart(now = new Date()) {
  const [y, m] = pacificMonth(now).split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/** Insert a ledger row once. → 'inserted' | 'duplicate' | 'cap' | 'not_ready' | 'failed' (+ row). */
async function insertReward(db, row) {
  const res = await call(db, 'growth_rewards?on_conflict=kind,ref_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(row),
  });
  if (res.missing) return { state: 'not_ready' };
  if (!res.ok) return { state: isCapError(res.body) ? 'cap' : 'failed' };
  const inserted = rowsOf(res)[0] || null;
  return inserted ? { state: 'inserted', row: inserted } : { state: 'duplicate' };
}

/** Ledger row → Pro time. On failure the row is removed, so nothing is claimed that was not given. */
async function settle(db, ledgerRow, { today, nowMs } = {}) {
  const g = await grantProDays(db, ledgerRow.user_id, ledgerRow.days, { stack: true, today, nowMs });
  if (!g.ok) {
    await call(db, `growth_rewards?id=eq.${ledgerRow.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return { ok: false, reason: g.reason };
  }
  await call(db, `growth_rewards?id=eq.${ledgerRow.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ pro_until_after: g.pro_until }),
  });
  return { ok: true, pro_until: g.pro_until };
}

// ── Report and get Pro ─────────────────────────────────────────────────────────────────────────────

/**
 * Reward the outcome just reported for one tracked application. Call AFTER the report was written.
 * @returns {Promise<{ granted: true, days: number, pro_until: string, month_days: number, month_cap: number }
 *   | { granted: false, reason: 'no_application'|'not_found'|'too_new'|'already_rewarded'|'monthly_cap'|'not_ready'|'failed', [k: string]: unknown }>}
 */
export async function rewardReport(db, uid, applicationId, { nowMs = Date.now(), today = pacificDate(new Date(nowMs)) } = {}) {
  if (!isUuid(uid) || !isUuid(applicationId)) return { granted: false, reason: 'no_application' };
  // The caller's own application, by id AND user id. Never a client-sent date.
  const appRes = await call(db, `applications?id=eq.${applicationId}&user_id=eq.${uid}&select=id,created_at&limit=1`);
  if (!appRes.ok) return { granted: false, reason: 'failed' };
  const app = rowsOf(appRes)[0];
  if (!app) return { granted: false, reason: 'not_found' };
  const created = Date.parse(app.created_at);
  if (!Number.isFinite(created)) return { granted: false, reason: 'failed' };
  const eligibleAt = created + REPORT_REWARD_MIN_TRACKED_DAYS * DAY_MS;
  if (nowMs < eligibleAt) {
    return { granted: false, reason: 'too_new', tracked_days: Math.max(0, Math.floor((nowMs - created) / DAY_MS)), min_days: REPORT_REWARD_MIN_TRACKED_DAYS };
  }

  const month = pacificMonth(new Date(nowMs));
  const [already, monthRows] = await Promise.all([
    call(db, `growth_rewards?kind=eq.report&ref_id=eq.${applicationId}&select=id&limit=1`),
    call(db, `growth_rewards?user_id=eq.${uid}&kind=eq.report&pacific_month=eq.${month}&select=days&limit=100`),
  ]);
  if (already.missing || monthRows.missing) return { granted: false, reason: 'not_ready' };
  if (!already.ok || !monthRows.ok) return { granted: false, reason: 'failed' };
  if (rowsOf(already).length) return { granted: false, reason: 'already_rewarded' };
  const used = rowsOf(monthRows).reduce((s, r) => s + (Number(r.days) || 0), 0);
  const left = REPORT_REWARD_MONTHLY_CAP_DAYS - used;
  const capped = { granted: false, reason: 'monthly_cap', month_cap: REPORT_REWARD_MONTHLY_CAP_DAYS, resets_on: nextPacificMonthStart(new Date(nowMs)) };
  if (left <= 0) return capped;
  const days = Math.min(REPORT_REWARD_PRO_DAYS, left);

  const ins = await insertReward(db, { user_id: uid, kind: 'report', ref_id: applicationId, days, pacific_month: month });
  if (ins.state === 'not_ready') return { granted: false, reason: 'not_ready' };
  if (ins.state === 'duplicate') return { granted: false, reason: 'already_rewarded' };
  if (ins.state === 'cap') return capped;
  if (ins.state !== 'inserted') return { granted: false, reason: 'failed' };
  const s = await settle(db, ins.row, { today, nowMs });
  if (!s.ok) return { granted: false, reason: 'failed' };
  return { granted: true, days, pro_until: s.pro_until, month_days: used + days, month_cap: REPORT_REWARD_MONTHLY_CAP_DAYS };
}

// ── Invite a friend ────────────────────────────────────────────────────────────────────────────────

/** The user's invite code row, created on first ask. null = not ready / could not be read. */
export async function ensureReferralCode(db, uid) {
  const read = async () => {
    const r = await call(db, `referral_codes?user_id=eq.${uid}&select=code,created_at&limit=1`);
    return r.missing ? { missing: true } : { row: rowsOf(r)[0] || null, ok: r.ok };
  };
  const first = await read();
  if (first.missing) return { ready: false };
  if (first.row) return { ready: true, ...first.row };
  if (!first.ok) return { ready: true, code: null };
  for (let i = 0; i < 4; i++) {
    const res = await call(db, 'referral_codes?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ user_id: uid, code: newReferralCode() }),
    });
    if (res.missing) return { ready: false };
    const made = rowsOf(res)[0];
    if (made) return { ready: true, code: made.code, created_at: made.created_at };
    // [] = a concurrent request made this user's row first; an error = the code collided. Read, then retry.
    const again = await read();
    if (again.row) return { ready: true, ...again.row };
  }
  return { ready: true, code: null };
}

/**
 * Claim `code` for the signed-in account `uid` (the invitee).
 * @param {{ accountCreatedAt: string|null, nowMs?: number }} ctx  accountCreatedAt = auth.users.created_at
 * @returns {Promise<{ ok: boolean, reason?: string, final: boolean }>}  final=false: try again later
 */
export async function claimReferral(db, uid, code, { accountCreatedAt, nowMs = Date.now() }) {
  const c = String(code || '').trim().toLowerCase();
  if (!isReferralCode(c)) return { ok: false, reason: 'invalid_code', final: true };
  const codeRes = await call(db, `referral_codes?code=eq.${c}&select=user_id,created_at&limit=1`);
  if (codeRes.missing) return { ok: false, reason: 'not_ready', final: false };
  if (!codeRes.ok) return { ok: false, reason: 'failed', final: false };
  const owner = rowsOf(codeRes)[0];
  if (!owner) return { ok: false, reason: 'unknown_code', final: true };
  if (owner.user_id === uid) return { ok: false, reason: 'self_referral', final: true };
  const acct = Date.parse(accountCreatedAt || '');
  if (!Number.isFinite(acct)) return { ok: false, reason: 'failed', final: false };
  if (acct <= Date.parse(owner.created_at)) return { ok: false, reason: 'account_predates_link', final: true };
  if (nowMs - acct > REFERRAL_CLAIM_WINDOW_DAYS * DAY_MS) return { ok: false, reason: 'account_too_old', final: true };
  const ins = await call(db, 'referrals?on_conflict=invitee_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ invitee_id: uid, referrer_id: owner.user_id, code: c }),
  });
  if (ins.missing) return { ok: false, reason: 'not_ready', final: false };
  if (!ins.ok) return { ok: false, reason: 'failed', final: false };
  if (rowsOf(ins).length) return { ok: true, final: true };
  // Already claimed. The same referrer again is a harmless replay; anyone else is refused.
  const prior = rowsOf(await call(db, `referrals?invitee_id=eq.${uid}&select=referrer_id&limit=1`))[0];
  if (prior && prior.referrer_id === owner.user_id) return { ok: true, duplicate: true, final: true };
  return { ok: false, reason: 'already_claimed', final: true };
}

/**
 * The invitee `uid` just tracked an application: hand out the invite rewards once.
 * Safe to call on every add_application (one indexed read when there is nothing to do).
 * @returns {Promise<{ rewarded: false, reason: string } | { rewarded: true, days: number, pro_until: string|null, referrer_rewarded: boolean }>}
 */
export async function rewardReferralOnApplication(db, uid, { nowMs = Date.now(), today = pacificDate(new Date(nowMs)) } = {}) {
  if (!isUuid(uid)) return { rewarded: false, reason: 'no_user' };
  const refRes = await call(db, `referrals?invitee_id=eq.${uid}&select=referrer_id,rewarded_at&limit=1`);
  if (refRes.missing) return { rewarded: false, reason: 'not_ready' };
  const ref = rowsOf(refRes)[0];
  if (!ref) return { rewarded: false, reason: 'no_referral' };
  if (ref.rewarded_at) return { rewarded: false, reason: 'already_rewarded' };

  // The invitee's week. Unique (kind, ref_id) means a replay or a race grants it once.
  let inviteeUntil = null;
  let inviteeGranted = false;
  const mine = await insertReward(db, { user_id: uid, kind: 'referral_invitee', ref_id: uid, days: REFERRAL_REWARD_PRO_DAYS });
  if (mine.state === 'not_ready') return { rewarded: false, reason: 'not_ready' };
  if (mine.state === 'failed') return { rewarded: false, reason: 'failed' };
  if (mine.state === 'inserted') {
    const s = await settle(db, mine.row, { today, nowMs });
    if (!s.ok) return { rewarded: false, reason: 'failed' }; // row removed: the next application retries
    inviteeUntil = s.pro_until;
    inviteeGranted = true;
  }

  // The referrer's week, up to REFERRAL_MAX_REWARDED invitees (the trigger enforces the cap).
  let referrerRewarded = false;
  const theirs = await insertReward(db, { user_id: ref.referrer_id, kind: 'referral_referrer', ref_id: uid, days: REFERRAL_REWARD_PRO_DAYS });
  if (theirs.state === 'inserted') {
    const s = await settle(db, theirs.row, { today, nowMs });
    if (!s.ok) return inviteeGranted ? { rewarded: true, days: REFERRAL_REWARD_PRO_DAYS, pro_until: inviteeUntil, referrer_rewarded: false } : { rewarded: false, reason: 'failed' };
    referrerRewarded = true;
  } else if (theirs.state === 'duplicate') {
    referrerRewarded = true;
  } else if (theirs.state !== 'cap') {
    // Not settled yet (a failed write): leave rewarded_at empty so the next application finishes it.
    return inviteeGranted ? { rewarded: true, days: REFERRAL_REWARD_PRO_DAYS, pro_until: inviteeUntil, referrer_rewarded: false } : { rewarded: false, reason: 'failed' };
  }

  await call(db, `referrals?invitee_id=eq.${uid}&rewarded_at=is.null`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ rewarded_at: new Date(nowMs).toISOString(), referrer_rewarded: referrerRewarded }),
  });
  if (!inviteeGranted) return { rewarded: false, reason: 'already_rewarded' };
  return { rewarded: true, days: REFERRAL_REWARD_PRO_DAYS, pro_until: inviteeUntil, referrer_rewarded: referrerRewarded };
}

/** What the invite card shows. { ready: false } before the migration. */
export async function referralStatus(db, uid, { nowMs = Date.now() } = {}) {
  if (!isUuid(uid)) return { ready: false };
  const code = await ensureReferralCode(db, uid);
  if (!code.ready) return { ready: false };
  const month = pacificMonth(new Date(nowMs));
  const [refs, rewards, cred] = await Promise.all([
    call(db, `referrals?referrer_id=eq.${uid}&select=rewarded_at,referrer_rewarded&limit=500`),
    call(db, `growth_rewards?user_id=eq.${uid}&select=kind,days,pacific_month&limit=1000`),
    call(db, `ai_credits?user_id=eq.${uid}&select=pro_until&limit=1`),
  ]);
  const refRows = rowsOf(refs);
  const rewardRows = rowsOf(rewards);
  const rewarded = rewardRows.filter((r) => r.kind === 'referral_referrer').length;
  const until = rowsOf(cred)[0]?.pro_until || null;
  return {
    ready: true,
    code: code.code || null,
    joined: refRows.length,
    waiting: refRows.filter((r) => !r.rewarded_at).length,
    rewarded,
    cap: REFERRAL_MAX_REWARDED,
    pro_days_earned: rewardRows.reduce((s, r) => s + (Number(r.days) || 0), 0),
    report_days_this_month: rewardRows.filter((r) => r.kind === 'report' && r.pacific_month === month).reduce((s, r) => s + (Number(r.days) || 0), 0),
    report_month_cap: REPORT_REWARD_MONTHLY_CAP_DAYS,
    pro_until: until && Date.parse(until) > nowMs ? until : null,
  };
}

/** Admin: the most recent grants (newest first), for review and manual revocation. */
export async function recentGrants(db, { limit = 100 } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const res = await call(db, `growth_rewards?select=id,user_id,kind,ref_id,days,pacific_month,pro_until_after,created_at&order=created_at.desc&limit=${n}`);
  if (res.missing) return { ready: false, grants: [] };
  return { ready: true, grants: rowsOf(res) };
}
