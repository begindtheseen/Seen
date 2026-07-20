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
    return res.status(200).json({ ok: true, company: claim.companyName, ...result });
  } catch (e) {
    console.error('[employer-analytics] Unhandled error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
