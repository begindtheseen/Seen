// Listings: tickets (seeker reports ⋃ employer disputes), take-downs, the job manager (browse / detail / edit
// / restore), Clear stale, duplicate listings, the aggregation target and the counts.

import { ok, list, plural, fmt, undoOffer, logSafe, AdminError } from './respond.js';
import { adminOnly, svcHeaders, bad, notFound, upstream, conflict, str } from './context.js';
import { isUuid, rows, readByIds, deleteByIds, readAll, countExact, countsByStatus, rpc, chunk, encodeCursor, decodeCursor, treeValue } from './batch.js';
import { audit, dropAuditRows } from './audit.js';
import { enqueueCompanies, recomputeNow } from './recompute.js';
import { fetchAdminJobsCounts } from '../adminJobsCounts.js';
import { runStaleSweep, STALE_CLEARABLE_FILTER, STALE_KEPT_FILTER } from '../staleSweep.js';
import { planJobDedupe, describeGroups } from '../jobDedupe.js';
import { isDisputeDecision, resolveDisputeEffect, orderDisputesOpenFirst as orderListingDisputes, buildListingTickets } from '../listingDisputes.js';
import { buildNotificationRow } from '../employerNotificationsStore.js';
import { normalizeClaimCompany } from '../employerClaims.js';
import { browsePath as browseJobsPath, nextCursor as nextJobsCursor, validatePatch as validateJobPatch, restorePatch as jobRestorePatch, isJobId, HOLDERS as JOB_HOLDERS } from '../jobAdmin.js';
import { normalizeCompany } from '../../../api/_utils/reportWrite.js';
import { pacificDayStart } from '../../time/pacific.js';
import { eqValue } from '../pgrest.js';
import { logError } from '../errlog.js';

export const PURGE_BUDGET_MS = 40_000;
export const PURGE_BATCH = 500;
export const DEDUPE_SCAN_BUDGET_MS = 25_000;
export const DEDUPE_BUDGET_MS = 40_000;
// Tests shorten the scan budget to exercise the resumable path quickly.
export const TUNING = { scanBudgetMs: DEDUPE_SCAN_BUDGET_MS };
const RPC_PAGE = 2000;
const DEDUPE_SELECT = 'id,title,company,location,apply_url,source,external_id,is_employer_posted,availability_status,expires_at,last_seen_at,created_at';
const LISTING_TOUCH = ['tickets', 'listings', 'listing_counts', 'overview', 'activity'];

// ── tickets ──────────────────────────────────────────────────────────────────────────────────────
/** Every listing ticket of the last 30 days. The overview's "Listing tickets" count uses this same read. */
export async function loadTickets(db) {
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  // Every row of both (keyset pages): a capped page would undercount tickets past 1,000.
  const [rep, disp] = await Promise.all([
    readAll(db, 'job_availability_reports', { select: 'id,job_id,status,reported_at,company,title,city,apply_url', filter: `reported_at=gte.${encodeURIComponent(monthAgo)}`, max: 50000 }),
    readAll(db, 'listing_disputes', { select: 'id,job_id,company_name,employer_user_id,kind,reason,detail,proposed_changes,status,created_at,reviewed_at,reviewed_by,admin_note', max: 50000 }),
  ]);
  if (!rep.ok || !disp.ok || rep.truncated || disp.truncated) return { ok: false };
  const disputes = disp.rows;
  const reports = rep.rows;
  const jobIds = [...new Set([...reports, ...disputes].map((x) => x.job_id).filter(Boolean))];
  const uuidIds = jobIds.filter(isUuid);
  const jr = uuidIds.length ? await readByIds(db, 'jobs', uuidIds, { select: 'id,title,company,city,apply_url,availability_status' }) : { rows: [] };
  const jobsById = Object.fromEntries(jr.rows.map((j) => [j.id, j]));
  const applyUrls = [...new Set([...Object.values(jobsById).map((j) => j.apply_url), ...reports.map((r) => r.apply_url)].filter(Boolean))];
  const suppressedByUrl = {};
  // URLs are long: 20 per read keeps each request small (the old single in-list of 400 URLs overflowed).
  for (const part of chunk(applyUrls, 20)) {
    const inList = part.map((u) => `"${String(u).replace(/["\\]/g, '')}"`).join(',');
    const sr = await db(`suppressed_listings?apply_url=in.(${encodeURIComponent(inList)})&select=apply_url,reason,created_at&limit=100`);
    for (const s of (await rows(sr)) || []) suppressedByUrl[s.apply_url] = { reason: s.reason, created_at: s.created_at };
  }
  const tickets = buildListingTickets({ reports, disputes, jobsById, suppressedByUrl });
  return { ok: true, tickets, counts: { open: tickets.filter((t) => t.status === 'open').length, resolved: tickets.filter((t) => t.status === 'resolved').length } };
}

async function listTickets(ctx) {
  const t = await loadTickets(ctx.db);
  if (!t.ok) throw upstream('Could not read the listing tickets.');
  const status = ['open', 'resolved'].includes(ctx.body.status) ? ctx.body.status : null;
  const shown = status ? t.tickets.filter((x) => x.status === status) : t.tickets;
  return list(ctx.res, shown, { counts: t.counts, total: shown.length, tickets: t.tickets, as_of: new Date().toISOString() });
}

async function listListingDisputes(ctx) {
  const filterStatus = ['open', 'approved', 'denied'].includes(ctx.body.status) ? ctx.body.status : null;
  const counts = await countsByStatus(ctx.db, 'listing_disputes', ['open', 'approved', 'denied']);
  const where = filterStatus ? `status=eq.${filterStatus}&` : '';
  const got = await rows(await ctx.db(`listing_disputes?${where}select=id,job_id,company_name,company_key,employer_user_id,kind,reason,detail,proposed_changes,status,created_at,reviewed_at,reviewed_by,admin_note&order=created_at.desc&limit=200`));
  if (!Array.isArray(got)) throw upstream('Could not read the listing disputes.');
  const disputes = filterStatus ? got : orderListingDisputes(got);
  return list(ctx.res, disputes, { disputes, counts, filter: filterStatus });
}

// The take-down recipe (delete_listing, an approved takedown dispute): expire the row (search filters on
// expires_at, never availability_status), block its apply link, clear its seeker reports. Returns what it did
// plus the prior values for undo.
async function takeDown(ctx, jid, reason) {
  const out = { soft_deleted: false, suppressed: false, reports_cleared: 0, prior: null, company: null, apply_url: null, reports: [] };
  const rep = await readAll(ctx.db, 'job_availability_reports', { select: '*', filter: `job_id=eq.${eqValue(jid)}`, max: 20000 });
  out.reports = rep.rows;
  if (isUuid(jid)) {
    const jobRow = ((await rows(await ctx.db(`jobs?id=eq.${jid}&select=apply_url,title,company,availability_status,expires_at,last_checked_at&limit=1`))) || [])[0] || null;
    if (jobRow) {
      out.prior = { availability_status: jobRow.availability_status, expires_at: jobRow.expires_at, last_checked_at: jobRow.last_checked_at };
      const now = new Date().toISOString();
      const up = await ctx.db(`jobs?id=eq.${jid}&select=id`, { method: 'PATCH', body: JSON.stringify({ availability_status: 'expired', expires_at: now, last_checked_at: now }) });
      out.soft_deleted = !!(up.ok && ((await up.json().catch(() => [])) || []).length);
      if (!up.ok) throw upstream(`Could not take the listing down (HTTP ${up.status}).`);
      out.company = jobRow.company || null;
      out.apply_url = jobRow.apply_url || null;
      if (jobRow.apply_url) {
        const ins = await ctx.db('suppressed_listings?on_conflict=apply_url', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ apply_url: jobRow.apply_url, stable_job_id: jid, title: jobRow.title || null, company: jobRow.company || null, reason }) });
        out.suppressed = ins.ok;
      }
    }
  } else {
    const snap = out.reports.find((r) => r.apply_url) || null;
    if (snap?.apply_url) {
      const ins = await ctx.db('suppressed_listings?on_conflict=apply_url', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ apply_url: snap.apply_url, stable_job_id: jid, title: snap.title || null, company: snap.company || null, reason }) });
      out.suppressed = ins.ok;
      out.company = snap.company || null;
      out.apply_url = snap.apply_url;
    }
  }
  const del = await ctx.db(`job_availability_reports?job_id=eq.${eqValue(jid)}&select=id`, { method: 'DELETE' });
  out.reports_cleared = del.ok ? ((await del.json().catch(() => [])) || []).length : 0;
  return out;
}

async function deleteListing(ctx) {
  adminOnly(ctx);
  const jid = str(ctx.body.job_id, 200);
  if (!jid) throw bad('job_id required');
  // Audit first (with what the take-down will need to be undone): no audit, no take-down.
  const auditId = await audit(ctx.db, ctx.sess, 'delete_listing', { kind: 'job', id: jid }, { metadata: { pending: true } });
  let t;
  try { t = await takeDown(ctx, jid, 'admin_removed'); }
  catch (e) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw e; }
  if (auditId) {
    await ctx.db(`admin_audit_log?id=eq.${auditId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata: { soft_deleted: t.soft_deleted, suppressed: t.suppressed, prior: t.prior, apply_url: t.apply_url, reports: t.reports.slice(0, 500), reports_cleared: t.reports_cleared } }) });
  }
  if (t.suppressed && t.company) {
    const c = normalizeCompany(t.company);
    const q = await enqueueCompanies(ctx.db, [c]);
    await recomputeNow(ctx.db, svcHeaders(ctx), [c], { mode: q.mode, deadline: Date.now() + 6000 });
  }
  const changed = t.soft_deleted || t.suppressed || t.reports_cleared ? 1 : 0;
  const bits = [t.soft_deleted ? 'expired' : null, t.suppressed ? 'apply link blocked' : null, t.reports_cleared ? `${plural(t.reports_cleared, 'report')} cleared` : null].filter(Boolean);
  return ok(ctx.res, {
    changed, message: changed ? `Taken down: ${bits.join(', ')}.` : 'Nothing to take down — no listing or reports with that id.',
    undo: changed ? undoOffer(auditId) : undefined,
    touched: [...LISTING_TOUCH, `job:${jid}`],
    soft_deleted: t.soft_deleted, suppressed: t.suppressed, reports_cleared: t.reports_cleared,
  });
}

async function dismissInactiveReport(ctx) {
  adminOnly(ctx);
  const jid = str(ctx.body.job_id, 200);
  if (!jid) throw bad('job_id required');
  const all = await readAll(ctx.db, 'job_availability_reports', { select: '*', filter: `job_id=eq.${eqValue(jid)}`, max: 20000 });
  if (!all.ok) throw upstream('Could not read the reports for that listing.');
  const snap = all.rows;
  if (!snap.length) return ok(ctx.res, { changed: 0, message: 'No reports left for that listing.', touched: ['tickets'] });
  const auditId = await audit(ctx.db, ctx.sess, 'dismiss_inactive_report', { kind: 'job', id: jid }, { prior: { reports: snap } });
  const del = await ctx.db(`job_availability_reports?job_id=eq.${eqValue(jid)}&select=id`, { method: 'DELETE' });
  if (!del.ok) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw upstream(`Could not clear the reports (HTTP ${del.status}).`); }
  const changed = ((await del.json().catch(() => [])) || []).length;
  return ok(ctx.res, { changed, message: `Kept the listing · cleared ${plural(changed, 'report')}.`, undo: changed ? undoOffer(auditId) : undefined, touched: ['tickets', 'overview', 'activity', `job:${jid}`] });
}

async function resolveListingDispute(ctx) {
  adminOnly(ctx);
  const idNum = Number(ctx.body.id);
  if (!Number.isInteger(idNum) || idNum <= 0) throw bad('A valid dispute id is required');
  if (!isDisputeDecision(ctx.body.decision)) throw bad('decision must be approved or denied');
  const note = ctx.body.note != null ? String(ctx.body.note).slice(0, 500) : null;
  const decision = ctx.body.decision;
  const dispute = ((await rows(await ctx.db(`listing_disputes?id=eq.${idNum}&select=id,job_id,company_name,company_key,employer_user_id,kind,proposed_changes,status&limit=1`))) || [])[0];
  if (!dispute) throw notFound('Dispute not found');
  if (dispute.status !== 'open') throw conflict('This dispute was already resolved');
  // Claim the dispute first (conditional on still open) so two presses cannot both apply the effect.
  const claim = await ctx.db(`listing_disputes?id=eq.${idNum}&status=eq.open&select=id`, { method: 'PATCH', body: JSON.stringify({ status: decision, reviewed_at: new Date().toISOString(), reviewed_by: ctx.sess.username, admin_note: note }) });
  if (!claim.ok) throw upstream(`Could not update the dispute (HTTP ${claim.status}).`);
  if (!((await claim.json().catch(() => [])) || []).length) throw conflict('This dispute was already resolved');
  const applied = { takedown: false, edited: false, suppressed: false, reportsCleared: false };
  const jid = String(dispute.job_id || '');
  let auditId = null;
  let t = null;
  if (decision === 'approved') {
    const effect = resolveDisputeEffect(dispute);
    if (effect.takedown && isUuid(jid)) {
      t = await takeDown(ctx, jid, 'employer_dispute');
      applied.takedown = t.soft_deleted; applied.suppressed = t.suppressed; applied.reportsCleared = t.reports_cleared > 0;
      if (t.company) { const c = normalizeCompany(t.company); const q = await enqueueCompanies(ctx.db, [c]); await recomputeNow(ctx.db, svcHeaders(ctx), [c], { mode: q.mode, deadline: Date.now() + 5000 }); }
    } else if (effect.edit && effect.patch && isUuid(jid)) {
      const up = await ctx.db(`jobs?id=eq.${jid}&select=id`, { method: 'PATCH', body: JSON.stringify({ ...effect.patch, last_checked_at: new Date().toISOString() }) });
      applied.edited = !!(up.ok && ((await up.json().catch(() => [])) || []).length);
    } else if (effect.clearReports) {
      const del = await ctx.db(`job_availability_reports?job_id=eq.${eqValue(jid)}&select=id`, { method: 'DELETE' });
      applied.reportsCleared = del.ok;
      if (isUuid(jid)) await ctx.db(`jobs?id=eq.${jid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ availability_status: 'active', last_checked_at: new Date().toISOString(), availability_report_count: 0 }) });
    }
  }
  try {
    const kindN = decision === 'approved' ? 'dispute_approved' : 'dispute_denied';
    const notif = buildNotificationRow(kindN, {
      companyName: dispute.company_name, companyKey: dispute.company_key || normalizeClaimCompany(dispute.company_name),
      employerUserId: dispute.employer_user_id, jobId: dispute.job_id,
      title: decision === 'approved' ? `Dispute #${idNum} approved` : `Dispute #${idNum} reviewed`,
      body: decision === 'approved'
        ? `An admin approved your ${dispute.kind} dispute (#${idNum}).${applied.reportsCleared ? ' The inactive reports were cleared and your listing is active again.' : ''}${note ? ` Note: ${note}` : ''}`
        : `An admin reviewed your ${dispute.kind} dispute (#${idNum}) and did not approve it.${note ? ` Note: ${note}` : ''}`,
      meta: { dispute_id: idNum, decision },
    });
    if (notif) await ctx.db('employer_notifications', { method: 'POST', body: JSON.stringify(notif), headers: { Prefer: 'return=minimal' } });
  } catch (e) { console.error('[admin] dispute notify failed (non-fatal): %s', logSafe(e?.message || e)); }
  auditId = await audit(ctx.db, ctx.sess, 'resolve_listing_dispute', { kind: 'dispute', id: idNum }, {
    prior: { status: 'open', job: t?.prior || null, reports: t?.reports?.slice(0, 500) || null },
    metadata: { decision, kind: dispute.kind, job_id: jid, apply_url: t?.apply_url || null, ...applied },
  }, { required: false });
  return ok(ctx.res, {
    changed: 1, decision, applied,
    message: decision === 'approved'
      ? `Dispute #${idNum} approved${applied.takedown ? ' — listing taken down' : applied.edited ? ' — listing edited' : applied.reportsCleared ? ' — seeker reports cleared' : ''}.`
      : `Dispute #${idNum} denied.`,
    undo: applied.takedown ? undoOffer(auditId) : undefined,
    touched: [...LISTING_TOUCH, ...(jid ? [`job:${jid}`] : [])],
  });
}

// ── legacy listing actions (kept for /admin/legacy; not used by the new UI) ─────────────────────
async function removeListing(ctx) {
  adminOnly(ctx);
  const job_id = str(ctx.body.job_id, 200);
  if (!job_id) throw bad('job_id required');
  const removedAt = new Date().toISOString();
  const patch = await ctx.db(`jobs?id=eq.${eqValue(job_id)}`, { method: 'PATCH', body: JSON.stringify({ availability_status: 'expired', expires_at: removedAt, last_checked_at: removedAt }), headers: { Prefer: 'return=minimal' } });
  if (!patch.ok) {
    console.error('[admin] remove_listing failed: %s', logSafe(patch.status));
    return ctx.res.status(502).json({ ok: false, error: 'Could not remove listing', code: 'upstream', retryable: true, status: patch.status });
  }
  await ctx.db(`job_availability_reports?job_id=eq.${eqValue(job_id)}&status=eq.expired`, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed_expired' }), headers: { Prefer: 'return=minimal' } });
  await audit(ctx.db, ctx.sess, 'remove_listing', { kind: 'job', id: job_id }, {}, { required: false });
  return ok(ctx.res, { changed: 1, message: 'Listing removed.', touched: LISTING_TOUCH });
}

async function denyReport(ctx) {
  const job_id = str(ctx.body.job_id, 200);
  if (!job_id) throw bad('job_id required');
  let changed = 0;
  if (isUuid(job_id)) {
    const up = await ctx.db(`jobs?id=eq.${job_id}&select=id`, { method: 'PATCH', body: JSON.stringify({ availability_status: 'active', last_checked_at: new Date().toISOString() }) });
    if (!up.ok) throw upstream(`Could not update the listing (HTTP ${up.status}).`);
    changed = ((await up.json().catch(() => [])) || []).length;
  }
  await ctx.db(`job_availability_reports?job_id=eq.${eqValue(job_id)}&status=eq.expired`, { method: 'PATCH', body: JSON.stringify({ status: 'denied' }), headers: { Prefer: 'return=minimal' } });
  await audit(ctx.db, ctx.sess, 'deny_report', { kind: 'job', id: job_id }, {}, { required: false });
  return ok(ctx.res, { changed, message: changed ? 'Listing marked active.' : 'No listing row with that id.', touched: LISTING_TOUCH });
}

async function getRecentJobs(ctx) {
  const period = ctx.body.period;
  const cutoff = period === 'today' ? pacificDayStart(new Date()).toISOString() : new Date(Date.now() - (period === 'month' ? 30 : 7) * 86400000).toISOString();
  const r = await ctx.db(`jobs?created_at=gte.${encodeURIComponent(cutoff)}&select=id,company,title,city,apply_url,created_at,availability_status,source&order=created_at.desc&limit=200`);
  const jobs = await rows(r);
  if (!Array.isArray(jobs)) throw upstream('Query failed');
  return list(ctx.res, jobs, { jobs, total: jobs.length, period });
}

async function emergencyJobRefresh(ctx) {
  adminOnly(ctx);
  // The refresh endpoint is called on a server-controlled origin, never one built from request headers
  // (x-forwarded-host is client-influenced: that would be a request-forgery path).
  const origin = process.env.VERCEL_URL ? `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, '')}` : 'https://seenjobs.io';
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.CRON_SECRET) headers.Authorization = `Bearer ${process.env.CRON_SECRET}`;
  else headers['X-Admin-Token'] = ctx.sess.token;
  let data = {};
  try {
    const r = await fetch(`${origin}/api/refresh-jobs?all=1`, { method: 'POST', headers, body: '{}' });
    data = await r.json().catch(() => ({}));
    if (!r.ok) throw upstream(data.error || `Refresh failed (${r.status})`);
  } catch (e) { if (e instanceof AdminError) throw e; throw upstream('Refresh request failed'); }
  await audit(ctx.db, ctx.sess, 'emergency_job_refresh', { kind: 'system', id: 'jobs' }, { metadata: { upserted: data.upserted ?? null, found: data.found ?? null } }, { required: false });
  const added = data.upserted ?? data.inserted ?? data.found ?? null;
  return ok(ctx.res, { changed: Number(added) || 0, message: `Refresh ran${added != null ? ` · ${fmt(added)} listings` : ''}.`, touched: ['listing_counts', 'listings', 'overview'], added, result: data });
}

// ── job manager ──────────────────────────────────────────────────────────────────────────────────
async function jobsBrowse(ctx) {
  const b = browseJobsPath(ctx.body.filters || {}, Date.now(), { todayStart: pacificDayStart(new Date()) });
  if (b.error) throw bad(b.error);
  const r = await ctx.db(b.path, { headers: { Prefer: 'count=exact' } });
  if (!r.ok) throw upstream('Could not read listings', { status: r.status });
  const jobs = await r.json().catch(() => []);
  const total = Number.parseInt(String(r.headers.get('content-range') || '').split('/')[1], 10);
  // Seen Command reads `jobs` and the object cursor `next`; the new UI uses `listings_browse`.
  return ctx.res.status(200).json({ ok: true, rows: jobs, jobs, total: Number.isFinite(total) ? total : null, next: nextJobsCursor(jobs, b), sort: b.sort });
}

/** The same browse with a string cursor (AdminList): pass `after` = the previous `next`. */
async function listingsBrowse(ctx) {
  const filters = { ...(ctx.body.filters || {}) };
  if (ctx.body.after) { try { filters.cursor = JSON.parse(decodeCursor(String(ctx.body.after)) || 'null'); } catch { filters.cursor = null; } }
  const b = browseJobsPath(filters, Date.now(), { todayStart: pacificDayStart(new Date()) });
  if (b.error) throw bad(b.error);
  const r = await ctx.db(b.path, { headers: { Prefer: 'count=exact' } });
  if (!r.ok) throw upstream(`Could not read listings (HTTP ${r.status}).`);
  const jobs = await r.json().catch(() => []);
  const total = Number.parseInt(String(r.headers.get('content-range') || '').split('/')[1], 10);
  const n = nextJobsCursor(jobs, b);
  return list(ctx.res, jobs, { next: n ? encodeCursor(JSON.stringify(n)) : undefined, total: Number.isFinite(total) ? total : null, as_of: new Date().toISOString(), sort: b.sort });
}

async function jobDetail(ctx) {
  const id = String(ctx.body.job_id || '');
  if (!isJobId(id)) throw bad('job_id must be a listing id');
  const r = await ctx.db(`jobs?id=eq.${id}&select=*&limit=1`);
  if (!r.ok) throw upstream('Could not read the listing', { status: r.status });
  const job = (await r.json().catch(() => []))[0];
  if (!job) throw notFound('No listing with that id');
  const count = (p) => ctx.db(p, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } })
    .then((x) => (x.ok ? Number.parseInt(String(x.headers.get('content-range') || '').split('/')[1], 10) || 0 : null));
  const [holderCounts, auditRes, suppRes] = await Promise.all([
    Promise.all(JOB_HOLDERS.map(([t, col, label]) => count(`${t}?${col}=eq.${id}&select=${col}`).then((n) => ({ table: t, label, count: n })))),
    ctx.db(`admin_audit_log?target_type=eq.job&target_id=eq.${id}&select=id,action,username,created_at,metadata&order=created_at.desc&limit=20`),
    job.apply_url ? ctx.db(`suppressed_listings?apply_url=eq.${encodeURIComponent(job.apply_url)}&select=reason,created_at&limit=1`) : Promise.resolve(null),
  ]);
  const history = auditRes.ok ? await auditRes.json().catch(() => null) : null; // null = could not be read
  const suppressed = suppRes && suppRes.ok ? (await suppRes.json().catch(() => []))[0] || null : null;
  const detail = { job, holders: holderCounts, history, suppressed, on_site: !!job.expires_at && new Date(job.expires_at) > new Date() };
  return ok(ctx.res, { message: 'Loaded the listing.', rows: [detail], ...detail });
}

async function jobEdit(ctx) {
  adminOnly(ctx);
  const id = String(ctx.body.job_id || '');
  if (!isJobId(id)) throw bad('job_id must be a listing id');
  const { patch, errors } = validateJobPatch(ctx.body.patch || {});
  if (errors.length) throw new AdminError(400, errors.join('; '), { code: 'bad_request', errors });
  const keys = Object.keys(patch);
  if (!keys.length) throw bad('nothing to change');
  const prior = ((await rows(await ctx.db(`jobs?id=eq.${id}&select=${keys.join(',')}&limit=1`))) || [])[0];
  if (!prior) throw notFound('No listing with that id');
  const auditId = await audit(ctx.db, ctx.sess, 'job_update', { kind: 'job', id }, { metadata: { prior, patch } });
  const up = await ctx.db(`jobs?id=eq.${id}&select=*`, { method: 'PATCH', body: JSON.stringify({ ...patch, edited_at: new Date().toISOString() }) });
  if (!up.ok) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw upstream('The database refused the change', { status: up.status }); }
  const job = (await up.json().catch(() => []))[0] || null;
  const base = { message: `Saved ${plural(keys.length, 'field')}.`, undo: undoOffer(auditId), touched: ['listings', `job:${id}`, 'activity'], rows: job ? [job] : [], job };
  // job_update (Seen Command) keeps `changed` = the list of fields; job_edit answers the contract.
  if (ctx.action === 'job_update') return ctx.res.status(200).json({ ok: true, skipped: [], ...base, changed: keys });
  return ok(ctx.res, { ...base, changed: job ? 1 : 0, fields: keys });
}

async function jobRestore(ctx) {
  adminOnly(ctx);
  const id = String(ctx.body.job_id || '');
  if (!isJobId(id)) throw bad('job_id must be a listing id');
  const prior = ((await rows(await ctx.db(`jobs?id=eq.${id}&select=availability_status,expires_at,last_checked_at,apply_url&limit=1`))) || [])[0];
  if (!prior) throw notFound('No listing with that id');
  const up = await ctx.db(`jobs?id=eq.${id}&select=*`, { method: 'PATCH', body: JSON.stringify(jobRestorePatch()) });
  if (!up.ok) throw upstream('The database refused the change', { status: up.status });
  let unsuppressed = null;
  if (prior.apply_url) {
    const sr = await ctx.db(`suppressed_listings?apply_url=eq.${encodeURIComponent(prior.apply_url)}`, { method: 'DELETE' });
    unsuppressed = sr.ok ? (await sr.json().catch(() => [])) : null;
  }
  const job = (await up.json().catch(() => []))[0] || null;
  await audit(ctx.db, ctx.sess, 'job_restore', { kind: 'job', id }, { metadata: { prior, unsuppressed } }, { required: false });
  return ok(ctx.res, { changed: job ? 1 : 0, message: 'Back on the site for 14 days.', touched: [...LISTING_TOUCH, `job:${id}`], rows: job ? [job] : [], job });
}

// ── counts / Clear stale ──────────────────────────────────────────────────────────────────────────
export async function jobsCounts(ctx, ms = 7000) {
  const todayISO = pacificDayStart(new Date()).toISOString();
  const p = fetchAdminJobsCounts({ supabaseUrl: ctx.url, serviceKey: ctx.key, db: ctx.db, todayISO, overdueISO: new Date(Date.now() - 15 * 86_400_000).toISOString() });
  const timeout = new Promise((r) => setTimeout(() => r(null), ms).unref?.());
  const c = await Promise.race([p, timeout]).catch(() => null);
  return c;
}

async function listingCounts(ctx) {
  const c = await jobsCounts(ctx, 20000);
  const fields = ['total', 'active', 'added_today', 'stale_or_expired', 'stale_clearable', 'expired_kept', 'stale_overdue'];
  const counts = {};
  const failed = [];
  for (const f of fields) { const v = c ? c[f] : null; counts[f] = Number.isFinite(Number(v)) && v != null ? Number(v) : null; if (counts[f] == null) failed.push(f); }
  counts.source = c?.source || null;
  // What Clear stale will delete and keep (separately, exact): the confirm and the "kept" tile read this, never
  // `expired_kept` (which counts every hidden expired row, kept or about to be deleted).
  const plan = await clearPlan(ctx.db);
  if (!plan) failed.push('clear_plan');
  return ok(ctx.res, { message: failed.length ? `Some counts could not be read: ${failed.join(', ')}.` : `${fmt(counts.active)} listings live.`, counts, clear_plan: plan, failed });
}

// What "Clear stale" (sweep_stale_jobs mode 'all', migration 20260929120000) will delete and keep, each from its own
// exact read: active aggregated rows unseen 7 days (aged to stale in the same sweep), stale rows, and expired rows —
// every one not employer-posted and no longer serving — minus the ones a saved_jobs / applications row references,
// which are KEPT as hidden 'expired' rows. Same reference set as the SQL (saved_jobs + applications job ids).
export async function clearPlan(db) {
  const now = encodeURIComponent(new Date().toISOString());
  const agedCut = encodeURIComponent(new Date(Date.now() - 7 * 86400e3).toISOString());
  const AGING = `availability_status=eq.active&is_employer_posted=eq.false&last_seen_at=lt.${agedCut}`;
  const STALE = `availability_status=eq.stale&is_employer_posted=eq.false&expires_at=lte.${now}`;
  const EXPIRED = `availability_status=eq.expired&is_employer_posted=eq.false&expires_at=lte.${now}`;
  const [aging, stale, expired, saved, apps] = await Promise.all([
    countExact(db, `jobs?select=id&${AGING}`), countExact(db, `jobs?select=id&${STALE}`), countExact(db, `jobs?select=id&${EXPIRED}`),
    readAll(db, 'saved_jobs', { select: 'id,job_id', filter: 'job_id=not.is.null', max: 500000 }),
    readAll(db, 'applications', { select: 'id,job_id', filter: 'job_id=not.is.null', max: 500000 }),
  ]);
  if (!saved.ok || !apps.ok || saved.truncated || apps.truncated) return null;
  const refIds = [...new Set([...saved.rows, ...apps.rows].map((r) => String(r.job_id || '').toLowerCase()).filter(isUuid))];
  const ref = refIds.length ? await readByIds(db, 'jobs', refIds, { select: 'id,availability_status,is_employer_posted,last_seen_at,expires_at' }) : { ok: true, rows: [] };
  if (!ref.ok) return null;
  const nowMs = Date.now(), agedMs = nowMs - 7 * 86400e3;
  let keptAging = 0, keptStale = 0, keptExpired = 0;
  for (const j of ref.rows) {
    if (j.is_employer_posted) continue;
    const off = j.expires_at && Date.parse(j.expires_at) <= nowMs;
    if (j.availability_status === 'active' && j.last_seen_at && Date.parse(j.last_seen_at) < agedMs) keptAging++;
    else if (j.availability_status === 'stale' && off) keptStale++;
    else if (j.availability_status === 'expired' && off) keptExpired++;
  }
  const sub = (a, b) => (a == null ? null : Math.max(0, a - b));
  const plan = {
    stale_delete: sub(stale, keptStale), expired_delete: sub(expired, keptExpired), aging_delete: sub(aging, keptAging),
    kept_referenced: keptStale + keptExpired + keptAging, expired_kept_referenced: keptExpired,
    stale_total: stale, expired_total: expired, aging_total: aging,
  };
  plan.will_delete = [plan.stale_delete, plan.expired_delete, plan.aging_delete].some((v) => v == null) ? null : plan.stale_delete + plan.expired_delete + plan.aging_delete;
  return plan;
}

async function purgeStale(ctx) {
  adminOnly(ctx);
  const sweep = await runStaleSweep({ url: ctx.url, key: ctx.key, mode: 'all', batch: PURGE_BATCH, deadline: Date.now() + PURGE_BUDGET_MS });
  if (!sweep.ok) {
    logError('admin-stats', 'purge_stale_jobs failed', { error: String(sweep.error || '').slice(0, 160) });
    const removedSoFar = (sweep.deleted || 0) + (sweep.retained || 0);
    throw new AdminError(500, 'Failed to clear stale listings', { code: 'upstream', retryable: true, detail: sweep.error, changed: removedSoFar, ...sweep });
  }
  const removed = sweep.deleted + sweep.retained;
  const [remaining, kept] = await Promise.all([countExact(ctx.db, `jobs?${STALE_CLEARABLE_FILTER}&select=id`), countExact(ctx.db, `jobs?${STALE_KEPT_FILTER}&select=id`)]);
  await audit(ctx.db, ctx.sess, 'purge_stale_jobs', { kind: 'system', id: 'jobs' }, { metadata: { removed, deleted: sweep.deleted, retained: sweep.retained, staled: sweep.staled, complete: sweep.complete, ms: sweep.ms } }, { required: false });
  const complete = sweep.complete && (remaining == null || remaining === 0 || sweep.complete);
  return ok(ctx.res, {
    // `changed` = rows DELETED (what clear_plan.will_delete predicted). Rows turned into kept 'expired' because
    // someone saved or tracked them are not cleared — they are reported as kept. (`removed` keeps its legacy sum.)
    changed: sweep.deleted, remaining: remaining ?? undefined, complete,
    message: `Cleared ${plural(sweep.deleted, 'listing')} that no longer serve (stale, or expired and nobody kept them)${remaining ? ` · ${fmt(remaining)} stale left` : ''}${sweep.retained ? ` · ${fmt(sweep.retained)} kept hidden because someone saved or tracked ${sweep.retained === 1 ? 'it' : 'them'}` : ''}.`,
    touched: ['listing_counts', 'listings', 'overview'],
    removed, deleted: sweep.deleted, retained: sweep.retained, staled: sweep.staled, kept, ms: sweep.ms,
  });
}

// ── duplicate listings ────────────────────────────────────────────────────────────────────────────
// Three ways to plan, best first:
//   1. admin_job_dupes_plan (SQL groups the database's own identity keys; migration 20261111100000);
//   2. a whole-table read by id when it fits in one request's budget (exact, as before);
//   3. otherwise a resumable scan in three passes (by company, by source id, by apply link), each
//      processing only COMPLETE partitions per request and handing back a cursor. Groups found within a
//      partition are a subset of the full groups and the keeper rule is a total order, so a pass never
//      deletes a row the full plan would keep — it can only miss a cross-partition duplicate.
async function loadReferencedJobIds(db) {
  const ids = new Set();
  for (const [table, col] of [['saved_jobs', 'job_id'], ['applications', 'job_id'], ['seen_applications', 'job_id']]) {
    for (let offset = 0; ; offset += 1000) {
      const r = await db(`${table}?select=${col}&${col}=not.is.null&order=${col}.asc&limit=1000&offset=${offset}`);
      if (!r.ok) return { ok: false, error: `could not read ${table} (HTTP ${r.status}) — nothing was deleted` };
      const page = await r.json().catch(() => null);
      if (!Array.isArray(page)) return { ok: false, error: `could not read ${table} — nothing was deleted` };
      for (const row of page) ids.add(String(row[col]));
      if (page.length < 1000) break;
    }
  }
  return { ok: true, ids };
}

const PASSES = [
  { name: 'company', col: 'company', filter: 'company=not.is.null' },
  { name: 'external', col: 'external_id', filter: 'external_id=not.is.null' },
  { name: 'apply_url', col: 'apply_url', filter: 'apply_url=not.is.null' },
];
const packState = (s) => encodeCursor(JSON.stringify(s));
function unpackState(c) {
  const raw = decodeCursor(c);
  if (!raw) return null;
  try { const s = JSON.parse(raw); return s && typeof s === 'object' ? s : null; } catch { return null; }
}

/** One partitioned round. Returns { state, rowsProcessed, plans: [{deleteIds, groups, protectedExtras}], done }. */
async function partitionRound(db, state, refs, deadline) {
  const plans = [];
  let processed = 0;
  // At least one page per round, so a slow request still moves forward.
  for (let first = true; (first || Date.now() < deadline) && state.pass < PASSES.length; first = false) {
    const p = PASSES[state.pass];
    let where = p.filter;
    if (state.after && state.after.v != null && isUuid(state.after.id)) {
      const sv = treeValue(state.after.v);
      where += `&and=(or(${p.col}.gt.${sv},and(${p.col}.eq.${sv},id.gt.${state.after.id})))`;
    }
    const r = await db(`jobs?select=${DEDUPE_SELECT}&${where}&order=${p.col}.asc,id.asc&limit=1000`);
    const page = await rows(r);
    if (!Array.isArray(page)) return { error: `jobs scan failed (HTTP ${r?.status ?? 0})` };
    if (!page.length) { state.pass++; state.after = null; continue; }
    let complete = page;
    let lastComplete = page[page.length - 1];
    if (page.length === 1000) {
      const lastV = page[page.length - 1][p.col];
      const cut = page.findIndex((x) => x[p.col] === lastV);
      if (cut > 0) { complete = page.slice(0, cut); lastComplete = complete[complete.length - 1]; }
      // One partition larger than a page: plan it on its own (still a subset of its full group).
    }
    const plan = planJobDedupe(complete, refs);
    plans.push(plan);
    processed += complete.length;
    state.after = { v: lastComplete[p.col], id: lastComplete.id };
    if (page.length < 1000) { state.pass++; state.after = null; }
  }
  return { state, processed, plans, done: state.pass >= PASSES.length };
}

async function jobDupes(ctx) {
  const removing = ctx.action === 'dedupe_jobs' || ctx.action === 'job_dupes_remove';
  if (removing) adminOnly(ctx);
  const t0 = Date.now();
  const refs = await loadReferencedJobIds(ctx.db);
  if (!refs.ok) throw new AdminError(500, refs.error, { code: 'upstream', retryable: true, changed: 0 });
  const state = unpackState(ctx.body.cursor);

  let allRows = null; // exact full plan when available
  let plans = [];
  let nextState = null;
  let scanned = 0;

  // 1. SQL plan, one page of up to RPC_PAGE groups per request (the cursor carries the last group key).
  let rpcNext = null;
  if (!state || state.rpc) {
    const viaRpc = await rpc(ctx.db, 'admin_job_dupes_plan', { p_after: state?.rpc ? String(state.after || '') || null : null, p_limit: RPC_PAGE });
    if (viaRpc.ok && Array.isArray(viaRpc.data) && viaRpc.data.every((g) => g && Array.isArray(g.ids))) {
      const ids = [...new Set(viaRpc.data.flatMap((g) => g.ids.map(String)))].filter(isUuid);
      const got = await readByIds(ctx.db, 'jobs', ids, { select: DEDUPE_SELECT });
      if (!got.ok) throw upstream('Could not read the duplicate listings — nothing was deleted.');
      allRows = got.rows;
      scanned = null;
      if (viaRpc.data.length >= RPC_PAGE) rpcNext = { ...(state || {}), v: 1, rpc: true, after: viaRpc.data[viaRpc.data.length - 1].k };
    } else if (state?.rpc) {
      throw upstream(`The duplicate plan stopped answering (HTTP ${viaRpc.status}) — press again.`);
    }
  }
  // 2. Whole-table read when it fits.
  if (!allRows && (!state || state.rpc)) {
    const all = await readAll(ctx.db, 'jobs', { select: DEDUPE_SELECT, max: 1_000_000, deadline: t0 + TUNING.scanBudgetMs });
    if (all.ok) { allRows = all.rows; scanned = all.rows.length; }
    else if (!all.timedOut) throw new AdminError(500, `jobs scan failed (HTTP ${all.status ?? 0}) — nothing was deleted`, { code: 'upstream', retryable: true, changed: 0 });
    else nextState = { v: 1, pass: 0, after: null, scanned: 0, suspected: 0, groups: 0, protected: 0, seen: [], sample: [], deleted: 0 };
  }
  // The whole-table read ran out of time: hand back a cursor now (this request has used its budget) and
  // continue with the partitioned passes on the next call.
  if (!allRows && nextState) {
    return ok(ctx.res, {
      changed: 0, complete: false, cursor: packState(nextState),
      message: 'The listings table is too big to read in one go — continuing in parts. Keep going.',
      touched: [], suspected: 0, groups: 0, protected: 0, total: null, scanned: 0, ms: Date.now() - t0,
    });
  }
  // 3. Partitioned passes.
  let st = state && !state.rpc ? state : null;
  if (!allRows && st) {
    const round = await partitionRound(ctx.db, st, refs.ids, t0 + TUNING.scanBudgetMs);
    if (round.error) throw new AdminError(500, `${round.error} — nothing more was deleted`, { code: 'upstream', retryable: true, changed: 0 });
    plans = round.plans;
    st = round.state;
    st.scanned = (st.scanned || 0) + round.processed;
  }

  // Plan → counts / deletes.
  const fullPlan = allRows ? planJobDedupe(allRows, refs.ids) : null;
  const deleteIds = fullPlan ? fullPlan.deleteIds : plans.flatMap((p) => p.deleteIds);
  const groups = fullPlan ? fullPlan.groups : plans.flatMap((p) => p.groups);
  const protectedExtras = fullPlan ? fullPlan.protectedExtras : plans.reduce((a, p) => a + p.protectedExtras, 0);
  const done = fullPlan ? !rpcNext : !!(st && st.pass >= PASSES.length);
  if (rpcNext) st = rpcNext;

  if (!removing) {
    let suspected = deleteIds.length, groupCount = groups.length, prot = protectedExtras, sample = describeGroups(groups);
    if (!fullPlan || rpcNext || state?.rpc) {
      st = st || {};
      const seen = new Set(st.seen || []);
      for (const id of deleteIds) if (seen.size < 20000) seen.add(String(id));
      st.seen = [...seen];
      st.suspected = seen.size; st.groups = (st.groups || 0) + groups.length; st.protected = (st.protected || 0) + protectedExtras;
      st.sample = [...(st.sample || []), ...describeGroups(groups)].slice(0, 8);
      suspected = st.suspected; groupCount = st.groups; prot = st.protected; sample = st.sample;
    }
    const total = fullPlan ? (scanned ?? null) : (st.scanned ?? null);
    const body = {
      changed: 0, complete: done, cursor: done ? undefined : packState(st), remaining: done ? 0 : undefined,
      message: done
        ? (suspected ? `${plural(suspected, 'duplicate listing')} in ${plural(groupCount, 'group')}${prot ? ` · ${fmt(prot)} kept because someone holds them` : ''}.` : 'No duplicate listings.')
        : (st.rpc ? `Found ${plural(suspected, 'duplicate')} so far — keep going.` : `Scanned ${fmt(st.scanned)} listings so far — keep going.`),
      touched: [], rows: done ? sample : [], suspected, groups: groupCount, protected: prot, total, scanned: total, sample, ms: Date.now() - t0,
    };
    return ok(ctx.res, body);
  }

  // Remove.
  const byId = new Map((fullPlan ? allRows : plans.flatMap((p) => p.groups.flatMap((g) => [g.keep, ...g.remove, ...g.kept]))).map((r) => [String(r.id), r]));
  const deadline = t0 + DEDUPE_BUDGET_MS;
  const targets = deleteIds.filter(isUuid);
  const snap = (id) => { const r = byId.get(id) || {}; return { id, title: r.title, company: r.company, location: r.location, source: r.source, apply_url: r.apply_url }; };
  // Audit first with the rows about to go; nothing is deleted if it cannot be written.
  let auditId = null;
  if (targets.length) auditId = await audit(ctx.db, ctx.sess, 'dedupe_jobs', { kind: 'system', id: 'jobs' }, { metadata: { planned: targets.length, protected: protectedExtras, rows: targets.slice(0, 300).map(snap) } });
  const del = await deleteByIds(ctx.db, 'jobs', targets, { filter: 'is_employer_posted=eq.false', deadline });
  const removed = del.deleted;
  if (auditId) await ctx.db(`admin_audit_log?id=eq.${auditId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata: { deleted: removed.length, remaining: Math.max(0, targets.length - removed.length), protected: protectedExtras, rows: removed.slice(0, 300).map(snap) } }) });
  if (!del.ok) {
    logError('admin-stats', 'dedupe_jobs delete failed', { status: del.status });
    throw new AdminError(500, 'Failed to remove duplicates', { code: 'upstream', retryable: true, detail: `delete failed (HTTP ${del.status})`, deleted: removed.length, changed: removed.length, remaining: Math.max(0, targets.length - removed.length) });
  }
  const leftThisRound = Math.max(0, targets.length - removed.length);
  const complete = done && leftThisRound === 0;
  if (st) st.deleted = (st.deleted || 0) + removed.length;
  // A full plan that ran out of time: the next press re-plans (cheap for a table that fits).
  const cursor = complete ? undefined : (fullPlan && !rpcNext ? undefined : packState(st));
  const totalDeleted = st ? st.deleted : removed.length;
  return ok(ctx.res, {
    changed: removed.length, remaining: fullPlan && !rpcNext ? leftThisRound : (complete ? 0 : undefined), complete, cursor,
    message: removed.length
      ? `Removed ${plural(removed.length, 'duplicate listing')}${complete ? '' : ' · still working'}.`
      : (complete ? 'No duplicate listings left.' : `Scanned ${fmt(st?.scanned || 0)} listings so far — keep going.`),
    touched: ['job_dupes', 'listings', 'listing_counts', 'overview', 'activity'],
    deleted: removed.length, total_deleted: totalDeleted, total: scanned ?? st?.scanned ?? null, groups: groups.length, protected: protectedExtras, ms: Date.now() - t0,
  });
}

// ── per-source health ────────────────────────────────────────────────────────────────────────
const STALE_SOURCE_MS = 48 * 3600e3;
function sourceVerdict(x) {
  if (x.live === 0) return { failing: true, why: 'No live listings from this source.' };
  if (x.last_seen && Date.now() - Date.parse(x.last_seen) > STALE_SOURCE_MS) return { failing: true, why: 'Nothing from this source seen in 48 hours.' };
  return { failing: false, why: null };
}

async function sourceHealth(ctx) {
  const today = pacificDayStart(new Date()).toISOString();
  const viaRpc = await rpc(ctx.db, 'admin_source_health', { p_today: today });
  let list0 = null, src = 'admin_source_health';
  if (viaRpc.ok && Array.isArray(viaRpc.data)) {
    list0 = viaRpc.data.map((x) => ({ source: x.source, live: Number(x.live), added_24h: Number(x.added_24h), added_today: Number(x.added_today), last_seen: x.last_seen || null }));
  } else {
    // Fallback: find the distinct sources one index step at a time, then exact counts per source.
    src = 'exact';
    const sources = [];
    for (let after = null, i = 0; i < 60; i++) {
      const r = await ctx.db(`jobs?select=source&source=not.is.null${after != null ? `&source=gt.${eqValue(after)}` : ''}&order=source.asc&limit=1`);
      const got = await rows(r);
      if (!Array.isArray(got)) throw upstream('Could not read the listing sources.');
      if (!got.length) break;
      sources.push(got[0].source);
      after = got[0].source;
    }
    const now = encodeURIComponent(new Date().toISOString());
    const day = encodeURIComponent(new Date(Date.now() - 86400e3).toISOString());
    list0 = await Promise.all(sources.map(async (s0) => {
      const f = `jobs?select=id&source=eq.${eqValue(s0)}`;
      const [live, added24, addedToday, last] = await Promise.all([
        countExact(ctx.db, `${f}&availability_status=eq.active&expires_at=gt.${now}`),
        countExact(ctx.db, `${f}&created_at=gte.${day}`),
        countExact(ctx.db, `${f}&created_at=gte.${encodeURIComponent(today)}`),
        ctx.db(`jobs?select=last_seen_at&source=eq.${eqValue(s0)}&last_seen_at=not.is.null&order=last_seen_at.desc&limit=1`).then(rows),
      ]);
      return { source: s0, live, added_24h: added24, added_today: addedToday, last_seen: Array.isArray(last) && last[0] ? last[0].last_seen_at : null };
    }));
  }
  const out = list0.map((x) => {
    if ([x.live, x.added_24h].some((v) => v == null || !Number.isFinite(v))) return { ...x, failing: null, why: 'Some counts could not be read.' };
    return { ...x, ...sourceVerdict(x) };
  }).sort((a, b) => (b.live ?? -1) - (a.live ?? -1));
  return list(ctx.res, out, { as_of: new Date().toISOString(), source: src, failing: out.filter((x) => x.failing).length });
}

// ── aggregation target / grouped reads ───────────────────────────────────────────────────────────
async function getJobTarget(ctx) {
  const got = await rows(await ctx.db('feature_flags?flag_name=eq.job_search_target&select=percentage&limit=1'));
  if (!Array.isArray(got)) throw upstream('Could not read the target.');
  const p = Number.parseInt(got?.[0]?.percentage, 10);
  const target = Number.isFinite(p) && p > 0 ? p : 20;
  return ok(ctx.res, { message: `Target: ${target} listings per search.`, target });
}

async function setJobTarget(ctx) {
  const n = Number.parseInt(ctx.body.target, 10);
  if (!Number.isFinite(n) || n < 5 || n > 60) throw bad('Target must be between 5 and 60');
  const prior = ((await rows(await ctx.db('feature_flags?flag_name=eq.job_search_target&select=percentage&limit=1'))) || [])[0]?.percentage ?? null;
  const up = await ctx.db('feature_flags?on_conflict=flag_name&select=flag_name', { method: 'POST', body: JSON.stringify({ flag_name: 'job_search_target', status: 'fully_on', percentage: n, description: 'Min related listings per job search before topping up from the live API' }), headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
  if (!up.ok) throw upstream('Failed to save target');
  await audit(ctx.db, ctx.sess, 'set_job_target', { kind: 'system', id: 'job_search_target' }, { prior: { target: prior }, next: { target: n } }, { required: false });
  return ok(ctx.res, { changed: 1, message: `Target set to ${n} listings per search.`, touched: ['sources'], target: n });
}

async function getJobsGrouped(ctx) {
  const r = await rpc(ctx.db, 'admin_jobs_by_company', {});
  let groups = null;
  if (r.ok) groups = (Array.isArray(r.data) ? r.data : []).map((g) => ({ company: g.company, total: Number(g.total) || 0, active: Number(g.active) || 0 }));
  else {
    const all = await readAll(ctx.db, 'jobs', { select: 'id,company,availability_status', max: 1_000_000, deadline: Date.now() + 40_000 });
    if (!all.ok) throw upstream('Query failed');
    const by = {};
    for (const j of all.rows) { const co = j.company || 'Unknown'; const g = by[co] || (by[co] = { company: co, total: 0, active: 0 }); g.total++; if (j.availability_status === 'active') g.active++; }
    groups = Object.values(by).sort((a, b) => b.total - a.total);
  }
  return list(ctx.res, groups, { groups, total_jobs: groups.reduce((a, g) => a + g.total, 0) });
}

async function getCompanyJobs(ctx) {
  const company = str(ctx.body.company, 300);
  if (!company) throw bad('company required');
  const jobs = await rows(await ctx.db(`jobs?company=eq.${eqValue(company)}&select=id,title,city,apply_url,source,availability_status,created_at,last_seen_at&order=created_at.desc&limit=500`));
  if (!Array.isArray(jobs)) throw upstream('Query failed');
  return list(ctx.res, jobs, { jobs, company });
}

export const actions = {
  list_listing_tickets: listTickets,
  list_listing_disputes: listListingDisputes,
  resolve_listing_dispute: resolveListingDispute,
  delete_listing: deleteListing,
  dismiss_inactive_report: dismissInactiveReport,
  remove_listing: removeListing,
  deny_report: denyReport,
  get_recent_jobs: getRecentJobs,
  emergency_job_refresh: emergencyJobRefresh,
  jobs_browse: jobsBrowse,
  listings_browse: listingsBrowse,
  job_detail: jobDetail,
  job_update: jobEdit,
  job_edit: jobEdit,
  job_restore: jobRestore,
  listing_counts: listingCounts,
  purge_stale_jobs: purgeStale,
  scan_job_dupes: jobDupes,
  dedupe_jobs: jobDupes,
  job_dupes_scan: jobDupes,
  job_dupes_remove: jobDupes,
  source_health: sourceHealth,
  get_job_target: getJobTarget,
  set_job_target: setJobTarget,
  get_jobs_grouped: getJobsGrouped,
  get_company_jobs: getCompanyJobs,
};
