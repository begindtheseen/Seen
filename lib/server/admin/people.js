// People: user search (every profile, no 100 cap), a user's sheet, the Pro window, credits, password reset,
// account deletion, duplicate-account clusters, and where signups come from.
//
// Pro is a WINDOW (ai_credits.pro_until). Setting it never touches a balance: the old "Grant/Revoke Pro" wrote
// balance 999 / 3, so revoking a buyer's Pro threw away the credits they had paid for.

import { ok, list, plural, fmt, undoOffer } from './respond.js';
import { adminOnly, bad, notFound, upstream, conflict, str } from './context.js';
import { rows, keysetPage, isUuid, countExact, readByIds, readAll } from './batch.js';
import { audit, dropAuditRows } from './audit.js';
import { ilikeContains } from '../pgrest.js';
import { pacificDate, pacificDayStart } from '../../time/pacific.js';
import { loadAttributionReport, landingGroup, referrerGroup } from '../attributionReport.js';
import { answerReport, creditTotals } from './system.js';
import { registerVerifier, unknownOutcome } from './idempotency.js';
import { dateWords } from './words.js';

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
    const all = await readAll(ctx.db, 'ai_credits', { select: CREDIT_SELECT, filter: `or=(pro.is.true,pro_until.gt.${encodeURIComponent(new Date().toISOString())})`, idCol: 'user_id', max: 100000 });
    if (!all.ok) throw upstream('Could not read Pro accounts.');
    const holders = all.rows;
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
    ctx.db(`credit_transactions?user_id=eq.${id}&select=delta,reason,metadata,created_at&order=created_at.desc&limit=50`).then(rows),
    countExact(ctx.db, `applications?user_id=eq.${id}&select=id`),
    countExact(ctx.db, `reports?user_id=eq.${id}&select=id`),
  ]);
  if (!Array.isArray(p)) throw upstream('Could not read the account.');
  if (!p[0]) throw notFound('No account with that id.');
  const [totals, signup] = await Promise.all([creditTotals(ctx.db, `user_id=eq.${id}`), signupSource(ctx.db, id)]);
  // `ledger` is the newest 50 entries (note = why an admin gave them); totals are summed over every entry.
  const ledgerRows = !Array.isArray(ledger) ? null : ledger.map(({ metadata, ...l }) => ({ ...l, note: metadata?.note ?? null, by: metadata?.by ?? null }));
  const row = { ...userRow(p[0], (c || [])[0]), ledger: ledgerRows, credits_earned: totals.earned, credits_spent: totals.spent, signup_source: signup, applications: apps, reports };
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

/** Where an account came from (signup_attribution, migration 20261024180000), or null: no row, or no table yet. */
export async function signupSource(db, userId) {
  const row = ((await rows(await db(`signup_attribution?user_id=eq.${userId}&select=landing_path,referrer_host,utm_source,utm_medium,utm_campaign,ref_code,first_seen_at&limit=1`))) || [])[0];
  if (!row) return null;
  return { ...row, landing_group: landingGroup(row.landing_path), referrer_group: referrerGroup(row.referrer_host) };
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
  return ok(ctx.res, { changed: 1, message: active ? `Pro until ${dateWords(until)}.` : 'Pro ended. Credits were not touched.', undo: undoOffer(auditId), touched: ['users', `user:${userId}`, 'activity'], rows: [row] });
}

/** Legacy set_pro {user_id, pro}: pro → a 30-day window, not pro → ends the window. Never a balance. */
async function setProLegacy(ctx) {
  const userId = String(ctx.body.user_id || '').toLowerCase();
  if (!userId) throw bad('user_id required');
  if (!USER_ID_RE.test(userId)) throw bad('Valid user_id required');
  const until = ctx.body.pro ? new Date(Date.now() + 30 * 86400e3).toISOString() : new Date().toISOString();
  const { auditId, row } = await setProWindow(ctx, userId, until, 'set_pro');
  return ok(ctx.res, { changed: 1, message: ctx.body.pro ? `Pro for 30 days (until ${dateWords(until)}). Credits were not touched.` : 'Pro ended. Credits were not touched.', undo: undoOffer(auditId), touched: ['users', `user:${userId}`, 'activity'], rows: [row] });
}

// A credit grant is ADDITIVE (repeating it grants again): it records its intent before writing, keeps its audit row
// when the database's answer is lost, and a Retry with the same request_id compares the balance with the intent
// (lib/server/admin/idempotency.js). The ledger row and the audit row carry the request key, so a finished-late
// grant can be completed without inserting a second one.
const grantSentence = (amount, balance, note) => `Added ${plural(amount, 'credit')} · balance ${fmt(balance)}${note ? ` — “${note}”` : ''}.`;
const lost = (r) => !r || r.status === 0 || r.status >= 500;

async function ensureGrantLedger(db, intent, key, by) {
  if (key) {
    const have = await rows(await db(`credit_transactions?user_id=eq.${intent.user_id}&reason=eq.admin_grant&metadata->>request=eq.${encodeURIComponent(key)}&select=id&limit=1`));
    if (Array.isArray(have) && have.length) return true;
  }
  const r = await db('credit_transactions?select=id', { method: 'POST', body: JSON.stringify({ user_id: intent.user_id, delta: intent.amount, reason: 'admin_grant', metadata: { ...(intent.note ? { note: intent.note } : {}), by, ...(key ? { request: key } : {}) } }) });
  return !!(r && r.ok);
}

async function grantCredits(ctx) {
  adminOnly(ctx);
  const userId = String(ctx.body.user_id || '').trim().toLowerCase();
  if (!USER_ID_RE.test(userId)) throw bad('Valid user_id required');
  const amount = Number(ctx.body.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw bad('amount must be an integer between 1 and 500');
  // Why the credits were given: stored on the ledger row (credit_transactions.metadata.note) and the audit row.
  const note = str(ctx.body.reason, 200) || null;
  const key = ctx.requestKey || null;
  const curRows = await rows(await ctx.db(`ai_credits?user_id=eq.${userId}&select=balance&limit=1`));
  if (!Array.isArray(curRows)) throw upstream('Could not read the balance.');
  const prior = curRows.length ? (Number(curRows[0].balance) || 0) : null;
  const newBalance = (prior || 0) + amount;
  const intent = { kind: 'credit_grant', user_id: userId, prior, next: newBalance, amount, note };
  if (ctx.recordIntent) await ctx.recordIntent(intent);
  const auditId = await audit(ctx.db, ctx.sess, 'grant_credits', { kind: 'user', id: userId }, { prior: { balance: prior }, next: { balance: newBalance }, metadata: { amount, new_balance: newBalance, reason: note, ...(key ? { request: key } : {}) } });
  let wrote = false;
  if (curRows.length) {
    // Conditional on the balance we read: a spend in between makes this a no-op instead of a lost update.
    const up = await ctx.db(`ai_credits?user_id=eq.${userId}&balance=eq.${prior}&select=user_id`, { method: 'PATCH', body: JSON.stringify({ balance: newBalance }) });
    // A lost answer (timeout, reset, 5xx) may have landed: keep the audit row, the record turns 'unknown'.
    if (lost(up)) throw unknownOutcome('The database did not confirm the grant — press Retry to check whether it went through.');
    wrote = up.ok && ((await up.json().catch(() => [])) || []).length > 0;
    if (!up.ok) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw upstream('The database refused the balance change — nothing was granted.'); }
    if (!wrote) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw conflict('The balance changed while you were looking — try again.'); }
  } else {
    const ins = await ctx.db('ai_credits?on_conflict=user_id&select=user_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ user_id: userId, balance: amount, pro: false, daily_earned: 0, last_reset: pacificDate() }) });
    if (lost(ins)) throw unknownOutcome('The database did not confirm the grant — press Retry to check whether it went through.');
    wrote = ins.ok && ((await ins.json().catch(() => [])) || []).length > 0;
    if (!ins.ok) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw upstream('The database refused the new balance — nothing was granted.'); }
    if (!wrote) { if (auditId) await dropAuditRows(ctx.db, [auditId]); throw conflict('A balance was created meanwhile — try again.'); }
  }
  // The balance changed; the ledger row must follow. If its write is lost, the record is 'unknown' and Retry finishes it.
  if (!(await ensureGrantLedger(ctx.db, intent, key, ctx.sess.username).catch(() => false))) throw unknownOutcome('The credits were added but the ledger row was not confirmed — press Retry to finish.');
  return ok(ctx.res, { changed: 1, message: grantSentence(amount, newBalance, note), undo: undoOffer(auditId), touched: ['users', `user:${userId}`, 'activity'], balance: newBalance });
}

// Verifier for an 'unknown' grant: the balance decides. == next → done (finish the ledger and audit rows);
// == prior (or still no row) → nothing happened; anything else → conflict, naming the balance.
registerVerifier('credit_grant', {
  async verify(ctx, intent) {
    const cur = await rows(await ctx.db(`ai_credits?user_id=eq.${intent.user_id}&select=balance&limit=1`));
    if (!Array.isArray(cur)) throw new Error('unreadable');
    if (!cur.length) return intent.prior == null ? { state: 'nothing' } : { state: 'conflict', message: 'The account has no credit balance any more — check before granting again.' };
    const bal = Number(cur[0].balance) || 0;
    if (bal === intent.next) return { state: 'done' };
    if (intent.prior != null && bal === intent.prior) return { state: 'nothing' };
    return { state: 'conflict', message: `The balance changed since your first press (it is now ${fmt(bal)}) — check before granting again.` };
  },
  async finish(ctx, intent, key) {
    await ensureGrantLedger(ctx.db, intent, key, ctx.sess.username).catch(() => false);
    let auditId = null;
    const found = await rows(await ctx.db(`admin_audit_log?action=eq.grant_credits&target_type=eq.user&target_id=eq.${intent.user_id}&metadata->>request=eq.${encodeURIComponent(key)}&select=id&order=id.desc&limit=1`));
    if (Array.isArray(found) && found[0]) auditId = String(found[0].id);
    else auditId = await audit(ctx.db, ctx.sess, 'grant_credits', { kind: 'user', id: intent.user_id }, { prior: { balance: intent.prior }, next: { balance: intent.next }, metadata: { amount: intent.amount, new_balance: intent.next, reason: intent.note ?? null, request: key, restored: true } }, { required: false });
    return { ok: true, changed: 1, skipped: [], message: grantSentence(intent.amount, intent.next, intent.note), undo: undoOffer(auditId), touched: ['users', `user:${intent.user_id}`, 'activity'], balance: intent.next };
  },
  // The grant did not land: the first try's kept audit row describes a grant that never happened, and the re-run
  // writes its own — remove the old one so one press leaves one row.
  async cleanup(ctx, intent, key) {
    const r = await ctx.db(`admin_audit_log?action=eq.grant_credits&target_type=eq.user&target_id=eq.${intent.user_id}&metadata->>request=eq.${encodeURIComponent(key)}&select=id`, { method: 'DELETE' });
    if (!r || !r.ok) throw new Error('audit clean-up refused');
  },
});

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

/** A cluster id: a positive integer (production: bigserial) or a uuid (the rig seeds uuids). */
export function clusterIdOf(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[1-9]\d{0,18}$/.test(s) || isUuid(s) ? s : null;
}

async function clusterDetail(ctx) {
  const clusterId = clusterIdOf(ctx.body.cluster_id ?? ctx.body.id);
  if (!clusterId) throw bad('cluster_id required');
  const c = ((await rows(await ctx.db(`duplicate_clusters?id=eq.${clusterId}&select=id,user_ids,signals,risk_score,status,admin_note,created_at,updated_at&limit=1`))) || [])[0];
  if (!c) throw notFound('No cluster with that id.');
  const ids = (Array.isArray(c.user_ids) ? c.user_ids : []).filter(isUuid);
  const prof = ids.length ? await readByIds(ctx.db, 'profiles', ids, { select: 'id,email,created_at' }) : { rows: [] };
  const credits = await creditsFor(ctx.db, ids);
  const byId = new Map(prof.rows.map((p) => [p.id, p]));
  const users = ids.map((id) => ({ ...userRow(byId.get(id) || { id }, credits.get(id)), found: byId.has(id) }));
  return ok(ctx.res, { message: `${plural(users.length, 'account')} sharing ${(c.signals || []).join(', ') || 'a signal'}.`, rows: [{ ...c, users }] });
}

async function updateCluster(ctx) {
  const clusterId = clusterIdOf(ctx.body.cluster_id);
  const status = ctx.body.status;
  if (!clusterId || !CLUSTER_STATUSES.includes(status)) throw bad('cluster_id and valid status required');
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
  const read = await readAll(ctx.db, 'login_signals', { select: 'id,user_id,ip_address', filter: `created_at=gte.${encodeURIComponent(monthISO)}`, max: 200000 });
  if (!read.ok) throw upstream('Could not query signals');
  const signals = read.rows;
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
  cluster_detail: clusterDetail,
  detect_duplicates_by_signals: detectClusters,
  signup_attribution: signupAttribution,
};
