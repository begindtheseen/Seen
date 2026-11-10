// People: user search (every profile, no 100 cap), a user's sheet, the Pro window, credits, password reset,
// account deletion, duplicate-account clusters, and where signups come from.
//
// Pro is a WINDOW (ai_credits.pro_until). Setting it never touches a balance: the old "Grant/Revoke Pro" wrote
// balance 999 / 3, so revoking a buyer's Pro threw away the credits they had paid for.

import { ok, list, plural, fmt, undoOffer } from './respond.js';
import { adminOnly, bad, notFound, upstream, conflict, str } from './context.js';
import { rows, keysetPage, isUuid, countExact, readByIds } from './batch.js';
import { audit, dropAuditRows } from './audit.js';
import { ilikeContains } from '../pgrest.js';
import { pacificDate, pacificDayStart } from '../../time/pacific.js';
import { loadAttributionReport } from '../attributionReport.js';
import { answerReport } from './system.js';

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDIT_SELECT = 'user_id,balance,pro,pro_until,comped';

const proActive = (c) => c?.pro === true || (!!c?.pro_until && new Date(c.pro_until) > new Date());
function userRow(p, c) {
  return { id: p.id, email: p.email || null, created_at: p.created_at || null, pro_until: c?.pro_until || null, pro_active: proActive(c), comped: !!c?.comped, balance: c?.balance ?? null };
}

async function creditsFor(db, ids) {
  const got = ids.length ? await readByIds(db, 'ai_credits', ids, { select: CREDIT_SELECT, col: 'user_id' }) : { rows: [] };
  return new Map(got.rows.map((c) => [c.user_id, c]));
}

async function usersList(ctx) {
  const q = str(ctx.body.q, 120);
  const filter = String(ctx.body.filter || 'all');
  const parts = [];
  if (q && USER_ID_RE.test(q)) parts.push(`id=eq.${q.toLowerCase()}`);
  else if (q) parts.push(`email=ilike.${ilikeContains(q)}`);
  if (filter === 'new_today') parts.push(`created_at=gte.${encodeURIComponent(pacificDayStart(new Date()).toISOString())}`);
  if (filter === 'new_week') parts.push(`created_at=gte.${encodeURIComponent(new Date(Date.now() - 7 * 86400e3).toISOString())}`);
  if (filter === 'pro') {
    // Pro = an active window; read the window holders first (small), then their profiles.
    const holders = await rows(await ctx.db(`ai_credits?or=(pro.is.true,pro_until.gt.${encodeURIComponent(new Date().toISOString())})&select=${CREDIT_SELECT}&order=pro_until.desc.nullslast&limit=1000`));
    if (!Array.isArray(holders)) throw upstream('Could not read Pro accounts.');
    const ids = holders.map((h) => h.user_id).filter(isUuid);
    const prof = ids.length ? await readByIds(ctx.db, 'profiles', ids, { select: 'id,email,created_at' }) : { rows: [] };
    const byId = new Map(holders.map((h) => [h.user_id, h]));
    let out = prof.rows.map((p) => userRow(p, byId.get(p.id)));
    if (q) out = out.filter((u) => String(u.email || '').toLowerCase().includes(q.toLowerCase()) || u.id === q.toLowerCase());
    return list(ctx.res, out, { total: out.length, as_of: new Date().toISOString() });
  }
  const filterStr = parts.join('&');
  const [page, total] = await Promise.all([
    keysetPage(ctx.db, 'profiles', { select: 'id,email,created_at', filter: filterStr, order: 'created_at', dir: 'desc', limit: ctx.body.limit || 50, after: ctx.body.after }),
    ctx.body.after ? Promise.resolve(undefined) : countExact(ctx.db, `profiles?select=id${filterStr ? `&${filterStr}` : ''}`),
  ]);
  if (!page.ok) throw upstream(`Could not read accounts (HTTP ${page.status}).`);
  const credits = await creditsFor(ctx.db, page.rows.map((p) => p.id).filter(isUuid));
  return list(ctx.res, page.rows.map((p) => userRow(p, credits.get(p.id))), { next: page.next || undefined, ...(total !== undefined ? { total } : {}), as_of: new Date().toISOString() });
}

async function userDetail(ctx) {
  const id = String(ctx.body.user_id || '').toLowerCase();
  if (!USER_ID_RE.test(id)) throw bad('Valid user_id required');
  const [p, c, ledger, apps, reports] = await Promise.all([
    ctx.db(`profiles?id=eq.${id}&select=id,email,created_at&limit=1`).then(rows),
    ctx.db(`ai_credits?user_id=eq.${id}&select=${CREDIT_SELECT}&limit=1`).then(rows),
    ctx.db(`credit_transactions?user_id=eq.${id}&select=delta,reason,created_at&order=created_at.desc&limit=50`).then(rows),
    countExact(ctx.db, `applications?user_id=eq.${id}&select=id`),
    countExact(ctx.db, `reports?user_id=eq.${id}&select=id`),
  ]);
  if (!Array.isArray(p)) throw upstream('Could not read the account.');
  if (!p[0]) throw notFound('No account with that id.');
  const row = { ...userRow(p[0], (c || [])[0]), ledger: Array.isArray(ledger) ? ledger : [], applications: apps, reports };
  return ok(ctx.res, { message: `Loaded ${row.email || id}.`, rows: [row] });
}

// What setting a window writes. A grant writes pro_until ONLY: never `pro` (the Stripe-managed flag that the
// revenue funnel and signup report count as paying — attributionReport.js:204, revenueFunnel.js:76), never
// `comped` (hasProAccess treats comped as Pro forever, creditRules.js:210), never a balance, and no purchase
// row — so an admin grant can never read as revenue. Ending Pro also clears the two lifetime flags an older
// grant may have left (legacy set_pro wrote pro:true, comped:true), or the account would stay Pro.
export function endingPatch(cur, until, ending) {
  const patch = { pro_until: until };
  if (ending && cur?.pro === true) patch.pro = false;
  if (ending && cur?.comped === true) patch.comped = false;
  return patch;
}

/** Write the window (see endingPatch); the upsert keeps every other column. Returns the row written. */
async function writeProUntil(db, userId, until) {
  const cur = ((await rows(await db(`ai_credits?user_id=eq.${userId}&select=${CREDIT_SELECT}&limit=1`))) || [])[0] || null;
  let r;
  if (cur) {
    // Ending Pro also clears the old lifetime flag (lib/server/credits.js reads `pro OR pro_until`), or a
    // legacy pro=true account would stay Pro after "end". Never the balance.
    const ending = !(new Date(until) > new Date());
    const patch = endingPatch(cur, until, ending);
    r = await db(`ai_credits?user_id=eq.${userId}&select=${CREDIT_SELECT}`, { method: 'PATCH', body: JSON.stringify(patch) });
  } else {
    // A new row only when the account has none: the free daily row, with the window.
    r = await db(`ai_credits?on_conflict=user_id&select=${CREDIT_SELECT}`, { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: userId, pro_until: until, daily_earned: 0, last_reset: pacificDate() }) });
  }
  if (!r || !r.ok) return { ok: false, status: r ? r.status : 0, prior: cur };
  const got = await r.json().catch(() => []);
  return { ok: true, prior: cur, row: (Array.isArray(got) ? got[0] : got) || null };
}

export async function setProWindow(ctx, userId, until, label) {
  adminOnly(ctx);
  const prior = ((await rows(await ctx.db(`ai_credits?user_id=eq.${userId}&select=${CREDIT_SELECT}&limit=1`))) || [])[0] || null;
  const ending = !(new Date(until) > new Date());
  const next = endingPatch(prior, until, ending);
  const priorVals = { pro_until: prior?.pro_until ?? null };
  if ('pro' in next) priorVals.pro = prior?.pro ?? null;
  if ('comped' in next) priorVals.comped = prior?.comped ?? null;
  const auditId = await audit(ctx.db, ctx.sess, 'set_pro_window', { kind: 'user', id: userId }, { prior: priorVals, next, metadata: { via: label } });
  const w = await writeProUntil(ctx.db, userId, until);
  if (!w.ok) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw upstream(`Could not save the Pro window (HTTP ${w.status}).`); }
  const prof = ((await rows(await ctx.db(`profiles?id=eq.${userId}&select=id,email,created_at&limit=1`))) || [])[0] || { id: userId };
  return { auditId, row: userRow(prof, w.row || { ...prior, pro_until: until }) };
}

async function setProWindowAction(ctx) {
  const userId = String(ctx.body.user_id || '').toLowerCase();
  if (!USER_ID_RE.test(userId)) throw bad('Valid user_id required');
  let until = ctx.body.until;
  if (until === undefined) throw bad('until is required (a date, or null to end Pro now)');
  if (until !== null) {
    const t = Date.parse(String(until));
    if (!Number.isFinite(t)) throw bad('until must be a date or null');
    if (t > Date.now() + 5 * 365 * 86400e3) throw bad('until must be within 5 years');
    until = new Date(t).toISOString();
  } else until = new Date().toISOString(); // ends now (a past window is "not Pro")
  const { auditId, row } = await setProWindow(ctx, userId, until, 'set_pro_window');
  const active = new Date(until) > new Date();
  return ok(ctx.res, { changed: 1, message: active ? `Pro until ${pacificDate(new Date(until))} (California).` : 'Pro ended. Credits were not touched.', undo: undoOffer(auditId), touched: ['users', `user:${userId}`, 'activity'], rows: [row] });
}

/** Legacy set_pro {user_id, pro}: pro → a 30-day window, not pro → ends the window. Never a balance. */
async function setProLegacy(ctx) {
  const userId = String(ctx.body.user_id || '').toLowerCase();
  if (!userId) throw bad('user_id required');
  if (!USER_ID_RE.test(userId)) throw bad('Valid user_id required');
  const until = ctx.body.pro ? new Date(Date.now() + 30 * 86400e3).toISOString() : new Date().toISOString();
  const { auditId, row } = await setProWindow(ctx, userId, until, 'set_pro');
  return ok(ctx.res, { changed: 1, message: ctx.body.pro ? `Pro for 30 days (until ${pacificDate(new Date(until))}). Credits were not touched.` : 'Pro ended. Credits were not touched.', undo: undoOffer(auditId), touched: ['users', `user:${userId}`, 'activity'], rows: [row] });
}

async function grantCredits(ctx) {
  adminOnly(ctx);
  const userId = String(ctx.body.user_id || '').trim().toLowerCase();
  if (!USER_ID_RE.test(userId)) throw bad('Valid user_id required');
  const amount = Number(ctx.body.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw bad('amount must be an integer between 1 and 500');
  const curRows = await rows(await ctx.db(`ai_credits?user_id=eq.${userId}&select=balance&limit=1`));
  if (!Array.isArray(curRows)) throw upstream('Could not read the balance.');
  const prior = curRows.length ? (Number(curRows[0].balance) || 0) : null;
  const newBalance = (prior || 0) + amount;
  const auditId = await audit(ctx.db, ctx.sess, 'grant_credits', { kind: 'user', id: userId }, { prior: { balance: prior }, next: { balance: newBalance }, metadata: { amount, new_balance: newBalance } });
  let wrote = false;
  if (curRows.length) {
    // Conditional on the balance we read: a spend in between makes this a no-op instead of a lost update.
    const up = await ctx.db(`ai_credits?user_id=eq.${userId}&balance=eq.${prior}&select=user_id`, { method: 'PATCH', body: JSON.stringify({ balance: newBalance }) });
    wrote = up.ok && ((await up.json().catch(() => [])) || []).length > 0;
    if (!up.ok) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw upstream('Failed to update balance'); }
    if (!wrote) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw conflict('The balance changed while you were looking — try again.'); }
  } else {
    const ins = await ctx.db('ai_credits?on_conflict=user_id&select=user_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: userId, balance: amount, pro: false, daily_earned: 0, last_reset: pacificDate() }) });
    wrote = ins.ok && ((await ins.json().catch(() => [])) || []).length > 0;
    if (!ins.ok) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw upstream('Failed to create credit balance'); }
    if (!wrote) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw conflict('A balance was created meanwhile — try again.'); }
  }
  await ctx.db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: userId, delta: amount, reason: 'admin_grant' }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
  return ok(ctx.res, { changed: 1, message: `Added ${plural(amount, 'credit')} · balance ${fmt(newBalance)}.`, undo: undoOffer(auditId), touched: ['users', `user:${userId}`, 'activity'], balance: newBalance });
}

async function setUserPassword(ctx) {
  adminOnly(ctx);
  const userId = String(ctx.body.user_id || '').trim();
  if (!USER_ID_RE.test(userId)) throw bad('Valid user_id required');
  const pw = String(ctx.body.new_password || '');
  if (pw.length < 8) throw bad('Password must be at least 8 characters');
  if (pw.length > 72) throw bad('Password must be 72 characters or fewer');
  await audit(ctx.db, ctx.sess, 'set_user_password', { kind: 'user', id: userId }, { metadata: { reason: str(ctx.body.reason, 200) || null } });
  const upd = await fetch(`${ctx.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'PUT', headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  if (!upd.ok) throw upstream(`Password reset failed (${upd.status})`);
  return ok(ctx.res, { changed: 1, message: 'Password changed. Tell the account holder out of band.', touched: [`user:${userId}`, 'activity'], user_id: userId });
}

async function deleteUser(ctx) {
  adminOnly(ctx);
  const userId = String(ctx.body.user_id || '').trim();
  if (!USER_ID_RE.test(userId)) throw bad('Valid user_id required');
  const auditId = await audit(ctx.db, ctx.sess, 'delete_user', { kind: 'user', id: userId }, { metadata: { pending: true } });
  // The sign-in account goes FIRST: if that fails, nothing of theirs has been touched (it used to delete the
  // app rows and then fail on auth, leaving a half-deleted account).
  const authDel = await fetch(`${ctx.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { apikey: ctx.key, Authorization: `Bearer ${ctx.key}` } });
  if (!authDel.ok && authDel.status !== 404) {
    if (auditId) await dropAuditRows(ctx.db, [auditId]);
    throw upstream(`Auth delete failed (${authDel.status}) — nothing was deleted.`);
  }
  const anon = async (table) => {
    const r = await ctx.db(`${table}?user_id=eq.${userId}&select=id`, { method: 'PATCH', body: JSON.stringify({ user_id: null }) });
    return r.ok ? ((await r.json().catch(() => [])) || []).length : null;
  };
  const reportsAnon = await anon('reports');
  const surveysAnon = await anon('resume_surveys');
  const failedTables = [];
  for (const t of ['applications', 'saved_jobs', 'credit_transactions', 'answered_questions', 'resume_employment', 'user_recent_cos', 'ai_credits']) {
    const r = await ctx.db(`${t}?user_id=eq.${userId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!r.ok && r.status !== 404) failedTables.push(t);
  }
  const pr = await ctx.db(`profiles?id=eq.${userId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!pr.ok) failedTables.push('profiles');
  if (auditId) await ctx.db(`admin_audit_log?id=eq.${auditId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata: { reports_anonymized: reportsAnon, resume_surveys_anonymized: surveysAnon, failed_tables: failedTables } }) });
  return ok(ctx.res, {
    changed: 1,
    message: failedTables.length ? `Account deleted; these could not be cleared: ${failedTables.join(', ')}.` : `Account deleted · ${plural(reportsAnon || 0, 'report')} kept anonymously.`,
    skipped: failedTables.length ? [{ reason: 'table_not_cleared', count: failedTables.length }] : [],
    touched: ['users', `user:${userId}`, 'activity', 'overview'], deleted: userId,
  });
}

// ── clusters ─────────────────────────────────────────────────────────────────────────────────────
const CLUSTER_STATUSES = ['suspected', 'safe', 'watching', 'limited', 'frozen', 'suspended'];

async function clustersList(ctx) {
  const status = CLUSTER_STATUSES.includes(ctx.body.status) ? ctx.body.status : (ctx.body.status === 'all' ? null : 'suspected');
  const got = await rows(await ctx.db(`duplicate_clusters?select=id,user_ids,signals,risk_score,status,admin_note,created_at${status ? `&status=eq.${status}` : ''}&order=risk_score.desc,id.desc&limit=200`));
  if (!Array.isArray(got)) throw upstream('Could not read the clusters.');
  const ids = [...new Set(got.flatMap((c) => (Array.isArray(c.user_ids) ? c.user_ids : [])).filter(isUuid))];
  const prof = ids.length ? await readByIds(ctx.db, 'profiles', ids, { select: 'id,email' }) : { rows: [] };
  const email = new Map(prof.rows.map((p) => [p.id, p.email]));
  const out = got.map((c) => ({ ...c, users: (c.user_ids || []).map((id) => ({ id, email: email.get(id) || null })) }));
  const total = status ? await countExact(ctx.db, `duplicate_clusters?select=id&status=eq.${status}`) : null;
  return list(ctx.res, out, { total });
}

async function updateCluster(ctx) {
  const clusterId = Number(ctx.body.cluster_id);
  const status = ctx.body.status;
  if (!Number.isInteger(clusterId) || clusterId <= 0 || !CLUSTER_STATUSES.includes(status)) throw bad('cluster_id and valid status required');
  const cur = ((await rows(await ctx.db(`duplicate_clusters?id=eq.${clusterId}&select=status,admin_note&limit=1`))) || [])[0];
  if (!cur) throw notFound('No cluster with that id.');
  const note = ctx.body.admin_note != null ? str(ctx.body.admin_note, 500) || null : cur.admin_note ?? null;
  const auditId = await audit(ctx.db, ctx.sess, 'update_cluster', { kind: 'cluster', id: clusterId }, { prior: { status: cur.status, admin_note: cur.admin_note ?? null }, next: { status, admin_note: note } });
  const up = await ctx.db(`duplicate_clusters?id=eq.${clusterId}&select=id`, { method: 'PATCH', body: JSON.stringify({ status, admin_note: note, updated_at: new Date().toISOString() }) });
  const changed = up.ok ? ((await up.json().catch(() => [])) || []).length : 0;
  if (!up.ok || !changed) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw up.ok ? notFound('No cluster with that id.') : upstream('Could not update the cluster.'); }
  return ok(ctx.res, { changed, message: `Cluster marked ${status}.`, undo: undoOffer(auditId), touched: ['clusters', 'overview', 'activity'] });
}

async function detectClusters(ctx) {
  adminOnly(ctx);
  const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();
  const signals = await rows(await ctx.db(`login_signals?created_at=gte.${encodeURIComponent(monthISO)}&select=user_id,ip_address&limit=5000`));
  if (!Array.isArray(signals)) throw upstream('Could not query signals');
  const ipGroups = {};
  for (const s of signals) {
    if (!s.ip_address || s.ip_address === 'unknown') continue;
    (ipGroups[s.ip_address] ||= new Set()).add(s.user_id);
  }
  const suspects = Object.entries(ipGroups).filter(([, u]) => u.size >= 2 && u.size <= 10).map(([ip, u]) => ({ ip, user_ids: [...u], count: u.size }));
  let created = 0;
  for (const s of suspects.slice(0, 50)) {
    const sig = `ip:${s.ip}`;
    const existing = await rows(await ctx.db(`duplicate_clusters?signals=cs.${encodeURIComponent(`{"${sig.replace(/["\\]/g, '')}"}`)}&select=id&limit=1`));
    if (Array.isArray(existing) && existing.length) continue;
    const ins = await ctx.db('duplicate_clusters?select=id', { method: 'POST', body: JSON.stringify({ user_ids: s.user_ids, signals: [sig], risk_score: Math.min(100, 20 + s.count * 10), status: 'suspected' }) });
    if (ins.ok) created++;
  }
  return ok(ctx.res, { changed: created, message: created ? `${plural(created, 'new cluster')} from ${plural(suspects.length, 'shared address', 'shared addresses')}.` : `No new clusters (${plural(suspects.length, 'shared address', 'shared addresses')} already known).`, touched: created ? ['clusters', 'overview'] : [], suspects: suspects.length, clusters_created: created });
}

async function signupAttribution(ctx) {
  const out = await loadAttributionReport(ctx.db, { days: ctx.body.days, stripeKey: process.env.STRIPE_SECRET_KEY || null });
  return answerReport(ctx, out, 'Loaded signup sources.');
}

export const actions = {
  users_list: usersList,
  user_detail: userDetail,
  set_pro_window: setProWindowAction,
  set_pro: setProLegacy,
  grant_credits: grantCredits,
  set_user_password: setUserPassword,
  delete_user: deleteUser,
  clusters_list: clustersList,
  update_cluster: updateCluster,
  detect_duplicates_by_signals: detectClusters,
  signup_attribution: signupAttribution,
};
