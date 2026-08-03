// Internal Admin API — username/password auth + all platform operations.
// ALL endpoints except admin_login require X-Admin-Token session header.
// Passwords hashed with scrypt (Node built-in). No plaintext credentials stored.

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto';
import {
  SOURCE_TRUST, PRIOR_STRENGTH, classifyPlatform, fuseCompanyIntel, aggregateOutcomes,
  GHOST_OUTCOMES, RESPONSE_OUTCOMES, NONTERMINAL_OUTCOMES,
} from './_utils/companyIntel.js';
import { recomputeCompanyScoreFromReports, normalizeCompany } from './_utils/reportWrite.js';
import { logError } from '../lib/server/errlog.js';
import { buildCompanyAuditBundle } from './_utils/companyAuditBundle.js';
import { isDisputeStatus, isDisputeReviewStatus, disputeStatusCounts, orderDisputesOpenFirst } from './_utils/companyReddit.js';
import { isDisputeDecision, resolveDisputeEffect, disputeStatusCounts as listingDisputeCounts, orderDisputesOpenFirst as orderListingDisputes, buildListingTickets } from '../lib/server/listingDisputes.js';
import { buildNotificationRow } from '../lib/server/employerNotificationsStore.js';
import { normalizeClaimCompany } from '../lib/server/employerClaims.js';
import { EMPLOYER_SKUS } from '../lib/server/employerSkus.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

function hashPw(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

// Live subscription breakdown from Stripe (trial vs paid vs canceled) + a rough MRR.
// Returns null when Stripe isn't configured so the dashboard degrades gracefully.
async function stripeSubsBreakdown() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    // NOTE: `items` is a default-included list on every subscription object — it is NOT
    // expandable. Passing expand[]=data.items 400s the whole request (the same bug #124
    // removed from api/stripe.js — this was the missed copy). We read s.items.data[0]
    // directly for the MRR price lookup; no expand needed.
    const r = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=100', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const counts = { trialing: 0, active: 0, past_due: 0, canceled: 0, unpaid: 0, incomplete: 0 };
    // A sub the user cancelled keeps its live status (trialing / active) with
    // cancel_at_period_end=true until the period actually ends — so a cancelled trial
    // otherwise still shows as an active trial. Track the churning set separately.
    let canceling = 0;          // any live sub flagged cancel_at_period_end
    let trialingCanceling = 0;  // trials already cancelled (status still 'trialing')
    let activeCanceling = 0;    // paid subs set to cancel at period end
    let mrrCents = 0;
    for (const s of (d.data || [])) {
      counts[s.status] = (counts[s.status] || 0) + 1;
      if (s.cancel_at_period_end) {
        canceling++;
        if (s.status === 'trialing') trialingCanceling++;
        else if (s.status === 'active') activeCanceling++;
      }
      // Realized MRR = active AND not-canceling only. A trial contributes nothing (not
      // yet paying); a paid sub set to cancel at period end is churning, so it's excluded
      // from retained MRR.
      if (s.status === 'active' && !s.cancel_at_period_end) {
        const item = s.items?.data?.[0];
        const amt = item?.price?.unit_amount || 0;
        const interval = item?.price?.recurring?.interval;
        mrrCents += interval === 'year' ? amt / 12 : amt;
      }
    }
    return {
      counts,
      canceling,
      // Live counts that EXCLUDE already-cancelled subs — so a cancelled trial drops to 0
      // the moment it's cancelled, not only when the trial period finally ends.
      trialing_active: Math.max(0, counts.trialing - trialingCanceling),
      active_paid_active: Math.max(0, counts.active - activeCanceling),
      mrr: Math.round(mrrCents) / 100,
      has_more: !!d.has_more,
    };
  } catch { return null; }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function verifyPw(password, salt, hash) {
  try {
    const derived = scryptSync(password, salt, 64).toString('hex');
    return timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  try { return await _handler(req, res); }
  catch(e) {
    // SECURITY: Do not expose internal error details to clients.
    // Log the full error server-side but return only a generic message.
    console.error('[admin-stats] Unhandled error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function _handler(req, res) {

  const SB = process.env.SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !SK) return res.status(500).json({ error: 'Not configured' });

  const db = (path, opts = {}) => fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SK, Authorization: `Bearer ${SK}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // ── ADMIN LOGIN (unauthenticated) ────────────────────────────────────────────
  if (req.method === 'POST' && body.action === 'admin_login') {
    const { username, password } = body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';

    // IP rate limit: 5 attempts per 15 minutes per IP
    const rlWindow = Math.floor(Date.now() / (15 * 60000));
    const rlKey = `${ip}:admin_login:${rlWindow}`;
    try {
      const rlRes = await fetch(`${SB}/rest/v1/rpc/increment_rate_limit`, {
        method: 'POST',
        headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: rlKey, p_ttl_seconds: 900 }),
      });
      if (rlRes.ok) {
        const count = await rlRes.json();
        if (count > 5) return res.status(429).json({ error: 'Too many login attempts — try again in 15 minutes' });
      }
    } catch(_) { /* fail open */ }

    // Bootstrap: if no admin accounts exist, create one from env vars
    const listRes = await db('admin_accounts?select=id&limit=1');
    const list = listRes.ok ? await listRes.json() : [];
    if (!list.length) {
      const EU = process.env.ADMIN_USERNAME, EP = process.env.ADMIN_PASSWORD;
      if (!EU || !EP) return res.status(503).json({ error: 'No admin accounts. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars.' });
      if (username !== EU || password !== EP) return res.status(401).json({ error: 'Invalid credentials' });
      const salt = randomBytes(16).toString('hex');
      await db('admin_accounts', {
        method: 'POST',
        body: JSON.stringify({ username: EU, password_hash: hashPw(EP, salt), salt, role: 'super_admin' }),
        headers: { Prefer: 'return=minimal' },
      });
    }

    const acctRes = await db(`admin_accounts?username=eq.${encodeURIComponent(username)}&limit=1`);
    const acct = acctRes.ok ? (await acctRes.json())[0] : null;
    if (!acct) return res.status(401).json({ error: 'Invalid credentials' });
    if (!acct.is_active) return res.status(401).json({ error: 'Account disabled' });
    if (acct.locked_until && new Date(acct.locked_until) > new Date()) return res.status(429).json({ error: 'Too many failed attempts — try again in 15 minutes' });

    if (!verifyPw(password, acct.salt, acct.password_hash)) {
      const attempts = (acct.login_attempts || 0) + 1;
      const patch = { login_attempts: attempts };
      if (attempts >= 5) patch.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await db(`admin_accounts?id=eq.${acct.id}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = randomBytes(32).toString('hex');
    await db('admin_sessions', {
      method: 'POST',
      body: JSON.stringify({ token, admin_id: acct.id, role: acct.role, expires_at: new Date(Date.now() + 8 * 3600000).toISOString(), ip_address: ip }),
      headers: { Prefer: 'return=minimal' },
    });
    await db(`admin_accounts?id=eq.${acct.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ login_attempts: 0, locked_until: null, last_login: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: acct.id, username: acct.username, action: 'login', metadata: { ip } }), headers: { Prefer: 'return=minimal' } });

    return res.status(200).json({ token, role: acct.role, username: acct.username });
  }

  // ── VERIFY SESSION (all other requests) ──────────────────────────────────────
  const adminToken = (req.headers['x-admin-token'] || body.admin_token || '').trim();
  if (!adminToken) return res.status(401).json({ error: 'Admin token required' });

  const sessRes = await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}&limit=1`);
  const sess = sessRes.ok ? (await sessRes.json())[0] : null;
  if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired — log in again' });
  const adminRole = sess.role;

  // ── GET: dashboard stats ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const now = new Date();
    const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekISO  = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();

    const ct = r => parseInt((r?.headers?.get('content-range') || '').split('/')[1]) || 0;

    const [
      usersTotalRes, usersTodayRes, usersWeekRes,
      reportsAllRes, reportsTodayRes, reportsWeekRes,
      appsAllRes, appsGhostedRes, appsHiredRes,
      coScoredRes, issuesRes, creditListRes,
      errTodayRes, errWeekRes,
      dauRes, dupClustersRes, flagsRes,
      staleJobsRes, zeroSearchesRes, jobReportsRes, searchLogsTodayRes,
      recentReportsRes, recentAppsRes, jobsTodayRes, inactiveReportsRes,
      jobsActiveRes, jobsNewTodayRes,
      reportsMonthRes, searchLogsWeekRes,
      jobsTotalRes, creditTxnRes, outcomeSharesRes, usersMonthRes,
      searchEvents30Res, resumeScans30Res, disputesOpenRes,
      pendingClaimsRes, listingDisputesOpenRes, unfulfilledPurchasesRes,
    ] = await Promise.all([
      db(`profiles?select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`profiles?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`profiles?created_at=gte.${weekISO}&select=id`,  { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`reports?select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`reports?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`reports?created_at=gte.${weekISO}&select=id`,  { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`applications?select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`applications?status=eq.ghosted&updated_at=gte.${monthISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`applications?status=eq.hired&updated_at=gte.${monthISO}&select=id`,   { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`company_scores?select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`user_issues?status=eq.open&order=created_at.desc&limit=20`),
      db(`ai_credits?select=balance,pro&limit=2000`),
      db(`api_errors?created_at=gte.${todayISO}&select=endpoint,error_msg,created_at&order=created_at.desc&limit=50`),
      db(`api_errors?created_at=gte.${weekISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`login_signals?created_at=gte.${todayISO}&select=user_id`),
      db(`duplicate_clusters?status=eq.suspected&order=risk_score.desc&limit=10`),
      db(`feature_flags?select=flag_name,status,percentage,description,updated_by,updated_at&order=flag_name.asc`),
      db(`jobs?availability_status=in.(stale,expired)&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`search_events?result_count=eq.0&created_at=gte.${weekISO}&select=query&order=created_at.desc&limit=20`),
      db(`job_availability_reports?reported_at=gte.${weekISO}&select=job_id,status&limit=200`),
      db(`search_logs?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`reports?select=id,company_name,outcome,role,city,platform,created_at,report_text,outcome_weight,trust_reason,needs_review&order=created_at.desc&limit=25`),
      db(`applications?select=id,company_name,role,city,status,stage,platform,created_at&order=created_at.desc&limit=25`),
      db(`jobs?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`job_availability_reports?status=in.(expired,unknown)&select=id,job_id,status,reported_at,company,title,city,apply_url&order=reported_at.desc&limit=50`),
      db(`jobs?select=count&availability_status=eq.active`),
      db(`jobs?select=count&created_at=gte.${encodeURIComponent(todayISO)}`),
      db(`reports?created_at=gte.${monthISO}&select=created_at,company_name,outcome&order=created_at.asc&limit=2000`),
      db(`search_logs?created_at=gte.${weekISO}&select=query&limit=500`),
      db(`jobs?select=count`),
      db(`credit_transactions?select=delta&limit=20000`),
      db(`outcome_card_shares?select=shared_via,created_at&order=created_at.desc&limit=5000`),
      db(`profiles?created_at=gte.${monthISO}&select=created_at&order=created_at.asc&limit=5000`),
      // ADDITIVE (admin command-center Data Flywheel panel): 30-day activity counts.
      // Both tables are service-key accessed (RLS bypassed). Never a constant.
      db(`search_events?created_at=gte.${monthISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`resume_surveys?created_at=gte.${monthISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      // ADDITIVE (overview attention signal): open Reddit-dispute count (migration 054). Count-only.
      db(`company_reddit_disputes?status=eq.open&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      // ADDITIVE (overview attention signals — employer side). Count-only, service-key (RLS bypassed).
      //  • pending employer→company claims (migration 053) awaiting approve/reject.
      //  • open listing disputes (migration 056) — only an admin can approve/deny.
      //  • employer purchases still 'paid' (not 'fulfilled') — someone paid for Featured/Verified
      //    and is waiting on the admin to grant the perk (migration 048).
      db(`employer_company_claims?status=eq.pending&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`listing_disputes?status=eq.open&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`employer_purchases?status=eq.paid&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } })
    ]);

    const usersTotal = ct(usersTotalRes);
    const issues = issuesRes.ok ? await issuesRes.json() : [];
    const jobsActiveData  = jobsActiveRes.ok   ? await jobsActiveRes.json()   : [];
    const jobsNewTodayData = jobsNewTodayRes.ok ? await jobsNewTodayRes.json() : [];
    const jobsTotalData   = jobsTotalRes.ok    ? await jobsTotalRes.json()    : [];
    const jobsActive  = parseInt(jobsActiveData[0]?.count)   || 0;
    const jobsNewToday = parseInt(jobsNewTodayData[0]?.count) || 0;
    const jobsTotal   = parseInt(jobsTotalData[0]?.count)    || 0;
    const creditRows = creditListRes.ok ? await creditListRes.json() : [];
    const proCount = creditRows.filter(r => r.pro).length;
    const totalBalance = creditRows.reduce((s, r) => s + (Number(r.balance) || 0), 0);
    const creditTxns = creditTxnRes && creditTxnRes.ok ? await creditTxnRes.json() : [];
    let creditsEarned = 0, creditsSpent = 0;
    for (const t of (Array.isArray(creditTxns) ? creditTxns : [])) {
      const d = Number(t.delta) || 0;
      if (d > 0) creditsEarned += d; else creditsSpent += -d;
    }
    const ghosted = ct(appsGhostedRes);
    const totalApps = ct(appsAllRes);
    const errToday = errTodayRes.ok ? await errTodayRes.json() : [];
    const dupClusters = dupClustersRes.ok ? await dupClustersRes.json() : [];
    const flags = flagsRes.ok ? await flagsRes.json() : [];
    const dauRows = dauRes.ok ? await dauRes.json() : [];
    const dau = new Set(dauRows.map(r => r.user_id)).size;
    const errByRoute = {};
    errToday.forEach(e => { errByRoute[e.endpoint] = (errByRoute[e.endpoint] || 0) + 1; });
    // Job trust signals
    const zeroSearchRows = zeroSearchesRes.ok ? await zeroSearchesRes.json() : [];
    const jobReportRows = jobReportsRes.ok ? await jobReportsRes.json() : [];
    const jobReportsByStatus = { active: 0, expired: 0, unknown: 0 };
    jobReportRows.forEach(r => { jobReportsByStatus[r.status] = (jobReportsByStatus[r.status] || 0) + 1; });

    const recentReports = recentReportsRes.ok ? await recentReportsRes.json() : [];
    const recentApps    = recentAppsRes.ok    ? await recentAppsRes.json()    : [];
    const inactiveReportRows = inactiveReportsRes.ok ? await inactiveReportsRes.json() : [];

    // Chart + top companies + outcome breakdown from 30d reports
    const reportsMonth = reportsMonthRes.ok ? await reportsMonthRes.json() : [];
    // Build 30-day daily chart
    const chartDays = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      chartDays.push(d.toISOString().slice(0, 10));
    }
    const chartMap = {};
    reportsMonth.forEach(r => { const d = r.created_at?.slice(0, 10); if (d) chartMap[d] = (chartMap[d] || 0) + 1; });
    const reportsChart = chartDays.map(date => ({ date, count: chartMap[date] || 0 }));
    // Top companies
    const companyCountMap = {};
    reportsMonth.forEach(r => { if (r.company_name) companyCountMap[r.company_name] = (companyCountMap[r.company_name] || 0) + 1; });
    const topCompanies = Object.entries(companyCountMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([company, count]) => ({ company, count }));
    // Outcome breakdown
    const outcomeMap = { ghosted: 0, rejected: 0, interview: 0, offer: 0, waiting: 0 };
    reportsMonth.forEach(r => {
      const o = r.outcome;
      if (o === 'ghosted') outcomeMap.ghosted++;
      else if (o === 'rejected' || o === 'autoreject') outcomeMap.rejected++;
      else if (o === 'interview' || o === 'human') outcomeMap.interview++;
      else if (o === 'offer' || o === 'hired') outcomeMap.offer++;
      else outcomeMap.waiting++;
    });

    // Most researched companies (7d) from search_logs
    const searchLogsWeek = searchLogsWeekRes.ok ? await searchLogsWeekRes.json() : [];
    const searchCountMap = {};
    searchLogsWeek.forEach(r => { if (r.query) searchCountMap[r.query] = (searchCountMap[r.query] || 0) + 1; });
    const topSearched = Object.entries(searchCountMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([company, count]) => ({ company, count }));

    // Enrich inactive reports with job details.
    // job_id here is TEXT — reports from live search results carry client-generated
    // ephemeral ids (e.g. "j_1no2squ") that never land in the jobs table, whose id is
    // a uuid column. Feeding a non-uuid into `jobs?id=in.(...)` makes PostgREST 400 the
    // WHOLE lookup (one bad id poisons every id), so we must filter to syntactically
    // valid uuids before querying — and we must NEVER drop a report that has no job row,
    // since surfacing those reports is the entire point of this panel.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let inactiveReports = [];
    if (inactiveReportRows.length) {
      const jobIds = [...new Set(inactiveReportRows.map(r => r.job_id).filter(Boolean))];
      const uuidJobIds = jobIds.filter(id => UUID_RE.test(id));
      let jobMap = {};
      if (uuidJobIds.length) {
        // NOTE: the jobs table has no `url` column (only `apply_url`) — selecting a
        // non-existent column 400s the whole lookup, so we select apply_url only.
        const jobsRes = await db(`jobs?id=in.(${uuidJobIds.map(id => encodeURIComponent(id)).join(',')})&select=id,company,title,city,apply_url,availability_status&limit=50`);
        const jobRows = jobsRes.ok ? await jobsRes.json() : [];
        jobMap = Object.fromEntries((jobRows || []).map(j => [j.id, j]));
      }
      // Group reports by job_id, count them — every reported job_id is kept.
      // `reasons` breaks the count down by report status (expired / unknown) so the admin
      // can see WHY it was flagged.
      const grouped = {};
      inactiveReportRows.forEach(r => {
        if (!grouped[r.job_id]) grouped[r.job_id] = { job_id: r.job_id, report_count: 0, latest_reported_at: r.reported_at, reasons: {}, snapshot: null };
        const g = grouped[r.job_id];
        g.report_count++;
        const reason = r.status || 'expired';
        g.reasons[reason] = (g.reasons[reason] || 0) + 1;
        if (r.reported_at > g.latest_reported_at) g.latest_reported_at = r.reported_at;
        // Client-sent listing snapshot (migration 046). Rows arrive newest-first, so the first one
        // carrying any snapshot field wins — gives the admin context even for ephemeral listings.
        if (!g.snapshot && (r.company || r.title || r.city || r.apply_url)) {
          g.snapshot = { company: r.company || null, title: r.title || null, city: r.city || null, apply_url: r.apply_url || null };
        }
      });
      inactiveReports = Object.values(grouped)
        .sort((a, b) => b.report_count - a.report_count)
        .map(g => ({ ...g, job: jobMap[g.job_id] || null }));

      // BOTH SIDES: flag reported listings the EMPLOYER has an OPEN dispute on (by dispute
      // number), so the admin never deletes a listing while its rebuttal sits unresolved in
      // the Community tab. Best-effort — the queue must load even if this lookup fails.
      try {
        const dRes = await db(`listing_disputes?job_id=in.(${jobIds.map(encodeURIComponent).join(',')})&status=eq.open&select=id,job_id,kind&limit=200`);
        const dRows = dRes.ok ? await dRes.json() : [];
        const dByJob = Object.fromEntries(dRows.map(d => [d.job_id, { id: d.id, kind: d.kind }]));
        inactiveReports = inactiveReports.map(g => ({ ...g, dispute: dByJob[g.job_id] || null }));
      } catch { /* annotation only */ }
    }

    // ── Job-board health / crisis detection ───────────────────────────────────
    // The job board is the primary data-acquisition engine. When active listings
    // collapse (stale ones pile up, refresh cron falls behind) users see a dead
    // board and the whole flywheel stalls. Surface an explicit crisis signal so
    // the admin dashboard can alert + auto-remediate instead of silently rotting.
    //
    // Thresholds (tuned for the current corpus of ~900 jobs; adjust as it grows):
    //   • active < 500           → board is too thin to feel alive (target ≥500 live)
    //   • active / total < 0.40  → majority of the corpus is stale/expired (>60% rot)
    // Either condition alone is enough to declare a crisis.
    const JOB_HEALTH_MIN_ACTIVE = 500;   // floor of live listings before we alert
    const JOB_HEALTH_MIN_RATIO  = 0.40;  // min share of corpus that must be active
    const staleJobs = ct(staleJobsRes);
    const activePct = jobsTotal > 0 ? Math.round((jobsActive / jobsTotal) * 100) : 0;
    const jobCrisis =
      jobsActive < JOB_HEALTH_MIN_ACTIVE ||
      (jobsTotal > 0 && jobsActive / jobsTotal < JOB_HEALTH_MIN_RATIO);
    const jobHealth = {
      active: jobsActive,
      total: jobsTotal,
      stale: staleJobs,
      active_pct: activePct,
      crisis: jobCrisis,
    };

    // ── Monetization / conversion analytics ──────────────────────────────────
    // Denominator is REAL signups (usersTotal = profiles count), not ai_credits rows: a
    // user who never ran an AI tool has no ai_credits row, so counting creditRows
    // undercounted accounts and inflated conversion. free = total − paid.
    const freeCount = Math.max(0, usersTotal - proCount);
    const convPct = usersTotal ? Math.round((proCount / usersTotal) * 1000) / 10 : 0;
    const subs = await stripeSubsBreakdown();
    const shareRows = outcomeSharesRes && outcomeSharesRes.ok ? await outcomeSharesRes.json() : [];
    const sharesByChannel = {};
    (Array.isArray(shareRows) ? shareRows : []).forEach(s => { sharesByChannel[s.shared_via] = (sharesByChannel[s.shared_via] || 0) + 1; });
    // 30-day daily signups (alongside the existing reports chart) for the conversion view.
    const usersMonth = usersMonthRes && usersMonthRes.ok ? await usersMonthRes.json() : [];
    const signupMap = {};
    (Array.isArray(usersMonth) ? usersMonth : []).forEach(u => { const d = u.created_at?.slice(0, 10); if (d) signupMap[d] = (signupMap[d] || 0) + 1; });
    const signupsChart = chartDays.map(date => ({ date, count: signupMap[date] || 0 }));

    const monetization = {
      stripe_connected: !!process.env.STRIPE_SECRET_KEY,
      total_accounts: usersTotal,
      pro_users: proCount,
      free_users: freeCount,
      conversion_pct: convPct,
      // From Stripe (null if not connected): trial vs paid vs churned. trialing / active_paid
      // are the LIVE, not-yet-cancelled counts (a cancelled-but-not-expired sub is reported
      // under `canceling`, never as an active trial/paid sub).
      trialing: subs ? subs.trialing_active : null,
      active_paid: subs ? subs.active_paid_active : null,
      canceling: subs?.canceling ?? null,
      past_due: subs?.counts?.past_due ?? null,
      canceled: subs?.counts?.canceled ?? null,
      mrr: subs ? subs.mrr : null,
      mrr_annualized: subs ? Math.round(subs.mrr * 12 * 100) / 100 : null,
      outcome_card_shares: Array.isArray(shareRows) ? shareRows.length : 0,
      shares_by_channel: sharesByChannel,
      signups_chart: signupsChart,
    };

    return res.status(200).json({
      monetization,
      users: { total: usersTotal, new_today: ct(usersTodayRes), new_this_week: ct(usersWeekRes), dau },
      reports: { total: ct(reportsAllRes), today: ct(reportsTodayRes), this_week: ct(reportsWeekRes), recent: recentReports, chart: reportsChart, top_companies: topCompanies, outcome_breakdown: outcomeMap },
      applications: { total: totalApps, ghosted_30d: ghosted, hired_30d: ct(appsHiredRes), ghost_rate_pct: totalApps > 0 ? Math.round(ghosted / totalApps * 100) : null, recent: recentApps },
      companies: { with_scores: ct(coScoredRes) },
      credits: { total_users: creditRows.length, pro_users: proCount, total_balance: totalBalance, earned: creditsEarned, spent: creditsSpent },
      // ADDITIVE: real 30-day activity counts for the Data Flywheel panel.
      flywheel: { job_searches_30d: ct(searchEvents30Res), resume_scans_30d: ct(resumeScans30Res) },
      errors: { today: errToday.length, this_week: ct(errWeekRes), by_route: errByRoute, recent: errToday.slice(0, 5) },
      issues: { open: issues.length, items: issues },
      reddit_disputes: { open: ct(disputesOpenRes) },
      employer_claims: { pending: ct(pendingClaimsRes) },
      listing_disputes: { open: ct(listingDisputesOpenRes) },
      employer_purchases: { unfulfilled: ct(unfulfilledPurchasesRes) },
      duplicate_clusters: { suspected: dupClusters.length, items: dupClusters },
      feature_flags: flags,
      job_health: jobHealth,
      company_lookups: searchLogsTodayRes.ok
        ? { ready: true, today: ct(searchLogsTodayRes), top: topSearched }
        : { ready: false },
      jobs: {
        total: jobsTotal,
        active: jobsActive,
        new_today: jobsNewToday,
        added_today: ct(jobsTodayRes),
        stale_or_expired: ct(staleJobsRes),
        zero_result_searches_7d: zeroSearchRows.length,
        top_zero_queries: [...new Set(zeroSearchRows.map(r => r.query))].slice(0, 10),
        availability_reports_7d: jobReportRows.length,
        reports_by_status: jobReportsByStatus,
        inactive_reports: inactiveReports,
      },
    });
  }

  // ── POST: admin actions ──────────────────────────────────────────────────────
  const { action } = body;

  if (action === 'admin_logout') {
    await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── LIVE FEED — cheap cursor poll for the real-time admin (Seen Live) ─────────
  // Returns only events NEWER than `since` across the tables that represent "something
  // happened", so the client can pop notifications + update without a full stats refetch.
  // The client passes back the previous poll's `server_time` as `since` (strictly-greater),
  // guaranteeing no gaps; it dedups by the composite event id. Read-only, all roles.
  if (action === 'recent_events') {
    const sinceRaw = body.since && !isNaN(Date.parse(body.since)) ? new Date(body.since).toISOString() : new Date(Date.now() - 2 * 60000).toISOString();
    const s = encodeURIComponent(sinceRaw);
    const j = (path) => db(path).then(r => (r.ok ? r.json() : [])).then(x => (Array.isArray(x) ? x : [])).catch(() => []);
    const [reports, apps, purchases, flags, signups, claims, listingDisputes, redditDisputes] = await Promise.all([
      j(`reports?created_at=gt.${s}&select=id,company_name,outcome,role,created_at&order=created_at.desc&limit=15`),
      j(`applications?created_at=gt.${s}&select=id,company_name,role,created_at&order=created_at.desc&limit=15`),
      j(`employer_purchases?created_at=gt.${s}&select=id,company,employer_sku,amount_cents,created_at&order=created_at.desc&limit=15`),
      j(`job_availability_reports?reported_at=gt.${s}&select=id,job_id,company,title,reported_at&order=reported_at.desc&limit=15`),
      j(`profiles?created_at=gt.${s}&select=created_at&order=created_at.desc&limit=15`),
      // Employer-side admin-review events — the ones that need a human. These are the same signals
      // the Needs Attention queue counts (migrations 053/056/054); surfacing them here makes them
      // pop in the live bell + toast the moment they happen.
      j(`employer_company_claims?created_at=gt.${s}&status=eq.pending&select=id,company_display_name,company_name,created_at&order=created_at.desc&limit=15`),
      j(`listing_disputes?created_at=gt.${s}&status=eq.open&select=id,company_name,kind,created_at&order=created_at.desc&limit=15`),
      j(`company_reddit_disputes?created_at=gt.${s}&status=eq.open&select=id,company_name,reason,created_at&order=created_at.desc&limit=15`),
    ]);
    const events = [];
    for (const r of reports) events.push({ id: `report:${r.id}`, type: 'report', sev: 'blue', at: r.created_at, title: `New report — ${r.company_name || 'a company'}`, sub: `${r.outcome || 'reported'}${r.role ? ` · ${r.role}` : ''}` });
    for (const a of apps) events.push({ id: `app:${a.id}`, type: 'application', sev: 'green', at: a.created_at, title: `Application tracked — ${a.company_name || 'a company'}`, sub: a.role || '' });
    for (const p of purchases) events.push({ id: `purchase:${p.id}`, type: 'purchase', sev: 'money', at: p.created_at, title: `Employer sale — $${((p.amount_cents || 0) / 100).toFixed(0)}`, sub: `${p.company || 'an employer'}${p.employer_sku ? ` · ${p.employer_sku}` : ''}` });
    for (const f of flags) events.push({ id: `flag:${f.id}`, type: 'flag', sev: 'amber', at: f.reported_at, title: `Listing flagged — ${f.title || f.company || f.job_id}`, sub: 'reported no longer active' });
    for (const g of signups) events.push({ id: `signup:${g.created_at}`, type: 'signup', sev: 'violet', at: g.created_at, title: 'New signup', sub: '' });
    for (const c of claims) events.push({ id: `claim:${c.id}`, type: 'claim', sev: 'amber', at: c.created_at, title: `Employer claim — ${c.company_display_name || c.company_name || 'a company'}`, sub: 'awaiting your approval' });
    for (const d of listingDisputes) events.push({ id: `ldispute:${d.id}`, type: 'listing_dispute', sev: 'amber', at: d.created_at, title: `Listing dispute — ${d.company_name || 'a company'}`, sub: `${d.kind || 'dispute'} · needs review` });
    for (const rd of redditDisputes) events.push({ id: `rdispute:${rd.id}`, type: 'reddit_dispute', sev: 'amber', at: rd.created_at, title: `Reddit dispute — ${rd.company_name || 'a company'}`, sub: `${rd.reason || 'flagged'} · needs review` });
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return res.status(200).json({ ok: true, events: events.slice(0, 40), server_time: new Date().toISOString() });
  }

  // ── EMPLOYER PURCHASES — list for fulfillment (Engine E4) ─────────────────────
  if (action === 'list_employer_purchases') {
    const pr = await db(`employer_purchases?select=id,company,email,employer_sku,amount_cents,status,created_at,fulfilled_at&order=created_at.desc&limit=50`);
    const purchases = pr.ok ? await pr.json() : [];
    const pk = await db(`employer_perks?select=company,featured_until,verified_until&order=updated_at.desc&limit=200`);
    const perks = pk.ok ? await pk.json() : [];
    const revRes = await db(`employer_purchases?select=amount_cents`);
    const rev = revRes.ok ? (await revRes.json()).reduce((n, r) => n + (r.amount_cents || 0), 0) : 0;
    return res.status(200).json({ ok: true, purchases: Array.isArray(purchases) ? purchases : [], perks: Array.isArray(perks) ? perks : [], total_cents: rev });
  }

  // ── FULFILL an employer purchase → grant the time-boxed perk (Engine E4) ──────
  // featured30 → featured_until = now+30d; verified90 → verified_until = now+90d. Company-keyed,
  // merge-upsert so granting one perk never clears the other. Money grants reach/badge, never a
  // score. Full admins only.
  if (action === 'fulfill_employer_purchase') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { purchase_id } = body;
    if (!purchase_id) return res.status(400).json({ error: 'purchase_id required' });
    const pr = await db(`employer_purchases?id=eq.${encodeURIComponent(purchase_id)}&select=id,company,employer_sku&limit=1`);
    const purchase = pr.ok ? (await pr.json())[0] : null;
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    const company = String(purchase.company || '').trim().toLowerCase();
    if (!company) return res.status(400).json({ error: 'Purchase has no company to attach the perk to' });
    // Map the SKU's kind → the perk column it grants (featured/verified/sponsor), from the single
    // source of truth. Unknown SKUs fall back to featured (reach-only) so a grant never errors.
    const def = EMPLOYER_SKUS[purchase.employer_sku] || null;
    const kind = def?.kind || 'featured';
    const days = def?.days || 30;
    const col = kind === 'verified' ? 'verified_until' : kind === 'sponsor' ? 'sponsor_until' : 'featured_until';
    const until = new Date(Date.now() + days * 86400e3).toISOString();
    const up = await db('employer_perks?on_conflict=company', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ company, [col]: until, purchase_id: purchase.id, updated_at: new Date().toISOString() }),
    });
    if (!up.ok) return res.status(500).json({ error: 'Could not grant perk' });
    await db(`employer_purchases?id=eq.${encodeURIComponent(purchase.id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'fulfilled', fulfilled_at: new Date().toISOString() }),
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'fulfill_employer_purchase', target_type: 'employer', target_id: company, metadata: { sku: purchase.employer_sku, until } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, company, perk: col, until });
  }

  // ── EMPLOYER REPLIES — moderation queue (Wave 2) ──────────────────────────────
  // Employer replies to outcome reports land 'pending' (migration 060) and are invisible to seekers
  // until approved here. Display-only content — never a score input. Any admin session may moderate.
  if (action === 'list_employer_replies') {
    const status = String(body.status || '').trim();
    const filt = ['pending', 'approved', 'rejected'].includes(status) ? `&status=eq.${status}` : '';
    const rr = await db(`employer_report_replies?select=id,report_id,company_key,body,status,created_at,reviewed_at,reviewed_by${filt}&order=created_at.desc&limit=200`);
    const replies = rr.ok ? await rr.json() : [];
    // Attach the report each reply answers, so the admin can judge it in context.
    const ids = [...new Set(replies.map(x => x.report_id).filter(Boolean))].slice(0, 200);
    const ctx = {};
    if (ids.length) {
      const cr = await db(`reports?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,role,outcome,report_text,company_name`);
      const rows = cr.ok ? await cr.json() : [];
      for (const row of rows) ctx[row.id] = { role: row.role, outcome: row.outcome, report_text: row.report_text, company_name: row.company_name };
    }
    const rank = { pending: 0, approved: 1, rejected: 2 };
    const withCtx = replies
      .map(x => ({ ...x, report: ctx[x.report_id] || null }))
      .sort((a, b) => (rank[a.status] - rank[b.status]) || (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const x of replies) if (counts[x.status] != null) counts[x.status]++;
    return res.status(200).json({ ok: true, replies: withCtx, counts });
  }

  if (action === 'moderate_employer_reply') {
    const { reply_id, decision } = body;
    if (!reply_id || !['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'reply_id and decision (approve|reject) required' });
    const status = decision === 'approve' ? 'approved' : 'rejected';
    const nowIso = new Date().toISOString();
    const up = await db(`employer_report_replies?id=eq.${encodeURIComponent(reply_id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status, reviewed_by: sess.username || 'admin', reviewed_at: nowIso, updated_at: nowIso }),
    });
    if (!up.ok) return res.status(500).json({ error: 'Could not update the reply' });
    const updated = (await up.json())[0] || null;
    await db('admin_audit_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'moderate_employer_reply', target_type: 'employer_reply', target_id: String(reply_id), metadata: { decision, company_key: updated?.company_key || null } }) });
    return res.status(200).json({ ok: true, reply: updated });
  }

  // ── EXPORT CSV — downloadable snapshot for conversion analysis ────────────────
  // Returns { csv, filename }; the admin UI turns it into a file download. Includes a
  // summary block + a 30-day daily time series (signups, reports, outcome-card shares).
  if (action === 'export_csv') {
    const now = new Date();
    const ct2 = r => parseInt((r?.headers?.get('content-range') || '').split('/')[1]) || 0;
    const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekISO = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();

    const [usersTotalRes, usersWeekRes, reportsAllRes, appsAllRes, coRes, creditRes, sharesRes, usersMonthRes, reportsMonthRes] = await Promise.all([
      db('profiles?select=id', { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`profiles?created_at=gte.${weekISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db('reports?select=id', { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db('applications?select=id', { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db('company_scores?select=id', { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db('ai_credits?select=pro&limit=20000'),
      db(`outcome_card_shares?select=shared_via,created_at&limit=20000`),
      db(`profiles?created_at=gte.${monthISO}&select=created_at&limit=20000`),
      db(`reports?created_at=gte.${monthISO}&select=created_at&limit=20000`),
    ]);
    const creditRows = creditRes.ok ? await creditRes.json() : [];
    const pro = creditRows.filter(r => r.pro).length;
    const total = creditRows.length;
    const shares = sharesRes.ok ? await sharesRes.json() : [];
    const usersMonth = usersMonthRes.ok ? await usersMonthRes.json() : [];
    const reportsMonth = reportsMonthRes.ok ? await reportsMonthRes.json() : [];
    const subs = await stripeSubsBreakdown();

    const byDay = (rows) => { const m = {}; (rows || []).forEach(x => { const d = x.created_at?.slice(0, 10); if (d) m[d] = (m[d] || 0) + 1; }); return m; };
    const su = byDay(usersMonth), rp = byDay(reportsMonth), sh = byDay(shares);

    const lines = [];
    lines.push(['Seen metrics export', new Date().toISOString()]);
    lines.push([]);
    lines.push(['SUMMARY', 'metric', 'value']);
    lines.push(['', 'Total accounts', total]);
    lines.push(['', 'Pro users', pro]);
    lines.push(['', 'Free users', Math.max(0, total - pro)]);
    lines.push(['', 'Free→Pro conversion %', total ? Math.round((pro / total) * 1000) / 10 : 0]);
    lines.push(['', 'Profiles (all)', ct2(usersTotalRes)]);
    lines.push(['', 'New users (7d)', ct2(usersWeekRes)]);
    lines.push(['', 'Reports (all)', ct2(reportsAllRes)]);
    lines.push(['', 'Applications (all)', ct2(appsAllRes)]);
    lines.push(['', 'Companies scored', ct2(coRes)]);
    lines.push(['', 'Outcome-card shares (all)', Array.isArray(shares) ? shares.length : 0]);
    lines.push([]);
    lines.push(['STRIPE', 'metric', 'value']);
    lines.push(['', 'Connected', !!process.env.STRIPE_SECRET_KEY]);
    lines.push(['', 'Trialing (live)', subs ? subs.trialing_active : 'n/a']);
    lines.push(['', 'Active (paid, live)', subs ? subs.active_paid_active : 'n/a']);
    lines.push(['', 'Canceling (at period end)', subs?.canceling ?? 'n/a']);
    lines.push(['', 'Past due', subs?.counts?.past_due ?? 'n/a']);
    lines.push(['', 'Canceled', subs?.counts?.canceled ?? 'n/a']);
    lines.push(['', 'MRR ($)', subs ? subs.mrr : 'n/a']);
    lines.push(['', 'ARR ($)', subs ? Math.round(subs.mrr * 12 * 100) / 100 : 'n/a']);
    lines.push([]);
    lines.push(['DAILY (last 30 days)', 'date', 'new_users', 'reports', 'card_shares']);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      lines.push(['', k, su[k] || 0, rp[k] || 0, sh[k] || 0]);
    }

    const csv = lines.map(row => row.map(csvCell).join(',')).join('\n');
    const stamp = now.toISOString().slice(0, 10);
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'export_csv' }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ ok: true, filename: `seen-metrics-${stamp}.csv`, csv });
  }

  if (action === 'find_duplicates') {
    const r = await db('company_scores?select=id,name:company_name,report_count,overall_score&order=report_count.desc&limit=500');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const rows = await r.json();
    const norm = n => n ? n.toLowerCase().trim().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
    const groups = {};
    rows.forEach(row => { const k = norm(row.name); (groups[k] = groups[k] || []).push(row); });
    const duplicates = Object.entries(groups)
      .filter(([, g]) => g.length > 1)
      .map(([key, companies]) => ({ key, companies }));
    return res.status(200).json({ ok: true, duplicates });
  }

  // ── Shared single-merge routine ──────────────────────────────────────────────
  // Log-first, identity-complete, recompute-based. Used by BOTH `merge` (manual /
  // scan-list) and `auto_merge` (per pair) so they can never drift apart. NO hand math:
  // the surviving score is DERIVED from the merged report corpus by recompute, and every
  // reversible fact is snapshotted to company_merges BEFORE anything is mutated.
  const svcHdrs = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };
  const jsonOrEmpty = (r) => (r && r.ok ? r.json().catch(() => []) : []);
  async function mergeCompanyPair(primaryId, secondaryId) {
    // 1. Load FULL primary + secondary rows (select=*)
    const [pArr, sArr] = await Promise.all([
      db(`company_scores?id=eq.${primaryId}&select=*&limit=1`).then(jsonOrEmpty),
      db(`company_scores?id=eq.${secondaryId}&select=*&limit=1`).then(jsonOrEmpty),
    ]);
    const primary = pArr[0], secondary = sArr[0];
    if (!primary || !secondary) return { ok: false, status: 404, error: 'Company not found' };
    const primaryName = primary.company_name, secondaryName = secondary.company_name;
    const secNorm = normalizeCompany(secondaryName), priNorm = normalizeCompany(primaryName);

    // 2. Resolve the secondary's companies-table ids (normalized-name match; may be several)
    const secWord = encodeURIComponent(String(secondaryName).split(/\s+/)[0] || secondaryName);
    const secCoRows = await db(`companies?name=ilike.*${secWord}*&select=id,name&limit=50`).then(jsonOrEmpty);
    const secondaryCompanyIds = (secCoRows || []).filter(c => normalizeCompany(c.name) === secNorm).map(c => c.id);
    // Resolve the primary's companies-table id so remapped reports get the right company_id
    const priWord = encodeURIComponent(String(primaryName).split(/\s+/)[0] || primaryName);
    const priCoRows = await db(`companies?name=ilike.*${priWord}*&select=id,name&limit=50`).then(jsonOrEmpty);
    const primaryCompanyId = (priCoRows || []).find(c => normalizeCompany(c.name) === priNorm)?.id || null;

    // 3. Collect moved_report_ids FIRST — case-INSENSITIVE name OR company_id membership
    //    (the old case-sensitive eq missed "amazon.com" vs "Amazon.com" variants).
    const byName = await db(`reports?company_name=ilike.${encodeURIComponent(secondaryName)}&select=id&limit=5000`).then(jsonOrEmpty);
    const byId = secondaryCompanyIds.length
      ? await db(`reports?company_id=in.(${secondaryCompanyIds.join(',')})&select=id&limit=5000`).then(jsonOrEmpty)
      : [];
    const movedReportIds = [...new Set([...(byName || []), ...(byId || [])].map(r => r.id).filter(Boolean))];
    const aliasAdded = String(secondaryName).toLowerCase();

    // 4. INSERT the company_merges log row BEFORE mutating anything. If the table is
    //    missing (migration 040 unapplied), degrade gracefully with logged:false.
    let logged = true, mergeId = null;
    try {
      const logRes = await db('company_merges', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          admin_id: sess.admin_id,
          primary_score_id: primaryId, primary_name: primaryName,
          secondary_score_id: secondaryId, secondary_name: secondaryName,
          secondary_row: secondary, primary_row_before: primary,
          moved_report_ids: movedReportIds,
          secondary_company_ids: secondaryCompanyIds,
          aliases_added: [aliasAdded],
        }),
      });
      if (logRes.ok) { const j = await logRes.json().catch(() => null); mergeId = Array.isArray(j) ? j[0]?.id : j?.id; }
      else logged = false;
    } catch { logged = false; }

    // 5. Remap: reports (by id list, batched) → primary; resume_surveys → primary norm;
    //    upsert the alias (canonical=primary, alias=secondary lower).
    for (let i = 0; i < movedReportIds.length; i += 100) {
      const chunk = movedReportIds.slice(i, i + 100);
      const patch = { company_name: primaryName };
      if (primaryCompanyId) patch.company_id = primaryCompanyId;
      await db(`reports?id=in.(${chunk.join(',')})`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    {
      const patch = { company_norm: priNorm, company_name: primaryName };
      if (primaryCompanyId) patch.company_id = primaryCompanyId;
      await db(`resume_surveys?company_norm=eq.${encodeURIComponent(secNorm)}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    await db('company_aliases?on_conflict=alias', { method: 'POST', body: JSON.stringify({ canonical: primaryName, alias: aliasAdded }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }).catch(() => {});

    // 6. NO hand math — derive the true post-merge score from the (now-merged) corpus.
    await recomputeCompanyScoreFromReports(SB, svcHdrs, primaryName);

    // 7. DELETE the secondary score row (snapshot already logged).
    await db(`company_scores?id=eq.${secondaryId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

    // report_count comes from the recompute, never pC+sC of claimed counts.
    const finalArr = await db(`company_scores?id=eq.${primaryId}&select=report_count,overall_score&limit=1`).then(jsonOrEmpty);
    const report_count = finalArr[0]?.report_count ?? null;
    return { ok: true, merge_id: mergeId, logged, primary_name: primaryName, secondary_name: secondaryName, moved_reports: movedReportIds.length, report_count };
  }

  // Recompute a company's cached score from its REAL reports, OR delete the cached row entirely
  // when the company has no real (non-review) reports left. A merge/undo/resplit moves reports
  // between names; recompute alone NO-OPS on an empty corpus and orphans the old score row, which
  // then keeps displaying the other company's numbers (the residual "Towne shows Towne Park's
  // ghost data" bug). Clearing the empty score is the general fix so no phantom score survives.
  async function refreshOrClearScore(name) {
    if (!name) return;
    const enc = encodeURIComponent(String(name).toLowerCase().trim());
    const real = await db(`reports?company_name=ilike.${enc}&needs_review=not.is.true&select=id&limit=1`).then(jsonOrEmpty);
    if (Array.isArray(real) && real.length > 0) {
      await recomputeCompanyScoreFromReports(SB, svcHdrs, name);
    } else {
      await db(`company_scores?company_name=eq.${enc}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
  }

  // Reverse ONE logged merge from its snapshot. Reusable by both undo_merge (by id) and
  // resplit_company (by name). Tolerant of partial/seeded logs that lack a secondary_row snapshot
  // — the reports are re-pointed by moved_report_ids + secondary_company_ids and the scores are
  // recomputed (or cleared) from the restored corpus, so no complete snapshot is required.
  async function undoMergeLog(log) {
    // 1. Restore the secondary score row from the snapshot when we have one.
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
    // 2. Re-point the moved reports back to the secondary (name + original company_id).
    const movedIds = Array.isArray(log.moved_report_ids) ? log.moved_report_ids : [];
    const origCid = (Array.isArray(log.secondary_company_ids) && log.secondary_company_ids[0]) || null;
    for (let i = 0; i < movedIds.length; i += 100) {
      const chunk = movedIds.slice(i, i + 100);
      const patch = { company_name: log.secondary_name };
      if (origCid) patch.company_id = origCid;
      await db(`reports?id=in.(${chunk.join(',')})`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    // 3. Delete the alias row(s) the merge created (so future submissions of the secondary name
    //    are no longer suggested as the primary).
    for (const a of (Array.isArray(log.aliases_added) ? log.aliases_added : [])) {
      await db(`company_aliases?alias=eq.${encodeURIComponent(a)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    // 4. Restore the primary's web-context from the pre-merge snapshot, then refresh BOTH names —
    //    clearing either score if it now has no real reports (kills the stale orphan).
    const before = log.primary_row_before || {};
    const restoreFields = {};
    for (const f of ['industry', 'raw_summary', 'web_reviews']) if (f in before) restoreFields[f] = before[f];
    if (Object.keys(restoreFields).length) {
      await db(`company_scores?id=eq.${log.primary_score_id}`, { method: 'PATCH', body: JSON.stringify(restoreFields), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    await refreshOrClearScore(log.primary_name);
    await refreshOrClearScore(log.secondary_name);
    // 5. Mark undone + audit.
    await db(`company_merges?id=eq.${encodeURIComponent(log.id)}`, { method: 'PATCH', body: JSON.stringify({ undone_at: new Date().toISOString(), undone_by: sess.admin_id }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'undo_merge', target_type: 'company', target_id: String(log.primary_score_id || ''), metadata: { merge_id: log.id, restored_reports: movedIds.length } }), headers: { Prefer: 'return=minimal' } });
    return { secondary_name: log.secondary_name, primary_name: log.primary_name, reports: movedIds.length, secondary_score_restored: restoredSecondary, aliases_removed: (Array.isArray(log.aliases_added) ? log.aliases_added.length : 0) };
  }

  if (action === 'merge') {
    // Accept either {primary_id, secondary_id} (from the scan list) or
    // {primary, secondary} names (from the manual-merge text form). Names are
    // resolved to IDs server-side — restores the old production manual-merge UX.
    let { primary_id, secondary_id } = body;
    const { primary, secondary } = body;
    if ((!primary_id || !secondary_id) && primary && secondary) {
      const [pLookup, sLookup] = await Promise.all([
        db(`company_scores?company_name=ilike.${encodeURIComponent(primary)}&select=id&limit=1`).then(r => r.json()),
        db(`company_scores?company_name=ilike.${encodeURIComponent(secondary)}&select=id&limit=1`).then(r => r.json()),
      ]);
      if (!pLookup[0]) return res.status(404).json({ error: `Company not found: ${primary}` });
      if (!sLookup[0]) return res.status(404).json({ error: `Company not found: ${secondary}` });
      primary_id = pLookup[0].id;
      secondary_id = sLookup[0].id;
    }
    if (!primary_id || !secondary_id) return res.status(400).json({ error: 'primary_id and secondary_id (or primary/secondary names) required' });
    if (String(primary_id) === String(secondary_id)) return res.status(400).json({ error: 'Cannot merge a company with itself' });
    const r = await mergeCompanyPair(primary_id, secondary_id);
    if (!r.ok) return res.status(r.status || 500).json({ error: r.error || 'Merge failed' });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'merge_companies', target_type: 'company', target_id: String(primary_id), metadata: { secondary_id, merge_id: r.merge_id, moved_reports: r.moved_reports, logged: r.logged } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, merged_report_count: r.report_count, moved_reports: r.moved_reports, merge_id: r.merge_id, logged: r.logged });
  }

  if (action === 'auto_merge') {
    const r = await db('company_scores?select=id,name:company_name,report_count&order=report_count.desc&limit=500');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const rows = await r.json();
    const norm = n => n ? n.toLowerCase().trim().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
    const groups = {};
    rows.forEach(row => { const k = norm(row.name); (groups[k] = groups[k] || []).push(row); });
    let merged = 0;
    const groupSummaries = [];
    for (const group of Object.values(groups).filter(g => g.length > 1)) {
      const primary = group.reduce((b, r) => (r.report_count||0) > (b.report_count||0) ? r : b);
      const absorbed = [];
      for (const sec of group.filter(r => r.id !== primary.id)) {
        // SAME single-merge routine per pair — fixes auto_merge's old defects
        // (no response_rate write, no report remap → the resurrection bug, no per-merge log).
        const mr = await mergeCompanyPair(primary.id, sec.id);
        if (mr.ok) { absorbed.push(sec.name); merged++; }
      }
      if (absorbed.length) groupSummaries.push({ canonical: primary.name, absorbed });
    }
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'auto_merge_companies', metadata: { merged, groups: groupSummaries.length } }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ ok: true, merged, groups: groupSummaries });
  }

  // ── list_merges: latest 50 merge-log rows (trimmed for the admin history UI) ──
  if (action === 'list_merges') {
    const r = await db('company_merges?select=id,created_at,primary_name,secondary_name,moved_report_ids,undone_at&order=created_at.desc&limit=50');
    if (!r.ok) return res.status(200).json({ ok: true, merges: [] }); // table may be unapplied
    const rows = await r.json().catch(() => []);
    const merges = (Array.isArray(rows) ? rows : []).map(m => ({
      id: m.id,
      created_at: m.created_at,
      primary_name: m.primary_name,
      secondary_name: m.secondary_name,
      moved_reports: Array.isArray(m.moved_report_ids) ? m.moved_report_ids.length : 0,
      undone_at: m.undone_at || null,
    }));
    return res.status(200).json({ ok: true, merges });
  }

  // ── undo_merge: reverse a logged merge by id (full admins only). Now wrapped so a failure
  //    surfaces a real error + ref instead of a silent 500, and it clears orphaned scores. ──
  if (action === 'undo_merge') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { merge_id } = body;
    if (!merge_id) return res.status(400).json({ error: 'merge_id required' });
    try {
      const logArr = await db(`company_merges?id=eq.${encodeURIComponent(merge_id)}&limit=1`).then(jsonOrEmpty);
      const log = logArr[0];
      if (!log) return res.status(404).json({ error: 'Merge log not found' });
      if (log.undone_at) return res.status(400).json({ error: 'This merge has already been undone' });
      const restored = await undoMergeLog(log);
      return res.status(200).json({ ok: true, restored });
    } catch (e) {
      const ref = logError('admin-stats:undo_merge', e, { merge_id });
      return res.status(500).json({ error: 'Undo failed — logged for investigation.', ref });
    }
  }

  // ── resplit_company: reclaim a company that was merged INTO another, BY NAME (no merge_id).
  //    Finds the most recent not-yet-undone merge where this name was the absorbed (secondary)
  //    company and reverses it. The general "X got saved as Y — give me X back" recovery, so the
  //    owner doesn't have to hunt a log id. Reports move back, the alias is dropped, and both
  //    scores are recomputed or cleared (no phantom score left behind). ──
  if (action === 'resplit_company') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const name = String(body.name || body.company || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'company name required' });
    try {
      const rows = await db(`company_merges?secondary_name=ilike.${encodeURIComponent(name)}&undone_at=is.null&order=created_at.desc&limit=1`).then(jsonOrEmpty);
      const log = rows[0];
      if (!log) {
        return res.status(404).json({
          ok: false, no_log: true,
          error: `No reversible merge found with "${name}" as the absorbed company. If it was merged before merge-logging existed, it can't be auto-reclaimed — its reports can no longer be distinguished from the parent. Re-add it as a new company and future reports will accrue to it separately.`,
        });
      }
      const restored = await undoMergeLog(log);
      return res.status(200).json({ ok: true, merge_id: log.id, restored });
    } catch (e) {
      const ref = logError('admin-stats:resplit_company', e, { name });
      return res.status(500).json({ error: 'Resplit failed — logged for investigation.', ref });
    }
  }

  // ── Job aggregation target — min related listings per search before topping
  //    up from the live API. Stored in feature_flags.job_search_target.percentage.
  if (action === 'get_job_target') {
    const r = await db('feature_flags?flag_name=eq.job_search_target&select=percentage&limit=1');
    const rows = r.ok ? await r.json() : [];
    const p = parseInt(rows?.[0]?.percentage, 10);
    return res.status(200).json({ ok: true, target: Number.isFinite(p) && p > 0 ? p : 20 });
  }

  if (action === 'set_job_target') {
    const n = parseInt(body.target, 10);
    if (!Number.isFinite(n) || n < 5 || n > 60) return res.status(400).json({ error: 'Target must be between 5 and 60' });
    const up = await db('feature_flags?on_conflict=flag_name', {
      method: 'POST',
      body: JSON.stringify({ flag_name: 'job_search_target', status: 'fully_on', percentage: n, description: 'Min related listings per job search before topping up from the live API' }),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!up.ok) return res.status(500).json({ error: 'Failed to save target' });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'set_job_target', metadata: { target: n } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, target: n });
  }

  if (action === 'resolve_issue' || action === 'dismiss_issue') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db(`user_issues?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: action === 'resolve_issue' ? 'resolved' : 'dismissed', resolved_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action, target_type: 'issue', target_id: String(id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── REDDIT DISPUTES — the ADMIN side of the company-page correction loop ───────
  // Visitors flag the surfaced public-Reddit discussion via api/company-reddit.js (dispute
  // action → company_reddit_disputes, migration 054). These two actions are how an admin
  // finally SEES and ACTS ON that queue — the loop was write-only until now.
  //
  // list_reddit_disputes → the review queue: open-first + newest-first by default, with a
  // count by status so the admin sees the whole picture; an optional `status` filter narrows it.
  if (action === 'list_reddit_disputes') {
    const filter = isDisputeStatus(body.status) ? body.status : null;
    // Whole-table status tally (status column only — cheap) so the header counts are always
    // accurate regardless of the active filter or the 200-row list window.
    const countRes = await db(`company_reddit_disputes?select=status&limit=5000`);
    const countRows = countRes.ok ? await countRes.json() : [];
    const counts = disputeStatusCounts(countRows);
    // The list itself. A filter scopes it to one status; otherwise pull the recent window and
    // float still-open disputes to the top (both already newest-first).
    const where = filter ? `status=eq.${filter}&` : '';
    const listRes = await db(`company_reddit_disputes?${where}select=id,company_name,company_key,reason,detail,permalink,contact,status,created_at&order=created_at.desc&limit=200`);
    const rows = listRes.ok ? await listRes.json() : [];
    const disputes = filter ? rows : orderDisputesOpenFirst(rows);
    return res.status(200).json({ ok: true, disputes, counts, filter });
  }

  // update_reddit_dispute → move one dispute to a review state (reviewed | actioned | dismissed).
  // Migration 054 has no reviewed_at/updated_at column, so status IS the transition. `id` is the
  // table's bigserial PK — validated as a positive integer before it reaches the query path.
  if (action === 'update_reddit_dispute') {
    const idNum = Number(body.id);
    if (!Number.isInteger(idNum) || idNum <= 0) return res.status(400).json({ error: 'A valid dispute id is required' });
    if (!isDisputeReviewStatus(body.status)) return res.status(400).json({ error: 'status must be reviewed, actioned, or dismissed' });
    await db(`company_reddit_disputes?id=eq.${idNum}`, { method: 'PATCH', body: JSON.stringify({ status: body.status }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'update_reddit_dispute', target_type: 'reddit_dispute', target_id: String(idNum), metadata: { status: body.status } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── LISTING DISPUTES — the ADMIN side of the employer→admin listing correction loop ─────
  // Employers file disputes via api/employer-listings.js (dispute action → listing_disputes,
  // migration 056) to contest ANY listing on their company. ONLY an admin approves/denies, and
  // approval APPLIES the effect (resolveDisputeEffect): a takedown reuses the exact delete_listing
  // machinery (expire the row + suppress the apply_url + recompute the company score); an edit
  // patches the row with the employer's sanitized proposed_changes. Either verdict notifies the
  // filer (employer_notifications, migration 057).
  if (action === 'list_listing_disputes') {
    const filterStatus = ['open', 'approved', 'denied'].includes(body.status) ? body.status : null;
    const countRes = await db(`listing_disputes?select=status&limit=5000`);
    const counts = listingDisputeCounts(countRes.ok ? await countRes.json() : []);
    const where = filterStatus ? `status=eq.${filterStatus}&` : '';
    const listRes = await db(`listing_disputes?${where}select=id,job_id,company_name,company_key,employer_user_id,kind,reason,detail,proposed_changes,status,created_at,reviewed_at,reviewed_by,admin_note&order=created_at.desc&limit=200`);
    const rows = listRes.ok ? await listRes.json() : [];
    let disputes = filterStatus ? rows : orderListingDisputes(rows);
    // BOTH SIDES IN ONE PLACE: attach the SEEKER's availability reports for each disputed
    // listing (count + expired/unknown breakdown), so the admin rules on the employer's
    // dispute with the candidate reports in view — never one side blind.
    try {
      const jobIds = [...new Set(disputes.map(d => d.job_id).filter(Boolean))];
      if (jobIds.length) {
        const rRes = await db(`job_availability_reports?job_id=in.(${jobIds.map(encodeURIComponent).join(',')})&select=job_id,status&limit=1000`);
        const rRows = rRes.ok ? await rRes.json() : [];
        const byJob = {};
        for (const r of rRows) {
          const b = byJob[r.job_id] || (byJob[r.job_id] = { count: 0, expired: 0, unknown: 0 });
          b.count++;
          if (r.status === 'expired') b.expired++;
          else if (r.status === 'unknown') b.unknown++;
        }
        disputes = disputes.map(d => ({ ...d, seeker_reports: byJob[d.job_id] || null }));
      }
    } catch { /* enrichment is best-effort — the queue itself must always load */ }
    return res.status(200).json({ ok: true, disputes, counts, filter: filterStatus });
  }

  if (action === 'resolve_listing_dispute') {
    // Full admins only — approval can EXPIRE a listing (destructive), same bar as delete_listing.
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const idNum = Number(body.id);
    if (!Number.isInteger(idNum) || idNum <= 0) return res.status(400).json({ error: 'A valid dispute id is required' });
    if (!isDisputeDecision(body.decision)) return res.status(400).json({ error: 'decision must be approved or denied' });
    const note = body.note != null ? String(body.note).slice(0, 500) : null;
    const decision = body.decision; // 'approved' | 'denied'

    const dRes = await db(`listing_disputes?id=eq.${idNum}&select=id,job_id,company_name,company_key,employer_user_id,kind,proposed_changes,status&limit=1`);
    const dispute = dRes.ok ? (await dRes.json())[0] : null;
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (dispute.status !== 'open') return res.status(409).json({ error: 'This dispute was already resolved' });

    const applied = { takedown: false, edited: false, suppressed: false, reportsCleared: false };
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (decision === 'approved') {
      const effect = resolveDisputeEffect(dispute);
      const jid = String(dispute.job_id || '');
      if (effect.takedown && UUID.test(jid)) {
        // Reuse the delete_listing recipe: read the row, EXPIRE it (the whole stack filters on
        // expires_at, not availability_status), suppress its apply_url so it can't re-aggregate or
        // be paste-a-link re-imported, clear its availability reports, recompute the company score.
        const rowRes = await db(`jobs?id=eq.${encodeURIComponent(jid)}&select=apply_url,title,company&limit=1`);
        const jobRow = rowRes.ok ? (await rowRes.json())[0] : null;
        const up = await db(`jobs?id=eq.${encodeURIComponent(jid)}`, {
          method: 'PATCH',
          body: JSON.stringify({ availability_status: 'expired', expires_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }),
          headers: { Prefer: 'return=minimal' },
        });
        applied.takedown = up.ok;
        if (jobRow?.apply_url) {
          const ins = await db('suppressed_listings?on_conflict=apply_url', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ apply_url: jobRow.apply_url, stable_job_id: jid, title: jobRow.title || null, company: jobRow.company || null, reason: 'employer_dispute' }),
          });
          applied.suppressed = ins.ok;
        }
        await db(`job_availability_reports?job_id=eq.${encodeURIComponent(jid)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        if (jobRow?.company) {
          try { await recomputeCompanyScoreFromReports(SB, { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' }, normalizeCompany(jobRow.company)); } catch { /* best-effort */ }
        }
      } else if (effect.edit && effect.patch && UUID.test(jid)) {
        // Apply the employer's sanitized proposed changes.
        const patch = { ...effect.patch, last_checked_at: new Date().toISOString() };
        const up = await db(`jobs?id=eq.${encodeURIComponent(jid)}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
        applied.edited = up.ok;
      } else if (effect.clearReports) {
        // still_active APPROVED: the admin sided with the EMPLOYER's rebuttal — the seeker's
        // inactive reports for this listing are cleared and (when a real jobs row exists) the
        // listing is re-marked active so it stops surfacing in the reported-inactive queue.
        const delRes = await db(`job_availability_reports?job_id=eq.${encodeURIComponent(jid)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        applied.reportsCleared = delRes.ok;
        if (UUID.test(jid)) {
          await db(`jobs?id=eq.${encodeURIComponent(jid)}`, {
            method: 'PATCH',
            body: JSON.stringify({ availability_status: 'active', last_checked_at: new Date().toISOString(), availability_report_count: 0 }),
            headers: { Prefer: 'return=minimal' },
          });
        }
      }
    }

    await db(`listing_disputes?id=eq.${idNum}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: decision, reviewed_at: new Date().toISOString(), reviewed_by: sess.username || 'admin', admin_note: note }),
      headers: { Prefer: 'return=minimal' },
    });

    // Notify the filer of the verdict (best-effort — a notify failure must not fail the resolve).
    try {
      const kindN = decision === 'approved' ? 'dispute_approved' : 'dispute_denied';
      const notif = buildNotificationRow(kindN, {
        companyName: dispute.company_name,
        companyKey: dispute.company_key || normalizeClaimCompany(dispute.company_name),
        employerUserId: dispute.employer_user_id, jobId: dispute.job_id,
        title: decision === 'approved' ? `Dispute #${idNum} approved` : `Dispute #${idNum} reviewed`,
        body: decision === 'approved'
          ? `An admin approved your ${dispute.kind} dispute (#${idNum}).${applied.reportsCleared ? ' The inactive reports were cleared and your listing is active again.' : ''}${note ? ` Note: ${note}` : ''}`
          : `An admin reviewed your ${dispute.kind} dispute (#${idNum}) and did not approve it.${note ? ` Note: ${note}` : ''}`,
        meta: { dispute_id: idNum, decision },
      });
      if (notif) await db('employer_notifications', { method: 'POST', body: JSON.stringify(notif), headers: { Prefer: 'return=minimal' } });
    } catch (e) { console.error('[resolve_listing_dispute] notify failed (non-fatal):', e?.message || e); }

    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'resolve_listing_dispute', target_type: 'listing_dispute', target_id: String(idNum), metadata: { decision, kind: dispute.kind, ...applied } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, decision, applied });
  }

  // ── UNIFIED LISTING TICKETS — one ticket per listing (seeker report ⋃ employer dispute) ──
  // The single place a report and its dispute are reviewed together. Actions stay the existing
  // ones (resolve_listing_dispute for a dispute; delete_listing / dismiss_inactive_report for a
  // bare report) — this only UNIFIES the read so the whole ticket is one object keyed by job_id.
  if (action === 'list_listing_tickets') {
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const [repRes, dispRes] = await Promise.all([
      db(`job_availability_reports?reported_at=gte.${encodeURIComponent(monthAgo)}&select=job_id,status,reported_at,company,title,city,apply_url&order=reported_at.desc&limit=2000`),
      db(`listing_disputes?select=id,job_id,company_name,employer_user_id,kind,reason,detail,proposed_changes,status,created_at,reviewed_at,reviewed_by,admin_note&order=created_at.desc&limit=300`),
    ]);
    const reports = repRes.ok ? await repRes.json() : [];
    const disputes = dispRes.ok ? await dispRes.json() : [];

    // Enrich the real (uuid) listings + find which apply_urls are admin-suppressed (removed).
    const UUID_RE2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const jobIds = [...new Set([...reports, ...disputes].map(x => x.job_id).filter(Boolean))];
    const uuidIds = jobIds.filter(id => UUID_RE2.test(id));
    let jobsById = {};
    if (uuidIds.length) {
      const jr = await db(`jobs?id=in.(${uuidIds.map(encodeURIComponent).join(',')})&select=id,title,company,city,apply_url,availability_status&limit=500`);
      const jrows = jr.ok ? await jr.json() : [];
      jobsById = Object.fromEntries(jrows.map(j => [j.id, j]));
    }
    // Suppressed listings carry the removal reason (admin_removed / employer_dispute / employer_closed).
    const applyUrls = [...new Set([
      ...Object.values(jobsById).map(j => j.apply_url),
      ...reports.map(r => r.apply_url),
    ].filter(Boolean))];
    let suppressedByUrl = {};
    if (applyUrls.length) {
      // PostgREST in-list of urls: comma-join encoded values, capped to a sane size.
      const inList = applyUrls.slice(0, 400).map(u => encodeURIComponent(u)).join(',');
      const sr = await db(`suppressed_listings?apply_url=in.(${inList})&select=apply_url,reason,created_at&limit=500`);
      const srows = sr.ok ? await sr.json() : [];
      suppressedByUrl = Object.fromEntries(srows.map(s => [s.apply_url, { reason: s.reason, created_at: s.created_at }]));
    }

    const tickets = buildListingTickets({ reports, disputes, jobsById, suppressedByUrl });
    const counts = { open: tickets.filter(t => t.status === 'open').length, resolved: tickets.filter(t => t.status === 'resolved').length };
    return res.status(200).json({ ok: true, tickets, counts });
  }

  if (action === 'set_pro') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { user_id, pro } = body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    // `comped` (migration 051) is what makes the grant DURABLE: the Stripe reconcile
    // paths refuse to revoke comped accounts, so an admin grant no longer evaporates on
    // the next pricing-page load / nightly sweep for anyone with a stripe_customer_id.
    await db(`ai_credits?on_conflict=user_id`, { method: 'POST', body: JSON.stringify({ user_id, pro: !!pro, comped: !!pro, balance: pro ? 999 : 3, daily_earned: 0, last_reset: new Date().toISOString().split('T')[0] }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'set_pro', target_type: 'user', target_id: user_id, metadata: { pro } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── FEATURE FLAG MANAGEMENT ───────────────────────────────────────────────────
  if (action === 'set_flag') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { flag_name, status, percentage } = body;
    const VALID_STATUSES = ['off','admin_only','beta_users','percentage_rollout','fully_on'];
    if (!flag_name || !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'flag_name and valid status required' });
    const acctRes = await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=admin_id&limit=1`);
    const acctRows = acctRes.ok ? await acctRes.json() : [];
    const adminIdForFlag = acctRows[0]?.admin_id || 'unknown';
    // UPSERT — creates the row if it doesn't exist yet, updates otherwise
    await db(`feature_flags?on_conflict=flag_name`, {
      method: 'POST',
      body: JSON.stringify({ flag_name, status, percentage: status === 'percentage_rollout' ? (parseInt(percentage) || 0) : 0, updated_by: adminIdForFlag, updated_at: new Date().toISOString() }),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'set_flag', target_type: 'feature_flag', target_id: flag_name, metadata: { status, percentage } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── SEED DEFAULT FLAGS ────────────────────────────────────────────────────────
  if (action === 'seed_flags') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const defaultFlags = [
      { flag_name: 'ai_credit_system_enabled', status: 'fully_on', percentage: 0, description: 'Enables the daily AI credit system. When off, all users get unlimited AI.' },
      { flag_name: 'reddit_import_enabled',    status: 'off',      percentage: 0, description: 'Enables automatic Reddit report import via cron.' },
      { flag_name: 'job_refresh_enabled',      status: 'fully_on', percentage: 0, description: 'Enables the Adzuna job refresh cron job.' },
    ];
    let created = 0;
    for (const f of defaultFlags) {
      const r = await db(`feature_flags?on_conflict=flag_name`, {
        method: 'POST',
        body: JSON.stringify({ ...f, updated_at: new Date().toISOString() }),
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      });
      if (r.ok && r.status !== 409) created++;
    }
    return res.status(200).json({ ok: true, created, total: defaultFlags.length });
  }

  // ── GET RECENT JOBS ───────────────────────────────────────────────────────────
  if (action === 'get_recent_jobs') {
    const { period } = body;
    const now = new Date();
    const todayISO2  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekISO2   = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthISO2  = new Date(Date.now() - 30 * 86400000).toISOString();
    const cutoff = period === 'today' ? todayISO2 : period === 'month' ? monthISO2 : weekISO2;
    const r = await db(`jobs?created_at=gte.${encodeURIComponent(cutoff)}&select=id,company,title,city,apply_url,created_at,availability_status,source&order=created_at.desc&limit=200`);
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.error('[get_recent_jobs] DB error', r.status, errBody);
      return res.status(500).json({ error: 'Query failed', detail: errBody.slice(0, 200) });
    }
    const jobs = await r.json();
    return res.status(200).json({ ok: true, jobs: Array.isArray(jobs) ? jobs : [], total: Array.isArray(jobs) ? jobs.length : 0, period });
  }

  // ── DUPLICATE CLUSTER MANAGEMENT ──────────────────────────────────────────────
  if (action === 'update_cluster') {
    const { cluster_id, status: clusterStatus, admin_note } = body;
    const VALID = ['suspected','safe','watching','limited','frozen','suspended'];
    if (!cluster_id || !VALID.includes(clusterStatus)) return res.status(400).json({ error: 'cluster_id and valid status required' });
    await db(`duplicate_clusters?id=eq.${encodeURIComponent(cluster_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: clusterStatus, admin_note: admin_note || null, updated_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'update_cluster', target_type: 'duplicate_cluster', target_id: String(cluster_id), metadata: { status: clusterStatus } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'remove_listing') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { job_id } = body;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    await db(`jobs?id=eq.${encodeURIComponent(job_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ availability_status: 'removed' }),
      headers: { Prefer: 'return=minimal' },
    });
    // Mark all expired reports for this job as resolved
    await db(`job_availability_reports?job_id=eq.${encodeURIComponent(job_id)}&status=eq.expired`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmed_expired' }),
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'remove_listing', target_type: 'job', target_id: String(job_id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // Dismiss inactive reports for a job_id that has no removable jobs-table row
  // (ephemeral search-result id, or a listing already gone). remove_listing PATCHes
  // jobs by uuid, which no-ops / 400s for these ids, leaving the reports on the
  // panel forever. This deletes the report rows directly so the admin can clear them.
  if (action === 'dismiss_inactive_report') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { job_id } = body;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    await db(`job_availability_reports?job_id=eq.${encodeURIComponent(String(job_id))}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'dismiss_inactive_report', target_type: 'job', target_id: String(job_id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // Delete a reported listing: soft-delete the jobs row (reversible — the row SURVIVES) AND
  // clear its availability reports so it leaves the queue.
  //
  // HOW the listing is actually removed: the whole user-facing job stack filters on
  // `expires_at > now()`, NOT on `availability_status` (see the stale-sweep at the bottom of
  // this file). So we EXPIRE the row — `availability_status='expired'` + `expires_at=now()` —
  // which drops it out of every search/read path immediately while keeping the row alive so
  // direct /jobs/<id> links still resolve. NOTE: `availability_status` has a CHECK constraint
  // (active/stale/expired/unknown) — writing 'removed' 400s silently and removes NOTHING, so
  // 'expired' is the only correct value here.
  //
  // We DELETE the report rows rather than PATCHing their status: the report status CHECK only
  // permits active/expired/unknown, so writing a "resolved"-style status silently 400s and
  // the report would resurface on the next load. DELETE always sticks. Full admins only
  // (moderators cannot destroy listings).
  if (action === 'delete_listing') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { job_id } = body;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    const jid = String(job_id);
    // Only a syntactically valid uuid can be a real jobs-table row — feeding an ephemeral
    // search-result id (e.g. "j_1no2squ") into jobs?id=eq. 400s (uuid parse). Guard it.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let soft_deleted = false;
    let suppressed = false;
    let deadCompany = null; // company of the confirmed-dead listing → score recompute below
    if (UUID.test(jid)) {
      // Read the row BEFORE expiring it: its apply_url goes into suppressed_listings so the
      // same dead posting can neither resurface via re-aggregation nor be paste-a-link
      // re-imported, and its company feeds the stale-listing registry/penalty. Previously
      // only ephemeral listings got suppressed — DB-backed ones could come straight back.
      const rowRes = await db(`jobs?id=eq.${encodeURIComponent(jid)}&select=apply_url,title,company&limit=1`);
      const rowRows = rowRes.ok ? await rowRes.json() : null;
      const jobRow = Array.isArray(rowRows) ? rowRows[0] : null;
      const up = await db(`jobs?id=eq.${encodeURIComponent(jid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ availability_status: 'expired', expires_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }),
        headers: { Prefer: 'return=minimal' },
      });
      soft_deleted = up.ok;
      if (jobRow?.apply_url) {
        const ins = await db('suppressed_listings?on_conflict=apply_url', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ apply_url: jobRow.apply_url, stable_job_id: jid, title: jobRow.title || null, company: jobRow.company || null, reason: 'admin_removed' }),
        });
        suppressed = ins.ok;
        deadCompany = jobRow.company || null;
      }
    } else {
      // Ephemeral (live-search) listing — no jobs row to expire. Suppress it by apply_url so a
      // re-search can't resurface the same dead posting (migration 047). We read the listing
      // snapshot the client saved on the report (migration 046) to get the apply_url; without one
      // there's nothing stable to suppress, so we just clear the report below.
      const snapRes = await db(`job_availability_reports?job_id=eq.${encodeURIComponent(jid)}&select=apply_url,title,company&limit=1`);
      const snapRows = snapRes.ok ? await snapRes.json() : null;
      const snap = Array.isArray(snapRows) ? snapRows[0] : null;
      if (snap?.apply_url) {
        const ins = await db('suppressed_listings?on_conflict=apply_url', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ apply_url: snap.apply_url, stable_job_id: jid, title: snap.title || null, company: snap.company || null, reason: 'admin_removed' }),
        });
        suppressed = ins.ok;
        deadCompany = snap.company || null;
      }
    }
    await db(`job_availability_reports?job_id=eq.${encodeURIComponent(jid)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    // Admin just CONFIRMED a dead listing — recompute the company's stored score so the
    // stale-listing penalty (companyScore.js) lands now, not on the next report write.
    // Awaited (not fire-and-forget): Vercel freezes the function after the response.
    if (suppressed && deadCompany) {
      try { await recomputeCompanyScoreFromReports(SB, { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' }, normalizeCompany(deadCompany)); } catch { /* score refresh is best-effort */ }
    }
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'delete_listing', target_type: 'job', target_id: jid, metadata: { soft_deleted, suppressed } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, soft_deleted, suppressed });
  }

  // ── JOB DEDUPLICATION ────────────────────────────────────────────────────────
  if (action === 'scan_job_dupes') {
    // Adzuna uses different tracking params per search query, so apply_url varies
    // for the same job matched by multiple searches. Use (title, company, city) instead.
    const r = await db('jobs?select=id,title,company,city&limit=100000');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const jobs = await r.json();
    const seen = new Map();
    for (const j of (jobs || [])) {
      const key = `${(j.title || '').toLowerCase().trim()}|${(j.company || '').toLowerCase().trim()}|${(j.city || '').toLowerCase().trim()}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    let suspected = 0;
    for (const count of seen.values()) if (count > 1) suspected += count - 1;
    return res.status(200).json({ ok: true, suspected, total: (jobs || []).length });
  }

  if (action === 'dedupe_jobs') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const r = await db('jobs?select=id,title,company,city,last_seen_at,created_at&limit=100000');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const jobs = await r.json();
    // Group by (title, company, city) case-insensitive
    const byKey = new Map();
    for (const j of (jobs || [])) {
      const key = `${(j.title || '').toLowerCase().trim()}|${(j.company || '').toLowerCase().trim()}|${(j.city || '').toLowerCase().trim()}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(j);
    }
    const toDelete = [];
    for (const group of byKey.values()) {
      if (group.length <= 1) continue;
      // Keep newest by last_seen_at, then created_at
      group.sort((a, b) => ((b.last_seen_at || b.created_at || '') > (a.last_seen_at || a.created_at || '') ? 1 : -1));
      toDelete.push(...group.slice(1).map(j => j.id));
    }
    if (!toDelete.length) return res.status(200).json({ ok: true, deleted: 0 });
    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      // SECURITY: Encode each ID to prevent injection via crafted job IDs.
      const encodedIds = batch.map(id => encodeURIComponent(String(id))).join(',');
      const dr = await db(`jobs?id=in.(${encodedIds})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (dr.ok) deleted += batch.length;
    }
    return res.status(200).json({ ok: true, deleted });
  }

  if (action === 'deny_report') {
    const { job_id } = body;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    // Mark job as confirmed active and dismiss reports
    await db(`jobs?id=eq.${encodeURIComponent(job_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ availability_status: 'active', last_checked_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    });
    await db(`job_availability_reports?job_id=eq.${encodeURIComponent(job_id)}&status=eq.expired`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'denied' }),
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'deny_report', target_type: 'job', target_id: String(job_id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'approve_report') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db(`reports?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ needs_review: false, outcome_weight: 1.0 }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'approve_report', target_type: 'report', target_id: String(id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'investigate_report') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db(`reports?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ needs_review: true }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'investigate_report', target_type: 'report', target_id: String(id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'deny_hiring_report') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db(`reports?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ outcome_weight: 0, needs_review: false }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'deny_hiring_report', target_type: 'report', target_id: String(id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'detect_duplicates_by_signals') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    // Find IPs shared by 2+ distinct users in the last 30 days
    const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();
    const signalsRes = await db(`login_signals?created_at=gte.${monthISO}&select=user_id,ip_address&limit=5000`);
    if (!signalsRes.ok) return res.status(500).json({ error: 'Could not query signals' });
    const signals = await signalsRes.json();
    // Group by IP
    const ipGroups = {};
    signals.forEach(s => {
      if (!s.ip_address || s.ip_address === 'unknown') return;
      if (!ipGroups[s.ip_address]) ipGroups[s.ip_address] = new Set();
      ipGroups[s.ip_address].add(s.user_id);
    });
    // Find shared IPs with 2-10 distinct users (>10 = likely NAT/campus, skip)
    const suspects = [];
    for (const [ip, users] of Object.entries(ipGroups)) {
      if (users.size >= 2 && users.size <= 10) {
        suspects.push({ ip, user_ids: [...users], count: users.size });
      }
    }
    // Upsert clusters for new suspect groups
    let created = 0;
    for (const s of suspects.slice(0, 50)) {
      const userArray = `{${s.user_ids.map(u => `"${u}"`).join(',')}}`;
      const existing = await db(`duplicate_clusters?signals=cs.{"ip:${s.ip}"}&limit=1`);
      if (existing.ok && (await existing.json()).length > 0) continue;
      const riskScore = Math.min(100, 20 + s.count * 10);
      await db('duplicate_clusters', {
        method: 'POST',
        body: JSON.stringify({ user_ids: s.user_ids, signals: [`ip:${s.ip}`], risk_score: riskScore, status: 'suspected' }),
        headers: { Prefer: 'return=minimal' },
      });
      created++;
    }
    return res.status(200).json({ ok: true, suspects: suspects.length, clusters_created: created });
  }

  // ── get_jobs_grouped: all jobs by company for admin browser ───────────────────
  if (action === 'get_jobs_grouped') {
    const r = await db('jobs?select=id,company,availability_status&limit=10000');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const jobs = await r.json();
    const groups = {};
    for (const j of (jobs || [])) {
      const co = j.company || 'Unknown';
      if (!groups[co]) groups[co] = { company: co, total: 0, active: 0 };
      groups[co].total++;
      if (j.availability_status === 'active') groups[co].active++;
    }
    const sorted = Object.values(groups).sort((a, b) => b.total - a.total);
    return res.status(200).json({ ok: true, groups: sorted, total_jobs: (jobs || []).length });
  }

  // ── get_company_jobs: all listings for one company ────────────────────────────
  if (action === 'get_company_jobs') {
    const { company } = body;
    if (!company) return res.status(400).json({ error: 'company required' });
    const r = await db(`jobs?company=eq.${encodeURIComponent(company)}&select=id,title,city,apply_url,source,availability_status,created_at,last_seen_at&order=created_at.desc&limit=500`);
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const jobs = await r.json();
    return res.status(200).json({ ok: true, jobs: jobs || [], company });
  }

  // ── delete_user: permanently remove a user + all their data (full admins only) ──
  if (body.action === 'delete_user') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const userId = String(body.user_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'Valid user_id required' });

    // Contributed company intel (reports, résumé surveys) must OUTLIVE the account —
    // it is anonymized (user_id → null), never destroyed. Anonymize BEFORE deletion.
    // Non-fatal: a PATCH failure is logged but never blocks the account deletion.
    const anonCount = async (table) => {
      try {
        const r = await db(`${table}?user_id=eq.${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ user_id: null }),
          headers: { Prefer: 'return=representation' },
        });
        if (!r.ok) { console.error(`[delete_user] anonymize ${table} failed`, r.status, (await r.text().catch(() => '')).slice(0, 160)); return null; }
        const rows = await r.json().catch(() => []);
        return Array.isArray(rows) ? rows.length : null;
      } catch (e) { console.error(`[delete_user] anonymize ${table} threw`, e?.message || e); return null; }
    };
    const reportsAnon = await anonCount('reports');
    const surveysAnon = await anonCount('resume_surveys');

    // Remove their app data first (in case FKs aren't ON DELETE CASCADE), then the auth user.
    // NOTE: resume_surveys is intentionally NOT here — its rows are anonymized above, not deleted.
    const userTables = ['applications', 'saved_jobs', 'credit_transactions', 'answered_questions', 'resume_employment', 'user_recent_cos', 'ai_credits'];
    for (const t of userTables) {
      await db(`${t}?user_id=eq.${userId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    }
    await db(`profiles?id=eq.${userId}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    // Delete the auth user via the admin API (removes login + auth-schema rows).
    const authDel = await fetch(`${SB}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE', headers: { apikey: SK, Authorization: `Bearer ${SK}` },
    });
    if (!authDel.ok && authDel.status !== 404) {
      const t = await authDel.text().catch(() => '');
      return res.status(502).json({ error: `Auth delete failed (${authDel.status})`, detail: t.slice(0, 160) });
    }
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'delete_user', target_type: 'user', target_id: userId, metadata: { reports_anonymized: reportsAnon, resume_surveys_anonymized: surveysAnon } }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ ok: true, deleted: userId });
  }

  // ── set_user_password: EMERGENCY password reset for ANY account (full admins only).
  //    Uses the Supabase Auth Admin API (service key, server-only). The new password is NEVER
  //    persisted or logged here — only the audit trail (which admin reset which account, and an
  //    optional reason) is recorded. The admin relays the new password to the account holder
  //    out-of-band. This exists so a locked-out user can be recovered without email access. ──
  if (body.action === 'set_user_password') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const userId = String(body.user_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'Valid user_id required' });
    const pw = String(body.new_password || '');
    if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (pw.length > 72) return res.status(400).json({ error: 'Password must be 72 characters or fewer' });
    // Update the auth password via the GoTrue admin API (same service-key path as delete_user).
    const upd = await fetch(`${SB}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!upd.ok) {
      const t = await upd.text().catch(() => '');
      return res.status(502).json({ error: `Password reset failed (${upd.status})`, detail: t.slice(0, 160) });
    }
    // Audit records WHO reset WHOSE password (+ optional reason) — never the password itself.
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'set_user_password', target_type: 'user', target_id: userId, metadata: { reason: String(body.reason || '').slice(0, 200) || null } }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ ok: true, user_id: userId });
  }

  // ── grant_credits: top up a specific account's AI-credit balance (full admins only) ──
  if (body.action === 'grant_credits') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const userId = String(body.user_id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({ error: 'Valid user_id required' });
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 500) return res.status(400).json({ error: 'amount must be an integer between 1 and 500' });

    // Read-modify-write: add to the existing balance, or create a fresh free-tier row.
    const curRes = await db(`ai_credits?user_id=eq.${userId}&select=balance&limit=1`);
    const curRows = curRes.ok ? await curRes.json() : [];
    let newBalance;
    if (curRows.length) {
      newBalance = (Number(curRows[0].balance) || 0) + amount;
      const up = await db(`ai_credits?user_id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ balance: newBalance }),
        headers: { Prefer: 'return=minimal' },
      });
      if (!up.ok) return res.status(500).json({ error: 'Failed to update balance' });
    } else {
      newBalance = amount;
      const ins = await db(`ai_credits?on_conflict=user_id`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, balance: amount, pro: false, daily_earned: 0, last_reset: new Date().toISOString().split('T')[0] }),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
      if (!ins.ok) return res.status(500).json({ error: 'Failed to create credit balance' });
    }
    await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: userId, delta: amount, reason: 'admin_grant' }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'grant_credits', target_type: 'user', target_id: userId, metadata: { amount, new_balance: newBalance } }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ ok: true, balance: newBalance });
  }

  // ── list_subscriptions: read-only Stripe subscription list for the Trials drill-down ──
  // Full admins only, audited as a read. Stripe items are default-included on each object —
  // we pass NO expand[] (expanding the items list 400s the whole request; the same bug #124
  // removed elsewhere). Returns a trimmed shape only; no secret is ever exposed to the client.
  // Stripe unset → honest empty payload with stripe_connected:false (dashboard degrades).
  if (body.action === 'list_subscriptions') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'list_subscriptions', target_type: 'stripe' }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(200).json({ ok: true, subscriptions: [], stripe_connected: false });
    try {
      const r = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=100', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) return res.status(200).json({ ok: true, subscriptions: [], stripe_connected: true, error: `Stripe HTTP ${r.status}` });
      const d = await r.json();
      const subscriptions = (d.data || []).map(s => ({
        id: s.id,
        status: s.status,
        cancel_at_period_end: !!s.cancel_at_period_end,
        trial_end: s.trial_end || null,
        current_period_end: s.current_period_end || null,
        // customer is a bare id unless expanded (we don't expand it); email only present
        // if Stripe happens to inline the customer object — otherwise fall back to the id.
        customer: typeof s.customer === 'string' ? s.customer : (s.customer?.id || null),
        email: (typeof s.customer === 'object' ? s.customer?.email : null) || null,
      }));
      return res.status(200).json({ ok: true, subscriptions, stripe_connected: true, has_more: !!d.has_more });
    } catch {
      return res.status(200).json({ ok: true, subscriptions: [], stripe_connected: true, error: 'Stripe request failed' });
    }
  }

  // ── export_company: full evidentiary audit bundle for ONE company ─────────────
  // Assembles the complete "how the grade was computed" chain for a company — every
  // contributing AND excluded report, each with its source/trust weight, the per-source
  // aggregation, the live-recomputed fused score with all formula inputs, and a methodology
  // key. Built for legal defensibility and transparency of aggregation. Submitters are
  // PSEUDONYMIZED: user_id → a stable hash token (proves distinct-submitter counts / anti-Sybil
  // without exposing account identifiers if the file leaves the building in discovery).
  if (body.action === 'export_company') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    // ONE bundle builder feeds both the JSON export and the legal PDF (see companyAuditBundle.js).
    let bundle;
    try {
      bundle = await buildCompanyAuditBundle({ db, serviceKey: SK, adminId: sess.admin_id, adminRole, company: body.company });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'export failed' });
    }
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'export_company', target_type: 'company', target_id: bundle.query, metadata: { reports: bundle.totals.total_reports } }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ ok: true, bundle });
  }

  // ── get_kpi_detail: return raw rows behind a KPI card ─────────────────────
  if (body.action === 'get_kpi_detail') {
    const metric = body.metric;
    const now = new Date();
    const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekISO  = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();

    let rows = [];

    if (metric === 'total_accounts') {
      const r = await db('profiles?select=id,email,created_at&order=created_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'new_today') {
      const r = await db(`profiles?created_at=gte.${todayISO}&select=id,email,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'new_this_week') {
      const r = await db(`profiles?created_at=gte.${weekISO}&select=id,email,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'companies_scored') {
      // company_scores keys on company_name / overall_score — the old select asked for
      // company_id / score (columns that don't exist), so this KPI drill-down was always empty.
      const r = await db('company_scores?select=company_name,overall_score,ghost_rate,response_rate,report_count,created_at&order=overall_score.desc&limit=100');
      const scores = r.ok ? await r.json() : [];
      rows = (Array.isArray(scores) ? scores : []).map(s => ({ company: s.company_name, score: s.overall_score, ghost_rate: s.ghost_rate, response_rate: s.response_rate, report_count: s.report_count, created_at: s.created_at }));
    } else if (metric === 'total_reports') {
      const r = await db('reports?select=id,company_name,outcome,role,created_at&order=created_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'reports_today') {
      const r = await db(`reports?created_at=gte.${todayISO}&select=id,company_name,outcome,role,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'reports_week') {
      const r = await db(`reports?created_at=gte.${weekISO}&select=id,company_name,outcome,role,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'ghost_rate') {
      const r = await db(`applications?status=eq.ghosted&updated_at=gte.${monthISO}&select=id,company_name,role,city,stage,updated_at&order=updated_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'apps_total') {
      const r = await db('applications?select=id,company_name,role,status,stage,created_at&order=created_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'ghosted_30d') {
      const r = await db(`applications?status=eq.ghosted&updated_at=gte.${monthISO}&select=id,company_name,role,city,stage,updated_at&order=updated_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'hired_30d') {
      const r = await db(`applications?status=eq.hired&updated_at=gte.${monthISO}&select=id,company_name,role,city,updated_at&order=updated_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'co_lookups') {
      const r = await db(`search_logs?created_at=gte.${todayISO}&select=query,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'jobs_total') {
      const r = await db('jobs?select=company,title,city,availability_status,source,created_at&order=created_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'jobs_active') {
      const r = await db('jobs?availability_status=eq.active&select=company,title,city,source,last_seen_at&order=last_seen_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'jobs_today') {
      const r = await db(`jobs?created_at=gte.${todayISO}&select=company,title,city,source,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'jobs_stale') {
      const r = await db('jobs?availability_status=in.(stale,expired)&select=company,title,city,availability_status,last_seen_at&order=last_seen_at.desc&limit=100');
      rows = await r.json();
    } else {
      return res.status(400).json({ error: 'Unknown metric' });
    }

    if (!Array.isArray(rows)) rows = [];

    // Stitch the Pro flag (from ai_credits.pro) onto account rows so the Manage Accounts
    // modal can filter Pro/Free and Grant/Revoke Pro inline. One cheap query keyed on the
    // ≤100 user ids we just fetched. Accounts with no ai_credits row are Free by definition.
    if (['total_accounts', 'new_today', 'new_this_week'].includes(metric) && rows.length) {
      const ids = rows.map(r => r.id).filter(Boolean);
      let proMap = new Map();
      if (ids.length) {
        const cr = await db(`ai_credits?user_id=in.(${ids.join(',')})&select=user_id,pro,balance`);
        const credits = cr.ok ? await cr.json() : [];
        proMap = new Map((Array.isArray(credits) ? credits : []).map(c => [c.user_id, c]));
      }
      rows = rows.map(r => ({ ...r, pro: !!proMap.get(r.id)?.pro, balance: proMap.get(r.id)?.balance ?? null }));
    }
    return res.status(200).json({ ok: true, metric, rows });
  }

  // ── PURGE STALE/EXPIRED LISTINGS — the "clear stale" half of a manual refresh ─────
  // Why this exists: the refresh cron backfills fresh ACTIVE listings but can NOT un-stale
  // jobs the sources no longer return. Adzuna is date-sorted, so a listing not re-seen in 7+
  // days goes 'stale' and never resurfaces on a re-search — yet it still SERVES to users
  // (the job search filters on expires_at>now, not availability_status) until its expires_at
  // passes (up to 14 days later). Result: after a refresh the admin "Stale/expired" count
  // never drops → the button looks dead. This explicit, admin-gated, audited action
  // SOFT-RETIRES those unconfirmed-stale rows (does NOT delete them): it sets
  // expires_at=now() so they immediately fall out of the user search (which gates on
  // expires_at>now) AND out of the "Stale/expired" count, while the row itself SURVIVES so
  // saved_jobs/applications foreign keys and /jobs/[id] permalinks (get_by_id resolves by
  // id, no expires_at filter) still resolve for anyone holding a shared/saved link. Full
  // admins only; the fresh backfill from refresh-jobs replaces the cleared inventory.
  if (action === 'purge_stale_jobs') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const cnt = r => parseInt((r?.headers?.get('content-range') || '').split('/')[1]) || 0;
    const beforeRes = await db(`jobs?availability_status=in.(stale,expired)&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } });
    const removed = cnt(beforeRes);
    if (removed > 0) {
      const patch = await db(`jobs?availability_status=in.(stale,expired)`, { method: 'PATCH', body: JSON.stringify({ availability_status: 'expired', expires_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
      if (!patch.ok) return res.status(500).json({ error: 'Failed to retire stale listings' });
    }
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'purge_stale_jobs', target_type: 'jobs', metadata: { removed } }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return res.status(200).json({ ok: true, removed });
  }

  // ── EMERGENCY JOB REFRESH — server-side auto-remediation for a job crisis ─────
  // Triggered from the admin crisis banner. Calls the refresh-jobs endpoint
  // (owned by another module — we only CALL it, never edit it) with ?all=1 so it
  // runs every batch + source in one shot to backfill the board immediately.
  // We forward the cron secret server-side so this works even if the caller's
  // admin token isn't accepted by refresh-jobs; if CRON_SECRET is unset we fall
  // back to forwarding the admin session token (refresh-jobs validates either).
  if (action === 'emergency_job_refresh') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host  = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (!host) return res.status(500).json({ error: 'Cannot resolve host for refresh' });
    const cronSecret = process.env.CRON_SECRET;
    const refreshHeaders = { 'Content-Type': 'application/json' };
    if (cronSecret) refreshHeaders.Authorization = `Bearer ${cronSecret}`;
    else refreshHeaders['X-Admin-Token'] = adminToken; // refresh-jobs validates admin sessions too
    try {
      const refreshRes = await fetch(`${proto}://${host}/api/refresh-jobs?all=1`, {
        method: 'POST',
        headers: refreshHeaders,
        body: '{}',
      });
      const data = await refreshRes.json().catch(() => ({}));
      if (!refreshRes.ok) {
        return res.status(502).json({ error: data.error || `Refresh failed (${refreshRes.status})` });
      }
      await db('admin_audit_log', {
        method: 'POST',
        body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'emergency_job_refresh', target_type: 'jobs', metadata: { upserted: data.upserted ?? null, found: data.found ?? null } }),
        headers: { Prefer: 'return=minimal' },
      }).catch(() => {});
      // Normalize the count fields refresh-jobs may return across versions.
      const added = data.upserted ?? data.inserted ?? data.found ?? null;
      return res.status(200).json({ ok: true, added, result: data });
    } catch (e) {
      return res.status(502).json({ error: `Refresh request failed: ${e.message}` });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
