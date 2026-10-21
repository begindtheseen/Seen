// Admin-only company list for the Mac-local Reddit collector (Seen Command → Aggregation → Company
// Intelligence). It returns names already present in Seen's active listings or company scores; it
// never creates a company. Same Bearer secret as /api/ingest-local-company-intel.
//
//   GET ?limit=N    the collector's default targets: the N companies with the most open listings.
//   GET ?limit=N&below=K  the same, but only companies with fewer than K applicant reports (the
//                   archive collector's "fill every company to K" queue). Companies with no open
//                   listings are not in it: a company is filled because people apply there now.
//   GET ?catalog=1  EVERY company Seen knows, with its counts, so the operator can pick targets
//                   (major companies, under-reported ones, or one specific company).
//
// Counts per company: active_listings (open, unexpired jobs), applicant_reports (first-party report
// rows behind its score), employee_reviews, mentions, and whether it has a grade yet. The old version
// filled the report count ONLY for companies with no listings, used the fused count (which includes a
// web-research claim) and stopped reading jobs after 25,000 rows.
import { isValidCompanyName, normalizeCompany } from './_utils/reportWrite.js';
import { firstPartyReportCount, mentionCount, isGradeable, reportsNeededForGrade } from '../lib/server/reportCounts.js';
import { searchableName } from '../lib/reports/targetNames.js';

const headersFor = key => ({ apikey: key, Authorization: `Bearer ${key}` });
// A lowercase, spaceless identifier is usually an ATS board slug, not the employer's
// display name. Keep it available as a last resort, but never let it outrank real names.
export const isSlugLike = name => String(name || '') === String(name || '').toLowerCase() && !/\s/.test(String(name || ''));
const MAX_ROWS = 200_000;

// Active listings per company, read by keyset pages on the primary key (offset paging gets slower
// with every page on the jobs table).
async function activeListingCounts(url, headers, counts) {
  const nowIso = encodeURIComponent(new Date().toISOString());
  let after = null;
  for (let read = 0; read < MAX_ROWS;) {
    const r = await fetch(`${url}/rest/v1/jobs?select=id,company&availability_status=eq.active&expires_at=gt.${nowIso}&company=not.is.null&order=id.asc&limit=1000${after ? `&id=gt.${after}` : ''}`, { headers });
    if (!r.ok) return false;
    const rows = await r.json();
    for (const row of rows) {
      const name = String(row?.company || '').trim(), normalized = normalizeCompany(name);
      if (!isValidCompanyName(name) || !normalized) continue;
      const entry = better(counts.get(normalized) || blank(name), name);
      entry.active_listings++;
      counts.set(normalized, entry);
    }
    read += rows.length;
    if (rows.length < 1000) return true;
    after = rows[rows.length - 1].id;
  }
  return true;
}

// Prefer the display name ("SpaceX") over the lowercase one company_scores stores ("spacex").
const isLower = (s) => s === s.toLowerCase();
const better = (entry, name) => { if (isLower(entry.company) && !isLower(name)) entry.company = name; return entry; };
const blank = (company) => ({ company, active_listings: 0, applicant_reports: 0, employee_reviews: 0, mentions: 0, graded: false, reports_needed: null, has_score: false });

async function scoreCounts(url, headers, counts, withExtras) {
  const cols = `company_name,report_count,first_party_report_count,data_source${withExtras.mentions ? ',mention_count' : ''}${withExtras.employee ? ',employee_review_count' : ''}`;
  for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
    const r = await fetch(`${url}/rest/v1/company_scores?select=${cols}&order=company_name.asc&limit=1000&offset=${offset}`, { headers });
    if (!r.ok) return false;
    const rows = await r.json();
    for (const row of rows) {
      const name = String(row?.company_name || '').trim(), normalized = normalizeCompany(name);
      if (!isValidCompanyName(name) || !normalized) continue;
      const entry = better(counts.get(normalized) || blank(name), name);
      entry.has_score = true;
      entry.applicant_reports += firstPartyReportCount(row);
      entry.mentions += mentionCount(row);
      entry.employee_reviews += Math.max(0, Number(row.employee_review_count) || 0);
      const gradeRow = { first_party_report_count: entry.applicant_reports, mention_count: entry.mentions };
      entry.graded = isGradeable(gradeRow);
      entry.reports_needed = entry.graded ? 0 : reportsNeededForGrade(gradeRow);
      counts.set(normalized, entry);
    }
    if (rows.length < 1000) return true;
  }
  return true;
}

// Optional columns: probe once so the catalog works before and after their migrations.
async function hasColumn(url, headers, col) {
  try { return (await fetch(`${url}/rest/v1/company_scores?select=${col}&limit=1`, { headers })).ok; } catch { return false; }
}

const rank = (a, b) => Number(isSlugLike(a.company)) - Number(isSlugLike(b.company)) || b.active_listings - a.active_listings
  || b.applicant_reports - a.applicant_reports || a.company.localeCompare(b.company);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Company target storage is unavailable.' });
  const catalog = String(req.query?.catalog || '') === '1';
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 10));
  const belowRaw = Number(req.query?.below);
  const below = Number.isInteger(belowRaw) && belowRaw >= 1 && belowRaw <= 10000 ? belowRaw : null;
  const headers = headersFor(key), counts = new Map();
  const [mentions, employee] = await Promise.all([hasColumn(url, headers, 'mention_count'), hasColumn(url, headers, 'employee_review_count')]);
  const [jobsOk, scoresOk] = await Promise.all([activeListingCounts(url, headers, counts), scoreCounts(url, headers, counts, { mentions, employee })]);
  // A partial read would show real companies with 0 listings / 0 reports — refuse instead.
  if (!jobsOk || !scoresOk) return res.status(502).json({ error: `Could not read ${!jobsOk ? 'job listings' : 'company scores'} — try again.` });
  const all = [...counts.values()].map((c) => ({ ...c, existing_reports: c.applicant_reports, slug_like: isSlugLike(c.company) })).sort(rank);
  if (catalog) return res.status(200).json({ ok: true, companies: all, total: all.length, employee_review_counts: employee, generated_at: new Date().toISOString() });
  // A board slug that was only capitalized ("Andurilindustries") matches nobody's post and burns a run's
  // minutes, so it is never handed out as a target (the catalog above still lists it, flagged).
  const queue = (below ? all.filter((c) => c.active_listings > 0 && c.applicant_reports < below) : all).filter((c) => !c.slug_like && searchableName(c));
  return res.status(200).json({ ok: true, companies: queue.slice(0, limit), scanned_active_companies: counts.size,
    ...(below ? { below, below_count: queue.length } : {}) });
}
