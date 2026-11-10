// One press = one execution, for every admin write (round 7, judge finding F3: a client that gave up at 30 s and
// pressed Retry granted credits twice).
//
// A write that carries `request_id` is run at most once per (action, request_id, round):
//   • the first call CLAIMS the key (the atomic counter rpc/increment_rate_limit, the same one the login rate limit
//     uses) and writes a `request_result` row in admin_audit_log {status:'running'}; when it answers 2xx the row
//     becomes {status:'done', status_code, response} — THE place the result is recorded;
//   • a replay finds that row: done → the recorded answer with `replayed: true`, nothing written; running (younger
//     than the function limit + 10 s) → 409 `in_progress`, retryable; failed or stale → it runs again.
//   • an answer that is not 2xx is recorded as 'failed', so Retry with the same id runs again (nothing was done).
// Job actions repeat their request_id on every ROUND by design (one Undo per press): their key includes `round`
// (send `round: <n>`; it defaults to the cursor, else 0). review_held and dedupe_reports keep their own row-level
// idempotency (a retry finishes the rest of the batch) and are not wrapped.

import { rows } from './batch.js';

export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const RUNNING_STALE_MS = 70_000;
const MAX_STORED = 100_000; // characters of the recorded answer; bigger answers keep their contract fields only

// Every write action the router serves, except the two with their own batch idempotency.
export const IDEMPOTENT_WRITES = new Set([
  'moderate_report', 'approve_report', 'investigate_report', 'deny_hiring_report', 'correct_report_outcome',
  'resolve_listing_dispute', 'delete_listing', 'dismiss_inactive_report', 'remove_listing', 'deny_report',
  'update_reddit_dispute', 'resolve_issue', 'dismiss_issue',
  'moderate_employer_reply', 'fulfill_employer_purchase',
  'job_edit', 'job_update', 'job_restore', 'set_job_target',
  'merge', 'auto_merge', 'undo_merge', 'resplit_company', 'company_recompute',
  'set_pro_window', 'set_pro', 'grant_credits', 'set_user_password', 'delete_user', 'update_cluster', 'detect_duplicates_by_signals',
  'set_flag', 'seed_flags', 'undo', 'review_reports',
  'purge_stale_jobs', 'job_dupes_remove', 'dedupe_jobs', 'recompute_queue_drain', 'refresh_demand', 'emergency_job_refresh',
]);
export const SELF_IDEMPOTENT = new Set(['review_held', 'dedupe_reports']);
// Rounds of a job repeat one request_id: these are only made idempotent when the round is named (`round: n`),
// otherwise round 2 would replay round 1 forever.
export const JOB_ACTIONS = new Set(['purge_stale_jobs', 'auto_merge', 'job_dupes_remove', 'dedupe_jobs', 'recompute_queue_drain']);

export function idempotencyKey(action, body) {
  const rid = String(body?.request_id ?? '');
  if (!REQUEST_ID_RE.test(rid)) return null;
  if (JOB_ACTIONS.has(action) && body.round == null) return null;
  const round = body.round != null ? String(body.round).slice(0, 20) : (body.cursor ? String(body.cursor).slice(-24) : '0');
  return `${action}:${rid}:${round}`.slice(0, 160);
}

async function claim(ctx, key) {
  try {
    const r = await ctx.db('rpc/increment_rate_limit', { method: 'POST', body: JSON.stringify({ p_key: `admin_req:${key}`, p_ttl_seconds: 86400 }) });
    if (!r || !r.ok) return null;
    const n = Number(await r.json());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

async function findRecord(ctx, key) {
  const r = await ctx.db(`admin_audit_log?action=eq.request_result&target_type=eq.request&target_id=eq.${encodeURIComponent(key)}&select=id,created_at,metadata&order=id.desc&limit=1`);
  const got = await rows(r);
  if (!Array.isArray(got)) return { ok: false };
  return { ok: true, row: got[0] || null };
}

function trimForStore(body) {
  const s = JSON.stringify(body ?? null);
  if (s.length <= MAX_STORED) return body;
  const { ok, changed, skipped, message, touched, undo, remaining, complete, cursor, error, code, retryable } = body || {};
  return { ok, changed, skipped, message, touched, undo, remaining, complete, cursor, error, code, retryable, trimmed: true };
}

/**
 * Run `fn(ctx)` at most once for this request id. Returns whatever the handler returned (the res object).
 */
export async function runOnce(ctx, fn) {
  const key = idempotencyKey(ctx.action, ctx.body);
  if (!key || !IDEMPOTENT_WRITES.has(ctx.action)) return fn(ctx);

  const n = await claim(ctx, key);
  let recordId = null;
  if (n !== 1) {
    // Not the first claim (or no counter): look for the recorded result.
    const found = await findRecord(ctx, key);
    if (!found.ok) {
      return ctx.res.status(503).json({ ok: false, error: 'Couldn’t check whether this was already done — try again.', code: 'upstream', retryable: true });
    }
    const m = found.row?.metadata || null;
    if (m && m.status === 'done') {
      const recorded = m.response && typeof m.response === 'object' ? m.response : { ok: true, changed: 0, skipped: [], touched: [], message: 'Already done.' };
      return ctx.res.status(Number(m.status_code) || 200).json({ ...recorded, replayed: true, ...(recorded.ok !== false ? { changed: 0, recorded_changed: recorded.changed ?? null } : {}) });
    }
    if (m && m.status === 'running' && Date.now() - Date.parse(found.row.created_at) < RUNNING_STALE_MS) {
      return ctx.res.status(409).json({ ok: false, error: 'This is still running from your first press — wait a moment, then check.', code: 'in_progress', retryable: true });
    }
    if (!m && n != null && n > 1) {
      // Claimed by another call that has not written its record yet: treat as running.
      return ctx.res.status(409).json({ ok: false, error: 'This is still running from your first press — wait a moment, then check.', code: 'in_progress', retryable: true });
    }
    recordId = found.row?.id ?? null; // failed or stale: run again, reusing its record row
  }

  // Record "running" before the write (the admin's identity, the action, the key).
  if (recordId == null) {
    const ins = await ctx.db('admin_audit_log?select=id', { method: 'POST', body: JSON.stringify({ admin_id: ctx.sess.admin_id ?? null, username: ctx.sess.username || 'admin', action: 'request_result', target_type: 'request', target_id: key, metadata: { status: 'running', action: ctx.action } }) });
    const got = ins && ins.ok ? await ins.json().catch(() => null) : null;
    recordId = Array.isArray(got) ? got[0]?.id : got?.id;
    if (!ins || !ins.ok) {
      return ctx.res.status(503).json({ ok: false, error: 'Couldn’t record this press, so nothing was done — try again.', code: 'upstream', retryable: true });
    }
  } else {
    await ctx.db(`admin_audit_log?id=eq.${recordId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata: { status: 'running', action: ctx.action } }) });
  }

  // Capture the answer.
  let status = 200, payload = null;
  const res = ctx.res;
  const origStatus = res.status.bind(res), origJson = res.json.bind(res);
  res.status = (c) => { status = c; return origStatus(c); };
  res.json = (b) => { payload = b; return origJson(b); };
  let thrown = null;
  try {
    return await fn(ctx);
  } catch (e) {
    thrown = e;
    throw e;
  } finally {
    res.status = origStatus; res.json = origJson;
    const done = !thrown && status >= 200 && status < 300;
    if (recordId != null) {
      await ctx.db(`admin_audit_log?id=eq.${recordId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata: done ? { status: 'done', action: ctx.action, status_code: status, response: trimForStore(payload) } : { status: 'failed', action: ctx.action, status_code: thrown ? (thrown.status || 500) : status } }) }).catch(() => null);
    }
  }
}
