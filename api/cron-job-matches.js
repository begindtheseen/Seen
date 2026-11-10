// Job-match emails (owner request 2026-10-24; rebuilt on job keys 2026-11-10). Twice a day, for every
// account with a résumé on file: find the listings that match it (the SAME matcher as the /jobs
// "Matched to your résumé" rail — lib/server/resumeMatches.js on the person's job keys,
// lib/server/jobKeys.js), pick the best one the person has not applied to, saved, or heard about
// (lib/server/jobMatchEmails.js pickBestMatch, plus up to two more from other employers), and email it
// with the reason from their own résumé or applications and the listing's Seen link. At most 2 a
// California day, at least 4 hours apart, never the same job twice. The keys are rebuilt whenever the
// résumé text or recent applications differ from what they were built from, so a changed résumé means
// new matches. Nothing matched → no email (an email with nothing spot-on is worse than none).
//
// Auth: Vercel's cron GET (Authorization: Bearer CRON_SECRET, lib/server/cronAuth.js); a manual run
// with the secret or an admin session. `?dry=1` (manual only) reports, per user, every match with its
// reason and the email it would send, without claiming, sending, or writing keys; `&user=<uuid>` limits
// it to one account (`&all=1` ignores the daily/4-hour limits so a check never reads "user_limit").
//
// Idempotent and race-safe: the (user_id, job_key) log row is CLAIMED before the send; a failed send
// deletes the claim so a later run can retry. No RESEND_KEY → a dry run.
//
// Limits: JOB_MATCH_DAILY_CAP (default 40) sends a California day across ALL users — Resend's free
// plan allows 100 emails a day shared with sign-up confirmations and outcome check-ins.
// Addresses on JOB_MATCH_SKIP_DOMAINS (default seenjobs.io: the audit/test accounts) are skipped, as
// are unconfirmed addresses and anyone who opted out.
//
// Job alerts (2026-11-01, lib/server/jobAlerts.js): a person whose email_prefs.job_match_mode is
// 'alerts' gets ONLY listings whose title has an alert's words AND that sit within the alert's radius
// (or are remote, for a Remote alert), added to Seen in the last ALERT_NEW_DAYS days. They need no
// résumé. Before migration 20261101120000 the columns do not exist: everyone stays on résumé matches.

import { isVercelCron, hasCronSecret, hasAdminSession } from '../lib/server/cronAuth.js';
import { findResumeMatches, finalizeMatches } from '../lib/server/resumeMatches.js';
import {
  pickBestMatch, canSendNow, buildJobMatchEmail, jobKey, companyScoreKey, companyVerdict,
} from '../lib/server/jobMatchEmails.js';
import { unsubToken } from '../lib/server/outcomeEmails.js';
import { loadTenantNames, withTenantName } from '../lib/server/tenantNames.js';
import { pacificDayStart } from '../lib/time/pacific.js';
import { logError } from '../lib/server/errlog.js';
import { boundingBox } from '../lib/server/geo.js';
import { scoreRow } from '../lib/server/jobScore.js';
import { prefsFromRow, matchAlerts, alertDbTerm, ALERT_NEW_DAYS } from '../lib/server/jobAlerts.js';
import { matchListing } from '../lib/server/jobKeys.js';
import { fetchFullPosting } from '../lib/server/fullPosting.js';
import { withCronRecord } from '../lib/server/cronRecord.js';

const SITE = 'https://seenjobs.io';
const BUDGET_MS = 240_000;
const ALERT_COLS = 'id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,lat,lng,ats_tenant,created_at';

// lib/geo/usPlaces.js, loaded only when someone has alerts (tests pass their own).
async function loadUsPlaces() {
  try { return await import('../lib/geo/usPlaces.js'); } catch { return null; }
}

/**
 * PostgREST pre-filter for a local alert: its bounding box OR a nearby place named in the location
 * text (most rows have no coordinates). Only a pre-filter: matchAlerts decides the radius.
 */
export function alertScopeClause(alert, geo) {
  const parts = [];
  const b = boundingBox({ lat: alert.lat, lng: alert.lng }, alert.miles);
  const f = (n) => n.toFixed(6);
  if (b) parts.push(`and(lat.gte.${f(b.latMin)},lat.lte.${f(b.latMax)},lng.gte.${f(b.lngMin)},lng.lte.${f(b.lngMax)})`);
  const clean = (x) => String(x || '').replace(/[(),*\\]/g, '').replace(/\./g, '*').trim();
  const names = new Set([clean(String(alert.place || '').split(',')[0])]);
  let near = [];
  try { near = typeof geo?.placesWithin === 'function' ? geo.placesWithin({ lat: alert.lat, lng: alert.lng }, alert.miles, { limit: 12 }) : []; } catch { near = []; }
  for (const pl of near) names.add(clean(pl.name));
  for (const n of names) if (n.length >= 3) parts.push(`location.ilike.*${n}*`);
  return parts.length ? `&or=${encodeURIComponent(`(${parts.join(',')})`)}` : null;
}

/**
 * Listings for a person's alerts, matched (title words + radius) and ranked by the listing's own
 * score. null when every read failed (the caller skips the person rather than guess).
 */
async function findAlertMatches(alerts, geo, rows) {
  const now = encodeURIComponent(new Date().toISOString());
  const since = encodeURIComponent(new Date(Date.now() - ALERT_NEW_DAYS * 86_400_000).toISOString());
  const usableAlerts = alerts.map((a) => {
    if (a.remote || (a.lat != null && a.lng != null)) return a;
    const g = (() => { try { return geo.geocodePlace(a.place); } catch { return null; } })();
    return g && Number.isFinite(Number(g.lat)) ? { ...a, lat: Number(g.lat), lng: Number(g.lng) } : null;
  });
  const reads = usableAlerts.map((a) => {
    if (!a) return Promise.resolve([]);
    const term = alertDbTerm(a);
    const scope = a.remote ? '&location=ilike.*remote*' : alertScopeClause(a, geo);
    if (!term || scope == null) return Promise.resolve([]);
    return rows(`jobs?title=ilike.*${encodeURIComponent(term)}*${scope}&expires_at=gt.${now}&created_at=gte.${since}&select=${ALERT_COLS}&order=created_at.desc&limit=100`);
  });
  const results = await Promise.all(reads);
  if (results.length && results.every((r) => r === null)) return null;
  const matched = matchAlerts(results.flatMap((r) => r || []), usableAlerts.map((a) => a || { keywords: '' }), geo);
  return matched
    .map((j) => ({ ...j, _matchScore: scoreRow(j).score || 0 }))
    .sort((a, b) => b._matchScore - a._matchScore);
}

// ── A summary is not a posting (2026-11-10, the GSG incident) ─────────────────────────────────────
// A listing may be EMAILED only when its requirements were read from the full posting. A row whose stored
// text is a teaser is read through lib/server/fullPosting.js (which also stores the posting on the row and
// marks a closed one gone), the match rule runs again on the full text, and the row is dropped when it
// fails, is gone, or cannot be read. Bounded: at most MAX_FETCHES per user per run, inside the run's
// clock; a row that could not be read is not tried again on this instance for UNREADABLE_TTL_MS.
export const MAX_FETCHES = 4;

/** How many emails a set of log rows stands for: one person's rows within two minutes are one email. */
export function countEmails(rows) {
  const byUser = new Map();
  for (const r of rows || []) {
    const t = Date.parse(r.sent_at);
    if (!Number.isFinite(t)) continue;
    const list = byUser.get(r.user_id) || [];
    list.push(t);
    byUser.set(r.user_id, list);
  }
  let n = 0;
  for (const list of byUser.values()) {
    list.sort((a, b) => a - b);
    let last = -Infinity;
    for (const t of list) { if (t - last > 120_000) n++; last = t; }
  }
  return n;
}
const FETCH_TIMEOUT_MS = 7000;
const UNREADABLE_TTL_MS = 6 * 3600e3;
const _unreadable = new Map();

/**
 * @param {Array<object>} rows ranked rows (already filtered to ones this person could be sent)
 * @returns {Promise<{ rows: Array<object>, fetched: number, dropped: Array<{ id: string, why: string }> }>}
 */
export async function confirmFullPostings(rows, keys, { db, deadline, fetchFull = fetchFullPosting, want = 3, max = MAX_FETCHES, now = new Date() }) {
  const out = []; const dropped = []; let fetched = 0;
  for (const j of rows) {
    if (out.length >= want) break;
    if (!j._summaryOnly) { out.push(j); continue; }
    const id = String(j.id);
    const miss = _unreadable.get(id);
    if (miss && Date.now() - miss < UNREADABLE_TTL_MS) { dropped.push({ id, why: 'unreadable_recently' }); continue; }
    if (fetched >= max || Date.now() > deadline - FETCH_TIMEOUT_MS - 5000) { dropped.push({ id, why: 'no_time' }); continue; }
    fetched++;
    let full = null;
    try { full = await fetchFull({ jobId: id, db, timeoutMs: FETCH_TIMEOUT_MS }); } catch { full = null; }
    if (!full || !full.ok) { _unreadable.set(id, Date.now()); dropped.push({ id, why: full?.reason === 'gone' ? 'gone' : 'unreadable' }); continue; }
    const row = { ...j, description: full.description };
    const m = matchListing(row, keys, { now, mode: 'email' });
    if (!m.ok || m.summaryOnly || !m.reason) { dropped.push({ id, why: m.ok ? 'still_summary' : `full_posting:${m.why}` }); continue; }
    out.push({ ...row, _reason: m.reason, _basis: m.basis, _need: m.need, _have: m.have, _summaryOnly: false });
  }
  return { rows: out, fetched, dropped };
}

function handler(req, res) { return run(req, res, { loadGeo: loadUsPlaces }); }

/** The handler with its geocoder / full-posting reader swapped (tests). */
export function makeHandler({ loadGeo = loadUsPlaces, fetchFull = fetchFullPosting } = {}) { return (req, res) => run(req, res, { loadGeo, fetchFull }); }

async function run(req, res, { loadGeo, fetchFull = fetchFullPosting }) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const cron = req.method === 'GET' && isVercelCron(req);
  const manual = !cron && (hasCronSecret(req) || await hasAdminSession(req));
  if (!cron && !manual) return res.status(401).json({ error: 'unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_KEY;
  const EMAIL_SECRET = process.env.EMAIL_UNSUB_SECRET || process.env.CRON_SECRET || SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'db_not_configured' });

  const qDry = String(req.query?.dry ?? '') === '1';
  // `?dry=1` is honoured for every authorised caller (it only removes effects): before 2026-11-10 a GET
  // with `Authorization: Bearer <CRON_SECRET>` counted as Vercel's cron and ignored dry=1 — a "check" sent mail.
  const dry = qDry || !RESEND_KEY;
  const onlyUser = (manual || dry) && /^[0-9a-f-]{36}$/i.test(String(req.query?.user || '')) ? String(req.query.user).toLowerCase() : null;
  const ignoreLimits = dry && String(req.query?.all ?? '') === '1';
  const dailyCap = Math.max(0, Number(process.env.JOB_MATCH_DAILY_CAP ?? 40) || 0);
  const skipDomains = String(process.env.JOB_MATCH_SKIP_DOMAINS ?? 'seenjobs.io').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const deadline = Date.now() + BUDGET_MS;

  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  const q = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const rows = async (path) => { const r = await q(path).catch(() => null); if (!r || !r.ok) return null; const j = await r.json().catch(() => null); return Array.isArray(j) ? j : null; };

  const summary = { ok: true, dry, users: 0, sent: 0, picked: [], skipped: {}, cap: dailyCap, sent_today_before: 0 };
  const skip = (why) => { summary.skipped[why] = (summary.skipped[why] || 0) + 1; };

  try {
    const dayStart = pacificDayStart(new Date()).toISOString();
    // Emails, not log rows: one email claims its main job and up to MORE_ITEMS extra jobs (rows seconds apart).
    const todayRes = await q(`job_match_email_log?sent_at=gte.${encodeURIComponent(dayStart)}&select=user_id,sent_at&order=sent_at.asc&limit=5000`);
    if (!todayRes.ok) return res.status(200).json({ ok: false, reason: 'log_unreadable', status: todayRes.status });
    const todayRows = await todayRes.json().catch(() => null);
    if (!Array.isArray(todayRows)) return res.status(200).json({ ok: false, reason: 'log_unreadable' });
    let sentToday = countEmails(todayRows);
    summary.sent_today_before = sentToday;

    // Everyone with a résumé on file (keyset pages; PostgREST caps a read at 1,000 rows).
    const users = [];
    for (let after = '', guard = 0; guard < 50; guard++) {
      const page = await rows(`profiles?select=id&resume_text=not.is.null${after ? `&id=gt.${after}` : ''}&order=id.asc&limit=1000`);
      if (!page) return res.status(200).json({ ok: false, reason: 'profiles_unreadable' });
      users.push(...page.map((p) => p.id));
      if (page.length < 1000) break;
      after = page[page.length - 1].id;
    }

    const optRows = await rows('email_prefs?select=user_id&job_match_opt_out=eq.true&limit=10000');
    if (!optRows) return res.status(200).json({ ok: false, reason: 'prefs_unreadable' });
    const optOut = new Set(optRows.map((r) => r.user_id));

    // People on "only my job alerts" (they need no résumé). A missing column = migration not applied.
    const alertPrefs = new Map();
    const ar = await q('email_prefs?select=user_id,job_match_mode,job_alerts,job_match_opt_out&job_match_mode=eq.alerts&job_match_opt_out=eq.false&limit=10000').catch(() => null);
    if (ar && ar.ok) {
      const list = await ar.json().catch(() => null);
      if (!Array.isArray(list)) return res.status(200).json({ ok: false, reason: 'prefs_unreadable' });
      for (const r of list) alertPrefs.set(r.user_id, prefsFromRow(r));
      summary.alerts_ready = true;
    } else {
      const err = ar ? await ar.json().catch(() => null) : null;
      const code = String(err?.code || '');
      if (code !== '42703' && code !== 'PGRST204') return res.status(200).json({ ok: false, reason: 'prefs_unreadable' });
      summary.alerts_ready = false; // columns not there yet: everyone stays on résumé matches
    }
    const known = new Set(users);
    for (const id of alertPrefs.keys()) if (!known.has(id)) users.push(id);
    if (onlyUser) { const keep = users.filter((id) => String(id).toLowerCase() === onlyUser); users.length = 0; users.push(...keep); }
    summary.users = users.length;
    summary.alert_users = alertPrefs.size;
    const geo = alertPrefs.size ? await loadGeo() : null;
    const tenantNames = await loadTenantNames(SUPABASE_URL, headers).catch(() => new Map());

    for (const uid of users) {
      if (Date.now() > deadline) { skip('out_of_time'); continue; }
      if (sentToday >= dailyCap && !ignoreLimits) { skip('daily_cap'); continue; }
      if (optOut.has(uid)) { skip('opted_out'); continue; }

      // This person's history: what Seen already emailed, applied to, saved.
      const u = encodeURIComponent(uid);
      const [log, apps, saved] = await Promise.all([
        rows(`job_match_email_log?user_id=eq.${u}&select=job_id,job_key,company,sent_at&order=sent_at.desc&limit=1000`),
        rows(`applications?user_id=eq.${u}&select=job_id,company_name,role&limit=1000`),
        rows(`saved_jobs?user_id=eq.${u}&select=job_id&limit=1000`),
      ]);
      if (!log || !apps || !saved) { skip('history_unreadable'); continue; } // never risk a repeat
      const dayStartMs = Date.parse(dayStart);
      const todays = log.filter((r) => Date.parse(r.sent_at) >= dayStartMs);
      if (!ignoreLimits && !canSendNow({ sentToday: countEmails(todays.map((r) => ({ ...r, user_id: uid }))), lastSentAt: log[0]?.sent_at || null })) { skip('user_limit'); continue; }

      const prefs = alertPrefs.get(uid) || null;
      let found;
      let city = null;
      let keys = null;
      let residentText = '';
      if (prefs) {
        if (!prefs.alerts.length) { skip('no_alerts'); continue; }
        if (!geo) { skip('geo_unavailable'); continue; }
        found = await findAlertMatches(prefs.alerts, geo, rows);
        if (!found) { skip('jobs_unreadable'); continue; }
        // Their own alert words choose the field; their résumé (when there is one) still decides whether
        // they meet what the listing requires — years in that field, licences, level.
        const km = await findResumeMatches({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, userId: uid, persist: !dry, onlyKeys: true }).catch(() => null);
        if (km?.heal) await km.heal;
        if (km?.keys) found = found.filter((j) => matchListing(j, km.keys, { alert: true }).ok);
      } else {
        const m = await findResumeMatches({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, userId: uid, persist: !dry, mode: 'email' });
        if (m.heal) await m.heal;
        if (m.reason) {
          skip(m.reason);
          if (dry) summary.picked.push({ user: uid.slice(0, 8), reason: m.reason, matches: [] });
          continue;
        }
        found = m.ranked;
        city = m.city;
        keys = m.keys;
        residentText = m.resumeText || '';
      }
      const ranked = found.map((j) => withTenantName(j, tenantNames));
      const dryMatches = dry && !prefs ? ranked.slice(0, 15).map((j) => ({ job_id: j.id, title: j.title, company: j.company, location: j.location, miles: j._miles ?? null, remote: !!j._remote, reason: j._reason, basis: j._basis, summary_only: !!j._summaryOnly })) : null;
      const dryKeys = dry && keys ? {
        occupations: (keys.occupations || []).map((o) => `${o.label} · ${o.years} yr${o.current ? ' · current' : ''}`),
        applied: (keys.applied || []).map((a) => `${a.title} at ${a.company || '?'} (${a.at})`),
        education: (keys.education || []).map((e) => `${e.degree} ${e.field}${e.studying ? ' (studying)' : ''}`),
        credentials: keys.credentials || [],
      } : null;
      if (!ranked.length) {
        skip('no_matches');
        if (dry) summary.picked.push({ user: uid.slice(0, 8), reason: 'no_matches', keys: dryKeys, matches: [] });
        continue;
      }

      // Teasers: read the full posting for the best candidates this person could actually be sent, and keep
      // only the ones that still match on the full text (résumé mode; alert rows are their own words).
      let confirmed = ranked;
      if (!prefs) {
        const emailedKeys = new Set(log.map((r) => r.job_key));
        const emailedIds = new Set(log.map((r) => String(r.job_id)));
        const appliedIds = new Set(apps.map((a) => a.job_id).filter(Boolean).map(String));
        const savedIds = new Set(saved.map((s) => s.job_id).filter(Boolean).map(String));
        const open = ranked.filter((j) => j.id && !emailedKeys.has(jobKey(j)) && !emailedIds.has(String(j.id)) && !appliedIds.has(String(j.id)) && !savedIds.has(String(j.id)));
        // A dry run never writes: the reader's store / gone-marking calls answer as if done.
        const readDb = dry ? (path, opts = {}) => ((opts.method || 'GET').toUpperCase() === 'GET' ? q(path, opts) : Promise.resolve(new Response(null, { status: 204 }))) : q;
        const c = await confirmFullPostings(open, keys, { db: readDb, deadline, fetchFull, want: 8 });
        // The final yes is the fit check's: its gates on the full posting, and a reason naming what in each
        // listing the résumé shows (no two the same). Nothing it marks "gate not met" is ever emailed.
        const f = finalizeMatches(c.rows, residentText, { limit: 6, keys });
        confirmed = f.rows;
        for (const d of f.dropped) { c.dropped.push(d); }
        summary.full_posting_reads = (summary.full_posting_reads || 0) + c.fetched;
        for (const d of c.dropped) { const k = d.why.startsWith('gate:') ? d.why.replace(':', '_') : `teaser_${d.why.split(':')[0]}`; summary.skipped[k] = (summary.skipped[k] || 0) + 1; }
        if (dry && dryMatches) for (const dm of dryMatches) { const d = c.dropped.find((x) => x.id === String(dm.job_id)); if (d) dm.dropped = d.why; }
        if (!confirmed.length) {
          const why = open.length ? 'no_readable_match' : 'no_good_match'; // nothing new vs. nothing readable
          skip(why);
          if (dry) summary.picked.push({ user: uid.slice(0, 8), reason: why, keys: dryKeys, matches: dryMatches });
          continue;
        }
      }

      // The employers' Seen grades, for the D/F gate and the email's verdict line.
      const companies = [...new Set(confirmed.slice(0, 40).map((j) => companyScoreKey(j.company)).filter(Boolean))];
      const scores = new Map();
      if (companies.length) {
        const list = companies.map((c) => `"${c.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
        const sr = await rows(`company_scores?company_name=in.(${encodeURIComponent(list)})&select=company_name,overall_score,response_rate,first_party_report_count,mention_count&limit=200`);
        if (!sr) { skip('grades_unreadable'); continue; } // the D/F gate must not be skipped silently
        for (const s of sr) scores.set(companyScoreKey(s.company_name), s);
      }

      const pick = pickBestMatch(confirmed, {
        emailedKeys: new Set(log.map((r) => r.job_key)),
        emailedJobIds: new Set(log.map((r) => String(r.job_id))),
        appliedJobIds: new Set(apps.map((a) => a.job_id).filter(Boolean).map(String)),
        appliedKeys: new Set(apps.map((a) => jobKey({ title: a.role, company: a.company_name }))),
        savedJobIds: new Set(saved.map((s) => s.job_id).filter(Boolean).map(String)),
        companiesToday: new Set(todays.map((r) => companyScoreKey(r.company))),
        scores,
        alertMode: !!prefs,
      });
      if (!pick) {
        skip('no_good_match');
        if (dry) summary.picked.push({ user: uid.slice(0, 8), reason: 'no_good_match', keys: dryKeys, matches: dryMatches });
        continue;
      }
      const { job } = pick;
      const verdict = companyVerdict(scores.get(companyScoreKey(job.company)));

      // The address: confirmed, not a test domain.
      let email = null;
      try {
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
        if (ur.ok) { const au = await ur.json(); if (au?.email && au.email_confirmed_at) email = String(au.email); }
      } catch { /* leave null */ }
      if (!email) { skip('no_confirmed_email'); continue; }
      const domain = email.split('@')[1]?.toLowerCase() || '';
      if (skipDomains.includes(domain)) { skip('test_domain'); continue; }

      const alert = prefs ? prefs.alerts[job._alert] || null : null;
      const utm = `utm_source=email&utm_medium=job_match&utm_campaign=${alert ? 'job_alert' : 'resume_match'}`;
      const applyUrl = `${SITE}/jobs/${encodeURIComponent(String(job.id))}?${utm}`;
      const companyPageUrl = verdict ? `${SITE}/company/${encodeURIComponent(String(job.company).toLowerCase().replace(/\s+/g, '-'))}?${utm}` : null;
      const unsubUrl = `${SITE}/api/unsubscribe?list=job_matches&uid=${u}&token=${unsubToken(uid, EMAIL_SECRET, 'job_matches')}`;
      const settingsUrl = alert ? `${SITE}/profile?${utm}#alerts` : null;
      const more = (pick.more || []).map((m) => ({ ...m, url: `${SITE}/jobs/${encodeURIComponent(String(m.job.id))}?${utm}` }));
      const mail0 = { job, verdict, city, applyUrl, unsubUrl, companyPageUrl, alert, settingsUrl };
      const report = { user: uid.slice(0, 8), job_id: job.id, title: job.title, company: job.company, location: job.location, reason: job._reason || null, alert: alert ? alert.keywords : null, grade: verdict?.letter || null, more: more.map((m) => ({ job_id: m.job.id, title: m.job.title, company: m.job.company, reason: m.job._reason })) };

      if (dry) {
        const mail = buildJobMatchEmail({ ...mail0, more });
        summary.picked.push({ ...report, subject: mail.subject, text: mail.text, keys: dryKeys, matches: dryMatches });
        continue;
      }

      const key = jobKey(job);
      const claim = await q('job_match_email_log', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: uid, job_id: String(job.id), job_key: key, company: companyScoreKey(job.company) }),
      });
      if (claim.status === 409) { skip('already_sent'); continue; }
      if (!claim.ok) { skip('claim_failed'); continue; }
      // The extra items are claimed too (never sent twice); one that cannot be claimed is left out.
      const claimedMore = [];
      for (const m of more) {
        const mk = jobKey(m.job);
        const c = await q('job_match_email_log', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ user_id: uid, job_id: String(m.job.id), job_key: mk, company: companyScoreKey(m.job.company) }),
        }).catch(() => null);
        if (c && c.ok) claimedMore.push({ ...m, key: mk });
      }
      const release = async () => {
        for (const k of [key, ...claimedMore.map((m) => m.key)]) {
          await q(`job_match_email_log?user_id=eq.${u}&job_key=eq.${encodeURIComponent(k)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
        }
      };
      const mail = buildJobMatchEmail({ ...mail0, more: claimedMore });
      report.subject = mail.subject;

      try {
        const send = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Seen <noreply@seenjobs.io>', to: [email], subject: mail.subject, html: mail.html, text: mail.text,
            headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
            tags: [{ name: 'kind', value: 'job_match' }],
          }),
        });
        if (send.ok) { summary.sent++; sentToday++; summary.picked.push(report); }
        else { await release(); skip(`send_${send.status}`); }
      } catch {
        await release();
        skip('send_error');
      }
    }
    return res.status(200).json(summary);
  } catch (e) {
    logError('cron-job-matches', e.message);
    return res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 200), ...summary });
  }
}

// every Vercel cron run is recorded for Admin → System (ok / partial / failed, a short count, duration_ms)
export default withCronRecord('cron-job-matches', handler);
