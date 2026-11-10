// One press = one execution, for every admin write (round 7, judge finding F3), and an unknown outcome is never a
// failure (round 8).
//
// A write that carries `request_id` runs at most once per (action, request_id, round):
//   • the first call CLAIMS the key (atomic counter rpc/increment_rate_limit) and writes a `request_result` row in
//     admin_audit_log {status:'running'} — THE record of this press. A 2xx answer makes it {status:'done',
//     status_code, response}; a refused write makes it 'failed' (nothing happened, Retry runs again).
//   • ADDITIVE writes (the effect adds up if repeated — a credit grant) first record their INTENT on that row
//     ({ kind, prior, next, … }) and, when the database's answer to the write itself is lost or not ok, mark the
//     row 'unknown' instead of 'failed' (the write may have landed).
//   • a replay finds the row: done → the recorded answer with `replayed: true`; running (younger than 70 s) →
//     409 `in_progress`; 'unknown' / stale 'running' with an intent → read the current state and compare with the
//     intent: == next → it was done (the record, its audit row and ledger row are completed, the done sentence is
//     answered with `replayed: true`); == prior → nothing happened, run; anything else → 409 conflict naming the
//     current value, not retryable. Failed, or no intent → run again.
//   • no counter and no record: SET-STYLE writes run (repeating them is harmless); ADDITIVE writes refuse
//     ("Couldn’t check whether this was already done — nothing was changed").
// Job actions repeat their request_id on every round by design: they are only made idempotent when the round is
// named (`round: n`). review_held and dedupe_reports keep their own batch rule and are not wrapped.

import { rows } from './batch.js';
import { AdminError } from './respond.js';

export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const RUNNING_STALE_MS = 70_000;
const MAX_STORED = 100_000;

// Every write the router serves, classified. ADDITIVE = repeating it adds up (needs an intent and a verifier).
// SET = repeating it changes nothing more (it sets a value, or its write is conditional on the state it changes).
export const WRITE_CLASS = {
  grant_credits: ['additive', 'adds to a balance and inserts a ledger row; a repeat adds again'],
  undo: ['additive', 'undoing a credit grant subtracts and inserts a ledger row; every other undo is conditional on the values it wrote (set-style), but the class is per action'],
  moderate_report: ['set', 'PATCH conditional on the state it changes (held/live/rejected)'],
  approve_report: ['set', 'alias of moderate_report'], investigate_report: ['set', 'alias of moderate_report'], deny_hiring_report: ['set', 'alias of moderate_report'],
  correct_report_outcome: ['set', 'PATCH conditional on outcome = the one read'],
  resolve_listing_dispute: ['set', 'claims the dispute with status=eq.open first; a repeat finds it resolved'],
  delete_listing: ['set', 'expires the row, upserts the suppression, deletes reports: a repeat finds nothing more to do'],
  dismiss_inactive_report: ['set', 'deletes the listing\'s reports; a repeat finds none'],
  remove_listing: ['set', 'expires the row'], deny_report: ['set', 'marks the row active'],
  update_reddit_dispute: ['set', 'PATCH conditional on the prior status'],
  resolve_issue: ['set', 'PATCH conditional on status=eq.open'], dismiss_issue: ['set', 'PATCH conditional on status=eq.open'],
  moderate_employer_reply: ['set', 'PATCH conditional on status=eq.pending'],
  fulfill_employer_purchase: ['set', 'marks fulfilled conditionally, then sets the perk window; a repeat finds it fulfilled and only re-grants a missing perk'],
  job_edit: ['set', 'sets fields to values'], job_update: ['set', 'alias of job_edit'],
  job_restore: ['set', 'sets the row live until now + 14 days'], set_job_target: ['set', 'sets a value'],
  merge: ['set', 'a repeat finds the absorbed company gone (404)'], auto_merge: ['set', 'each round re-plans from the companies that still exist'],
  undo_merge: ['set', 'conditional on undone_at is null'], resplit_company: ['set', 'finds only a not-undone merge'],
  company_recompute: ['set', 'recomputes from the reports'],
  set_pro_window: ['set', 'sets pro_until to a value'], set_pro: ['set', 'alias of set_pro_window'],
  set_user_password: ['set', 'sets the password'], delete_user: ['set', 'a repeat finds nothing to delete (auth 404 accepted)'],
  update_cluster: ['set', 'sets a status'], detect_duplicates_by_signals: ['set', 'creates a cluster only for a signal that has none'],
  set_flag: ['set', 'upserts a value'], seed_flags: ['set', 'insert with ignore-duplicates'],
  review_reports: ['set', 'decides only rows still held'],
  purge_stale_jobs: ['set', 'the sweep re-evaluates what is stale'], job_dupes_remove: ['set', 're-plans; deletes only rows that still exist'],
  dedupe_jobs: ['set', 'alias of job_dupes_remove'], recompute_queue_drain: ['set', 'recomputes what is still queued'],
  refresh_demand: ['set', 'upserts the demand rows'], emergency_job_refresh: ['set', 'refresh upserts listings'],
};
export const IDEMPOTENT_WRITES = new Set(Object.keys(WRITE_CLASS));
export const ADDITIVE = new Set(Object.entries(WRITE_CLASS).filter(([, v]) => v[0] === 'additive').map(([k]) => k));
export const SELF_IDEMPOTENT = new Set(['review_held', 'dedupe_reports']);
export const JOB_ACTIONS = new Set(['purge_stale_jobs', 'auto_merge', 'job_dupes_remove', 'dedupe_jobs', 'recompute_queue_drain']);
// Reads (and session actions): never wrapped. The contract test holds READS ∪ WRITE_CLASS ∪ SELF_IDEMPOTENT = every action.
export const READS = new Set([
  'overview', 'list_held_reports', 'reports_recent', 'report_detail', 'reports_stats', 'scan_report_dupes', 'list_listing_tickets',
  'list_listing_disputes', 'get_recent_jobs', 'jobs_browse', 'listings_browse', 'job_detail', 'listing_counts', 'scan_job_dupes', 'job_dupes_scan',
  'source_health', 'get_job_target', 'get_jobs_grouped', 'get_company_jobs', 'find_duplicates', 'list_merges', 'export_company',
  'companies_list', 'company_detail', 'users_list', 'user_detail', 'clusters_list', 'cluster_detail', 'signup_attribution',
  'list_employer_purchases', 'list_employer_replies', 'flags_list', 'cron_health', 'activity_log', 'search', 'errors_list', 'issues_list',
  'list_reddit_disputes', 'revenue_summary', 'revenue_funnel', 'search_opportunities', 'list_growth_rewards', 'list_subscriptions',
  'recent_events', 'get_kpi_detail', 'export_csv', 'db_size', 'job_status', 'refresh_jobs', 'whoami', 'admin_logout',
]);

// kind → { verify(ctx, intent) → {state:'done'|'nothing'|'conflict', message?}, finish(ctx, intent) → answer body,
//          cleanup?(ctx, intent, key) — on 'nothing', before the re-run: removes rows the first try kept (throws to refuse) }
const VERIFIERS = new Map();
export function registerVerifier(kind, v) { VERIFIERS.set(kind, v); }

/** The write's answer was lost or not ok: its effect is unknown. The record becomes 'unknown', the answer retryable. */
export function unknownOutcome(message = 'The database did not confirm the change — checking it again is safe: press Retry.') {
  return new AdminError(504, message, { code: 'timeout', retryable: true, unknown: true });
}

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

const patchRecord = (ctx, id, metadata) => ctx.db(`admin_audit_log?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata }) });
const notChecked = (ctx) => ctx.res.status(503).json({ ok: false, error: 'Couldn’t check whether this was already done — nothing was changed. Try again.', code: 'upstream', retryable: true });
const inProgress = (ctx) => ctx.res.status(409).json({ ok: false, error: 'This is still running from your first press — wait a moment, then check.', code: 'in_progress', retryable: true });

export async function runOnce(ctx, fn) {
  const key = idempotencyKey(ctx.action, ctx.body);
  if (!key || !IDEMPOTENT_WRITES.has(ctx.action)) return fn(ctx);
  const additive = ADDITIVE.has(ctx.action);

  const n = await claim(ctx, key);
  let recordId = null;
  let carried = null;
  if (n !== 1) {
    const found = await findRecord(ctx, key);
    if (!found.ok) return notChecked(ctx);
    const row = found.row;
    const m = row?.metadata || null;
    if (!row && n == null && additive) return notChecked(ctx); // no counter, no record: an additive write fails closed
    if (m && m.status === 'done') {
      const recorded = m.response && typeof m.response === 'object' ? m.response : { ok: true, changed: 0, skipped: [], touched: [], message: 'Already done.' };
      return ctx.res.status(Number(m.status_code) || 200).json({ ...recorded, replayed: true, ...(recorded.ok !== false ? { changed: 0, recorded_changed: recorded.changed ?? null } : {}) });
    }
    const fresh = row && Date.now() - Date.parse(row.created_at) < RUNNING_STALE_MS;
    if (m && m.status === 'running' && fresh) return inProgress(ctx);
    if (!m && n != null && n > 1) return inProgress(ctx);
    // 'unknown', or a stale 'running': compare the database with the recorded intent before anything else.
    if (m && m.intent && (m.status === 'unknown' || m.status === 'running')) {
      const v = VERIFIERS.get(m.intent.kind);
      if (!v) return notChecked(ctx);
      let verdict;
      try { verdict = await v.verify(ctx, m.intent, key); } catch { return notChecked(ctx); }
      if (verdict.state === 'done') {
        const body = await v.finish(ctx, m.intent, key);
        await patchRecord(ctx, row.id, { status: 'done', action: ctx.action, intent: m.intent, status_code: 200, response: trimForStore(body) }).catch(() => null);
        return ctx.res.status(200).json({ ...body, replayed: true, changed: 0, recorded_changed: body.changed ?? 1 });
      }
      if (verdict.state === 'conflict') {
        await patchRecord(ctx, row.id, { status: 'failed', action: ctx.action, intent: m.intent, conflict: verdict.message }).catch(() => null);
        return ctx.res.status(409).json({ ok: false, error: verdict.message, code: 'conflict', retryable: false });
      }
      // Nothing happened: clear what the first try left that claims otherwise (its kept audit row), then run,
      // reusing the record. A failed clean-up answers 'not checked' — nothing has been written yet.
      if (v.cleanup) { try { await v.cleanup(ctx, m.intent, key); } catch { return notChecked(ctx); } }
      carried = m.intent;
    }
    recordId = row?.id ?? null;
  }

  if (recordId == null) {
    const ins = await ctx.db('admin_audit_log?select=id', { method: 'POST', body: JSON.stringify({ admin_id: ctx.sess.admin_id ?? null, username: ctx.sess.username || 'admin', action: 'request_result', target_type: 'request', target_id: key, metadata: { status: 'running', action: ctx.action } }) });
    const got = ins && ins.ok ? await ins.json().catch(() => null) : null;
    recordId = Array.isArray(got) ? got[0]?.id : got?.id;
    if (!ins || !ins.ok) return ctx.res.status(503).json({ ok: false, error: 'Couldn’t record this press, so nothing was done — try again.', code: 'upstream', retryable: true });
  } else {
    const p = await patchRecord(ctx, recordId, { status: 'running', action: ctx.action, ...(carried ? { previous_intent: carried } : {}) });
    if (!p || !p.ok) return notChecked(ctx);
  }

  // An additive handler records its intent here, before its write; the record must take it or nothing is written.
  let intent = null;
  ctx.requestKey = key;
  ctx.recordIntent = async (value) => {
    if (recordId == null) return;
    intent = value;
    const p = await patchRecord(ctx, recordId, { status: 'running', action: ctx.action, intent: value, intent_written_at: new Date().toISOString() });
    if (!p || !p.ok) throw new AdminError(503, 'Couldn’t record this press, so nothing was changed — try again.', { code: 'upstream', retryable: true });
  };

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
    ctx.recordIntent = null;
    const done = !thrown && status >= 200 && status < 300;
    const unknown = !!(thrown && thrown.extra && thrown.extra.unknown);
    if (recordId != null) {
      const meta = done ? { status: 'done', action: ctx.action, ...(intent ? { intent } : {}), status_code: status, response: trimForStore(payload) }
        : unknown ? { status: 'unknown', action: ctx.action, intent }
          : { status: 'failed', action: ctx.action, ...(intent ? { intent } : {}), status_code: thrown ? (thrown.status || 500) : status };
      await patchRecord(ctx, recordId, meta).catch(() => null);
    }
  }
}
