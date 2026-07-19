// Employer posting analytics — the aggregate-shaping engine behind /employers/analytics.
//
// WHAT'S REAL (and what isn't) — this file is honest by construction:
//   • Seen hosts NO employer-owned job postings. Listings shown on the seeker side are aggregated
//     from external sources and carry ephemeral client ids (lib/jobId.ts); api/apply.js emails the
//     application, it never persists a row. So there is no "impressions/views" signal anywhere in
//     the schema — an application-rate defined as applications-per-view CANNOT be computed, and we
//     never fabricate one.
//   • The real, populated applicant substrate for a company is the `reports` table (the same
//     applicant-reported outcomes that power company_scores and the public company page / the
//     employer reputation lookup). Each row carries: outcome, platform (where the applicant
//     applied), source (how the report reached Seen), role, wait_days, created_at.
//
// So this module computes, per company, ONLY what the data supports:
//   • Applicant sources  → `platform` mix (where they applied) + `source` mix (report provenance).
//   • Application volume  → count of applicant reports over time (monthly) — the honest read of
//                            "application rates": volume + response/ghost RATES, never a conversion.
//   • Response / ghost    → outcome distribution, bucketed with the EXACT canonical mapping used by
//                            api/reports.js `fetchCompanyStats` (lines ~1215-1216) so these numbers
//                            can never drift from the grade candidates see.
//   • Per-role            → the finest posting-granularity that exists (reports.role), the honest
//                            stand-in for "per-posting" given there are no employer-owned postings.
//
// shapeEmployerAnalytics() is PURE (no I/O) and unit-tested. fetchEmployerAnalytics() is a thin,
// server-only PostgREST wrapper that mirrors lib/growth.ts (service key, ilike name match,
// AbortSignal.timeout) and hands the rows to the pure shaper.

// ── Canonical outcome buckets — mirror api/reports.js exactly ──────────────────
// response_rate = (hired + offer + interview + human) / total   ← positive human engagement
// ghost_rate    =  ghosted / total
// rejected      =  autoreject + rejected   (a response, but negative — not "responded", not ghost)
// pending       =  waiting                 (no terminal outcome yet)
const RESPONDED = ['hired', 'offer', 'interview', 'human'];
const GHOSTED = ['ghosted'];
const REJECTED = ['autoreject', 'rejected'];
const PENDING = ['waiting'];

// Human labels for the outcome vocabulary (unknown outcomes fall back to a title-cased key).
const OUTCOME_LABELS = {
  hired: 'Hired', offer: 'Offer', interview: 'Interview', human: 'Human reply',
  ghosted: 'Ghosted', rejected: 'Rejected', autoreject: 'Auto-rejected', waiting: 'Awaiting reply',
};

// Grade thresholds — identical to lib/growth.ts `grade` and components/employer/EmployerReputation,
// so the analytics headline reads the same letter candidates see. Kept inline (not imported) so the
// pure shaper stays dependency-free and node-testable.
export function gradeOf(score) {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

const MIN_RATE_REPORTS = 5; // canonical floor: below this, live-computed rates are withheld, not guessed
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const pctOf = (n, total) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0); // one-decimal percent
const clean = (s) => String(s == null ? '' : s).trim();
const titleCase = (s) => clean(s).replace(/\b\w/g, (c) => c.toUpperCase());

// Bucket an ISO timestamp to a YYYY-MM key (UTC). Returns null for unparseable input.
export function monthKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Tally an array of {key,...} into a sorted [{key,count,pct}] breakdown (desc by count, then key).
function tally(rows, pick, total, { emptyLabel = '(unspecified)' } = {}) {
  const counts = new Map();
  for (const r of rows) {
    const key = clean(pick(r)) || emptyLabel;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, pct: pctOf(count, total) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * Shape raw `reports` rows (+ an optional cached company_scores row) into the employer analytics
 * view model. PURE and deterministic — never throws, never fabricates a metric.
 *
 * @param {Array<{outcome?:string,source?:string,platform?:string,role?:string,wait_days?:number,created_at?:string}>} reports
 * @param {null|{overall_score?:number,ghost_rate?:number,response_rate?:number,avg_wait_days?:number,report_count?:number,data_quality?:string}} scoreRow
 * @param {{topRoles?:number}} [opts]
 */
export function shapeEmployerAnalytics(reports, scoreRow = null, opts = {}) {
  const rows = Array.isArray(reports) ? reports.filter(Boolean) : [];
  const total = rows.length;
  const topRoles = opts.topRoles ?? 8;

  // ── Outcome distribution + canonical response/ghost buckets ──
  const inBucket = (bucket) => rows.filter((r) => bucket.includes(clean(r.outcome).toLowerCase())).length;
  const responded = inBucket(RESPONDED);
  const ghosted = inBucket(GHOSTED);
  const rejected = inBucket(REJECTED);
  const pending = inBucket(PENDING);

  const outcomeBreakdown = tally(rows, (r) => clean(r.outcome).toLowerCase(), total, { emptyLabel: 'unknown' })
    .map((o) => ({ ...o, label: OUTCOME_LABELS[o.key] || titleCase(o.key) }));

  // ── Headline rates: prefer the cached canonical score (what candidates see); else compute live
  //    from outcomes with the SAME formula, but only once we clear the MIN_RATE_REPORTS floor. ──
  const hasScore = !!scoreRow && scoreRow.overall_score != null;
  const scoreGhost = scoreRow && scoreRow.ghost_rate != null ? Number(scoreRow.ghost_rate) : null;
  const scoreResp = scoreRow && scoreRow.response_rate != null ? Number(scoreRow.response_rate) : null;
  const enoughForLive = total >= MIN_RATE_REPORTS;

  const ghostRate = scoreGhost != null ? scoreGhost : enoughForLive ? ghosted / total : null;
  const responseRate = scoreResp != null ? scoreResp : enoughForLive ? responded / total : null;
  const ratesComputedLive = scoreGhost == null && scoreResp == null && enoughForLive;

  const dataQuality = (scoreRow && scoreRow.data_quality)
    || (total >= 10 ? 'strong' : total >= 3 ? 'moderate' : 'limited');

  const headline = {
    overallScore: hasScore ? Math.max(0, Math.min(100, Math.round(Number(scoreRow.overall_score)))) : null,
    grade: hasScore ? gradeOf(Number(scoreRow.overall_score)) : null,
    ghostRate,
    responseRate,
    ghostPct: ghostRate == null ? null : Math.round(ghostRate * 100),
    responsePct: responseRate == null ? null : Math.round(responseRate * 100),
    avgWaitDays: scoreRow && scoreRow.avg_wait_days != null
      ? Math.round(Number(scoreRow.avg_wait_days))
      : liveAvgWait(rows),
    reportCount: total || (scoreRow && scoreRow.report_count) || 0,
    dataQuality,
    ratesComputedLive,           // true → rates were computed here (no cached score existed)
    ratesWithheld: ghostRate == null && responseRate == null, // true → below the report floor
    rateFloor: MIN_RATE_REPORTS,
  };

  // ── Applicant sources (two honest dimensions) ──
  const sources = tally(rows, (r) => r.platform, total, { emptyLabel: 'Unknown platform' });     // where they applied
  const provenance = tally(rows, (r) => r.source, total, { emptyLabel: 'unknown' });             // how Seen learned of it

  // ── Application volume over time (monthly, ascending) ──
  const monthCounts = new Map();
  for (const r of rows) {
    const m = monthKey(r.created_at);
    if (m) monthCounts.set(m, (monthCounts.get(m) || 0) + 1);
  }
  const monthly = [...monthCounts.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // ── Per-role breakdown (the honest "per-posting" proxy) ──
  const roleMap = new Map();
  for (const r of rows) {
    const role = clean(r.role) || '(role not given)';
    const bucket = roleMap.get(role) || { role, count: 0, responded: 0, ghosted: 0 };
    bucket.count += 1;
    const oc = clean(r.outcome).toLowerCase();
    if (RESPONDED.includes(oc)) bucket.responded += 1;
    if (GHOSTED.includes(oc)) bucket.ghosted += 1;
    roleMap.set(role, bucket);
  }
  const roles = [...roleMap.values()]
    .map((b) => ({ ...b, respondedPct: pctOf(b.responded, b.count), ghostedPct: pctOf(b.ghosted, b.count) }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role))
    .slice(0, topRoles);

  const terminal = responded + ghosted + rejected;

  return {
    hasData: total > 0,
    reportCount: total,
    headline,
    responseSummary: {
      total,
      responded, ghosted, rejected, pending, terminal,
      respondedPct: pctOf(responded, total),
      ghostedPct: pctOf(ghosted, total),
      rejectedPct: pctOf(rejected, total),
      pendingPct: pctOf(pending, total),
    },
    outcomeBreakdown,
    sources,
    provenance,
    monthly,
    roles,
    roleCount: roleMap.size,
  };
}

// Average reported wait in days across rows that carry a wait_days value (null when none do).
function liveAvgWait(rows) {
  const vals = rows.map((r) => Number(r.wait_days)).filter((n) => Number.isFinite(n) && n >= 0);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// ── Server-only I/O wrapper — mirrors lib/growth.ts sbCreds/scoreFromDb access idiom ──────────────
// Reads the cached company_scores row AND the company's reports, via the SERVICE key, straight from
// PostgREST. Service key is referenced only inside this function body (never NEXT_PUBLIC_, never a
// client importer) so it can't reach a client bundle — same guarantee lib/growth.ts documents.
const FETCH_TIMEOUT_MS = 8000;
const REPORTS_CAP = 1000; // per-company reports are small (top company ~50); cap defends the query

const fuzzyPattern = (name) => encodeURIComponent(String(name).toLowerCase().trim().replace(/[\s-]+/g, '*'));

export async function fetchEmployerAnalytics(companyName, opts = {}) {
  const name = clean(companyName);
  if (!name) return { ok: false, reason: 'no_company', analytics: null };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ok: false, reason: 'no_creds', analytics: null };

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const enc = encodeURIComponent(name.toLowerCase());
  const scoreSel = 'select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,report_count,data_quality,industry,verification_status';
  const reportSel = 'select=outcome,source,platform,role,wait_days,rounds,created_at,needs_review';

  try {
    const [scoreRes, repRes] = await Promise.all([
      fetch(`${url}/rest/v1/company_scores?company_name=ilike.${enc}&${scoreSel}&order=created_at.desc&limit=1`,
        { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      fetch(`${url}/rest/v1/reports?company_name=ilike.${enc}&${reportSel}&order=created_at.desc&limit=${REPORTS_CAP}`,
        { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    ]);

    let scoreRow = scoreRes.ok ? (await scoreRes.json())?.[0] || null : null;
    let reports = repRes.ok ? (await repRes.json()) || [] : [];

    // Fuzzy fallback for multi-word names (mirrors lib/growth.ts): "coca cola" → "coca*cola".
    if (reports.length === 0 && /[\s-]/.test(name)) {
      const [s2, r2] = await Promise.all([
        fetch(`${url}/rest/v1/company_scores?company_name=ilike.${fuzzyPattern(name)}&${scoreSel}&order=created_at.desc&limit=1`,
          { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
        fetch(`${url}/rest/v1/reports?company_name=ilike.${fuzzyPattern(name)}&${reportSel}&order=created_at.desc&limit=${REPORTS_CAP}`,
          { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      ]);
      if (!scoreRow && s2.ok) scoreRow = (await s2.json())?.[0] || null;
      if (r2.ok) reports = (await r2.json()) || [];
    }

    // Reports flagged needs_review don't count toward the grade candidates see — exclude them here
    // too so the analytics and the public score stay consistent.
    const counted = reports.filter((r) => !r.needs_review);
    const resolvedName = (scoreRow && scoreRow.company_name) || name;
    return {
      ok: true,
      company: resolvedName,
      industry: (scoreRow && scoreRow.industry) || null,
      verified: !!(scoreRow && scoreRow.verification_status && scoreRow.verification_status !== 'unverified'),
      analytics: shapeEmployerAnalytics(counted, scoreRow, opts),
    };
  } catch {
    return { ok: false, reason: 'fetch_failed', analytics: null };
  }
}
