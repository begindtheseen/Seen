// The LEGACY dashboard read: GET /api/admin-stats with no action. /admin/legacy, the exec dashboard and the
// brain sync read this exact payload. Ported unchanged from the old handler except the 30-day chart / top
// companies / outcome mix, which now read every report of the window (they read the oldest 1,000 before).
// The new admin never calls this; it uses `overview` and the per-section lists.

import { fetchAdminJobsCounts } from '../adminJobsCounts.js';
import { enrichmentQueueStats } from '../enrichmentQueue.js';
import { pacificDate, pacificDayStart } from '../../time/pacific.js';
import { reportState, rulesCheck } from '../reportModeration.js';
import { HELD_PENDING_FILTER, reportsStats30 } from './review.js';

// Live subscription breakdown from Stripe. Seen sells no subscriptions any more; kept for the legacy page only.
async function stripeSubsBreakdown() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=100', { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const d = await r.json();
    const counts = { trialing: 0, active: 0, past_due: 0, canceled: 0, unpaid: 0, incomplete: 0 };
    let canceling = 0, trialingCanceling = 0, activeCanceling = 0, mrrCents = 0;
    for (const s of (d.data || [])) {
      counts[s.status] = (counts[s.status] || 0) + 1;
      if (s.cancel_at_period_end) { canceling++; if (s.status === 'trialing') trialingCanceling++; else if (s.status === 'active') activeCanceling++; }
      if (s.status === 'active' && !s.cancel_at_period_end) {
        const item = s.items?.data?.[0];
        const amt = item?.price?.unit_amount || 0;
        mrrCents += item?.price?.recurring?.interval === 'year' ? amt / 12 : amt;
      }
    }
    return { counts, canceling, trialing_active: Math.max(0, counts.trialing - trialingCanceling), active_paid_active: Math.max(0, counts.active - activeCanceling), mrr: Math.round(mrrCents) / 100, has_more: !!d.has_more };
  } catch { return null; }
}

export async function legacyDashboard(ctx) {
  const { res, db } = ctx;
  const SB = ctx.url, SK = ctx.key;
  const now = new Date();
  const todayISO = pacificDayStart(now).toISOString();
  const weekISO  = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();

  const ct = r => parseInt((r?.headers?.get('content-range') || '').split('/')[1]) || 0;

  // Self-filling company pages (migration 20261017140000): one small RPC, deliberately OUTSIDE the
  // db() wrapper — before the migration is applied it 404s, and that must read as { ready:false },
  // not mark every other number on this dashboard `degraded`.
  const enrichmentP = enrichmentQueueStats(SB, SK);
  // Database size against the storage guard (migration 20261021130000). Outside db() for the same reason:
  // before the migration it 404s, and that must read as null, not mark the dashboard degraded.
  const storageP = fetch(`${SB}/rest/v1/rpc/jobs_storage_status`, { method: 'POST', headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' }, body: '{}' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // The "stale" number the admin alert + Clear stale button use: the SAME definition the sweep
  // clears (lib/server/staleSweep.js). The older stale_or_expired count also includes 'expired'
  // rows kept for users' saved/applied links, which no clear can (or should) remove.
  // stale_overdue: stale rows the daily cron sweep should ALREADY have deleted (unseen 15d+ — its
  // cut-off is 14d, plus a day of grace). Normal churn keeps thousands of rows stale for 7–14 days
  // by design; only an overdue backlog means the sweep is falling behind and needs a manual clear.
  // ALL seven jobs counts (total, active, added today, stale+expired, clearable, kept, overdue) come
  // from ONE scan via lib/server/adminJobsCounts.js — they used to be seven concurrent exact counts
  // over the whole table on every poll, the top load on the database (see that file). Exact either way.
  const jobsCountsP = fetchAdminJobsCounts({
    supabaseUrl: SB, serviceKey: SK, db, todayISO,
    overdueISO: new Date(Date.now() - 15 * 86_400_000).toISOString(),
  });

  const [
    usersTotalRes, usersTodayRes, usersWeekRes,
    reportsAllRes, reportsTodayRes, reportsWeekRes,
    appsAllRes, appsGhostedRes, appsHiredRes,
    coScoredRes, issuesRes, creditListRes,
    errTodayRes, errWeekRes,
    dauRes, dupClustersRes, flagsRes,
    zeroSearchesRes, jobReportsRes, searchLogsTodayRes,
    recentReportsRes, recentAppsRes, inactiveReportsRes,
    reportsMonthRes, searchLogsWeekRes,
    creditTxnRes, outcomeSharesRes, usersMonthRes,
    searchEvents30Res, resumeScans30Res, disputesOpenRes,
    pendingClaimsRes, listingDisputesOpenRes, unfulfilledPurchasesRes, heldReportsRes,
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
    db(`search_events?result_count=eq.0&created_at=gte.${weekISO}&select=query&order=created_at.desc&limit=20`),
    db(`job_availability_reports?reported_at=gte.${weekISO}&select=job_id,status&limit=200`),
    db(`search_logs?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
    // NOTE: `reports` has no `city` column — it carries `location_id` (uuid FK). Selecting `city`
    // made PostgREST reject the whole request with 400, so `recent` has been silently EMPTY: the
    // admin dashboard's recent-reports feed showed nothing at all, not merely a missing city. Nothing
    // reads a report's city (the `.city` reads elsewhere in this file and in components/admin are on
    // JOB rows), so the column is simply dropped. Add `location_id` and resolve the name if the feed
    // ever needs a place again.
    db(`reports?select=id,company_name,outcome,role,platform,created_at,report_text,outcome_weight,trust_reason,needs_review&order=created_at.desc&limit=25`),
    db(`applications?select=id,company_name,role,city,status,stage,platform,created_at&order=created_at.desc&limit=25`),
    db(`job_availability_reports?status=in.(expired,unknown)&select=id,job_id,status,reported_at,company,title,city,apply_url&order=reported_at.desc&limit=50`),
    reportsStats30(db, now),
    db(`search_logs?created_at=gte.${weekISO}&select=query&limit=500`),
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
    db(`employer_purchases?status=eq.paid&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
    // Held reports awaiting an admin decision (Community → Reports awaiting review). Rejected rows
    // stay held but are done, so they are not pending.
    db(`reports?${HELD_PENDING_FILTER}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
  ]);

  const usersTotal = ct(usersTotalRes);
  const issues = issuesRes.ok ? await issuesRes.json() : [];
  const jobsCounts = await jobsCountsP;
  const jobsActive = jobsCounts.active || 0;
  const jobsNewToday = jobsCounts.added_today || 0;
  const jobsTotal = jobsCounts.total || 0;
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

  // Each recent row carries its real state (live / held / rejected / duplicate, counted in the grade or
  // not) and whether Seen's strict first-hand rules would accept it today — so the buttons' results show.
  const recentReports = (recentReportsRes.ok ? await recentReportsRes.json() : []).map((r) => ({ ...r, ...reportState(r), rules: rulesCheck(r) }));
  const recentApps    = recentAppsRes.ok    ? await recentAppsRes.json()    : [];
  const inactiveReportRows = inactiveReportsRes.ok ? await inactiveReportsRes.json() : [];

  // Chart + top companies + outcome breakdown: EVERY report of the last 30 California days (keyset read in
  // review.js reportsStats30). The old read asked for 2,000 ascending and got the OLDEST 1,000 — the last week
  // read 0 while prod had 122.
  const stats30 = reportsMonthRes && reportsMonthRes.ok ? reportsMonthRes : null;
  if (!stats30) db.failed.push({ table: 'reports(30d)', status: 0 });
  const chartDays = [];
  for (let i = 29; i >= 0; i--) chartDays.push(pacificDate(pacificDayStart(now, -i)));
  const reportsChart = stats30 ? stats30.by_day : chartDays.map((date) => ({ date, count: 0 }));
  const topCompanies = stats30 ? stats30.top_companies : [];
  const outcomeMap = stats30 ? stats30.outcome_mix : { ghosted: 0, rejected: 0, interview: 0, offer: 0, waiting: 0 };

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
  const staleJobs = jobsCounts.stale_or_expired || 0;
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
  (Array.isArray(usersMonth) ? usersMonth : []).forEach(u => { const d = u.created_at ? pacificDate(new Date(u.created_at)) : null; if (d) signupMap[d] = (signupMap[d] || 0) + 1; });
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
    enrichment: await enrichmentP,
    storage: await storageP,
    employer_claims: { pending: ct(pendingClaimsRes) },
    held_reports: { pending: ct(heldReportsRes) },
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
      added_today: jobsNewToday,
      stale_or_expired: staleJobs,
      // Clearable stale rows (what "Clear stale" removes) vs expired rows kept for saved/applied links.
      stale_clearable: jobsCounts.stale_clearable,
      expired_kept: jobsCounts.expired_kept,
      stale_overdue: jobsCounts.stale_overdue,
      counts_source: jobsCounts.source, // 'rpc' (one scan) or 'exact' (seven, before the migration)
      zero_result_searches_7d: zeroSearchRows.length,
      top_zero_queries: [...new Set(zeroSearchRows.map(r => r.query))].slice(0, 10),
      availability_reports_7d: jobReportRows.length,
      reports_by_status: jobReportsByStatus,
      inactive_reports: inactiveReports,
    },
    // Whether the numbers above can be trusted. `degraded: true` means at least one underlying query
    // failed, so some count in this payload is a fabricated 0 rather than a measurement. Consumers
    // (the exec dashboard, the brain sync) must refuse to record or display numbers when this is set
    // — a wrong figure presented as fact is worse than an admitted gap.
    data_quality: {
      degraded: db.failed.length > 0,
      failed_query_count: db.failed.length,
      failed_queries: db.failed.slice(0, 20),
    },
  });
}
