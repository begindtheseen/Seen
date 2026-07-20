// Shared employer-auth resolution for the login-scoped employer endpoints
// (api/employer-listings.js, api/employer-notifications.js).
//
// The identity contract is IDENTICAL to api/employer-claims.js: verify the Supabase Bearer JWT
// (local HS256, else the /auth/v1/user fallback for ES256/RS256), then resolve the caller's single
// APPROVED company claim (migration 053). Only an approved claim grants scope — this is the whole
// no-data-bleed boundary: every employer surface keys strictly off the returned companyKey, and an
// employer with no approved claim gets null (→ 403) and sees nothing company-scoped.

import { createHmac, timingSafeEqual } from 'crypto';
import { normalizeClaimCompany } from './employerClaims.js';

// Verify a Supabase JWT locally (HS256). Returns payload (.sub = user UUID) or null. Mirrors
// api/employer-claims.js / api/user-sync.js exactly.
export function verifyJWTLocal(token, secret) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const mac = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    const sigBuf = Buffer.from(parts[2], 'base64url');
    const macBuf = Buffer.from(mac, 'base64url');
    if (sigBuf.length !== macBuf.length || !timingSafeEqual(sigBuf, macBuf)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

/**
 * Resolve the caller's Supabase user id from the Authorization: Bearer header. Returns the uid
 * string, or null when there's no token / it's invalid.
 */
export async function resolveEmployerUid(req, { SUPABASE_URL, SERVICE_KEY }) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const secret = process.env.SUPABASE_JWT_SECRET;
  const payload = secret ? verifyJWTLocal(token, secret) : null;
  if (payload) return payload.sub;
  // Asymmetric tokens can't be HS256-verified — fall back to the auth API.
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const { id } = await r.json().catch(() => ({}));
  return id || null;
}

/**
 * The caller's single APPROVED company claim → { companyKey, companyName } or null. companyKey is
 * the canonical scope key (normalizeClaimCompany over the stored canonical company_name);
 * companyName is the display spelling the surfaces show.
 */
export async function resolveApprovedClaim(db, uid) {
  if (!uid) return null;
  const r = await db(
    `employer_company_claims?user_id=eq.${encodeURIComponent(uid)}&status=eq.approved` +
    `&select=company_name,company_display_name&limit=1`,
  );
  const row = r.ok ? (await r.json())[0] : null;
  if (!row) return null;
  const companyName = (row.company_display_name && String(row.company_display_name).trim()) || row.company_name;
  return { companyKey: normalizeClaimCompany(row.company_name), companyName };
}
