// Server-side reports fetch — uses service key to bypass RLS.
// Queries by company_name column directly — no company table join needed.

import { createHmac, timingSafeEqual } from 'crypto';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { reportsReadFromQuery, setPublicCache } from '../lib/server/publicRead.js';
import { logError } from '../lib/server/errlog.js';
import { tenureAdjustment, scoreConfidence, confidenceLabel, aggregateTenure, MIN_TENURE_SAMPLE } from './_utils/companyScore.js';
import { fuseCompanyIntel, classifyPlatform, mentionOutcomes, mentionTotal } from './_utils/companyIntel.js';
import { hasMentionCount, mentionSel, hasEmployeeReviewCount } from '../lib/server/scoreColumns.js';
import { EMPLOYEE_REVIEWS_FILTER } from '../lib/server/employeeReviews.js';
import { reportDupKey } from '../lib/server/reportDupes.js';
import { recomputeCompanyScoreFromReports, fetchConfirmedStaleCount, resolveOrCreateCompany, resolveOrCreateLocation, fetchEmployeeReviewSignal } from './_utils/reportWrite.js';
import { listEmployerListings, closeEmployerListing } from '../lib/server/employerListings.js';
import { fetchIndustryBenchmark } from '../lib/server/benchmark.js';
import { isEvidencedScore, suppressionReason, servedDataSource } from '../lib/server/scoreProvenance.js';
import { firstPartyReportCount, mentionCount, webClaimCount, gateScore, isGradeable, SCORABLE_REPORTS_FILTER, scorableResolvedCountPath, parseExactCount, EMPLOYEE_REVIEW_RE, scoreUpdatedAt, seenUserReportsPath, countSeenUserReports, seenUserShare } from '../lib/server/reportCounts.js';
import { feedRowPasses } from '../lib/reports/feedFilter.js';
import { enqueueCompanyEnrichment } from '../lib/server/enrichmentQueue.js';
import { rewardReport } from '../lib/server/growthRewards.js';
import { isVercelCron } from '../lib/server/cronAuth.js';

// Actions that existed only to call a model API — Reddit import classification and company web
// research — were removed with the owner's decision (2026-10-26) that Seen uses no model API.
// Free applicant reports come from the rule-based collectors (api/cron-archive-reports.js,
// api/enrich-companies.js, api/ingest-local-company-intel.js). An old caller gets an honest no-op.
export const REMOVED_MODEL_ACTIONS = new Set(['reddit_import', 'research', 'populate']);

// Exactly the outcomes the prod reports_outcome_check constraint accepts (verified 2026-10-17).
export const REPORT_OUTCOMES = new Set(['ghosted', 'rejected', 'autoreject', 'hired', 'offer', 'interview', 'interviewing', 'human', 'waiting']);
/** An imported outcome as a writable one: 'applied' (no response yet) → 'waiting'; anything
 *  the constraint rejects ('unknown', junk) → null, meaning "do not write this row". */
export function writableOutcome(o) {
  const v = String(o || '').trim().toLowerCase();
  const mapped = v === 'applied' ? 'waiting' : v;
  return REPORT_OUTCOMES.has(mapped) ? mapped : null;
}

// Verify a Supabase JWT locally (HS256). Returns the payload or null.
function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const mac = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    const sig = Buffer.from(s, 'base64url');
    const exp = Buffer.from(mac, 'base64url');
    if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!payload.sub || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

// Extract authenticated user_id from the request, or return null for anonymous.
async function resolveUid(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
  if (JWT_SECRET) {
    const p = verifyJWT(token, JWT_SECRET);
    if (p) return p.sub;
  }
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (r.ok) return (await r.json())?.id || null;
    } catch { /* ignore */ }
  }
  return null;
}

// Anti-Sybil trust assessment for a signed-in report submission. Returns the weight/reason/review
// to store. Anonymous submits are already 0.3 + needs_review elsewhere; this neutralizes two cheap
// signed-in manipulation patterns by dropping to 0.3 + needs_review (excluded from score fusion)
// rather than rejecting — legit repeat reporting still records, it just can't double-count or flood:
//   (a) the same user already reported this company in the last 30 days (duplicate), or
//   (b) the user has exceeded a per-account daily submission cap (mass-submission farm).
// `dupFilter` is a PostgREST predicate identifying the company (e.g. `company_id=eq.<uuid>`).
// NOTE: cross-account device/IP clustering (the multi-account Sybil case) is the next step —
// deferred because naive IP thresholds false-positive on corporate NAT / mobile carriers.
async function assessSubmitTrust(SUPABASE_URL, hdrs, uid, dupFilter) {
  const out = { weight: 1.0, reason: 'direct_submission', review: false };
  const DAILY_CAP = 15;
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const since1d = new Date(Date.now() - 864e5).toISOString();
  try {
    const [dupRes, volRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/reports?user_id=eq.${uid}&${dupFilter}&created_at=gte.${since30}&select=id&limit=1`, { headers: hdrs }),
      fetch(`${SUPABASE_URL}/rest/v1/reports?user_id=eq.${uid}&created_at=gte.${since1d}&select=id&limit=${DAILY_CAP + 1}`, { headers: hdrs }),
    ]);
    const isDup    = dupRes.ok && ((await dupRes.json()) || []).length > 0;
    const dayCount = volRes.ok ? ((await volRes.json()) || []).length : 0;
    if (isDup)                      { out.weight = 0.3; out.reason = 'duplicate_user_company'; out.review = true; }
    else if (dayCount >= DAILY_CAP) { out.weight = 0.3; out.reason = 'velocity_capped';        out.review = true; }
  } catch { /* on failure, fall through at default trust */ }
  return out;
}

// Blocks placeholder/garbage values from ever entering the companies table.
// Must contain at least one letter, no hash-prefixed IDs, no pure numerics,
// not a known placeholder word, min 2 chars.
function isValidCompanyName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 200) return false;
  if (!/[a-zA-Z]/.test(n)) return false;
  if (n.startsWith('#')) return false;
  const lower = n.toLowerCase();
  const BLOCKED = new Set([
    'unknown','n/a','na','none','test','company','employer','null','undefined',
    'other','various','multiple','anonymous','private','confidential','tbd','tba',
    'not specified','not listed','not provided','see description',
  ]);
  if (BLOCKED.has(lower)) return false;
  return true;
}

// Industry baseline benchmarks (Greenhouse 2023, LinkedIn Talent Insights)
const INDUSTRY_BENCHMARKS = {
  ghost_rate: 0.55,
  response_rate: 0.20,
  interview_rate: 0.025,
  avg_wait_days: 21,
  avg_rounds: 2.5,
  offer_rate: 0.008,
};

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Env + body setup (shared by GET crons and POST) ──────────────────────────
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
  body = body || {};

  // Vercel crons fire as GET requests with the action in the query string. Map them to
  // the POST-style action handlers below. This MUST run before the benchmark GET block,
  // which 400s on any GET without a recognized `type`.
  if (req.method === 'GET') {
    if (req.query.action === 'update_tenure') body = { action: 'update_tenure' };
  }
  const isCronGet = req.method === 'GET' && !!body.action;
  // Public reads as cacheable GETs (lib/server/publicRead.js): the query maps to the SAME body the POST
  // route uses, so one handler answers both and the CDN can serve repeat visitors. Measured 2026-10-24:
  // under 10–20 concurrent visitors every POST here waited 5–25 s on the shared database while the one
  // GET endpoint with cache headers answered from the edge in <100 ms.
  const publicRead = req.method === 'GET' && !isCronGet ? reportsReadFromQuery(req.query) : null;
  if (publicRead) body = publicRead;
  const isPublicGet = !!publicRead;

  // ── GET: benchmark stats (industry or company) ───────────────────────────────
  if (req.method === 'GET' && !isCronGet && !isPublicGet) {
    const limited = await applyRateLimit(req, res, 'benchmarks');
    if (limited) return;
    const { type, name, names } = req.query || {};
    if (type === 'industry') return res.status(200).json({ ok: true, benchmarks: INDUSTRY_BENCHMARKS });
    if (type === 'company' && name) {
      const stats = await fetchCompanyStats(String(name).slice(0, 100), SUPABASE_URL, { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' });
      return res.status(200).json({ ok: true, stats });
    }
    if (type === 'batch' && names) {
      const nameList = String(names).split(',').slice(0, 25).map(n => n.trim()).filter(Boolean);
      const dbH = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
      const arr = await Promise.all(nameList.map(n => fetchCompanyStats(n, SUPABASE_URL, dbH)));
      const result = {};
      nameList.forEach((n, i) => { if (arr[i]) result[n.toLowerCase()] = arr[i]; });
      return res.status(200).json({ ok: true, stats: result });
    }
    return res.status(400).json({ error: 'type required: industry|company|batch' });
  }

  if (req.method !== 'POST' && !isCronGet && !isPublicGet) return res.status(405).end('Method not allowed');

  if (REMOVED_MODEL_ACTIONS.has(body.action)) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'no_model_api', action: body.action });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'DB not configured' });
  }

  // Service-key headers for all DB reads/writes below. Declared once here, before
  // the first POST handler — previously it was declared further down, so the
  // leaderboard handler referenced an out-of-scope `dbH` and silently returned [],
  // leaving the company scoreboard empty.
  const hdrsBase = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  // PostgREST fetcher with the service key, the shape lib/server/growthRewards.js expects.
  const serviceDb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdrsBase, ...(opts.headers || {}) } });
  // "Report and get Pro" (lib/server/growthRewards.js): the outcome just written for one of the caller's
  // OWN tracked applications earns Pro days, by the application's server-side age, the same for every
  // outcome. It never touches the report, its weight or any score, and it can never fail the report:
  // a missing table (before migration 20261024160000) or any error is simply no reward.
  const reportReward = async (uid, applicationId) => {
    if (!applicationId) return null;
    try { return await rewardReport(serviceDb, uid, String(applicationId)); } catch { return null; }
  };

  // ── Employer perks (Engine E4) — active Featured / Transparency Verified for a company.
  // Isolated read so the company page can show the badge without touching the scoring path.
  // Perks never affect a score; this is display-only. Must run BEFORE the `body.name` catch below.
  if (body.action === 'employer_perk') {
    const name = String(body.name || '').trim().toLowerCase();
    if (!name) return res.status(200).json({ featured: false, verified: false });
    setPublicCache(res, 'perk');
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/employer_perks?company=eq.${encodeURIComponent(name)}&select=featured_until,verified_until&limit=1`, { headers: hdrsBase });
      const row = r.ok ? (await r.json())[0] : null;
      const now = Date.now();
      const active = (v) => !!v && Date.parse(v) > now;
      return res.status(200).json({ featured: active(row?.featured_until), verified: active(row?.verified_until) });
    } catch { return res.status(200).json({ featured: false, verified: false }); }
  }

  // ── Employer self-serve listing management (seen-command#94) ────────────────
  // No employer accounts exist, so trust comes from the listing's own source: a close
  // request only auto-expires when a live fetch of the apply_url confirms the posting is
  // gone (lib/server/employerListings.js); otherwise it queues in the admin open-issues
  // list. Both send `name`/no name — MUST run before the `body.name` catch below.
  if (body.action === 'employer_listings') {
    if (await applyRateLimit(req, res, 'employer-listings')) return;
    const r = await listEmployerListings({ url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY, company: body.name });
    return res.status(r.http).json(r.body);
  }
  if (body.action === 'employer_close_listing') {
    if (await applyRateLimit(req, res, 'employer-close')) return;
    const r = await closeEmployerListing({ url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY, jobId: body.job_id, reason: body.reason });
    return res.status(r.http).json(r.body);
  }

  // ── Industry benchmark (public, aggregate) — "you vs your industry on Seen". Powers the
  //    never-empty employer reputation hero and the consumer company page's credibility context.
  //    MUST be checked before the company_score block below, which greedily matches any body.name. ──
  if (body.action === 'industry_benchmark') {
    if (await applyRateLimit(req, res, 'industry-benchmark')) return;
    const name = (body.name || body.company || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name required' });
    let benchmark = null;
    try {
      benchmark = await fetchIndustryBenchmark(name, {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
      });
    } catch { /* fail-soft: the page still renders its own score without the benchmark */ }
    setPublicCache(res, 'benchmark');
    return res.status(200).json({ ok: true, benchmark });
  }

  // ── Company-score: merged from api/company-score.js ─────────────────────────
  if (body.action === 'company_score' || body.action === 'resolve' || body.name) {
    if (await applyRateLimit(req, res, 'company-score')) return;
    setPublicCache(res, 'score');
    return handleCompanyScore(req, res, body);
  }

  // ── Ghost surges for a user's tracked companies (dashboard "Signals") ─────────
  // Same rule the FAQ states: ≥3 scorable "ghosted" reports in the last 7 days. Names are matched
  // exactly (case-insensitive) so "general" never counts Dollar General's reports.
  if (body.action === 'ghost_surges') {
    const names = Array.isArray(body.names) ? [...new Set(body.names.map(n => String(n || '').toLowerCase().trim()).filter(Boolean))].slice(0, 20) : [];
    if (!names.length) return res.status(200).json({ ok: true, surges: [] });
    try {
      const since = encodeURIComponent(new Date(Date.now() - 7 * 86400000).toISOString());
      const inList = names.map(n => `"${n.replace(/"/g, '')}"`).join(',');
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/reports?select=company_name&outcome=eq.ghosted&created_at=gte.${since}&company_name=in.(${encodeURIComponent(inList)})&${SCORABLE_REPORTS_FILTER}&limit=1000`,
        { headers: hdrsBase }
      );
      const rows = r.ok ? await r.json() : [];
      const counts = {};
      for (const row of (Array.isArray(rows) ? rows : [])) { const k = String(row.company_name || '').toLowerCase().trim(); counts[k] = (counts[k] || 0) + 1; }
      const surging = names.filter(n => (counts[n] || 0) >= 3);
      // The company's CURRENT grade rides along: a week's 3 ghost reports at a company whose overall
      // ghost rate is 13% (Walmart, grade A) is not a warning on its own — the dashboard words the
      // signal with the base rate, or drops it when the grade is A / the ghost rate is under 20%.
      const grades = {};
      if (surging.length) {
        try {
          const gl = surging.map(n => `"${n.replace(/"/g, '')}"`).join(',');
          const gr = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?select=company_name,overall_score,ghost_rate,report_count,first_party_report_count,data_source&company_name=in.(${encodeURIComponent(gl)})&limit=40`, { headers: hdrsBase });
          for (const g of (gr.ok ? await gr.json() : [])) {
            const k = String(g.company_name || '').toLowerCase().trim();
            const gradeable = isGradeable(g);
            grades[k] = { gradeable, overall_score: gradeable ? g.overall_score : null, ghost_rate: gradeable ? g.ghost_rate : null };
          }
        } catch { /* the surge still reports its count; the client words it without a base rate */ }
      }
      const surges = surging.map(n => ({ name: n, ghosted_7d: counts[n], ...(grades[n] || { gradeable: null, overall_score: null, ghost_rate: null }) }));
      return res.status(200).json({ ok: true, surges });
    } catch(e) { return res.status(200).json({ ok: true, surges: [] }); }
  }

  // ── Company leaderboard ───────────────────────────────────────────────────────
  if (body.action === 'leaderboard') {
    try {
      // report_count is the FUSED total (first-party rows + the web-research claim) — fine for
      // ordering, never for a "reports" label. Every row also carries the honest split so clients
      // can label correctly. order:'first_party' ranks by real report rows (the admin Ghost Report
      // panel needs this — mirrors lib/growth.ts getLeaderboard({ by: 'first_party' })).
      // Only companies with ≥1 real report can ever be gradeable (lib/server/reportCounts.js), so the
      // 150 slots are filled from those, most-reported first. Ordering by the FUSED count let web-claim
      // rows (McDonald's 12.7k claimed) take the slots and the gate then threw them away — the board
      // showed 66 companies while ≥150 were gradeable (nike 8/8, apple 7/7, marriott 8/8 missing).
      const order = 'first_party_report_count.desc.nullslast,report_count.desc';
      // In parallel: the Seen-user reports (one small read), so every card can say how many of its
      // applicant accounts were filed with Seen and how many are public posts (audit #3). A failed
      // read leaves the split unknown (null) — cards then show no split, never a wrong one.
      const [r, seenRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/company_scores?select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,waste_score,report_count,first_party_report_count${await mentionSel(SUPABASE_URL, hdrsBase)},web_report_count,data_source,data_quality,verification_status,industry&first_party_report_count=gte.1&order=${order}&limit=150`,
          { headers: hdrsBase }
        ),
        fetch(`${SUPABASE_URL}/rest/v1/${seenUserReportsPath()}`, { headers: hdrsBase }).catch(() => null),
      ]);
      if (!r.ok) return res.status(200).json({ companies: [] });
      const rows = await r.json();
      let seenCounts = null;
      try { if (seenRes && seenRes.ok) seenCounts = countSeenUserReports(await seenRes.json()); } catch { seenCounts = null; }
      const overall = s => s || 0;
      // Grade gate (lib/server/reportCounts.js): a ranked list is a list of verdicts, so only companies
      // with enough real reports to be graded are on it.
      const companies = (Array.isArray(rows) ? rows : []).filter(c => isGradeable(c)).map(c => ({
        name: c.company_name,
        industry: c.industry || '',
        verified: c.verification_status === 'verified',
        score: {
          overall_score: overall(c.overall_score),
          ghost_rate: c.ghost_rate || 0,
          response_rate: c.response_rate || 0,
          avg_wait_days: c.avg_wait_days || 0,
          report_count: c.report_count || 0,
          // Applicant accounts behind the grade (public posts + Seen-user reports — the field keeps its
          // old name; see lib/server/reportCounts.js firstPartyReportCount).
          first_party_report_count: firstPartyReportCount(c),
          // Of those, how many a Seen user filed (null = unknown). The rest are public posts.
          seen_user_report_count: seenUserShare(seenCounts, c.company_name, firstPartyReportCount(c)),
          mention_count: mentionCount(c),
          web_report_count: webClaimCount(c),
          data_source: servedDataSource(c),
          risk_level: overall(c.overall_score) >= 70 ? 'safe' : overall(c.overall_score) >= 40 ? 'warn' : 'danger',
          waste: c.waste_score || 0,
        },
      }));
      // Identical for every visitor and only changes when the score cron runs — let the
      // CDN serve it so a popular leaderboard page doesn't hit the DB on every load.
      setPublicCache(res, 'leaderboard');
      return res.status(200).json({ ok: true, companies });
    } catch(e) { return res.status(200).json({ companies: [] }); }
  }

  // ── Tenure aggregation — fold résumé-derived avg tenure into company_scores ──
  // Cron/admin only. Averages employee tenure per company from resume_employment and
  // PATCHes EXISTING company_scores rows (never creates). Additive + idempotent; if
  // the tenure columns or table are absent the PATCH simply no-ops.
  if (body.action === 'update_tenure') {
    const CRON_SECRET = process.env.CRON_SECRET;
    const isCron = isVercelCron(req);
    const hasCronSecret = CRON_SECRET && req.headers['x-cron-secret'] === CRON_SECRET;
    if (!isCron && !hasCronSecret) {
      const adminToken = (req.headers['x-admin-token'] || '').trim();
      if (!adminToken) return res.status(401).json({ error: 'unauthorized' });
      const sessRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`, { headers: hdrsBase });
      const sess = sessRes.ok ? (await sessRes.json())?.[0] : null;
      if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      // Light normalizer matching company_scores.company_name storage (lowercased + trimmed).
      const norm = (n) => (n || '').toString().trim().toLowerCase();
      const rows = [];
      for (let offset = 0; offset < 20000; offset += 1000) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/resume_employment?select=company,start_date,end_date&limit=1000&offset=${offset}`, { headers: hdrsBase });
        if (!r.ok) break;
        const batch = await r.json();
        if (!Array.isArray(batch) || !batch.length) break;
        rows.push(...batch);
        if (batch.length < 1000) break;
      }
      const agg = aggregateTenure(rows, norm);
      let updated = 0;
      for (const [co, v] of Object.entries(agg)) {
        if (v.sample < MIN_TENURE_SAMPLE) continue;
        const patch = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=eq.${encodeURIComponent(co)}`, {
          method: 'PATCH',
          headers: { ...hdrsBase, Prefer: 'return=minimal' },
          body: JSON.stringify({ avg_tenure_months: v.avg_tenure_months, tenure_sample_count: v.sample }),
        });
        if (patch.ok) updated += 1;
      }
      return res.status(200).json({ ok: true, companies_aggregated: Object.keys(agg).length, companies_updated: updated });
    } catch (e) {
      logError('reports/update_tenure', e.message);
      return res.status(500).json({ error: 'tenure aggregation failed' });
    }
  }

  // Rate-limit only write actions — reads are cheap and public
  if (['submit','moderate','quick_submit','report_issue','create_from_tracker','record_card_share'].includes(body.action)) {
    const limited = await applyRateLimit(req, res, 'report-submit');
    if (limited) return;
  }

  // ── Quick-submit: one-click outcome — requires auth to prevent data pollution ─
  if (body.action === 'quick_submit') {
    // SECURITY: Require authentication. Anonymous submissions allow unlimited
    // data pollution of company scores. Signed-in users are accountable and
    // can be rate-limited per user, not just per IP.
    const uid = await resolveUid(req);
    if (!uid) return res.status(401).json({ error: 'Sign in to submit outcomes' });

    try {
      const { company, outcome, role, city } = body;
      if (!company || !outcome) return res.status(400).json({ error: 'company and outcome required' });
      const VALID = new Set(['ghosted','rejected','autoreject','hired','offer','interview','human','waiting']);
      if (!VALID.has(outcome)) return res.status(400).json({ error: 'invalid outcome' });
      const safeCompany = String(company).slice(0, 120).replace(/[<>`\\]/g, '').trim();
      const safeRole    = role ? String(role).slice(0, 120).replace(/[<>`\\]/g, '').trim() : '';
      const safeCity    = city ? String(city).slice(0,  80).replace(/[<>`\\]/g, '').trim() : '';
      if (!safeCompany) return res.status(400).json({ error: 'company required' });
      // Same anti-Sybil down-weighting as the full submit path (dedup + per-account daily cap).
      const trust = await assessSubmitTrust(SUPABASE_URL, hdrsBase, uid, `company_name=ilike.${encodeURIComponent(safeCompany)}`);
      // reports has no `city` column (city lives on company_locations via location_id, like the
      // full `submit` path) — sending one made PostgREST reject every quick submit that named a city.
      // Location is best-effort: a lookup failure must never block the outcome itself.
      const loc = {};
      if (safeCity) {
        try {
          const cid = await resolveOrCreateCompany(SUPABASE_URL, { ...hdrsBase, Prefer: 'return=representation' }, safeCompany);
          const lid = cid ? await resolveOrCreateLocation(SUPABASE_URL, { ...hdrsBase, Prefer: 'return=representation' }, cid, safeCity) : null;
          if (cid) loc.company_id = cid;
          if (lid) loc.location_id = lid;
        } catch { /* outcome still submits without a location */ }
      }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
        method: 'POST',
        headers: { ...hdrsBase, Prefer: 'return=minimal' },
        body: JSON.stringify({ company_name: safeCompany, outcome, role: safeRole, ...loc, platform: 'Seen', experience_level: 'Unknown', outcome_weight: trust.weight, needs_review: trust.review, trust_reason: trust.reason, user_id: uid }),
      });
      if (!r.ok) {
        const e = await r.text().catch(() => '');
        console.error('[reports/quick_submit] DB error:', r.status, e.slice(0, 200));
        return res.status(400).json({ error: 'Submit failed' });
      }
      const reward = await reportReward(uid, body.application_id);
      return res.status(200).json({ ok: true, submitted: true, ...(reward ? { reward } : {}) });
    } catch(err) {
      logError('reports/quick_submit', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  // ── Create-from-tracker: first-party outcome from a REAL tracked application ───
  // Powers the "One-Click Outcome Card from the tracker" loop. The user reached a
  // terminal status (hired / ghosted / rejected) on a tracked app and is now creating
  // a shareable card; this records the same first-party report the /report submit path
  // would, sourced from the tracker instead of a re-typed form. It resolves the company
  // + location records (so the report feeds company_scores exactly like `submit`) and
  // runs through the SAME anti-Sybil assessSubmitTrust dedup/velocity check — a signed-in
  // tracker outcome is first-party (full trust) but still can't double-count or flood.
  if (body.action === 'create_from_tracker') {
    // SECURITY: signed-in only. The whole point is first-party trust from a real user's
    // tracker — anonymous callers have no tracker and would just be re-poisoning scores.
    const uid = await resolveUid(req);
    if (!uid) return res.status(401).json({ error: 'Sign in to share a tracked outcome' });
    try {
      const { company: co, role, location, platform, outcome, rounds } = body;
      if (!co || !outcome) return res.status(400).json({ error: 'company and outcome required' });
      const VALID = new Set(['ghosted','rejected','autoreject','hired','offer','interview','human','waiting']);
      if (!VALID.has(outcome)) return res.status(400).json({ error: 'invalid outcome' });

      const hdrs = { ...hdrsBase, Prefer: 'return=representation' };
      const safeCo  = String(co).trim().slice(0, 200).replace(/[<>`\\]/g, '');
      const safeLoc = location ? String(location).trim().slice(0, 200).replace(/[<>`\\]/g, '') : '';
      const normalize = n => n ? n.trim().toLowerCase().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
      const coNorm = normalize(safeCo);

      // Resolve / create the company record (same path as `submit`).
      const coWord = encodeURIComponent(safeCo.split(/\s+/)[0]);
      const coSearch = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.*${coWord}*&select=id,name&limit=20`, { headers: hdrs });
      const coRows = coSearch.ok ? await coSearch.json() : [];
      let cid = (coRows || []).find(c => normalize(c.name) === coNorm)?.id || (coRows || []).find(c => c.name.toLowerCase() === safeCo.toLowerCase())?.id || null;
      if (!cid) {
        const insRes = await fetch(`${SUPABASE_URL}/rest/v1/companies`, { method: 'POST', headers: hdrs, body: JSON.stringify({ name: safeCo, logo_letter: safeCo[0]?.toUpperCase() || '?' }) });
        if (insRes.ok) { const insRows = await insRes.json(); cid = Array.isArray(insRows) ? insRows[0]?.id : insRows?.id; }
        if (!cid) {
          const retry = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(safeCo)}&select=id&limit=1`, { headers: hdrs });
          if (retry.ok) { const r = await retry.json(); cid = r?.[0]?.id || null; }
        }
      }
      if (!cid) return res.status(500).json({ error: 'Could not resolve company record' });

      // Resolve / create the location record when we have one.
      let lid = null;
      if (safeLoc) {
        const locSearch = await fetch(`${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${cid}&city=ilike.${encodeURIComponent(safeLoc)}&select=id&limit=1`, { headers: hdrs });
        const locRows = locSearch.ok ? await locSearch.json() : [];
        lid = locRows?.[0]?.id || null;
        if (!lid) {
          const locIns = await fetch(`${SUPABASE_URL}/rest/v1/company_locations`, { method: 'POST', headers: hdrs, body: JSON.stringify({ company_id: cid, city: safeLoc }) });
          if (locIns.ok) { const lr = await locIns.json(); lid = Array.isArray(lr) ? lr[0]?.id : lr?.id; }
        }
      }

      // Signed-in → first-party full trust, down-weighted only for dedup/velocity patterns.
      const trust = await assessSubmitTrust(SUPABASE_URL, hdrsBase, uid, `company_id=eq.${cid}`);
      const reportBase = {
        company_id: cid, location_id: lid || null,
        role: (role || '').trim().slice(0, 200),
        platform: (platform || '').trim().slice(0, 100) || 'Seen Tracker',
        outcome,
        rounds: parseInt(rounds) || 0,
        unpaid_work: 'na',
        experience_level: '',
        source: 'tracker',
        needs_review: trust.review,
        outcome_weight: trust.weight,
        trust_reason: trust.reason,
        user_id: uid,
      };
      let repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' }, body: JSON.stringify({ ...reportBase, company_name: safeCo }) });
      if (!repRes.ok && repRes.status === 400) {
        const errText = await repRes.text();
        if (errText.includes('company_name') || errText.includes('column')) repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' }, body: JSON.stringify(reportBase) });
      }
      if (!repRes.ok) { const e = await repRes.text().catch(() => ''); console.error('[reports/create_from_tracker] DB error:', repRes.status, e.slice(0, 200)); return res.status(500).json({ error: 'Failed to save report' }); }
      const reward = await reportReward(uid, body.application_id);
      return res.status(200).json({ ok: true, company_id: cid, trust_reason: trust.reason, ...(reward ? { reward } : {}) });
    } catch(err) {
      logError('reports/create_from_tracker', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  }

  // ── Record an outcome-card share/download (light virality analytics) ──────────
  // Fired once when a signed-in user shares or downloads their outcome card. Writes a
  // single analytics row to outcome_card_shares (migration 030). Does NOT touch
  // company_scores — that's the report's job. Failures are non-fatal to the share UX.
  if (body.action === 'record_card_share') {
    const uid = await resolveUid(req);
    if (!uid) return res.status(200).json({ ok: true, recorded: false }); // anon shares still allowed in UI; just not logged
    try {
      const { company, outcome, shared_via } = body;
      const VIA = new Set(['twitter','reddit','linkedin','threads','download','native']);
      const safeCompany = company ? String(company).slice(0, 120).replace(/[<>`\\]/g, '').trim() : '';
      const safeOutcome = outcome ? String(outcome).slice(0, 40).replace(/[<>`\\]/g, '').trim() : '';
      const via = VIA.has(shared_via) ? shared_via : 'download';
      if (!safeCompany || !safeOutcome) return res.status(400).json({ error: 'company and outcome required' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/outcome_card_shares`, {
        method: 'POST',
        headers: { ...hdrsBase, Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: uid, company_name: safeCompany, outcome: safeOutcome, shared_via: via }),
      });
      return res.status(200).json({ ok: true, recorded: r.ok });
    } catch(err) {
      logError('reports/record_card_share', err.message);
      return res.status(200).json({ ok: true, recorded: false });
    }
  }

  // ── Batch score lookup — DB-only, no AI, cached scores for up to 50 companies ──
  if (body.action === 'batch_scores') {
    try {
      const names = body.names;
      if (!Array.isArray(names) || !names.length) return res.json({ ok: true, scores: {} });
      const nameList = names.slice(0, 50).map(n => String(n).toLowerCase().trim()).filter(Boolean);
      if (!nameList.length) return res.json({ ok: true, scores: {} });
      // Strip quotes/backslashes before wrapping — otherwise a crafted name could break out
      // of the quoted PostgREST CSV value and alter which rows match (filter injection).
      const inFilter = nameList.map(n => `"${n.replace(/["\\]/g, '')}"`).join(',');
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/company_scores?company_name=in.(${inFilter})&select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,waste_score,report_count,first_party_report_count${await mentionSel(SUPABASE_URL, hdrsBase)},web_report_count,data_source&limit=50`,
        { headers: hdrsBase }
      );
      const rows = r.ok ? await r.json() : [];
      const scores = {};
      (Array.isArray(rows) ? rows : []).forEach(row => {
        scores[row.company_name.toLowerCase()] = gateScore({
          overall_score: row.overall_score,
          ghost_rate: row.ghost_rate,
          response_rate: row.response_rate,
          avg_wait_days: row.avg_wait_days,
          waste: row.waste_score,
          report_count: row.report_count, // fused — use first_party_report_count for any "reports" claim
          first_party_report_count: firstPartyReportCount(row),
          mention_count: mentionCount(row),
          web_report_count: webClaimCount(row),
          data_source: servedDataSource(row),
        });
      });
      return res.json({ ok: true, scores });
    } catch { return res.json({ ok: true, scores: {} }); }
  }

  // ── User-reported issue (wrong data, duplicate, broken listing, etc.) ─────────
  if (body.action === 'report_issue') {
    const VALID_TYPES = new Set(['wrong_data','duplicate','broken_listing','spam','other']);
    const { type, target_type, target_name, notes } = body;
    if (!type || !VALID_TYPES.has(type)) return res.status(400).json({ error: 'Invalid issue type' });
    const safeTargetType = ['company','job','feed','other'].includes(target_type) ? target_type : 'other';
    const safeName  = target_name ? String(target_name).slice(0, 200).replace(/[<>`]/g, '').trim() : null;
    const safeNotes = notes ? String(notes).slice(0, 500).replace(/[<>`]/g, '').trim() : null;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_issues`, {
      method: 'POST',
      headers: { ...hdrsBase, Prefer: 'return=minimal' },
      body: JSON.stringify({ type, target_type: safeTargetType, target_name: safeName, notes: safeNotes }),
    });
    if (!r.ok) return res.status(500).json({ error: 'Failed to save issue' });
    return res.status(200).json({ ok: true });
  }

  // ── Moderation (merged from moderate-report.js) ─────────────────────────────
  if (body.action === 'moderate') {
    const { company: mCo, role: mRole, location: mLoc } = body;
    if (!mCo || !mRole) return res.status(400).json({ ok: false, issues: ['Company and role are required.'] });
    // The location check is the whole of this pre-submit step (no model reviews the text); the report
    // itself still goes through the deterministic trust / needs-review pipeline on submit.
    const locResult = await checkLocation(mLoc).catch(() => ({ valid: true, normalized: mLoc }));
    const issues = !locResult.valid ? ['Location not recognized — enter a real city (e.g. "Austin, TX" or "Chicago, IL").'] : [];
    return res.json({ ok: locResult.valid, issues, corrected_experience: null, normalized_location: locResult.normalized || mLoc });
  }

  // ── Community feed — real Seen reports only ──────────────────────────────────
  if (body.action === 'feed') {
    try {
      const { outcome, offset = 0, limit = 20 } = body;
      const safeLimit = Math.min(50, Math.max(1, parseInt(limit) || 20));
      const safeOffset = Math.max(0, parseInt(offset) || 0);

      const outcomeMap = {
        ghosted:      ['ghosted'],
        rejected:     ['autoreject', 'rejected'],
        interviewing: ['human', 'interview', 'interviewing'],
        hired:        ['hired', 'offer'],
      };
      const outcomes = outcomeMap[outcome] || null;

      // Only reports that shape a score are public — held rows (anti-gaming review) never were.
      // A row compiled from public discussion is shown only when its text still passes the strict
      // first-hand applicant rules for its company (lib/reports/feedFilter.js) — a customer's
      // "support ghosted me" or an employee's "she hired me and now wants me gone" is not an
      // applicant account. The window read is wider than the page so a page still fills; the
      // client continues from `next_offset` (rows consumed), never offset + page size.
      const readWindow = Math.min(150, safeLimit * 4);
      let url = `${SUPABASE_URL}/rest/v1/reports`
        + `?select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,company_name,trust_reason`
        + `&${SCORABLE_REPORTS_FILTER}`
        + `&order=created_at.desc`
        + `&limit=${readWindow}&offset=${safeOffset}`;
      if (outcomes) url += `&outcome=in.(${outcomes.join(',')})`;

      // Exact count: "Load more (N remaining)" printed a planner estimate before.
      const r = await fetch(url, { headers: { ...hdrsBase, 'Prefer': 'count=exact' } });
      if (!r.ok) { console.error('FEED: supabase error', r.status); return res.status(500).json({ error: 'feed error' }); }
      const raw = await r.json();
      const rows = Array.isArray(raw) ? raw : [];
      const page = [];
      let consumed = 0;
      for (const row of rows) {
        consumed += 1;
        if (!feedRowPasses(row)) continue;
        page.push({ ...row, source: classifyPlatform(row.platform, row.trust_reason) });
        if (page.length >= safeLimit) break;
      }

      // Content-Range: 0-19/1234 — the corpus size (an upper bound on what the rules let through).
      const contentRange = r.headers.get('content-range') || '';
      const total = parseInt(contentRange.split('/')[1]) || rows.length;
      const nextOffset = safeOffset + consumed;
      const hasMore = rows.length === readWindow ? true : consumed < rows.length;

      console.log(`FEED: offset=${safeOffset} read=${rows.length} shown=${page.length} total=${total}`);
      return res.status(200).json({ ok: true, reports: page, total, next_offset: nextOffset, has_more: hasMore });
    } catch(e) {
      console.error('FEED: unhandled error:', e.message);
      return res.status(500).json({ error: 'feed error', detail: e.message });
    }
  }

  // ── Submit report (merged from submit-report.js) ────────────────────────────
  if (body.action === 'submit') {
    // Per-IP throttle — this endpoint writes into the reports corpus that drives every
    // company score, so it must never be a free-for-all firehose.
    if (await applyRateLimit(req, res, 'report-submit')) return;
    const { company: co, role, location, platform, outcome, ghost_stage, rounds, unpaid_work, experience_level, report_text } = body;
    // location is optional — tracker-originated submissions (day-30 check-ins, /apply-tracked
    // apps) legitimately have no city. Requiring it silently killed that whole intel path.
    if (!co || !role) return res.status(400).json({ error: 'company and role required' });
    // Identify the submitter if a valid token is present. Anonymous submissions are still
    // accepted (the public report page allows them) but enter at a low trust weight and are
    // flagged for review, so they can't dominate or poison a company's score. Signed-in
    // submissions are first-party and carry full weight.
    const submitUid = await resolveUid(req);
    const trusted = !!submitUid;
    const hdrs = { ...hdrsBase, Prefer: 'return=representation' };
    const safeCo = co.trim().slice(0, 200).replace(/[<>`\\]/g, '');
    const safeLoc = (location || '').trim().slice(0, 200).replace(/[<>`\\]/g, '');
    const normalize = n => n ? n.trim().toLowerCase().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
    const coNorm = normalize(safeCo);

    const coWord = encodeURIComponent(safeCo.split(/\s+/)[0]);
    const coSearch = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.*${coWord}*&select=id,name&limit=20`, { headers: hdrs });
    const coRows = coSearch.ok ? await coSearch.json() : [];
    let cid = (coRows || []).find(c => normalize(c.name) === coNorm)?.id || (coRows || []).find(c => c.name.toLowerCase() === safeCo.toLowerCase())?.id || null;

    if (!cid) {
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/companies`, { method: 'POST', headers: hdrs, body: JSON.stringify({ name: safeCo, logo_letter: safeCo[0]?.toUpperCase() || '?' }) });
      if (insRes.ok) { const insRows = await insRes.json(); cid = Array.isArray(insRows) ? insRows[0]?.id : insRows?.id; }
      if (!cid) {
        const retry = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(safeCo)}&select=id&limit=1`, { headers: hdrs });
        if (retry.ok) { const r = await retry.json(); cid = r?.[0]?.id || null; }
      }
    }
    if (!cid) return res.status(500).json({ error: 'Could not resolve company record' });

    let lid = null;
    if (safeLoc) {
      const locSearch = await fetch(`${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${cid}&city=ilike.${encodeURIComponent(safeLoc)}&select=id&limit=1`, { headers: hdrs });
      const locRows = locSearch.ok ? await locSearch.json() : [];
      lid = locRows?.[0]?.id || null;
      if (!lid) {
        const locIns = await fetch(`${SUPABASE_URL}/rest/v1/company_locations`, { method: 'POST', headers: hdrs, body: JSON.stringify({ company_id: cid, city: safeLoc }) });
        if (locIns.ok) { const lr = await locIns.json(); lid = Array.isArray(lr) ? lr[0]?.id : lr?.id; }
        if (!lid) { const lr2 = await fetch(`${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${cid}&select=id&limit=1`, { headers: hdrs }); if (lr2.ok) { const r2 = await lr2.json(); lid = r2?.[0]?.id || null; } }
      }
    }

    // Signed-in submits start at full trust but get down-weighted for duplicate/flooding patterns
    // (see assessSubmitTrust). Anonymous submits stay at 0.3 + needs_review.
    const trust = trusted
      ? await assessSubmitTrust(SUPABASE_URL, hdrsBase, submitUid, `company_id=eq.${cid}`)
      : { weight: 0.3, reason: 'anonymous_unverified', review: true };

    // wait_days: accept the client's value when plausible (0–365) — it feeds response-time
    // intel; the old hardcoded null discarded it even on successful submits.
    const waitDays = Number.isFinite(parseInt(body.wait_days)) ? Math.max(0, Math.min(365, parseInt(body.wait_days))) : null;
    const reportBase = { company_id: cid, location_id: lid || null, role: String(role).trim().slice(0,200), platform: (platform||'').trim().slice(0,100), outcome: outcome||'waiting', ghost_stage: ghost_stage||null, rounds: parseInt(rounds)||0, wait_days: waitDays, unpaid_work: unpaid_work||'na', experience_level: (experience_level||'').trim().slice(0,50), report_text: report_text ? report_text.slice(0,2000) : null,
      source:        trusted ? 'direct' : 'anonymous',
      needs_review:  trust.review,
      outcome_weight: trust.weight,
      trust_reason:  trust.reason,
      user_id:       submitUid || null };
    let repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' }, body: JSON.stringify({ ...reportBase, company_name: safeCo }) });
    if (!repRes.ok && repRes.status === 400) {
      const errText = await repRes.text();
      if (errText.includes('company_name') || errText.includes('column')) repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' }, body: JSON.stringify(reportBase) });
    }
    if (!repRes.ok) { const e = await repRes.text(); return res.status(500).json({ error: 'Failed to save report', detail: e.slice(0,100) }); }
    console.log(`REPORT SAVED: "${safeCo}" @ "${safeLoc}" company_id:${cid}`);
    // Refresh this company's cached score from its real reports right away so the new report
    // reflects on the company page immediately (cache-first read would otherwise serve a stale
    // grade). Only for trusted, non-review submits — flagged rows don't count toward the grade.
    if (!trust.review) { await recomputeCompanyScoreFromReports(SUPABASE_URL, hdrsBase, safeCo); }
    return res.status(200).json({ ok: true, company_id: cid });
  }

  // ── n8n / external ingest webhook ────────────────────────────────────────────
  // n8n POSTs here with action:'ingest' to push data from Glassdoor, Indeed,
  // LinkedIn, Blind, or any other source n8n can reach.
  // Body: { action:'ingest', source:'glassdoor', reports:[{company,outcome,role,report_text,platform,source},...] }
  if (body.action === 'ingest') {
    const tok = (req.headers['x-admin-token'] || '').trim();
    if (!tok) return res.status(401).json({ error: 'unauthorized' });
    const s = await fetch(`${SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(tok)}&select=expires_at&limit=1`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
    const sess = s.ok ? (await s.json())?.[0] : null;
    if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'unauthorized' });

    const reports = Array.isArray(body.reports) ? body.reports : [];
    if (!reports.length) return res.status(400).json({ error: 'reports array required' });

    const SOURCE_WEIGHTS = { glassdoor: 0.7, indeed: 0.6, linkedin: 0.5, blind: 0.6, trustpilot: 0.4, news: 0.3, other: 0.3 };

    let imported = 0, skipped = 0, duplicates = 0, errors = [];
    const wroteCompanies = new Set();
    // Same account already stored (or earlier in this batch) → skip. The Oct 18 SpaceX/Tesla import ran
    // twice and every row landed twice (lib/server/reportDupes.js). One read per company, cached.
    const heldKeys = new Map();
    const keysFor = async (company) => {
      const k = String(company).toLowerCase().trim();
      if (heldKeys.has(k)) return heldKeys.get(k);
      const r = await fetch(`${SUPABASE_URL}/rest/v1/reports?company_name=ilike.${encodeURIComponent(k)}&select=company_name,outcome,platform,role,report_text&limit=5000`, { headers: hdrsBase });
      if (!r.ok) throw new Error(`duplicate check failed (${r.status})`);
      const set = new Set(((await r.json()) || []).map(reportDupKey).filter(Boolean));
      heldKeys.set(k, set);
      return set;
    };
    for (const rpt of reports.slice(0, 500)) {
      try {
        if (!rpt.company || !rpt.outcome || !isValidCompanyName(rpt.company)) { skipped++; continue; }
        const outcome = writableOutcome(rpt.outcome); // 'unknown' / junk used to fail the insert silently
        if (!outcome) { skipped++; continue; }
        const src = (rpt.source || body.source || 'other').toLowerCase().split('/')[0];
        const weight = SOURCE_WEIGHTS[src] || 0.3;

        // Resolve company id
        const coR = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(String(rpt.company).slice(0,120))}&select=id&limit=1`, { headers: hdrsBase });
        const coRows = coR.ok ? await coR.json() : [];
        let cid = coRows?.[0]?.id || null;
        if (!cid) {
          const ins = await fetch(`${SUPABASE_URL}/rest/v1/companies`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'return=representation' }, body: JSON.stringify({ name: String(rpt.company).slice(0, 120) }) });
          cid = ins.ok ? (await ins.json())?.[0]?.id || null : null;
        }

        const row = {
          company_name:     String(rpt.company).slice(0, 120),
          platform:         String(rpt.platform || body.source || 'External').slice(0, 100),
          outcome,
          role:             rpt.role ? String(rpt.role).slice(0, 200) : '', // reports.role is NOT NULL (prod)
          report_text:      rpt.report_text ? String(rpt.report_text).slice(0, 2000) : null,
          source:           src,
          outcome_weight:   weight,
          // An employee review ("what it's like to work here") is not a hiring outcome — stored for the
          // page but never scored (lib/server/reportCounts.js SCORABLE_REPORTS_FILTER).
          trust_reason:     (rpt.kind === 'employee_review' || EMPLOYEE_REVIEW_RE.test(String(rpt.report_text || '')) || /employee/i.test(String(rpt.platform || ''))) ? 'external_employee_review' : 'external_import',
          needs_review:     true, // queued for an admin spot-check — but COUNTED in the score at ingest trust (SCORABLE_REPORTS_FILTER)
          rounds:           Number.isInteger(rpt.rounds) ? rpt.rounds : 0,
          unpaid_work:      'na',
          experience_level: rpt.experience_level ? String(rpt.experience_level).slice(0, 50) : 'Unknown',
        };
        if (cid) row.company_id = cid;
        const held = await keysFor(row.company_name);
        const dupKey = reportDupKey(row);
        if (dupKey && held.has(dupKey)) { duplicates++; skipped++; continue; }
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/reports`, { method: 'POST', headers: { ...hdrsBase, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
        if (ins.ok) { imported++; wroteCompanies.add(row.company_name); if (dupKey) held.add(dupKey); } else skipped++;
      } catch(e) { errors.push(e.message); skipped++; }
    }
    // Recompute each company that got a report so ingested intel actually moves grades
    // (otherwise trapped behind the 365-day score cache). Bounded to 25 per run.
    // Imported reports count toward the score at ingest trust (0.55), so this moves the grade.
    for (const c of [...wroteCompanies].slice(0, 25)) { await recomputeCompanyScoreFromReports(SUPABASE_URL, hdrsBase, c); }
    if (errors.length) logError('reports/ingest', `${errors.length} errors`, { source: body.source || null, imported, skipped, sample: errors.slice(0, 3) });
    return res.status(200).json({ ok: true, imported, skipped, duplicates, errors: errors.slice(0, 5), recomputed: Math.min(wroteCompanies.size, 25) });
  }

  // ── Fetch reports ───────────────────────────────────────────────────────────
  const { company, city } = body;
  if (!company) return res.status(400).json({ error: 'company required' });

  const hdrs = hdrsBase;

  // Normalize: strip legal suffixes, lowercase for matching
  const normalize = n => n ? n.trim().toLowerCase()
    .replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '')
    .trim() : '';

  const canonical = normalize(company.trim());
  // Same-company test used on every row that comes back: legal suffixes stripped, hyphens and
  // spaces equivalent (slugs decode "coca-cola" → "coca cola"). "General Motors" never matches
  // "Dollar General" or "Mass General Brigham" — the old first-word wildcard returned all of them.
  const nameKey = n => normalize(n).replace(/[\s-]+/g, ' ');
  const sameCompany = r => nameKey(r.company_name) === nameKey(canonical);

  console.log(`REPORTS: company="${company}" canonical="${canonical}"`);

  try {
    // ── Query reports directly by company_name (no FK join) ───────────────────
    // REPORT_LIST_LIMIT: the list was capped at 100 newest rows, so a company with more public rows
    // (SpaceX 106, Tesla 207 on 2026-10-20) silently lost its OLDEST reports from the page.
    // Wildcards only BETWEEN tokens (so "Towne Park LLC" / "coca-cola" still match); every row is
    // then checked with sameCompany. Held rows (anti-gaming needs_review) are not public.
    const nameEnc = encodeURIComponent(`*${canonical.replace(/[\s-]+/g, '*')}*`);
    const url = `${SUPABASE_URL}/rest/v1/reports`
      + `?company_name=ilike.${nameEnc}`
      + `&needs_review=not.is.true`
      + `&select=id,role,outcome,ghost_stage,rounds,wait_days,report_text,platform,outcome_weight,trust_reason,created_at,experience_level,location_id,company_name,company_id`
      + `&order=created_at.desc`
      + `&limit=${REPORT_LIST_LIMIT}`;

    console.log(`REPORTS: fetching URL: ${url.replace(SUPABASE_URL, '[URL]')}`);

    setPublicCache(res, 'list');
    const rRes = await fetch(url, { headers: hdrs });

    if (!rRes.ok) {
      const err = await rRes.text();
      console.error(`REPORTS: fetch failed ${rRes.status}:`, err.slice(0, 300));

      // Fallback: try querying by company_id if company_name column doesn't exist yet
      const cosRes = await fetch(
        `${SUPABASE_URL}/rest/v1/companies?name=ilike.${nameEnc}&select=id,name&limit=20`,
        { headers: hdrs }
      );
      if (!cosRes.ok) {
        return res.status(200).json({ ok: true, reports: [], cities: [], _debug: `fetch failed: ${rRes.status}` });
      }
      const cosRows = await cosRes.json();
      // The same-company test as the main query: "Amazon Flex" / "Amazon Web Services" rows must not
      // join Amazon's list (the old `includes` let 2 Amazon Flex rows make the page say 28 under a 26 hero).
      const ids = (cosRows || [])
        .filter(c => nameKey(c.name) === nameKey(canonical))
        .map(c => c.id).filter(Boolean);

      if (!ids.length) {
        return res.status(200).json({ ok: true, reports: [], cities: [], _debug: 'no company found' });
      }

      const fbUrl = `${SUPABASE_URL}/rest/v1/reports`
        + `?company_id=in.(${ids.join(',')})`
        + `&needs_review=not.is.true`
        + `&select=id,role,outcome,ghost_stage,rounds,wait_days,report_text,platform,outcome_weight,trust_reason,created_at,experience_level,location_id,company_name,company_id`
        + `&order=created_at.desc&limit=${REPORT_LIST_LIMIT}`;
      const fbRes = await fetch(fbUrl, { headers: hdrs });
      const fbRows = (fbRes.ok ? await fbRes.json() : []).filter(r => !r.company_name || sameCompany(r));
      console.log(`REPORTS: fallback company_id query got ${fbRows?.length || 0} rows`);
      return buildResponse(res, fbRows, hdrs, SUPABASE_URL, city);
    }

    const rows = (await rRes.json() || []).filter(sameCompany);
    console.log(`REPORTS: company_name query got ${rows?.length || 0} rows`);

    // The former "older rows with company_id but no company_name" merge (a companies lookup + a second
    // 500-row report_text read, both sequential) is gone: reports.company_name is set on every row in
    // production (verified read-only 2026-10-24: company_name IS NULL → 0 of 4,679), so it only ever
    // re-read rows the query above had already returned — and, because it never applied sameCompany, it
    // also leaked OTHER companies' rows into the list (Amazon showed two "Amazon Flex" survey reports via
    // companies.name ILIKE *amazon*). The company_id fallback above still covers a failed primary read.
    return buildResponse(res, rows || [], hdrs, SUPABASE_URL, city);

  } catch(e) {
    console.error('REPORTS error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ── Moderation helpers ────────────────────────────────────────────────────────

async function checkLocation(location) {
  if (!location || location.trim().length < 3) return { valid: false, normalized: null };
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location)}&limit=1&addressdetails=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Seen/1.0 (seenjobs.io)' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { valid: true, normalized: location };
    const places = await res.json();
    if (!places?.length) return { valid: false, normalized: null };
    const addr = places[0].address || {};
    const city  = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
    const state = addr.state || '';
    return { valid: true, normalized: city && state ? `${city}, ${state}` : city || state || location };
  } catch(e) {
    return { valid: true, normalized: location };
  }
}

async function fetchCompanyStats(name, supabaseUrl, dbHeaders) {
  if (!supabaseUrl || !dbHeaders?.apikey) return null;
  try {
    const enc = encodeURIComponent(name);
    const [scoresRes, reportsRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/company_scores?company_name=ilike.${enc}&select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,avg_rounds,waste_score,report_count,data_quality,data_source,first_party_report_count${await mentionSel(supabaseUrl, dbHeaders)},web_report_count,web_reviews&order=created_at.desc&limit=1`, { headers: dbHeaders }),
      // Same corpus as the score (employee reviews and anti-gaming holds excluded), so this count can't
      // pass the 5-review grade gate on rows that aren't hiring outcomes.
      fetch(`${supabaseUrl}/rest/v1/reports?company_name=ilike.${enc}&${SCORABLE_REPORTS_FILTER}&select=outcome&order=created_at.desc&limit=150`, { headers: dbHeaders }),
    ]);
    const [scores, reps] = await Promise.all([scoresRes.ok ? scoresRes.json() : [], reportsRes.ok ? reportsRes.json() : []]);
    // The cached row is used below as a FALLBACK for ghost_rate/response_rate when we have too few
    // reports to compute them. An unevidenced cached row would therefore supply an invented ghost
    // rate to a company that has no real data — exactly the number we must never publish. Drop it
    // and let the computed-or-null path decide. `data_source` is selected above solely for this.
    const raw = Array.isArray(scores) ? scores[0] : null;
    const cs = isEvidencedScore(raw) ? raw : null;
    const total = Array.isArray(reps) ? reps.length : 0;
    const dist = {};
    (Array.isArray(reps) ? reps : []).forEach(r => { const oc = r.outcome||'unknown'; dist[oc] = (dist[oc]||0)+1; });
    const ghost_rate = cs?.ghost_rate ?? (total >= 5 ? (dist.ghosted||0)/total : null);
    const response_rate = cs?.response_rate ?? (total >= 5 ? ((dist.hired||0)+(dist.offer||0)+(dist.interview||0)+(dist.human||0))/total : null);
    const realCount = total || firstPartyReportCount(cs);
    // Grade gate (lib/server/reportCounts.js): no score / ghost / response rate below the report bar.
    return gateScore({ company_name: cs?.company_name||name, overall_score: cs?.overall_score||null, ghost_rate, response_rate, avg_wait_days: cs?.avg_wait_days||null, avg_rounds: cs?.avg_rounds||null, waste_score: cs?.waste_score||null, report_count: realCount, first_party_report_count: realCount, mention_count: mentionCount(cs), data_quality: cs?.data_quality||(total>=10?'strong':total>=3?'moderate':'limited'), outcome_dist: dist });
  } catch(e) { return null; }
}

async function buildResponse(res, reports, hdrs, SUPABASE_URL, city) {
  // Fetch city names for any location_ids
  const locIds = [...new Set((reports || []).map(r => r.location_id).filter(Boolean))];
  const cityMap = {};
  if (locIds.length) {
    try {
      const locRes = await fetch(
        `${SUPABASE_URL}/rest/v1/company_locations?id=in.(${locIds.join(',')})&select=id,city&limit=100`,
        { headers: hdrs }
      );
      if (locRes.ok) {
        const locRows = await locRes.json();
        (locRows || []).forEach(l => { if (l.id && l.city) cityMap[l.id] = l.city; });
      }
    } catch(_e) {}
  }

  const enriched = (reports || []).map(r => ({
    ...r,
    city: r.location_id ? (cityMap[r.location_id] || '') : '',
  }));

  const cityFilter = city?.trim()?.toLowerCase();
  const filtered = cityFilter
    ? enriched.filter(r => !r.city || r.city.toLowerCase().includes(cityFilter))
    : enriched;

  const cities = [...new Set(enriched.map(r => r.city).filter(Boolean))].sort();

  return res.status(200).json({ ok: true, reports: filtered, cities, total: enriched.length });
}

// Public rows the company page lists (it shows them 10 at a time). Large enough for every company today.
export const REPORT_LIST_LIMIT = 500;

// ── handleCompanyScore: merged from api/company-score.js ──────────────────────
const _SCORE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// Every company-score response passes through gateScore (lib/server/reportCounts.js): below
// MIN_REPORTS_FOR_GRADE real reports the payload keeps its counts/reviews but no verdict fields.
function _rowToScore(row) { return gateScore(_rowToScoreRaw(row)); }
function _rowToScoreRaw(row) {
  const base = row.overall_score;
  let reviews = [];
  if (row.web_reviews) {
    try { reviews = typeof row.web_reviews === 'string' ? JSON.parse(row.web_reviews) : row.web_reviews; } catch(_e) {}
  }
  // Fold in résumé-derived tenure (gated; 0 when absent, so the score is unchanged
  // for companies without tenure data) and attach a confidence signal.
  const tAdj = tenureAdjustment(row.avg_tenure_months, row.tenure_sample_count);
  const s = Math.max(0, Math.min(100, Math.round(base + tAdj)));
  const ageDays = row.created_at ? Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86400000)) : 0;
  // Honest split: first-party rows vs the LLM web-research claim. Legacy rows (pre-migration
  // 063, split columns null) are inferred from data_source — 'reports' rows were computed from
  // real report rows; anything else ('web_search'/null) is a web claim, NOT applicant reports.
  const firstParty = firstPartyReportCount(row);
  const webClaim = webClaimCount(row);
  const confidence = scoreConfidence({ reportCount: firstParty, tenureSample: row.tenure_sample_count || 0, dataAgeDays: ageDays, webClaimedCount: webClaim });
  return {
    overall_score: s, base_score: base, tenure_adjustment: tAdj,
    ghost_rate: row.ghost_rate, response_rate: row.response_rate,
    avg_wait_days: row.avg_wait_days, avg_rounds: row.avg_rounds, waste: row.waste_score,
    unpaid_rate: row.unpaid_rate, report_count: row.report_count || 0,
    first_party_report_count: firstParty, mention_count: mentionCount(row), web_report_count: webClaim,
    employee_review_count: Math.max(0, Number(row.employee_review_count) || 0),
    avg_tenure_months: row.avg_tenure_months || null, tenure_sample_count: row.tenure_sample_count || 0,
    confidence, confidence_label: confidenceLabel(confidence), sufficient: confidence >= 0.33,
    // Provenance is reported, never renamed. This previously collapsed every non-'reports' row to
    // 'web_research', which presented model-generated estimates to users as research.
    data_quality: row.data_quality || 'medium', data_source: servedDataSource(row),
    risk_level: s >= 70 ? 'safe' : s >= 40 ? 'warn' : 'danger',
    industry: row.industry || '', summary: /^estimated baseline/i.test(String(row.raw_summary || '')) ? '' : (row.raw_summary || ''),
    process_score: s, web_reviews: reviews,
    // When this score was last (re)computed — the "Last updated" under every grade
    // (lib/server/reportCounts.js scoreUpdatedAt: company_scores has no updated_at column).
    updated_at: scoreUpdatedAt(row),
  };
}

// Fuse a web-research estimate with the company's REAL reported outcomes (direct user
// reports + Reddit + ingest), so the stored score reflects all the intel we hold rather
// than a single web guess. Returns the web estimate unchanged when we have no reports
// (no regression). See api/_utils/companyIntel.js + SCORING.md §2.
// Company slugs decode hyphens to spaces, so "Coca-Cola" arrives as "coca cola" and an
// exact ilike misses it. Fallback pattern: wildcard between tokens ("coca*cola"), still
// anchored at both ends so it can't over-match unrelated companies.
function _fuzzyNamePattern(name) {
  return encodeURIComponent(String(name).toLowerCase().trim().replace(/[\s-]+/g, '*'));
}

// Group report rows by trust class and carry each class's mean wait_days / rounds, so fusion
// (companyIntel sources[].avgWaitDays/avgRounds) produces a real avg wait instead of null.
// Shared with api/_utils/reportWrite.js recompute via the same helper there.
export function groupReportsByType(reps) {
  const byType = {};
  for (const row of reps) {
    const type = classifyPlatform(row.platform, row.trust_reason);
    (byType[type] ||= []).push({ outcome: row.outcome, wait_days: row.wait_days, rounds: row.rounds });
  }
  return byType;
}
export function sourcesFromGroups(byType) {
  const mean = (rows, key, max) => {
    const vals = rows.map(r => Number(r[key])).filter(v => Number.isFinite(v) && v > 0 && v <= max);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return Object.entries(byType).map(([type, rows]) => ({
    type,
    outcomes: rows.map(r => ({ outcome: r.outcome })),
    ...(type === 'mentions' ? {} : { avgWaitDays: mean(rows, 'wait_days', 365), avgRounds: mean(rows, 'rounds', 20) }),
  }));
}

async function _fuseWithReports(name, web, SUPABASE_URL, dbH) {
  if (!SUPABASE_URL || !dbH) return null;
  try {
    const enc = encodeURIComponent(String(name).toLowerCase().trim());
    // Every report counts at its trust weight; only the anti-gaming holds wait for an admin
    // (lib/server/reportCounts.js SCORABLE_REPORTS_FILTER — the same corpus the stored recompute uses).
    let r = await fetch(`${SUPABASE_URL}/rest/v1/reports?company_name=ilike.${enc}&${SCORABLE_REPORTS_FILTER}&select=outcome,platform,trust_reason,wait_days,rounds&limit=2000`, { headers: dbH });
    let reps = r.ok ? await r.json() : null;
    let empPattern = enc;
    if ((!Array.isArray(reps) || !reps.length) && /[\s-]/.test(String(name))) {
      empPattern = _fuzzyNamePattern(name);
      r = await fetch(`${SUPABASE_URL}/rest/v1/reports?company_name=ilike.${empPattern}&${SCORABLE_REPORTS_FILTER}&select=outcome,platform,trust_reason,wait_days,rounds&limit=2000`, { headers: dbH });
      reps = r.ok ? await r.json() : null;
    }
    if (!Array.isArray(reps)) return null;
    // Employee reviews move the grade by their letter grades (lib/server/employeeReviews.js). Read with
    // the same name match that found the reports. A failed read fuses without them and stores no
    // count, so the cache staleness check repairs the row on the next view.
    // Everything after the report rows is independent: one round of parallel reads, not four sequential
    // ones (the column probes are memoized per instance, so they cost nothing after the first call).
    const withMentions = await hasMentionCount(SUPABASE_URL, dbH);
    const [employeeReviews, withEmployeeCount, wr, confirmedStaleListings] = await Promise.all([
      fetchEmployeeReviewSignal(SUPABASE_URL, dbH, empPattern),
      hasEmployeeReviewCount(SUPABASE_URL, dbH),
      // "What people are saying" (stored web_reviews) counts exactly half a report — only once
      // mention_count can be stored, so this path and the stored recompute always agree.
      withMentions
        ? fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=eq.${enc}&select=web_reviews&limit=1`, { headers: dbH })
            .then((x) => (x.ok ? x.json() : [])).catch(() => [])
        : Promise.resolve(null),
      // Admin-confirmed dead listings (zombie postings) carry a bounded penalty here too,
      // so the company-page score matches the stored recompute path.
      fetchConfirmedStaleCount(SUPABASE_URL, dbH, name),
    ]);
    const byType = groupReportsByType(reps);
    let totalMentions = null;
    if (withMentions) {
      const webReviews = Array.isArray(wr) && wr[0] ? wr[0].web_reviews : null;
      const mentions = mentionOutcomes(webReviews);
      totalMentions = mentionTotal(webReviews);
      if (mentions.length) byType.mentions = mentions;
    }
    if (!Object.keys(byType).length && !totalMentions) return null;
    const sources = sourcesFromGroups(byType);
    const fz = fuseCompanyIntel({ web, sources, confirmedStaleListings, employeeReviews: employeeReviews || null });
    // mention_count = EVERY quoted account (each counts half a report toward the bar); null = column absent.
    // employee_review_store = the count to persist (undefined → JSON omits it: column absent or read failed).
    return fz ? { ...fz, mention_count: totalMentions, employee_review_store: withEmployeeCount && employeeReviews ? employeeReviews.count : undefined } : fz;
  } catch (_e) { return null; }
}

async function handleCompanyScore(req, res, body) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const dbH = SUPABASE_URL && SUPABASE_SERVICE_KEY ? { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' } : null;

  if (body.action === 'resolve') {
    const { query } = body;
    if (!query) return res.status(400).json({ error: 'query required' });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(200).json({ ok: true, candidates: [] });
    const q = String(query).slice(0, 100).toLowerCase().trim();
    const qWord = q.split(/\s+/)[0];
    try {
      const [aliasRes, scoresRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/company_aliases?alias=ilike.${encodeURIComponent(q)}&select=canonical,alias&limit=3`, { headers: dbH }),
        fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.*${encodeURIComponent(qWord)}*&select=company_name,overall_score,ghost_rate,report_count,first_party_report_count${await mentionSel(SUPABASE_URL, dbH)},data_source,data_quality,verification_status&order=report_count.desc&limit=8`, { headers: dbH }),
      ]);
      const aliases = aliasRes.ok ? await aliasRes.json() : [];
      const scores = scoresRes.ok ? await scoresRes.json() : [];
      const candidates = [];
      (Array.isArray(aliases) ? aliases : []).forEach(a => { candidates.push({ name: a.canonical, match_confidence: 97, via_alias: true, data_source: 'alias' }); });
      (Array.isArray(scores) ? scores : []).forEach(s => {
        const cn = (s.company_name || '').toLowerCase();
        let conf = cn === q ? 99 : cn.includes(q) || q.includes(cn) ? Math.round(Math.min(q.length, cn.length) / Math.max(q.length, cn.length) * 90) : Math.round([...q.split(' ')].filter(w => w.length > 1 && cn.includes(w)).length / Math.max(q.split(' ').length, 1) * 80);
        if (!candidates.find(c => c.name.toLowerCase() === cn)) candidates.push({ name: s.company_name, match_confidence: conf, overall_score: isGradeable(s) ? s.overall_score : null, gradeable: isGradeable(s), report_count: s.report_count, data_quality: s.data_quality, verification_status: s.verification_status });
      });
      candidates.sort((a, b) => b.match_confidence - a.match_confidence);
      return res.status(200).json({ ok: true, query, candidates: candidates.slice(0, 5) });
    } catch(e) { return res.status(200).json({ ok: true, candidates: [] }); }
  }

  // ── Default: company score by name ──────────────────────────────────────────
  // Data-first and model-free: serve from cache, else aggregate this company's REAL reports into a
  // grade (deterministic, $0, scales without API limits), else the honest "no reports yet" state.
  const { name, force_refresh = false } = body;
  if (!name) return res.status(400).json({ error: 'name required' });

  if (!force_refresh && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const nameEnc = encodeURIComponent(name.toLowerCase().trim());
      // In parallel with the cache read: how many reports the score SHOULD be built from right now.
      const livePath = scorableResolvedCountPath(name);
      const liveCountP = livePath
        ? fetch(`${SUPABASE_URL}/rest/v1/${livePath}`, { headers: { ...dbH, Prefer: 'count=exact' } })
            .then((r) => (r.ok ? parseExactCount(r.headers.get('content-range')) : null)).catch(() => null)
        : Promise.resolve(null);
      // …and how many employee reviews (they move the grade too; compared once the column exists).
      const liveEmpP = (await hasEmployeeReviewCount(SUPABASE_URL, dbH))
        ? fetch(`${SUPABASE_URL}/rest/v1/reports?select=id&company_name=ilike.${nameEnc}&${EMPLOYEE_REVIEWS_FILTER}&limit=1`, { headers: { ...dbH, Prefer: 'count=exact' } })
            .then((r) => (r.ok ? parseExactCount(r.headers.get('content-range')) : null)).catch(() => null)
        : Promise.resolve(null);
      let cacheRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.${nameEnc}&order=created_at.desc&limit=1`, { headers: dbH });
      let rows = cacheRes.ok ? await cacheRes.json() : null;
      // Slug decoding turns hyphens into spaces ("coca cola") — retry with token wildcards
      // so hyphenated/punctuated company names still hit their cached score.
      if ((!rows || !rows[0]) && /[\s-]/.test(String(name))) {
        cacheRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.${_fuzzyNamePattern(name)}&order=created_at.desc&limit=1`, { headers: dbH });
        rows = cacheRes.ok ? await cacheRes.json() : null;
      }
      // A cached row only counts as a hit if there is evidence behind it. An unevidenced row is
      // treated as a MISS rather than an error, so the request falls through to real report
      // aggregation and, failing that, to the honest "no data yet — be the first to report" state.
      // Self-repair: a stored score built from a different number of reports than we now hold is
      // stale — new reports since, or rows an older rule never counted (SpaceX: 4 stored vs 104
      // real). Recompute from the full corpus before answering, so the page, the grade gate and every
      // list that reads company_scores get the real numbers. Only fires when the counts differ.
      if (rows?.[0]) {
        const live = await liveCountP;
        // The recompute reads at most 2,000 rows, so compare at that cap (no endless re-recompute).
        // Mentions: only compared once the column exists (row carries mention_count).
        const mentionsStale = 'mention_count' in rows[0]
          && mentionTotal(rows[0].web_reviews) !== mentionCount(rows[0]);
        // Employee reviews: a stored count that differs from what we hold (or was never stored) is stale.
        const liveEmp = await liveEmpP;
        const employeeStale = liveEmp != null && 'employee_review_count' in rows[0]
          && Math.min(liveEmp, 2000) !== (Number(rows[0].employee_review_count) || 0)
          && firstPartyReportCount(rows[0]) > 0;
        if ((live != null && live > 0 && Math.min(live, 2000) !== firstPartyReportCount(rows[0])) || mentionsStale || employeeStale) {
          const fresh = await recomputeCompanyScoreFromReports(SUPABASE_URL, dbH, rows[0].company_name || name);
          if (fresh) { console.log(`score repaired for "${name}": ${firstPartyReportCount(rows[0])} → ${fresh.first_party_report_count} reports`); rows[0] = { ...rows[0], ...fresh }; }
        }
      }
      if (rows?.[0]) {
        if (isEvidencedScore(rows[0])) {
          // Self-filling pages: an evidenced score with ZERO first-party reports (an older web-research
          // estimate) still has no applicant reports behind it — queue public-discussion enrichment
          // under the STORED name so new reports land on this score row. Bounded (≤1.5s timeout),
          // never throws; null when the queue is unavailable. See lib/server/enrichmentQueue.js.
          const fp = firstPartyReportCount(rows[0]);
          const enrichment = fp === 0
            ? await enqueueCompanyEnrichment(SUPABASE_URL, SUPABASE_SERVICE_KEY, rows[0].company_name || name, { firstPartyCount: fp })
            : null;
          return res.json({ ok: true, score: _rowToScore(rows[0]), _src: 'cache', ...(enrichment ? { enrichment } : {}) });
        }
        console.warn(`score suppressed for "${name}": ${suppressionReason(rows[0])}`);
      }
    } catch(e) { console.warn('Cache check:', e.message); }
  }

  // 2. Reports aggregation — compute the grade from our own report corpus (deterministic, no LLM).
  const repFused = await _fuseWithReports(name, {}, SUPABASE_URL, dbH);
  if (repFused && (repFused.report_count > 0 || repFused.mention_count > 0)) {
    const score = {
      overall_score: repFused.overall_score, ghost_rate: repFused.ghost_rate, response_rate: repFused.response_rate,
      avg_wait_days: repFused.avg_wait_days ? Math.round(repFused.avg_wait_days) : null, avg_rounds: repFused.avg_rounds || null,
      waste: repFused.waste_score, unpaid_rate: repFused.unpaid_rate, report_count: repFused.report_count,
      first_party_report_count: repFused.first_party_report_count ?? repFused.report_count,
      web_report_count: repFused.web_report_count ?? 0,
      ...(repFused.mention_count != null ? { mention_count: repFused.mention_count } : {}),
      employee_review_count: repFused.employee_review_count, employee_review_adjustment: repFused.employee_review_adjustment,
      data_quality: repFused.confidence_label || 'low', data_source: 'reports', risk_level: repFused.risk_level,
      process_score: repFused.overall_score, industry: '', summary: '', web_reviews: [], fused_sources: repFused.sources_used || [],
      updated_at: new Date().toISOString(),
    };
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const expires = new Date(Date.now() + _SCORE_TTL_MS).toISOString();
      const rowBase = { company_name:name.toLowerCase().trim(), overall_score:score.overall_score, ghost_rate:score.ghost_rate, response_rate:score.response_rate, avg_wait_days:score.avg_wait_days, avg_rounds:score.avg_rounds, waste_score:score.waste, unpaid_rate:score.unpaid_rate, report_count:score.report_count, first_party_report_count: score.first_party_report_count, web_report_count: score.web_report_count, ...(score.mention_count != null ? { mention_count: score.mention_count } : {}), employee_review_count: repFused.employee_review_store, data_quality:score.data_quality, data_source:'reports', industry:'', raw_summary:'', expires_at:expires };
      // web_reviews is NOT sent: merge-duplicates keeps the stored "what people are saying" quotes
      // (sending [] used to erase them — and they now count toward the score).
      try { await fetch(`${SUPABASE_URL}/rest/v1/company_scores?on_conflict=company_name`, { method:'POST', headers:{...dbH,Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(rowBase) }); } catch(_e) {}
    }
    return res.json({ ok: true, score: gateScore(score), _src: 'reports' });
  }

  // 3. No reports yet. Queue this company for self-filling (public Reddit discussion → attributed,
  //    down-weighted reports, filled by the api/enrich-companies cron). Bounded (≤1.5s), never throws,
  //    resolves null when the queue is unavailable — the response is then the plain empty state.
  const enrichment = await enqueueCompanyEnrichment(SUPABASE_URL, SUPABASE_SERVICE_KEY, name, { firstPartyCount: 0 });
  const payload = { ok: true, no_data: true, score: null, message: `No applicant reports yet for "${name}". Be the first to report your experience.` };
  return res.json(enrichment ? { ...payload, enrichment } : payload);
}
