// Employer analytics API — login-scoped to the caller's APPROVED company claim (migration 053).
//
// The /employers hub's Analytics tab is a client component, so it needs a client-callable,
// auth-scoped source for the same data the server-rendered /employers/analytics page shows. This
// wraps the existing pure shaper (lib/server/employerAnalytics.js › fetchEmployerAnalytics) behind
// the Bearer-JWT + approved-claim gate, exactly like api/employer-listings.js. No data bleed: the
// company is resolved from the caller's approved claim, never a request param — an employer can only
// ever see their own company's analytics (which is public-aggregate anyway: outcomes, no PII).

import { resolveEmployerUid, resolveApprovedClaim } from '../lib/server/employerAuth.js';
import { fetchEmployerAnalytics } from '../lib/server/employerAnalytics.js';
import { shapeApplyActivity } from '../lib/server/employerActivity.js';
import { fetchIndustryBenchmark } from '../lib/server/benchmark.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'DB not configured' });

  const db = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

  try {
    const uid = await resolveEmployerUid(req, { SUPABASE_URL, SERVICE_KEY });
    if (!uid) return res.status(401).json({ error: 'Sign in as an employer to see your analytics' });
    const claim = await resolveApprovedClaim(db, uid);
    if (!claim) return res.status(403).json({ error: 'Your company claim must be approved first', reason: 'no_approved_claim' });

    const result = await fetchEmployerAnalytics(claim.companyName);

    // Industry benchmark — the "never-empty" layer. Even when there are zero first-party reports
    // (result.hasData === false), the company's web-researched score + its industry peers still let
    // us show "here's your reputation vs your industry on Seen." Fail-soft: analytics still returns
    // its reports-derived view if this can't be computed.
    let benchmark = null;
    try { benchmark = await fetchIndustryBenchmark(claim.companyName, { SUPABASE_URL, SERVICE_KEY }); } catch { /* fail soft */ }

    // Applicant activity — the observable apply-click signal (migration 058), aggregate + no PII.
    // company_key-scoped, cap the window generously; the pure shaper does the 7/30-day + per-role cut.
    let activity = null;
    try {
      const evRes = await db(
        `apply_events?company_key=eq.${encodeURIComponent(claim.companyKey)}` +
        `&select=role,city,created_at,job_id&order=created_at.desc&limit=1000`,
      );
      const events = evRes.ok ? await evRes.json() : [];
      activity = shapeApplyActivity(events, Date.now());
    } catch { /* fail soft — analytics still returns the reports-derived view */ }

    return res.status(200).json({ ok: true, company: claim.companyName, activity, benchmark, ...result });
  } catch (e) {
    console.error('[employer-analytics] Unhandled error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
