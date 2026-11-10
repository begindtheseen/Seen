// Review: held reports (list + bulk decision), single-report moderation, recent reports, duplicate copies,
// and the recompute queue drain. Rules about WHAT a decision writes live in lib/server/reportReview.js and
// lib/server/reportModeration.js; this file is the transport: ids in the body, short chunks, counted
// writes, audit rows with prior values before the write, honest partial answers, and undo.

import { randomUUID } from 'crypto';
import { ok, list, skips, plural, fmt, undoOffer, AdminError } from './respond.js';
import { adminOnly, svcHeaders, bad, notFound, upstream, conflict, str } from './context.js';
import { isUuid, readByIds, patchByIds, readAll, keysetPage, rows, rpc, chunk, idList } from './batch.js';
import { audit, auditMany, auditRow, dropAuditRows } from './audit.js';
import { enqueueCompanies, drainRecompute, recomputeNow, companyKey } from './recompute.js';
import { sortHeldReports, groupCounts, planDecision, classifyHeldReport, markDuplicates, SORTS as HELD_SORTS } from '../reportReview.js';
import { moderationPlan, reportState, rulesCheck, DECISIONS as MODERATION_DECISIONS } from '../reportModeration.js';
import { REJECTED_TRUST_REASON, DUPLICATE_TRUST_REASON } from '../reportCounts.js';
import { findDuplicateReports, DUPLICATE_PATCH } from '../reportDupes.js';
import { pacificDate, pacificDayStart } from '../../time/pacific.js';
import { ilikeContains } from '../pgrest.js';

export const HELD_PENDING_FILTER = `needs_review=is.true&or=(trust_reason.is.null,trust_reason.not.in.(${REJECTED_TRUST_REASON},${DUPLICATE_TRUST_REASON}))`;
export const HELD_SELECT = 'id,company_name,outcome,role,platform,source,created_at,report_text,outcome_weight,trust_reason,needs_review';
const RECENT_SELECT = 'id,company_name,outcome,role,platform,created_at,report_text,outcome_weight,trust_reason,needs_review';
export const MAX_BULK_IDS = 5000;
const WRITE_BUDGET_MS = 35_000;
const RECOMPUTE_INLINE_MS = 8_000;
const HELD_DECISION_ACTIONS = ['approve_held_report', 'reject_held_report'];

const isPending = (r) => r && r.needs_review === true && r.trust_reason !== REJECTED_TRUST_REASON && r.trust_reason !== DUPLICATE_TRUST_REASON;
const touchedForCompanies = (cs) => cs.slice(0, 50).map((c) => `company:${c}`);

// ── list_held_reports ────────────────────────────────────────────────────────────────────────────
export async function listHeld(ctx) {
  const sort = HELD_SORTS.includes(ctx.body.sort) ? ctx.body.sort : 'needs_eyes';
  const all = await readAll(ctx.db, 'reports', { select: HELD_SELECT, filter: HELD_PENDING_FILTER, max: 20000 });
  if (!all.ok) throw upstream(`Could not read the held reports (HTTP ${all.status ?? 0}).`);
  const sorted = sortHeldReports(all.rows, sort);
  return list(ctx.res, sorted, {
    sort, total: sorted.length, as_of: new Date().toISOString(), counts: groupCounts(sorted),
    truncated: !!all.truncated, reports: sorted,
  });
}

// ── the bulk engine (review_held, and review_reports for the legacy page) ─────────────────────────
/**
 * Decide held reports. Returns a plain result; the two actions format it.
 * Idempotent under retry: pass the same `requestId` and rows this batch already decided are reported as
 * `already_done_last_try`, never as "already decided".
 */
export async function decideHeld(ctx, { decision, ids, includeDuplicates = false, requestId = null, budgetMs = WRITE_BUDGET_MS, recomputeMs = RECOMPUTE_INLINE_MS }) {
  const t0 = Date.now();
  const deadline = t0 + budgetMs;
  const batchId = requestId && isUuid(requestId) ? String(requestId).toLowerCase() : randomUUID();
  const valid = [...new Set(ids.map((x) => String(x).toLowerCase()))].filter(isUuid);
  const invalid = ids.length - ids.filter((x) => isUuid(x)).length;

  // 1. Possible duplicates (approve only): the same rule the queue shows, over the WHOLE pending set.
  let dupIds = new Set();
  if (decision === 'approve' && !includeDuplicates) {
    const all = await readAll(ctx.db, 'reports', { select: 'id,company_name,outcome,report_text,created_at,trust_reason,platform,needs_review', filter: HELD_PENDING_FILTER, max: 20000 });
    if (!all.ok) throw upstream(`Could not read the held reports to check for duplicates (HTTP ${all.status ?? 0}) — nothing was changed.`);
    for (const r of markDuplicates(all.rows)) if (r.review?.flags?.includes('possible_duplicate')) dupIds.add(String(r.id));
  }
  const dupSkipped = valid.filter((id) => dupIds.has(id));
  const work = valid.filter((id) => !dupIds.has(id));

  // 2. Write. The RPC does read + audit + write + queue in one transaction; otherwise short chunks.
  const result = { changed: [], alreadyDecided: [], notHeld: [], notFound: [], doneLastTry: [], companies: new Set(), error: null, mode: 'rest' };
  const leftover = [];
  const viaRpc = work.length
    ? await rpc(ctx.db, 'admin_review_reports', { p_ids: work, p_decision: decision, p_admin: ctx.sess.username, p_admin_id: ctx.sess.admin_id ?? null, p_batch: batchId })
    : { ok: false, absent: true };
  const rpcAnswer = viaRpc.ok && viaRpc.data && !Array.isArray(viaRpc.data) && Array.isArray(viaRpc.data.changed) ? viaRpc.data : null;
  if (rpcAnswer) {
    result.mode = 'rpc';
    result.changed = rpcAnswer.changed.map(String);
    result.notHeld = (rpcAnswer.not_held || []).map(String);
    result.notFound = (rpcAnswer.missing || []).map(String);
    result.doneLastTry = (rpcAnswer.done_last_try || []).map(String);
    result.alreadyDecided = (rpcAnswer.already_decided || []).map(String);
    for (const c of rpcAnswer.companies || []) result.companies.add(companyKey(c));
  } else if (viaRpc.ok === false && !viaRpc.absent && viaRpc.status && viaRpc.status !== 0) {
    throw upstream(`The database refused the decision (HTTP ${viaRpc.status}) — nothing was changed.`);
  } else {
    const parts = chunk(work);
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      if (Date.now() > deadline) { leftover.push(...parts.slice(p).flat()); break; }
      // Pending rows first (the common case); then, only for the rest, what state they are in.
      const cur = await readByIds(ctx.db, 'reports', part, { select: HELD_SELECT, filter: HELD_PENDING_FILTER });
      if (!cur.ok) { result.error = { status: 502, message: 'Could not read some of the reports.' }; leftover.push(...parts.slice(p).flat()); break; }
      const byId = new Map(cur.rows.filter(isPending).map((r) => [String(r.id), r]));
      const others = part.filter((id) => !byId.has(id));
      if (others.length) {
        const st = await readByIds(ctx.db, 'reports', others, { select: 'id,needs_review,trust_reason' });
        const stById = new Map((st.rows || []).map((r) => [String(r.id), r]));
        for (const id of others) {
          const r = stById.get(id);
          if (!r) result.notFound.push(id);
          else if (r.needs_review !== true) result.notHeld.push(id);
          else result.alreadyDecided.push(id);
        }
      }
      const pending = part.map((id) => byId.get(id)).filter(Boolean);
      if (!pending.length) continue;
      // Audit first: if it cannot be written, this chunk is not written either.
      const plans = planDecision(pending, decision);
      const auditRowsIn = [];
      for (const { patch, ids: gids } of plans) {
        for (const id of gids) {
          const r = byId.get(id);
          auditRowsIn.push(auditRow(ctx.sess, `${decision}_held_report`, { kind: 'report', id }, {
            prior: { needs_review: r.needs_review, trust_reason: r.trust_reason ?? null, outcome_weight: r.outcome_weight ?? null },
            next: patch,
            metadata: { batch_id: batchId, company: r.company_name, outcome: r.outcome, group: classifyHeldReport(r).group },
          }));
        }
      }
      let audited;
      try { audited = await auditMany(ctx.db, auditRowsIn); }
      catch (e) { result.error = { status: 502, message: e.message }; leftover.push(...parts.slice(p).flat()); break; }
      const auditByTarget = new Map(audited.map((a) => [String(a.target_id), a.id]));
      const changedHere = new Set();
      let failed = false;
      for (const { patch, ids: gids } of plans) {
        const w = await patchByIds(ctx.db, 'reports', gids, patch, { filter: HELD_PENDING_FILTER });
        for (const id of w.changed) changedHere.add(id);
        if (!w.ok) { failed = true; result.error = { status: 502, message: `The database refused part of the write (HTTP ${w.status}).` }; break; }
      }
      const notChanged = pending.map((r) => String(r.id)).filter((id) => !changedHere.has(id));
      if (notChanged.length) {
        // Their audit rows describe a write that did not happen.
        await dropAuditRows(ctx.db, notChanged.map((id) => auditByTarget.get(id)).filter(Boolean));
        // After a failure they are simply not done yet; otherwise someone decided them between read and write.
        if (failed) leftover.push(...notChanged); else result.alreadyDecided.push(...notChanged);
      }
      for (const id of changedHere) {
        result.changed.push(id);
        const c = companyKey(byId.get(id)?.company_name);
        if (c) result.companies.add(c);
      }
      if (failed) { leftover.push(...parts.slice(p + 1).flat()); break; }
    }
    // Rows no longer pending that THIS batch decided on an earlier try (a retry after a timeout): an approved
    // row reads as "not held", a rejected one as "already decided" — both are really "done by your last try".
    const notPending = [...result.alreadyDecided, ...result.notHeld];
    if (notPending.length) {
      const mine = new Set();
      for (const part of chunk(notPending)) {
        const r = await ctx.db(`admin_audit_log?action=in.(${HELD_DECISION_ACTIONS.join(',')})&target_type=eq.report&target_id=in.${idList(part)}&metadata->>batch_id=eq.${batchId}&select=target_id&limit=200`);
        for (const a of (await rows(r)) || []) mine.add(String(a.target_id));
      }
      result.doneLastTry = notPending.filter((id) => mine.has(id));
      result.alreadyDecided = result.alreadyDecided.filter((id) => !mine.has(id));
      result.notHeld = result.notHeld.filter((id) => !mine.has(id));
    }
  }
  const remainingIds = leftover;

  // 3. One parent audit row for the whole batch (the activity log line + the Undo handle).
  let parentId = null;
  if (result.changed.length || result.doneLastTry.length) {
    parentId = await audit(ctx.db, ctx.sess, 'review_held', { kind: 'bulk', id: null }, {
      metadata: { batch_id: batchId, decision, requested: ids.length, changed: result.changed.length, skipped_duplicates: dupSkipped.length, already_decided: result.alreadyDecided.length, not_held: result.notHeld.length, remaining: remainingIds.length, mode: result.mode },
    }, { required: false });
  }

  // 4. Scores: queue, then drain what fits.
  let recompute = { queued: 0, done: 0, remaining: 0, mode: 'table' };
  if (result.companies.size) {
    const companies = [...result.companies];
    const q = result.mode === 'rpc' ? { mode: 'table', queued: companies.length } : await enqueueCompanies(ctx.db, companies);
    const drained = await recomputeNow(ctx.db, svcHeaders(ctx), companies, { mode: q.mode, deadline: Math.min(Date.now() + recomputeMs, ctx.deadline - 5000) });
    recompute = { queued: q.queued, done: drained.done, failed: drained.failed, remaining: drained.remaining, mode: q.mode, ...(drained.cursor ? { cursor: drained.cursor } : {}) };
  }
  return { batchId, parentId, decision, requested: ids.length, invalid, dupSkipped, remainingIds, ...result, companies: [...result.companies], recompute, ms: Date.now() - t0 };
}

function decisionMessage(r) {
  const verb = r.decision === 'approve' ? 'Approved' : 'Rejected';
  const done = r.changed.length;
  const parts = [];
  if (done || r.doneLastTry.length) parts.push(`${verb} ${fmt(done + r.doneLastTry.length)} of ${fmt(r.requested)}`);
  if (r.doneLastTry.length) parts.push(`${fmt(r.doneLastTry.length)} of those by your last try`);
  if (r.dupSkipped.length) parts.push(`${fmt(r.dupSkipped.length)} skipped as possible duplicates`);
  if (r.alreadyDecided.length) parts.push(`${fmt(r.alreadyDecided.length)} already decided`);
  if (r.notHeld.length) parts.push(`${fmt(r.notHeld.length)} not held`);
  if (r.notFound.length) parts.push(`${fmt(r.notFound.length)} not found`);
  if (r.remainingIds.length) parts.push(`${fmt(r.remainingIds.length)} still to do`);
  if (r.recompute.remaining) parts.push(`${plural(r.recompute.remaining, 'company score')} still updating`);
  if (!done && !r.doneLastTry.length) {
    const why = parts.length ? parts.join(' · ') : 'none of them were waiting';
    return `Nothing to do — ${why}.`;
  }
  return `${parts.join(' · ')}.`;
}

function decisionSkips(r) {
  return skips(
    { reason: 'possible_duplicate', count: r.dupSkipped.length, ids: r.dupSkipped },
    { reason: 'already_done_last_try', count: r.doneLastTry.length, ids: r.doneLastTry },
    { reason: 'already_decided', count: r.alreadyDecided.length, ids: r.alreadyDecided },
    { reason: 'not_held', count: r.notHeld.length, ids: r.notHeld },
    { reason: 'not_found', count: r.notFound.length, ids: r.notFound },
    { reason: 'invalid_id', count: r.invalid },
  );
}

function readDecision(body) {
  const decision = body.decision;
  if (!['approve', 'reject'].includes(decision)) throw bad('decision must be approve or reject');
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  return { decision, ids };
}

export async function reviewHeld(ctx) {
  const { decision, ids } = readDecision(ctx.body);
  if (!ids.length) throw bad('Choose at least one report.');
  if (ids.length > MAX_BULK_IDS) throw bad(`At most ${fmt(MAX_BULK_IDS)} reports per press.`);
  const r = await decideHeld(ctx, { decision, ids, includeDuplicates: ctx.body.include_duplicates === true, requestId: ctx.body.request_id });
  const touched = ['held', 'reports', 'overview', 'activity', ...touchedForCompanies(r.companies)];
  if (r.error && !r.changed.length && !r.doneLastTry.length) {
    throw new AdminError(r.error.status, `${r.error.message} Nothing was changed.`, { code: 'upstream', retryable: true, changed: 0, remaining: r.remainingIds.length || r.requested });
  }
  const base = {
    changed: r.changed.length,
    skipped: decisionSkips(r),
    message: decisionMessage(r),
    touched,
    rows: r.changed.map((id) => ({ id, state: r.decision === 'approve' ? 'live' : 'rejected', decision: r.decision })),
    undo: r.parentId && r.changed.length ? undoOffer(r.parentId) : undefined,
    recompute: r.recompute,
    request_id: r.batchId,
    remaining: r.remainingIds.length,
    complete: r.remainingIds.length === 0,
  };
  if (r.error) {
    // Partial: some chunks written (audited), the rest not. Pressing again with the same request_id finishes.
    return ctx.res.status(r.error.status).json({ ...base, ok: false, error: `${r.error.message} ${base.message}`, code: 'upstream', retryable: true });
  }
  return ok(ctx.res, base);
}

/** Legacy alias (the /admin/legacy queue): same engine, the old response fields. */
export async function reviewReportsLegacy(ctx) {
  const { decision, ids } = readDecision(ctx.body);
  if (!ids.length || ids.length > 500) throw bad('provide 1–500 report ids');
  if (!ids.every(isUuid)) throw bad('invalid report id');
  const r = await decideHeld(ctx, { decision, ids, includeDuplicates: true, requestId: ctx.body.request_id });
  if (r.error && !r.changed.length) throw new AdminError(r.error.status, `update failed after ${r.changed.length} report(s)`, { code: 'upstream', retryable: true, changed: 0 });
  const out = {
    decision, requested: ids.length, changed: r.changed.length + r.doneLastTry.length,
    skipped: ids.length - r.changed.length - r.doneLastTry.length,
    companies: r.companies.length, recomputed: r.recompute.done || 0,
    message: decisionMessage(r), touched: ['held', 'reports', 'overview'],
    undo: r.parentId && r.changed.length ? undoOffer(r.parentId) : undefined,
    recompute: r.recompute,
  };
  if (r.error) return ctx.res.status(r.error.status).json({ ...out, ok: false, error: `update failed (${r.error.status}) after ${r.changed.length} report(s)`, code: 'upstream', retryable: true });
  return ctx.res.status(200).json({ ok: true, ...out });
}

// ── recompute_queue_drain ───────────────────────────────────────────────────────────────────────
export async function recomputeDrain(ctx) {
  const d = await drainRecompute(ctx.db, svcHeaders(ctx), { cursor: ctx.body.cursor || null, deadline: Math.min(Date.now() + 40_000, ctx.deadline - 5000) });
  const remaining = d.remaining;
  return ok(ctx.res, {
    changed: d.done,
    skipped: skips({ reason: 'recompute_failed', count: d.failed }),
    remaining: remaining ?? undefined,
    complete: d.complete,
    cursor: d.cursor,
    message: d.done || d.failed
      ? `Recomputed ${plural(d.done, 'company score')}${d.failed ? ` · ${fmt(d.failed)} failed (moved to the back)` : ''}${remaining ? ` · ${fmt(remaining)} waiting` : ''}.`
      : (remaining ? `${plural(remaining, 'company score')} waiting.` : 'No company scores are waiting.'),
    touched: d.done ? ['companies', 'overview'] : [],
  });
}

// ── reports_recent / report_detail ───────────────────────────────────────────────────────────────
const STATE_FILTERS = {
  live: `needs_review=is.false&or=(trust_reason.is.null,trust_reason.not.in.(${REJECTED_TRUST_REASON},${DUPLICATE_TRUST_REASON}))`,
  held: HELD_PENDING_FILTER,
  rejected: `trust_reason=eq.${REJECTED_TRUST_REASON}`,
  duplicate: `trust_reason=eq.${DUPLICATE_TRUST_REASON}`,
};
const decorate = (r) => ({ ...r, ...reportState(r), rules: rulesCheck(r) });

export async function reportsRecent(ctx) {
  const parts = [];
  const state = str(ctx.body.state, 20);
  if (state && STATE_FILTERS[state]) parts.push(STATE_FILTERS[state]);
  const q = str(ctx.body.q, 80);
  if (q) parts.push(`company_name=ilike.${ilikeContains(q)}`);
  const page = await keysetPage(ctx.db, 'reports', { select: RECENT_SELECT, filter: parts.join('&'), order: 'created_at', dir: 'desc', limit: ctx.body.limit || 50, after: ctx.body.after });
  if (!page.ok) throw upstream(`Could not read the reports (HTTP ${page.status}).`);
  return list(ctx.res, page.rows.map(decorate), { next: page.next || undefined, as_of: new Date().toISOString() });
}

export async function reportDetail(ctx) {
  const id = String(ctx.body.id || '');
  if (!isUuid(id)) throw bad('That is not a report id.');
  const r = await ctx.db(`reports?id=eq.${id}&select=${HELD_SELECT}&limit=1`);
  const got = await rows(r);
  if (!Array.isArray(got)) throw upstream(`Could not read the report (HTTP ${r.status}).`);
  if (!got[0]) throw notFound('That report no longer exists.');
  const h = await ctx.db(`admin_audit_log?target_type=eq.report&target_id=eq.${id}&select=id,created_at,username,action,metadata&order=created_at.desc&limit=20`);
  const history = ((await rows(h)) || []).map((a) => ({ id: String(a.id), at: a.created_at, admin: a.username, action: a.action }));
  const row = { ...decorate(got[0]), review: classifyHeldReport(got[0]), history };
  return ok(ctx.res, { message: 'Loaded the report.', rows: [row] });
}

// ── moderate_report (+ the old approve_report / investigate_report / deny_hiring_report names) ──
const LEGACY_DECISION = { approve_report: 'approve', investigate_report: 'hold', deny_hiring_report: 'reject' };

export async function moderateReport(ctx) {
  const decision = ctx.action === 'moderate_report' ? ctx.body.decision : LEGACY_DECISION[ctx.action];
  if (!MODERATION_DECISIONS.includes(decision)) throw bad('decision must be approve, reject, hold or restore');
  const id = String(ctx.body.id || '');
  if (!isUuid(id)) throw bad('invalid report id');
  const cur = await ctx.db(`reports?id=eq.${id}&select=${HELD_SELECT}`);
  const got = await rows(cur);
  if (!Array.isArray(got)) throw upstream(`could not read the report (${cur.status})`);
  const row = got[0];
  if (!row) throw notFound('That report no longer exists — reload the list.');
  let prior = null;
  if (decision === 'restore') {
    const a = await ctx.db(`admin_audit_log?target_type=eq.report&target_id=eq.${id}&action=in.(reject_report,reject_held_report)&select=metadata&order=created_at.desc&limit=1`);
    prior = ((await rows(a)) || [])[0]?.metadata?.prior || null;
  }
  const plan = moderationPlan(row, decision, prior);
  const company = companyKey(row.company_name);
  if (!plan.patch) {
    return ok(ctx.res, { changed: 0, message: plan.message, touched: [], rows: [{ id, ...reportState(row) }], ...reportState(row) });
  }
  const priorVals = { needs_review: row.needs_review, trust_reason: row.trust_reason ?? null, outcome_weight: row.outcome_weight ?? null };
  const auditId = await audit(ctx.db, ctx.sess, `${decision}_report`, { kind: 'report', id }, { prior: priorVals, next: plan.patch, metadata: { company: row.company_name, outcome: row.outcome } });
  const pr = await ctx.db(`reports?id=eq.${id}&${plan.filter}&select=id`, { method: 'PATCH', body: JSON.stringify(plan.patch) });
  if (!pr.ok) {
    if (auditId) await dropAuditRows(ctx.db, [auditId]);
    throw upstream(`update failed (${pr.status})`);
  }
  const changed = ((await pr.json().catch(() => [])) || []).length;
  if (!changed) {
    if (auditId) await dropAuditRows(ctx.db, [auditId]);
    throw conflict('It changed while you were looking — reload the list and try again.');
  }
  let recomputed = false;
  if (company) {
    const q = await enqueueCompanies(ctx.db, [company]);
    const d = await recomputeNow(ctx.db, svcHeaders(ctx), [company], { mode: q.mode, deadline: Date.now() + 6000 });
    recomputed = d.done > 0;
  }
  const next = { ...row, ...plan.patch };
  return ok(ctx.res, {
    changed, message: plan.message, recomputed,
    undo: undoOffer(auditId),
    touched: ['reports', 'held', 'overview', 'activity', ...(company ? [`company:${company}`] : [])],
    rows: [{ id, ...reportState(next) }],
    ...reportState(next),
  });
}

// ── duplicate report copies ──────────────────────────────────────────────────────────────────────
const REPORT_DUPE_SELECT = 'id,company_name,outcome,platform,role,report_text,created_at,trust_reason,needs_review,outcome_weight';
export const REPORT_DUPE_SCAN_BUDGET_MS = 20_000;
export const REPORT_DUPE_BUDGET_MS = 40_000;

export async function reportDupes(ctx) {
  const marking = ctx.action === 'dedupe_reports';
  if (marking) adminOnly(ctx);
  const t0 = Date.now();
  const all = await readAll(ctx.db, 'reports', { select: REPORT_DUPE_SELECT, max: 200_000, deadline: t0 + REPORT_DUPE_SCAN_BUDGET_MS });
  if (all.timedOut) throw new AdminError(504, `scan did not finish in time (${all.rows.length} reports read) — nothing was changed`, { code: 'timeout', retryable: true, changed: 0 });
  if (!all.ok) throw new AdminError(500, `reports scan failed (HTTP ${all.status ?? 0}) — nothing was changed`, { code: 'upstream', retryable: true, changed: 0 });
  const { dupes, groups } = findDuplicateReports(all.rows);
  const byCompany = {};
  for (const d of dupes) { const c = d.company || '(no company)'; byCompany[c] = (byCompany[c] || 0) + 1; }
  const companyRows = Object.entries(byCompany).sort((a, b) => b[1] - a[1]).map(([company, count]) => ({ company, count }));
  if (!marking) {
    return list(ctx.res, companyRows, { total: all.rows.length, groups, suspected: dupes.length, by_company: byCompany, message: dupes.length ? `${plural(dupes.length, 'duplicate copy', 'duplicate copies')} in ${plural(groups, 'group')}.` : 'No duplicate copies.' });
  }
  const byId = new Map(all.rows.map((r) => [String(r.id), r]));
  const marked = [];
  let error = null;
  for (let i = 0; i < dupes.length && Date.now() - t0 < REPORT_DUPE_BUDGET_MS; i += 40) {
    const batch = dupes.slice(i, i + 40).filter((d) => isUuid(d.id));
    if (!batch.length) continue;
    const auditIn = batch.map((d) => {
      const r = byId.get(d.id) || {};
      return auditRow(ctx.sess, 'mark_duplicate_report', { kind: 'report', id: d.id }, { prior: { needs_review: r.needs_review, trust_reason: r.trust_reason ?? null, outcome_weight: r.outcome_weight ?? null }, next: DUPLICATE_PATCH, metadata: { company: r.company_name, duplicate_of: d.keep } });
    });
    let audited;
    try { audited = await auditMany(ctx.db, auditIn); } catch (e) { error = e.message; break; }
    const w = await patchByIds(ctx.db, 'reports', batch.map((d) => d.id), DUPLICATE_PATCH, { filter: `or=(trust_reason.is.null,trust_reason.neq.${DUPLICATE_TRUST_REASON})` });
    const got = new Set(w.changed);
    const drop = audited.filter((a) => !got.has(String(a.target_id))).map((a) => a.id);
    if (drop.length) await dropAuditRows(ctx.db, drop);
    for (const d of batch) if (got.has(d.id)) marked.push(d);
    if (!w.ok) { error = `update failed (HTTP ${w.status}) after ${marked.length} report(s)`; break; }
  }
  const companies = [...new Set(marked.map((d) => companyKey(d.company)).filter(Boolean))];
  let recomputed = 0;
  if (companies.length) {
    const q = await enqueueCompanies(ctx.db, companies);
    const dr = await recomputeNow(ctx.db, svcHeaders(ctx), companies, { mode: q.mode, deadline: Math.min(Date.now() + 8000, ctx.deadline - 5000) });
    recomputed = dr.done;
  }
  const remaining = Math.max(0, dupes.length - marked.length);
  if (error) throw new AdminError(500, 'Failed to mark duplicate reports', { code: 'upstream', retryable: true, detail: error, marked: marked.length, changed: marked.length, remaining });
  return ok(ctx.res, {
    changed: marked.length, remaining, complete: remaining === 0,
    message: marked.length ? `Marked ${plural(marked.length, 'duplicate copy', 'duplicate copies')} (kept, hidden, never scored)${remaining ? ` · ${fmt(remaining)} left` : ''}.` : 'No duplicate copies left to mark.',
    touched: ['report_dupes', 'reports', 'held', 'overview', 'activity'],
    marked: marked.length, groups, companies: companies.length, recomputed, by_company: byCompany, ms: Date.now() - t0,
  });
}

// ── 30-day report stats (the chart / top companies / outcome mix) ────────────────────────────────
// The old dashboard asked for 2,000 rows ascending and PostgREST returned the OLDEST 1,000 — the last week
// read 0 while prod had 122. Here: the RPC counts in SQL, or every row of the window is read by keyset.
export function outcomeBucket(o) {
  if (o === 'ghosted') return 'ghosted';
  if (o === 'rejected' || o === 'autoreject') return 'rejected';
  if (o === 'interview' || o === 'human') return 'interview';
  if (o === 'offer' || o === 'hired') return 'offer';
  return 'waiting';
}

export async function reportsStats30(db, now = new Date()) {
  const chartDays = [];
  for (let i = 29; i >= 0; i--) chartDays.push(pacificDate(pacificDayStart(now, -i)));
  const since = pacificDayStart(now, -29).toISOString();
  const all = await readAll(db, 'reports', { select: 'id,created_at,company_name,outcome', filter: `created_at=gte.${encodeURIComponent(since)}`, max: 200_000, deadline: Date.now() + 20_000 });
  if (!all.ok) return { ok: false, source: 'rest' };
  const chartMap = {}, companyMap = {};
  const mix = { ghosted: 0, rejected: 0, interview: 0, offer: 0, waiting: 0 };
  for (const r of all.rows) {
    const d = r.created_at ? pacificDate(new Date(r.created_at)) : null;
    if (d) chartMap[d] = (chartMap[d] || 0) + 1;
    if (r.company_name) companyMap[r.company_name] = (companyMap[r.company_name] || 0) + 1;
    mix[outcomeBucket(r.outcome)]++;
  }
  return {
    ok: true, source: 'rest', total: all.rows.length,
    by_day: chartDays.map((date) => ({ date, count: chartMap[date] || 0 })),
    top_companies: Object.entries(companyMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([company, count]) => ({ company, count })),
    outcome_mix: mix,
  };
}

export async function reportsStats(ctx) {
  const s = await reportsStats30(ctx.db);
  if (!s.ok) throw upstream('Could not read the last 30 days of reports.');
  return ok(ctx.res, { message: `${plural(s.total, 'report')} in the last 30 days.`, rows: [{ total: s.total, by_day: s.by_day, top_companies: s.top_companies, outcome_mix: s.outcome_mix, source: s.source }] });
}

export const actions = {
  list_held_reports: listHeld,
  review_held: reviewHeld,
  review_reports: reviewReportsLegacy,
  recompute_queue_drain: recomputeDrain,
  reports_recent: reportsRecent,
  report_detail: reportDetail,
  reports_stats: reportsStats,
  moderate_report: moderateReport,
  approve_report: moderateReport,
  investigate_report: moderateReport,
  deny_hiring_report: moderateReport,
  scan_report_dupes: reportDupes,
  dedupe_reports: reportDupes,
};
