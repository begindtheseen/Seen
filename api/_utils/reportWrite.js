// Shared report-write helpers — the company/location resolve-or-create logic and the
// anti-Sybil trust assessment, extracted so BOTH api/reports.js (submit / create_from_tracker)
// and api/user-sync.js (resume_survey) feed company_scores through the exact same path.
//
// All calls use the SERVICE key headers (`hdrs`) supplied by the caller — these helpers
// never touch RLS-protected reads on the client's behalf.

import { classifyPlatform, fuseCompanyIntel } from './companyIntel.js';
import { broadcastActivity } from '../../lib/server/realtime.js';

const _SCORE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

// Range guards for the DB writers. Rates are fractions [0,1]; scores are [0,100]. A rate
// that persists as e.g. 34.0 renders as "3400%" on the company page — these make that
// impossible. Exported so the sanity is unit-tested directly.
export const clampRate  = v => (v == null ? null : Math.min(1, Math.max(0, v)));
export const clampScore = v => (v == null ? null : Math.min(100, Math.max(0, v)));

// Normalize a company name the same way reports.js does (strip common legal suffixes).
export function normalizeCompany(n) {
  return n
    ? n.trim().toLowerCase()
        .replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '')
        .trim()
    : '';
}

// Blocks placeholder/garbage values from ever entering the companies table.
// Mirrors isValidCompanyName() in api/reports.js.
export function isValidCompanyName(name) {
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

// Resolve an existing company row by fuzzy name match, or create it. Returns the company id
// (uuid) or null. Same algorithm as the `submit` / `create_from_tracker` handlers in reports.js.
export async function resolveOrCreateCompany(SUPABASE_URL, hdrs, rawName) {
  const safeCo = String(rawName).trim().slice(0, 200);
  const coNorm = normalizeCompany(safeCo);
  const coWord = encodeURIComponent(safeCo.split(/\s+/)[0]);
  const coSearch = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.*${coWord}*&select=id,name&limit=20`, { headers: hdrs });
  const coRows = coSearch.ok ? await coSearch.json() : [];
  let cid = (coRows || []).find(c => normalizeCompany(c.name) === coNorm)?.id
    || (coRows || []).find(c => c.name.toLowerCase() === safeCo.toLowerCase())?.id
    || null;
  if (!cid) {
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ name: safeCo, logo_letter: safeCo[0]?.toUpperCase() || '?' }),
    });
    if (insRes.ok) { const insRows = await insRes.json(); cid = Array.isArray(insRows) ? insRows[0]?.id : insRows?.id; }
    if (!cid) {
      const retry = await fetch(`${SUPABASE_URL}/rest/v1/companies?name=ilike.${encodeURIComponent(safeCo)}&select=id&limit=1`, { headers: hdrs });
      if (retry.ok) { const r = await retry.json(); cid = r?.[0]?.id || null; }
    }
  }
  return cid;
}

// Resolve / create a location row under a company. Returns location id or null.
export async function resolveOrCreateLocation(SUPABASE_URL, hdrs, cid, rawLoc) {
  const safeLoc = rawLoc ? String(rawLoc).trim().slice(0, 200) : '';
  if (!safeLoc) return null;
  const locSearch = await fetch(`${SUPABASE_URL}/rest/v1/company_locations?company_id=eq.${cid}&city=ilike.${encodeURIComponent(safeLoc)}&select=id&limit=1`, { headers: hdrs });
  const locRows = locSearch.ok ? await locSearch.json() : [];
  let lid = locRows?.[0]?.id || null;
  if (!lid) {
    const locIns = await fetch(`${SUPABASE_URL}/rest/v1/company_locations`, {
      method: 'POST', headers: hdrs,
      body: JSON.stringify({ company_id: cid, city: safeLoc }),
    });
    if (locIns.ok) { const lr = await locIns.json(); lid = Array.isArray(lr) ? lr[0]?.id : lr?.id; }
  }
  return lid;
}

// Anti-Sybil trust assessment — identical contract to assessSubmitTrust() in reports.js.
// `dupFilter` is a PostgREST predicate identifying the company (e.g. `company_id=eq.<uuid>`).
export async function assessSubmitTrust(SUPABASE_URL, hdrs, uid, dupFilter) {
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

// Eagerly recompute a single company's cached score from its REAL reports and upsert it into
// company_scores, so a freshly-written report (résumé survey or direct submit) reflects on the
// company page IMMEDIATELY instead of waiting for a cache-miss / force_refresh / nightly cron.
//
// This is the exact same deterministic, LLM-free fusion handleCompanyScore runs on a cache-miss
// (reports-first path): pool the company's non-review reports by source and blend them with the
// per-source trust weights in SOURCE_TRUST (direct/survey 1.0, ingest 0.55, reddit 0.3). It is
// idempotent — with an empty web prior the fused result is a pure function of the current report
// set, so re-running over the same reports yields the same score (no drift on repeat writes).
//
// Preserves any existing web-research context (industry / summary / reviews) by OMITTING those
// columns from the upsert — PostgREST merge-duplicates only overwrites columns present in the
// payload. Best-effort: never throws, and returns false on any no-op so the write path is unaffected.
// Admin-confirmed dead listings for a company (suppressed_listings is written ONLY by
// the admin delete flow, so this count is verified evidence — not raw user reports).
// Fail-safe: any error reads as 0 so a hiccup here can never distort a score.
export async function fetchConfirmedStaleCount(SUPABASE_URL, hdrs, companyName) {
  try {
    if (!SUPABASE_URL || !hdrs?.apikey || !companyName) return 0;
    const enc = encodeURIComponent(String(companyName).toLowerCase().trim());
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/suppressed_listings?company=ilike.${enc}&select=apply_url&limit=100`,
      { headers: hdrs },
    );
    if (!r.ok) return 0;
    const rows = await r.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch { return 0; }
}

export async function recomputeCompanyScoreFromReports(SUPABASE_URL, hdrs, companyName) {
  try {
    if (!SUPABASE_URL || !hdrs?.apikey || !companyName) return false;
    const enc = encodeURIComponent(String(companyName).toLowerCase().trim());
    // Same corpus the score path uses: exclude needs_review rows so anonymous/dup/flagged
    // reports can't move the grade (they're held out until an admin clears them).
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/reports?company_name=ilike.${enc}&needs_review=not.is.true&select=outcome,platform&limit=500`,
      { headers: hdrs },
    );
    if (!r.ok) return false;
    const reps = await r.json();
    if (!Array.isArray(reps) || !reps.length) return false;
    const byType = {};
    for (const row of reps) { const t = classifyPlatform(row.platform); (byType[t] ||= []).push({ outcome: row.outcome }); }
    const sources = Object.entries(byType).map(([type, outcomes]) => ({ type, outcomes }));
    // Fold in admin-confirmed dead listings so companies that leave zombie postings up
    // carry the (bounded) penalty in their stored grade.
    const confirmedStaleListings = await fetchConfirmedStaleCount(SUPABASE_URL, hdrs, companyName);
    const fz = fuseCompanyIntel({ web: {}, sources, confirmedStaleListings });
    if (!fz || !fz.report_count) return false;
    // Belt-and-suspenders: fusion already clamps, but the WRITER enforces the range too so a
    // rate can never persist as e.g. 34.0 (→ "3400% ghost rate"). rates [0,1], scores [0,100].
    const row = {
      company_name: String(companyName).toLowerCase().trim(),
      overall_score: clampScore(fz.overall_score),
      ghost_rate: clampRate(fz.ghost_rate),
      response_rate: clampRate(fz.response_rate),
      avg_wait_days: fz.avg_wait_days != null ? Math.round(fz.avg_wait_days) : null,
      avg_rounds: fz.avg_rounds,
      waste_score: clampScore(fz.waste_score),
      unpaid_rate: clampRate(fz.unpaid_rate),
      report_count: fz.report_count,
      // Recompute runs with web:{} — this count is 100% first-party report rows.
      first_party_report_count: fz.first_party_report_count ?? fz.report_count,
      web_report_count: 0,
      data_quality: fz.confidence_label || 'low',
      data_source: 'reports',
      expires_at: new Date(Date.now() + _SCORE_TTL_MS).toISOString(),
    };
    const sv = await fetch(`${SUPABASE_URL}/rest/v1/company_scores?on_conflict=company_name`, {
      method: 'POST',
      headers: { ...hdrs, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    return sv.ok;
  } catch { return false; }
}

// Write a report row, with the same company_name fallback retry reports.js uses when the
// optional company_name column doesn't exist yet. Returns true on success.
export async function writeReport(SUPABASE_URL, hdrs, reportBase, companyName) {
  let repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
    method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' },
    body: JSON.stringify({ ...reportBase, company_name: companyName }),
  });
  if (!repRes.ok && repRes.status === 400) {
    const errText = await repRes.text();
    if (errText.includes('company_name') || errText.includes('column')) {
      repRes = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
        method: 'POST', headers: { ...hdrs, Prefer: 'return=minimal' },
        body: JSON.stringify(reportBase),
      });
    }
  }
  if (repRes.ok) broadcastActivity('report'); // instant Seen Live ping
  return repRes.ok;
}
