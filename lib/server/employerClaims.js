// Pure claim/authz helpers for the ADMIN-APPROVED CLAIMS model (migration 053).
//
// No I/O, no node builtins — safe to import from BOTH the api endpoint (api/employer-claims.js)
// and client components (lib/auth.tsx), exactly like lib/server/employerDashboard.js is imported
// into the 'use client' dashboard. These functions decide identity + authz over a list of a
// user's claim rows; the endpoint and the DB (RLS + unique indexes, migration 053) enforce them.

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'];

/**
 * Canonical company key. Mirrors how company_scores stores company_name (lower(trim(...)),
 * migration 023) with internal whitespace collapsed so "  Acme   Corp " and "acme corp" are the
 * same claim target. This is what uniqueness is enforced on; the raw spelling is kept separately
 * for display + the ?company= value the surfaces consume.
 */
export function normalizeClaimCompany(name) {
  return String(name == null ? '' : name).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A company name is claimable if, once trimmed, it is 2–120 chars and contains at least one
 * letter or digit (rejects whitespace-only / punctuation-only junk). Intentionally permissive —
 * an admin is the real gate; this only blocks obviously-empty input.
 */
export function isValidClaimCompany(name) {
  const raw = String(name == null ? '' : name).trim();
  if (raw.length < 2 || raw.length > 120) return false;
  return /[\p{L}\p{N}]/u.test(raw);
}

// Newest-first by created_at (missing/invalid dates sort last, stable-ish).
function byNewest(a, b) {
  const ta = Date.parse(a && a.created_at) || 0;
  const tb = Date.parse(b && b.created_at) || 0;
  return tb - ta;
}

function claimsFor(claims) {
  return Array.isArray(claims) ? claims.filter(Boolean) : [];
}

/**
 * The employer's approved company, or null. Only status==='approved' grants scope — this is the
 * core authz rule of the model. Returns the DISPLAY name (what the surfaces' ?company= wants),
 * falling back to the canonical name. If (against the DB's unique index) more than one approved
 * row exists, the newest wins.
 */
export function resolveEmployerCompany(claims) {
  const approved = claimsFor(claims).filter(c => c.status === 'approved').sort(byNewest);
  if (!approved.length) return null;
  const c = approved[0];
  return (c.company_display_name && String(c.company_display_name).trim()) || c.company_name || null;
}

/**
 * The single most-relevant claim for the portal to show honestly: an approved claim wins, else the
 * newest pending, else the newest rejected, else null. Lets /employers render exactly one truthful
 * state (you manage X / pending review / not approved / claim your company).
 */
export function selectActiveClaim(claims) {
  const list = claimsFor(claims);
  const approved = list.filter(c => c.status === 'approved').sort(byNewest);
  if (approved.length) return approved[0];
  const pending = list.filter(c => c.status === 'pending').sort(byNewest);
  if (pending.length) return pending[0];
  const rejected = list.filter(c => c.status === 'rejected').sort(byNewest);
  if (rejected.length) return rejected[0];
  return null;
}

/**
 * Whether this user may request a claim for `company` right now, given their existing claims.
 * Pure precheck that mirrors what the DB's partial-unique indexes enforce, so the endpoint can
 * return a clear reason instead of a raw constraint error.
 *
 * Returns { ok: boolean, reason: string, company: canonicalName }.
 *   - invalid          → the name isn't a usable company name
 *   - already_approved → this user already has THIS company approved
 *   - already_pending  → this user already has a pending request for THIS company
 *   - has_other_company→ this user already manages a DIFFERENT approved company (one per employer)
 */
export function canRequestClaim(claims, company) {
  const canonical = normalizeClaimCompany(company);
  if (!isValidClaimCompany(company)) {
    return { ok: false, reason: 'invalid', company: canonical };
  }
  const list = claimsFor(claims);
  const sameApproved = list.some(c => c.status === 'approved' && c.company_name === canonical);
  if (sameApproved) return { ok: false, reason: 'already_approved', company: canonical };

  const samePending = list.some(c => c.status === 'pending' && c.company_name === canonical);
  if (samePending) return { ok: false, reason: 'already_pending', company: canonical };

  const otherApproved = list.some(c => c.status === 'approved' && c.company_name !== canonical);
  if (otherApproved) return { ok: false, reason: 'has_other_company', company: canonical };

  return { ok: true, reason: 'ok', company: canonical };
}

/**
 * Whether a logged-in employer's surface should scope to their approved company (ignoring the
 * ?company= param) vs. honor the param. Login-scoping applies only when: they're a ready employer
 * WITH an approved company AND god-view is not requested. God-view (admin) always uses the param.
 */
export function effectiveSurfaceCompany({ isEmployer, employerCompany, paramCompany, godview }) {
  const param = String(paramCompany == null ? '' : paramCompany).trim();
  if (godview) return { company: param, scoped: false, source: 'godview' };
  if (isEmployer && employerCompany) return { company: employerCompany, scoped: true, source: 'claim' };
  return { company: param, scoped: false, source: 'param' };
}

// ── Instant claim verification via work-email domain ───────────────────────────
// An employer who signs up with an email at the company's own domain (brandon@acme.com claiming
// "Acme") has already proven, to Supabase, that they control that mailbox — strong enough evidence
// of employment to auto-approve the claim and skip the manual admin queue. Free/personal-email
// providers prove nothing about employer, so they always fall through to manual review.
//
// Pure + node-builtin-free so both the endpoint (api/employer-claims.js) and tests can use it.

// Consumer/free mailbox providers — an address here is never proof of working for any company.
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'passport.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'protonmail.com', 'proton.me', 'pm.me', 'gmx.com', 'gmx.net', 'gmx.de', 'mail.com', 'email.com',
  'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'fastmail.com', 'hey.com',
  'tutanota.com', 'tuta.io', 'tutamail.com', 'qq.com', '163.com', '126.com', 'sina.com', 'naver.com',
  'hushmail.com', 'inbox.com', 'mailinator.com', 'guerrillamail.com', '10minutemail.com',
]);

// Legal/generic tokens that carry no identity — dropped so "Acme Inc" and "Acme" match the same
// @acme.com domain, and generic words can't cause a false match.
const LEGAL_SUFFIX_TOKENS = new Set([
  'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'group', 'holdings',
  'plc', 'gmbh', 'ag', 'sa', 'srl', 'bv', 'llp', 'lp', 'partners', 'the', 'and', 'of',
]);

// Second-level public labels that sit LEFT of a country TLD (acme.co.uk, acme.com.au) — dropped
// alongside the TLD so the registrable label ("acme") is what we compare.
const PUBLIC_SLD_LABELS = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

const alnum = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** The lowercased domain of an email ("HR@Acme.com" → "acme.com"), or '' if not a single address. */
export function emailDomain(email) {
  const parts = String(email == null ? '' : email).toLowerCase().trim().split('@');
  return parts.length === 2 && parts[1] ? parts[1] : '';
}

/** The registrable label(s) of a domain, TLD (and country-SLD) stripped: "acme.co.uk" → ["acme"]. */
function domainCoreLabels(domain) {
  const labels = String(domain).split('.').filter(Boolean);
  if (labels.length < 2) return [];
  let core = labels.slice(0, -1); // drop the TLD
  if (core.length >= 2 && PUBLIC_SLD_LABELS.has(core[core.length - 1])) core = core.slice(0, -1);
  return core.map(alnum).filter(Boolean);
}

/** Identity-bearing tokens of a company name, lowercased/alnum, legal + tiny words dropped. */
function companyTokens(companyName) {
  return String(companyName == null ? '' : companyName)
    .toLowerCase().split(/[^a-z0-9]+/)
    .map(alnum)
    .filter((t) => t && t.length >= 2 && !LEGAL_SUFFIX_TOKENS.has(t));
}

/**
 * True when `email`'s domain plausibly belongs to `companyName` — i.e. a work-email match strong
 * enough to auto-approve the company claim. Free-email providers are always false. A match needs a
 * registrable domain label to line up with the company's identity tokens (either the whole name
 * joined — "acmecorp.com" for "Acme Corp" — or an individual ≥3-char token like "acme").
 *
 * Deliberately conservative: a near-miss simply falls through to manual admin review, never a
 * wrong auto-grant. This is authz over money-free reputation data, so the cost of a false-negative
 * (a human clicks approve) is far lower than a false-positive.
 */
export function emailDomainMatchesCompany(email, companyName) {
  const domain = emailDomain(email);
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return false;

  const core = domainCoreLabels(domain);
  const tokens = companyTokens(companyName);
  if (!core.length || !tokens.length) return false;

  const joined = alnum(tokens.join(''));
  for (const label of core) {
    // Whole-name match: "acmecorp.com" ↔ "Acme Corp"; require ≥4 shared chars to avoid tiny hits.
    if (joined && Math.min(label.length, joined.length) >= 4 &&
        (label === joined || label.includes(joined) || joined.includes(label))) {
      return true;
    }
    // Single significant token match: "acme" ↔ "acme.com".
    for (const t of tokens) {
      if (t.length < 3) continue;
      if (label === t) return true;
      if (label.includes(t) && t.length >= 4) return true;
      if (t.includes(label) && label.length >= 4) return true;
    }
  }
  return false;
}
