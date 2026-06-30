// Shared report-write helpers — the company/location resolve-or-create logic and the
// anti-Sybil trust assessment, extracted so BOTH api/reports.js (submit / create_from_tracker)
// and api/user-sync.js (resume_survey) feed company_scores through the exact same path.
//
// All calls use the SERVICE key headers (`hdrs`) supplied by the caller — these helpers
// never touch RLS-protected reads on the client's behalf.

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
  return repRes.ok;
}
