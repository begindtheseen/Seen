// Admin-only receiver for raw, source-attributed company-intelligence excerpts from the local Mac.
import { normalizeIntelItem } from '../lib/server/companyIntelImport.js';
import { resolveOrCreateCompany, recomputeCompanyScoreFromReports, writeReport } from './_utils/reportWrite.js';

const headersFor = key => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const input = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
  if (!input.length) return res.status(400).json({ error: 'Provide 1–100 source-attributed items.' });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Company-intelligence storage is unavailable.' });
  const hdrs = headersFor(key), strictExisting = body.require_existing === true;
  const metrics = { ok: true, received: input.length, accepted: 0, imported_reports: 0, commentary: 0, duplicates: 0, rejected: 0, errors: [] }, reportCompanies = new Set();
  for (const raw of input) {
    const item = normalizeIntelItem(raw);
    if (!item) { metrics.rejected++; continue; }
    // The automatic collector is intentionally limited to companies Seen already knows.
    // Manual admin imports remain available for a deliberately entered new company.
    if (strictExisting) {
      const name = encodeURIComponent(item.company.toLowerCase());
      const [score, job] = await Promise.all([
        fetch(`${url}/rest/v1/company_scores?company_name=eq.${name}&select=company_name&limit=1`, { headers: hdrs }),
        fetch(`${url}/rest/v1/jobs?company=ilike.${encodeURIComponent(item.company)}&select=id&limit=1`, { headers: hdrs }),
      ]);
      const known = (score.ok && (await score.json()).length) || (job.ok && (await job.json()).length);
      if (!known) { metrics.rejected++; metrics.errors.push(`unknown company: ${item.company}`); continue; }
    }
    // Register first: the unique source_hash is the cross-run and cross-query duplicate guard.
    const claim = await fetch(`${url}/rest/v1/company_intel_imports`, { method: 'POST', headers: { ...hdrs, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ company_name: item.company, source: item.source, source_url: item.source_url, source_hash: item.source_hash, kind: item.kind }) });
    const claimed = claim.ok ? await claim.json().catch(() => []) : [];
    if (!claim.ok) { metrics.errors.push(`registry ${claim.status}`); metrics.rejected++; continue; }
    if (!Array.isArray(claimed) || !claimed.length) { metrics.duplicates++; continue; }
    metrics.accepted++;
    if (item.kind === 'applicant_outcome') {
      const cid = await resolveOrCreateCompany(url, hdrs, item.company);
      const ok = await writeReport(url, hdrs, { company_id: cid || undefined, role: item.role, platform: `Public review · ${new URL(item.source_url).hostname.replace(/^www\./, '')}`, source: 'web_public', outcome: item.outcome, outcome_weight: 0.3, trust_reason: 'external_import', needs_review: true, rounds: 0, unpaid_work: 'na', experience_level: 'Unknown', report_text: `${item.excerpt} [Source: ${item.source_url}]` }, item.company.toLowerCase());
      if (ok) { metrics.imported_reports++; reportCompanies.add(item.company); } else { metrics.errors.push('report write failed'); metrics.rejected++; }
    } else {
      // Commentary stays on the company page but carries a kind flag so employee reviews do not
      // count as hiring-outcome mentions.
      const q = encodeURIComponent(item.company.toLowerCase());
      const prior = await fetch(`${url}/rest/v1/company_scores?company_name=eq.${q}&select=web_reviews&limit=1`, { headers: hdrs });
      const rows = prior.ok ? await prior.json() : [];
      let reviews = rows?.[0]?.web_reviews; if (typeof reviews === 'string') { try { reviews = JSON.parse(reviews); } catch { reviews = []; } }
      if (!Array.isArray(reviews)) reviews = [];
      reviews.push({ text: item.excerpt, source: item.source, year: item.year, sentiment: item.sentiment, url: item.source_url, kind: item.kind, source_hash: item.source_hash });
      const save = await fetch(`${url}/rest/v1/company_scores?on_conflict=company_name`, { method: 'POST', headers: { ...hdrs, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ company_name: item.company.toLowerCase(), web_reviews: reviews.slice(-100) }) });
      if (save.ok) metrics.commentary++; else { metrics.errors.push('commentary write failed'); metrics.rejected++; }
    }
  }
  // Commentary is display-only and must never rewrite a company's score/count cache.
  // Only actual applicant-outcome rows need a score refresh.
  for (const company of reportCompanies) await recomputeCompanyScoreFromReports(url, hdrs, company);
  return res.status(200).json(metrics);
}
