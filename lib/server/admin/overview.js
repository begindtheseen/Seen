// Today: four numbers, every work queue with its count, one system line. A count that could not be read is
// null and named in `failed` — never a 0 that looks like a measurement.
//
// The counts come from ONE RPC, admin_overview(p_today) (migration 20261111100000_admin_core.sql), when it
// exists; before that, from bounded parallel exact counts (each with its own time cap). The listing counts
// and the ticket count always come from the same reads their own screens use, so Today and the section
// never disagree.

import { rpc, countExact } from './batch.js';
import { pacificDayStart } from '../../time/pacific.js';
import { HELD_PENDING_FILTER } from './review.js';
import { jobsCounts, loadTickets } from './listings.js';
import { cronHealthRows, systemLine, revenueWindow } from './system.js';

const QUEUES = [
  { key: 'held_reports', label: 'Held reports', section: 'review', filter: { kind: 'held' } },
  { key: 'listing_tickets', label: 'Listing tickets', section: 'review', filter: { kind: 'tickets' } },
  { key: 'reddit_disputes', label: 'Reddit disputes', section: 'review', filter: { kind: 'disputes' } },
  { key: 'employer_claims', label: 'Employer claims', section: 'review', filter: { kind: 'claims' } },
  { key: 'employer_replies', label: 'Employer replies', section: 'review', filter: { kind: 'replies' } },
  { key: 'purchases_to_fulfil', label: 'Purchases to fulfil', section: 'review', filter: { kind: 'purchases' } },
  { key: 'data_issues', label: 'Data issues', section: 'review', filter: { kind: 'issues' } },
  { key: 'account_clusters', label: 'Account clusters', section: 'people', filter: { view: 'clusters' } },
];

// Fallback count paths (the RPC computes the same filters in SQL).
const COUNT_PATHS = (todayISO, since24, since7) => ({
  held_reports: `reports?${HELD_PENDING_FILTER}&select=id`,
  reddit_disputes: 'company_reddit_disputes?status=eq.open&select=id',
  employer_claims: 'employer_company_claims?status=eq.pending&select=id',
  employer_replies: 'employer_report_replies?status=eq.pending&select=id',
  purchases_to_fulfil: 'employer_purchases?status=eq.paid&select=id',
  data_issues: 'user_issues?status=eq.open&select=id',
  account_clusters: 'duplicate_clusters?status=eq.suspected&select=id',
  reports_24h: `reports?created_at=gte.${encodeURIComponent(since24)}&select=id`,
  signups_24h: `profiles?created_at=gte.${encodeURIComponent(since24)}&select=id`,
  reports_7d: `reports?created_at=gte.${encodeURIComponent(since7)}&select=id`,
  signups_7d: `profiles?created_at=gte.${encodeURIComponent(since7)}&select=id`,
  signups_today: `profiles?created_at=gte.${encodeURIComponent(todayISO)}&select=id`,
  errors_24h: `api_errors?created_at=gte.${encodeURIComponent(since24)}&select=id`,
  recompute_waiting: 'company_recompute_queue?select=company_key',
});

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export async function overviewData(ctx) {
  const now = new Date();
  const todayISO = pacificDayStart(now).toISOString();
  const since24 = new Date(now.getTime() - 86400e3).toISOString();
  const since7 = new Date(now.getTime() - 7 * 86400e3).toISOString();
  const failed = [];

  const [viaRpc, jobs, tickets, crons, revenue] = await Promise.all([
    rpc(ctx.db, 'admin_overview', { p_today: todayISO }),
    jobsCounts(ctx, 7000),
    loadTickets(ctx.db).catch(() => ({ ok: false })),
    cronHealthRows(ctx.db, now).catch(() => null),
    revenueWindow(ctx.db, 7).catch(() => ({ total_cents: null })),
  ]);

  let counts = {};
  let source = 'fallback';
  if (viaRpc.ok && viaRpc.data && typeof viaRpc.data === 'object' && !Array.isArray(viaRpc.data)) {
    source = 'rpc';
    counts = viaRpc.data;
  } else {
    const paths = COUNT_PATHS(todayISO, since24, since7);
    const names = Object.keys(paths);
    const vals = await Promise.all(names.map((n) => countExact(ctx.db, paths[n], 6000)));
    names.forEach((n, i) => { counts[n] = vals[i]; });
    // Before migration 20261111100000 there is no queue table: nothing waits, it is not a failed read.
    if (counts.recompute_waiting == null) counts.recompute_waiting = 0;
  }

  const stat = (name, v) => { const n = num(v); if (n == null) failed.push(name); return n; };
  const stats = {
    listings_live: stat('listings_live', jobs?.active),
    listings_stale: stat('listings_stale', jobs?.stale_clearable),
    reports_24h: stat('reports_24h', counts.reports_24h),
    signups_24h: stat('signups_24h', counts.signups_24h),
    revenue_7d_cents: stat('revenue_7d_cents', revenue?.total_cents),
  };
  const queues = QUEUES.map((q) => {
    const v = q.key === 'listing_tickets' ? (tickets && tickets.ok ? tickets.counts.open : null) : num(counts[q.key]);
    if (v == null) failed.push(q.key);
    return { ...q, count: v };
  });
  let system;
  if (crons) system = systemLine(crons.rows);
  else { system = { ok: false, line: 'Cron health could not be read.' }; failed.push('cron_health'); }

  return {
    ok: true,
    as_of: now.toISOString(),
    degraded: failed.length > 0,
    failed,
    source,
    stats,
    queues,
    system,
    extra: {
      reports_7d: num(counts.reports_7d), signups_7d: num(counts.signups_7d), signups_today: num(counts.signups_today),
      errors_24h: num(counts.errors_24h), recompute_waiting: num(counts.recompute_waiting),
      listings_total: num(jobs?.total), listings_added_today: num(jobs?.added_today), listings_counts_source: jobs?.source || null,
      revenue_source: revenue?.source || null,
    },
  };
}

export async function overview(ctx) {
  const out = await overviewData(ctx);
  return ctx.res.status(200).json(out);
}

export const actions = { overview };
