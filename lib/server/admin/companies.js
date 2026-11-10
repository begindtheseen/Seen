// Companies: search, one company's sheet, recompute, duplicates, merge / auto-merge / undo / resplit, and the
// evidentiary export. The merge routine is the one used before (log first, identity-complete, recompute — no
// hand math); what changed is how names are matched (exact, case-insensitive, no wildcards — `ilike` with a
// raw name treated `_` and `*` as wildcards and took the first match) and that every answer is the contract.

import { ok, list, plural, fmt, undoOffer, AdminError } from './respond.js';
import { adminOnly, svcHeaders, bad, notFound, upstream, str } from './context.js';
import { rows, keysetPage, isUuid, chunk, readAll } from './batch.js';
import { audit } from './audit.js';
import { enqueueCompanies, recomputeNow, companyKey } from './recompute.js';
import { recomputeCompanyScoreFromReports, normalizeCompany } from '../../../api/_utils/reportWrite.js';
import { findCompanyDuplicates } from '../companyDupes.js';
import { SCORABLE_REPORTS_FILTER } from '../reportCounts.js';
import { buildCompanyAuditBundle } from '../../../api/_utils/companyAuditBundle.js';
import { ilikeExact, ilikeContains, eqValue } from '../pgrest.js';
import { logError } from '../errlog.js';

export const AUTO_MERGE_BUDGET_MS = 40_000;
const MERGE_TOUCH = ['companies', 'company_dupes', 'merges', 'activity', 'overview'];
const json = (r) => (r && r.ok ? r.json().catch(() => []) : Promise.resolve([]));

async function loadAllCompanyNames(db) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await db(`company_scores?select=id,name:company_name,report_count,overall_score&order=id.asc&limit=1000&offset=${offset}`);
    if (!r.ok) return { ok: false, error: `company scan failed (HTTP ${r.status})` };
    const page = await r.json().catch(() => null);
    if (!Array.isArray(page)) return { ok: false, error: 'company scan returned no rows' };
    out.push(...page);
    if (page.length < 1000) return { ok: true, rows: out };
  }
}

function merger(ctx) {
  const db = ctx.db;
  const svc = svcHeaders(ctx);
  async function mergeCompanyPair(primaryId, secondaryId) {
    const [pArr, sArr] = await Promise.all([
      db(`company_scores?id=eq.${eqValue(primaryId)}&select=*&limit=1`).then(json),
      db(`company_scores?id=eq.${eqValue(secondaryId)}&select=*&limit=1`).then(json),
    ]);
    const primary = pArr[0], secondary = sArr[0];
    if (!primary || !secondary) return { ok: false, status: 404, error: 'Company not found' };
    const primaryName = primary.company_name, secondaryName = secondary.company_name;
    const secNorm = normalizeCompany(secondaryName), priNorm = normalizeCompany(primaryName);
    const secWord = String(secondaryName).split(/\s+/)[0] || secondaryName;
    const secCoRows = await db(`companies?name=ilike.${ilikeContains(secWord)}&select=id,name&limit=50`).then(json);
    const secondaryCompanyIds = (secCoRows || []).filter((c) => normalizeCompany(c.name) === secNorm).map((c) => c.id);
    const priWord = String(primaryName).split(/\s+/)[0] || primaryName;
    const priCoRows = await db(`companies?name=ilike.${ilikeContains(priWord)}&select=id,name&limit=50`).then(json);
    const primaryCompanyId = (priCoRows || []).find((c) => normalizeCompany(c.name) === priNorm)?.id || null;
    // Every report of the absorbed company (keyset pages — a capped page left reports behind past 1,000).
    const nameRead = await readAll(db, 'reports', { select: 'id', filter: `company_name=ilike.${ilikeExact(secondaryName)}`, max: 200000 });
    if (!nameRead.ok) return { ok: false, status: 502, error: 'Could not read the reports to move, so nothing was merged.' };
    const byName = nameRead.rows;
    const cleanIds = secondaryCompanyIds.filter((x) => isUuid(x) || /^\d+$/.test(String(x)));
    let byId = [];
    for (const part of chunk(cleanIds, 40)) {
      const idRead = await readAll(db, 'reports', { select: 'id', filter: `company_id=in.(${part.join(',')})`, max: 200000 });
      if (!idRead.ok) return { ok: false, status: 502, error: 'Could not read the reports to move, so nothing was merged.' };
      byId = byId.concat(idRead.rows);
    }
    const movedReportIds = [...new Set([...(byName || []), ...(byId || [])].map((r) => r.id).filter(Boolean))];
    const aliasAdded = String(secondaryName).toLowerCase();
    let logged = true, mergeId = null;
    const logRes = await db('company_merges', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ admin_id: ctx.sess.admin_id, primary_score_id: primaryId, primary_name: primaryName, secondary_score_id: secondaryId, secondary_name: secondaryName, secondary_row: secondary, primary_row_before: primary, moved_report_ids: movedReportIds, secondary_company_ids: secondaryCompanyIds, aliases_added: [aliasAdded] }),
    });
    if (logRes.ok) { const j = await logRes.json().catch(() => null); mergeId = Array.isArray(j) ? j[0]?.id : j?.id; } else logged = false;
    // Without the merge log a merge cannot be undone — refuse it rather than make an irreversible change.
    if (!logged) return { ok: false, status: 502, error: 'Could not write the merge log, so nothing was merged.' };
    for (const part of chunk(movedReportIds.filter(isUuid), 40)) {
      const patch = { company_name: primaryName };
      if (primaryCompanyId) patch.company_id = primaryCompanyId;
      await db(`reports?id=in.(${part.join(',')})`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    {
      const patch = { company_norm: priNorm, company_name: primaryName };
      if (primaryCompanyId) patch.company_id = primaryCompanyId;
      await db(`resume_surveys?company_norm=eq.${eqValue(secNorm)}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    await db('company_aliases?on_conflict=alias', { method: 'POST', body: JSON.stringify({ canonical: primaryName, alias: aliasAdded }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }).catch(() => {});
    await recomputeCompanyScoreFromReports(ctx.url, svc, primaryName);
    await db(`company_scores?id=eq.${eqValue(secondaryId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    const finalArr = await db(`company_scores?id=eq.${eqValue(primaryId)}&select=report_count,overall_score&limit=1`).then(json);
    return { ok: true, merge_id: mergeId, logged, primary_name: primaryName, secondary_name: secondaryName, moved_reports: movedReportIds.length, report_count: finalArr[0]?.report_count ?? null };
  }

  async function refreshOrClearScore(name) {
    if (!name) return;
    const key = String(name).toLowerCase().trim();
    const real = await db(`reports?company_name=ilike.${ilikeExact(key)}&${SCORABLE_REPORTS_FILTER}&select=id&limit=1`).then(json);
    if (Array.isArray(real) && real.length > 0) await recomputeCompanyScoreFromReports(ctx.url, svc, name);
    else await db(`company_scores?company_name=eq.${eqValue(key)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
  }

  async function undoMergeLog(log) {
    const secRow = { ...(log.secondary_row || {}) };
    let restoredSecondary = false;
    if (secRow.company_name) {
      const ins = await db('company_scores', { method: 'POST', body: JSON.stringify(secRow), headers: { Prefer: 'return=minimal' } });
      restoredSecondary = ins.ok;
      if (!ins.ok) {
        const secRow2 = { ...secRow }; delete secRow2.id;
        const up = await db('company_scores?on_conflict=company_name', { method: 'POST', body: JSON.stringify(secRow2), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
        restoredSecondary = up.ok;
      }
    }
    const movedIds = (Array.isArray(log.moved_report_ids) ? log.moved_report_ids : []).filter(isUuid);
    const origCid = (Array.isArray(log.secondary_company_ids) && log.secondary_company_ids[0]) || null;
    for (const part of chunk(movedIds, 40)) {
      const patch = { company_name: log.secondary_name };
      if (origCid) patch.company_id = origCid;
      await db(`reports?id=in.(${part.join(',')})`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    for (const a of (Array.isArray(log.aliases_added) ? log.aliases_added : [])) {
      await db(`company_aliases?alias=eq.${eqValue(a)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    const before = log.primary_row_before || {};
    const restoreFields = {};
    for (const f of ['industry', 'raw_summary', 'web_reviews']) if (f in before) restoreFields[f] = before[f];
    if (Object.keys(restoreFields).length) await db(`company_scores?id=eq.${eqValue(log.primary_score_id)}`, { method: 'PATCH', body: JSON.stringify(restoreFields), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    await refreshOrClearScore(log.primary_name);
    await refreshOrClearScore(log.secondary_name);
    // Conditional on not-yet-undone, so two presses cannot both run the reversal's bookkeeping.
    await db(`company_merges?id=eq.${eqValue(log.id)}&undone_at=is.null`, { method: 'PATCH', body: JSON.stringify({ undone_at: new Date().toISOString(), undone_by: ctx.sess.admin_id }), headers: { Prefer: 'return=minimal' } });
    await audit(db, ctx.sess, 'undo_merge', { kind: 'company', id: String(log.primary_name || log.primary_score_id || '') }, { metadata: { merge_id: log.id, restored_reports: movedIds.length } }, { required: false });
    return { secondary_name: log.secondary_name, primary_name: log.primary_name, reports: movedIds.length, secondary_score_restored: restoredSecondary, aliases_removed: (Array.isArray(log.aliases_added) ? log.aliases_added.length : 0) };
  }
  return { mergeCompanyPair, undoMergeLog };
}

async function findDuplicates(ctx) {
  const all = await loadAllCompanyNames(ctx.db);
  if (!all.ok) throw new AdminError(500, all.error, { code: 'upstream', retryable: true });
  const duplicates = findCompanyDuplicates(all.rows);
  return list(ctx.res, duplicates, { duplicates, total: all.rows.length, message: duplicates.length ? `${plural(duplicates.length, 'duplicate group')} (${fmt(duplicates.filter((g) => g.auto).length)} can merge automatically).` : 'No duplicate company names.' });
}

async function resolveName(db, name) {
  const got = await rows(await db(`company_scores?company_name=ilike.${ilikeExact(name)}&select=id,company_name&limit=2`));
  if (!Array.isArray(got)) throw upstream('Could not look the company up.');
  return got;
}

async function merge(ctx) {
  adminOnly(ctx);
  let { primary_id, secondary_id } = ctx.body;
  const primary = str(ctx.body.primary, 300), secondary = str(ctx.body.secondary, 300);
  if ((!primary_id || !secondary_id) && primary && secondary) {
    const [p, s] = await Promise.all([resolveName(ctx.db, primary), resolveName(ctx.db, secondary)]);
    if (!p[0]) throw notFound(`Company not found: ${primary}`);
    if (!s[0]) throw notFound(`Company not found: ${secondary}`);
    primary_id = p[0].id; secondary_id = s[0].id;
  }
  if (!primary_id || !secondary_id) throw bad('primary_id and secondary_id (or primary/secondary names) required');
  if (String(primary_id) === String(secondary_id)) throw bad('Cannot merge a company with itself');
  const r = await merger(ctx).mergeCompanyPair(primary_id, secondary_id);
  if (!r.ok) throw new AdminError(r.status || 500, r.error || 'Merge failed');
  const auditId = await audit(ctx.db, ctx.sess, 'merge_companies', { kind: 'company', id: r.primary_name }, { metadata: { primary_id, secondary_id, secondary_name: r.secondary_name, merge_id: r.merge_id, moved_reports: r.moved_reports, logged: r.logged } }, { required: false });
  return ok(ctx.res, {
    changed: 1, message: `Merged ${r.secondary_name} into ${r.primary_name} · ${plural(r.moved_reports, 'report')} moved.`,
    undo: r.merge_id ? undoOffer(auditId) : undefined,
    touched: [...MERGE_TOUCH, `company:${companyKey(r.primary_name)}`, `company:${companyKey(r.secondary_name)}`],
    merged_report_count: r.report_count, moved_reports: r.moved_reports, merge_id: r.merge_id, logged: r.logged,
  });
}

async function autoMerge(ctx) {
  adminOnly(ctx);
  const all = await loadAllCompanyNames(ctx.db);
  if (!all.ok) throw new AdminError(500, all.error, { code: 'upstream', retryable: true });
  const found = findCompanyDuplicates(all.rows);
  const autoGroups = found.filter((g) => g.auto);
  const deadline = Date.now() + AUTO_MERGE_BUDGET_MS;
  const m = merger(ctx);
  let merged = 0, failed = 0, done = 0;
  const groupSummaries = [];
  for (const group of autoGroups) {
    if (Date.now() > deadline) break;
    const [primary, ...rest] = group.companies;
    const absorbed = [];
    for (const sec of rest) {
      const mr = await m.mergeCompanyPair(primary.id, sec.id);
      if (mr.ok) {
        absorbed.push(sec.name); merged++;
        await audit(ctx.db, ctx.sess, 'auto_merge_pair', { kind: 'company', id: primary.name }, { metadata: { primary_id: primary.id, secondary_id: sec.id, secondary_name: sec.name, merge_id: mr.merge_id, moved_reports: mr.moved_reports } }, { required: false });
      } else failed++;
    }
    done++;
    if (absorbed.length) groupSummaries.push({ canonical: primary.name, absorbed });
  }
  const remaining = autoGroups.length - done;
  await audit(ctx.db, ctx.sess, 'auto_merge_companies', { kind: 'system', id: 'companies' }, { metadata: { merged, failed, groups: groupSummaries.length, remaining } }, { required: false });
  // One unit everywhere: GROUPS. `changed` = groups merged this round, `remaining` = groups still to do, so the
  // job manager's "N of M" adds up. `merged` (companies absorbed) rides along for the detail line.
  const groupsDone = groupSummaries.length;
  return ok(ctx.res, {
    changed: groupsDone, remaining, complete: remaining === 0,
    skipped: failed ? [{ reason: 'merge_failed', count: failed }] : [],
    message: groupsDone
      ? `Merged ${plural(groupsDone, 'group')} (${plural(merged, 'company', 'companies')} absorbed)${remaining ? ` · ${plural(remaining, 'group')} left` : ''}${failed ? ` · ${fmt(failed)} failed` : ''}.`
      : (remaining ? `${plural(remaining, 'group')} left — keep going.` : 'No companies left to merge automatically.'),
    touched: MERGE_TOUCH, groups_total: autoGroups.length, merged, failed, groups: groupSummaries, manual: found.length - autoGroups.length,
  });
}

async function listMerges(ctx) {
  const r = await ctx.db('company_merges?select=id,created_at,primary_name,secondary_name,moved_report_ids,undone_at&order=created_at.desc&limit=50');
  // Before migration 040 the table does not exist (404): an honest empty history. Any other failure is an error.
  if (!r.ok) {
    if (r.status === 404) return list(ctx.res, [], { merges: [], ready: false });
    throw upstream(`Could not read the merge history (HTTP ${r.status}).`);
  }
  const got = await r.json().catch(() => []);
  const merges = (Array.isArray(got) ? got : []).map((m) => ({ id: m.id, created_at: m.created_at, primary_name: m.primary_name, secondary_name: m.secondary_name, moved_reports: Array.isArray(m.moved_report_ids) ? m.moved_report_ids.length : 0, undone_at: m.undone_at || null }));
  return list(ctx.res, merges, { merges });
}

export async function undoMergeById(ctx, mergeId) {
  const log = ((await rows(await ctx.db(`company_merges?id=eq.${eqValue(mergeId)}&limit=1`))) || [])[0];
  if (!log) throw notFound('Merge log not found');
  if (log.undone_at) throw new AdminError(409, 'This merge has already been undone', { code: 'conflict' });
  return merger(ctx).undoMergeLog(log);
}

async function undoMerge(ctx) {
  adminOnly(ctx);
  const mergeId = str(ctx.body.merge_id, 80);
  if (!mergeId) throw bad('merge_id required');
  try {
    const restored = await undoMergeById(ctx, mergeId);
    return ok(ctx.res, { changed: 1, message: `Separated ${restored.secondary_name} from ${restored.primary_name} · ${plural(restored.reports, 'report')} moved back.`, touched: [...MERGE_TOUCH, `company:${companyKey(restored.primary_name)}`, `company:${companyKey(restored.secondary_name)}`], restored });
  } catch (e) {
    if (e instanceof AdminError) throw e;
    const ref = logError('admin-stats:undo_merge', e, { merge_id: mergeId });
    throw new AdminError(500, 'Undo failed — logged for investigation.', { code: 'upstream', retryable: true, ref });
  }
}

async function resplitCompany(ctx) {
  adminOnly(ctx);
  const name = str(ctx.body.name || ctx.body.company, 300);
  if (name.length < 2) throw bad('company name required');
  try {
    const log = ((await rows(await ctx.db(`company_merges?secondary_name=ilike.${ilikeExact(name)}&undone_at=is.null&order=created_at.desc&limit=1`))) || [])[0];
    if (!log) {
      throw new AdminError(404, `No reversible merge found with "${name}" as the absorbed company. If it was merged before merge-logging existed, it can't be auto-reclaimed — its reports can no longer be distinguished from the parent. Re-add it as a new company and future reports will accrue to it separately.`, { code: 'not_found', no_log: true });
    }
    const restored = await merger(ctx).undoMergeLog(log);
    return ok(ctx.res, { changed: 1, message: `Separated ${restored.secondary_name} again · ${plural(restored.reports, 'report')} moved back.`, touched: [...MERGE_TOUCH, `company:${companyKey(restored.primary_name)}`, `company:${companyKey(restored.secondary_name)}`], merge_id: log.id, restored });
  } catch (e) {
    if (e instanceof AdminError) throw e;
    const ref = logError('admin-stats:resplit_company', e, { name });
    throw new AdminError(500, 'Resplit failed — logged for investigation.', { code: 'upstream', retryable: true, ref });
  }
}

async function exportCompany(ctx) {
  adminOnly(ctx);
  let bundle;
  try {
    bundle = await buildCompanyAuditBundle({ db: ctx.db, serviceKey: ctx.key, adminId: ctx.sess.admin_id, adminRole: ctx.sess.role, company: ctx.body.company });
  } catch (e) {
    throw new AdminError(e?.statusCode || 500, e?.message || 'export failed');
  }
  await audit(ctx.db, ctx.sess, 'export_company', { kind: 'company', id: bundle.query }, { metadata: { reports: bundle.totals?.total_reports } }, { required: false });
  return ok(ctx.res, { message: `Exported ${bundle.query}.`, bundle });
}

const COMPANY_SELECT = 'id,name:company_name,overall_score,report_count,ghost_rate,response_rate';

async function companiesList(ctx) {
  const q = str(ctx.body.q, 100);
  const filter = q ? `company_name=ilike.${ilikeContains(q)}` : '';
  const page = await keysetPage(ctx.db, 'company_scores', { select: `${COMPANY_SELECT},company_name`, filter, order: 'company_name', dir: 'asc', limit: ctx.body.limit || 50, after: ctx.body.after });
  if (!page.ok) throw upstream(`Could not read companies (HTTP ${page.status}).`);
  return list(ctx.res, page.rows.map(({ company_name, ...r }) => r), { next: page.next || undefined, as_of: new Date().toISOString() });
}

async function companyDetail(ctx) {
  const name = str(ctx.body.name || ctx.body.company, 300);
  if (!name) throw bad('company name required');
  const score = ((await rows(await ctx.db(`company_scores?company_name=ilike.${ilikeExact(name)}&select=*&limit=1`))) || [])[0] || null;
  const key = companyKey(name);
  const count = async (path) => {
    const r = await ctx.db(`${path}&limit=1`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } });
    const v = Number.parseInt(String(r?.headers?.get?.('content-range') || '').split('/')[1], 10);
    return r && r.ok && Number.isFinite(v) ? v : null;
  };
  const [reportsTotal, held, merges, perks] = await Promise.all([
    count(`reports?company_name=ilike.${ilikeExact(key)}&select=id`),
    count(`reports?company_name=ilike.${ilikeExact(key)}&needs_review=is.true&select=id`),
    rows(await ctx.db(`company_merges?or=(primary_name.ilike.${encodeURIComponent(`"${key.replace(/["\\]/g, '')}"`)},secondary_name.ilike.${encodeURIComponent(`"${key.replace(/["\\]/g, '')}"`)})&select=id,created_at,primary_name,secondary_name,undone_at&order=created_at.desc&limit=20`)),
    rows(await ctx.db(`employer_perks?company=eq.${eqValue(key)}&select=company,featured_until,verified_until,sponsor_until&limit=1`)),
  ]);
  if (!score && !reportsTotal) throw notFound(`No company called ${name}.`);
  return ok(ctx.res, { message: score ? `${score.company_name}: score ${score.overall_score ?? '—'}.` : `${name} has reports but no score yet.`, rows: [{ name: score?.company_name || name, score, reports_total: reportsTotal, held, merges: Array.isArray(merges) ? merges : null, perks: Array.isArray(perks) ? perks[0] || null : null }] });
}

async function companyRecompute(ctx) {
  const name = str(ctx.body.name || ctx.body.company, 300);
  if (!name) throw bad('company name required');
  const key = companyKey(name);
  const q = await enqueueCompanies(ctx.db, [key]);
  const d = await recomputeNow(ctx.db, svcHeaders(ctx), [key], { mode: q.mode, deadline: Date.now() + 20000 });
  if (!d.done) throw upstream(`Could not recompute ${name}'s score.`);
  await audit(ctx.db, ctx.sess, 'company_recompute', { kind: 'company', id: key }, {}, { required: false });
  return ok(ctx.res, { changed: 1, message: `Recomputed ${name}'s score from its reports.`, touched: ['companies', `company:${key}`] });
}

export const actions = {
  find_duplicates: findDuplicates,
  merge,
  auto_merge: autoMerge,
  list_merges: listMerges,
  undo_merge: undoMerge,
  resplit_company: resplitCompany,
  export_company: exportCompany,
  companies_list: companiesList,
  company_detail: companyDetail,
  company_recompute: companyRecompute,
};
export { merger };
