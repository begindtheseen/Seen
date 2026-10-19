// Admin-only target list for the Mac-local Reddit collector. It returns names already
// present in Seen's active listings or company scores; it never creates a company.
import { isValidCompanyName, normalizeCompany } from './_utils/reportWrite.js';

const headersFor = key => ({ apikey: key, Authorization: `Bearer ${key}` });
const page = async (url, headers, offset) => {
  const response = await fetch(`${url}/rest/v1/jobs?select=company&availability_status=eq.active&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&company=not.is.null&order=company.asc&limit=1000&offset=${offset}`, { headers });
  return response.ok ? response.json() : [];
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Company target storage is unavailable.' });
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 10));
  const headers = headersFor(key), counts = new Map();
  for (let offset = 0; offset < 25000; offset += 1000) {
    const rows = await page(url, headers, offset);
    for (const row of rows) {
      const name = String(row?.company || '').trim(), normalized = normalizeCompany(name);
      if (!isValidCompanyName(name) || !normalized) continue;
      const old = counts.get(normalized) || { company: name, active_listings: 0, existing_reports: 0 };
      old.active_listings++; counts.set(normalized, old);
    }
    if (rows.length < 1000) break;
  }
  const scores = await fetch(`${url}/rest/v1/company_scores?select=company_name,report_count&order=report_count.desc.nullslast&limit=1000`, { headers })
    .then(r => r.ok ? r.json() : []).catch(() => []);
  for (const row of scores) {
    const name = String(row?.company_name || '').trim(), normalized = normalizeCompany(name);
    if (!isValidCompanyName(name) || !normalized || counts.has(normalized)) continue;
    counts.set(normalized, { company: name, active_listings: 0, existing_reports: Number(row.report_count) || 0 });
  }
  const companies = [...counts.values()].sort((a, b) => b.active_listings - a.active_listings || b.existing_reports - a.existing_reports || a.company.localeCompare(b.company)).slice(0, limit);
  return res.status(200).json({ ok: true, companies, scanned_active_companies: counts.size });
}
