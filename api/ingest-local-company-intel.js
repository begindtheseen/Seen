// Admin-only receiver for raw, source-attributed company-intelligence excerpts from the local Mac.
import { normalizeIntelItem } from '../lib/server/companyIntelImport.js';
import { classifyApplicantAccount, REPORT_OUTCOME } from '../lib/reports/applicantRules.js';
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
  const metrics = { ok: true, received: input.length, accepted: 0, imported_reports: 0, published_reports: 0, downgraded: 0, commentary: 0, duplicates: 0, rejected: 0, errors: [] }, reportCompanies = new Set();
  // Every rejection carries a reason; distinct reasons only, so a batch of 100 cannot bloat the reply.
  const note = (reason) => { if (!metrics.errors.includes(reason) && metrics.errors.length < 20) metrics.errors.push(reason); };
  for (const raw of input) {
    // One item that throws (a malformed DB reply, a network blip) costs that item, never the batch:
    // a thrown handler 500s and the collector marks the whole run failed with the rest unsent.
    try { await ingestOne(raw); } catch (e) { metrics.rejected++; note(`item failed: ${String(e?.message || e).slice(0, 120)}`); }
  }
  async function ingestOne(raw) {
    const item = normalizeIntelItem(raw);
    if (!item) { metrics.rejected++; note('invalid item: needs a company, an https source link and an excerpt of 20+ characters'); return; }
    // An account that carries its page context (any source: Reddit, Hacker News, a page Google found) is
    // re-checked HERE with the same strict rules the collectors use. Passing → published as attributed
    // public discussion (weight 0.3: Reddit tier for reddit.com, "Public review · <host>" for the rest);
    // failing → kept only as commentary, never as a report. Accounts without context keep the old path
    // (held for admin review).
    let checked = false;
    const host = new URL(item.source_url).hostname.toLowerCase();
    const isReddit = /(^|\.)reddit\.com$/.test(host);
    if (item.kind === 'applicant_outcome' && item.context) {
      // "The company's own subreddit" only means something on Reddit; elsewhere it is never assumed.
      const r = classifyApplicantAccount(item.excerpt, { names: [item.company], title: item.context.title, isOp: item.context.is_op, inCompanySub: isReddit && item.context.company_sub });
      if (r.kind === 'applicant_outcome') { checked = true; item.outcome = r.outcome; }
      else { item.kind = 'public_commentary'; item.outcome = null; metrics.downgraded++; note('kept as commentary: not a first-hand applicant account under Seen’s rules'); }
    }
    // The automatic collector is intentionally limited to companies Seen already knows.
    // Manual admin imports remain available for a deliberately entered new company.
    if (strictExisting) {
      const name = encodeURIComponent(item.company.toLowerCase());
      const [score, job] = await Promise.all([
        fetch(`${url}/rest/v1/company_scores?company_name=eq.${name}&select=company_name&limit=1`, { headers: hdrs }),
        fetch(`${url}/rest/v1/jobs?company=ilike.${encodeURIComponent(item.company)}&select=id&limit=1`, { headers: hdrs }),
      ]);
      const known = (score.ok && (await score.json()).length) || (job.ok && (await job.json()).length);
      if (!known) { metrics.rejected++; note(`unknown company: ${item.company}`); return; }
    }
    // Register first: the unique source_hash is the cross-run and cross-query duplicate guard.
    // on_conflict must NAME source_hash. Without it PostgREST resolves ignore-duplicates against the
    // primary key, so an excerpt already imported by an earlier run hit the source_hash unique index
    // as a 409 and was reported as REJECTED (2026-10-20: a re-run of 25 companies → 84 × 409, 0 duplicates).
    const claim = await fetch(`${url}/rest/v1/company_intel_imports?on_conflict=source_hash`, { method: 'POST', headers: { ...hdrs, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ company_name: item.company, source: item.source, source_url: item.source_url, source_hash: item.source_hash, kind: item.kind }) });
    if (claim.status === 409) { metrics.duplicates++; return; } // a unique key raced or the other (source_url, source_hash) index
    const claimed = claim.ok ? await claim.json().catch(() => []) : [];
    if (!claim.ok) { note(`registry ${claim.status}`); metrics.rejected++; return; }
    if (!Array.isArray(claimed) || !claimed.length) { metrics.duplicates++; return; }
    // From here the excerpt is registered. If its write fails or throws, release the registration,
    // or every later run would skip it as a "duplicate" that was never actually stored.
    const release = () => fetch(`${url}/rest/v1/company_intel_imports?source_hash=eq.${item.source_hash}`, { method: 'DELETE', headers: { ...hdrs, Prefer: 'return=minimal' } }).catch(() => {});
    try { await store(item); } catch (e) { await release(); throw e; }
    async function store(item) {
      if (item.kind === 'applicant_outcome') {
        const cid = await resolveOrCreateCompany(url, hdrs, item.company);
        const outcome = REPORT_OUTCOME[item.outcome] || item.outcome; // reports_outcome_check has no 'assessment'
        const sub = (/^Reddit r\/(\w+)/i.exec(item.source) || [])[1] || (/\/r\/(\w+)/i.exec(item.source_url) || [])[1];
        const row = checked && isReddit
          // Same row shape as api/reports.js reddit_import: Reddit tier (0.3), labelled public discussion,
          // published. trust_reason marks the batch so it can be found and removed in one query.
          ? { company_id: cid || undefined, role: item.role, platform: `Reddit r/${sub || 'unknown'}`, source: 'reddit', outcome, outcome_weight: 0.3, trust_reason: 'reddit_rule_match', needs_review: false, rounds: 0, unpaid_work: 'na', experience_level: 'Unknown', report_text: `${item.excerpt} [Source: ${item.source_url}]` }
          : checked
          // Any other public page (Hacker News, a forum Google found): the established public-review contract
          // (api/_utils/companyIntel.js PUBLIC_REVIEW_PLATFORM_PREFIX, weight 0.3), published, tagged as a batch.
          ? { company_id: cid || undefined, role: item.role, platform: `Public review · ${host.replace(/^www\./, '')}`, source: 'web_public', outcome, outcome_weight: 0.3, trust_reason: 'web_rule_match', needs_review: false, rounds: 0, unpaid_work: 'na', experience_level: 'Unknown', report_text: `${item.excerpt} [Source: ${item.source_url}]` }
          : { company_id: cid || undefined, role: item.role, platform: `Public review · ${new URL(item.source_url).hostname.replace(/^www\./, '')}`, source: 'web_public', outcome, outcome_weight: 0.3, trust_reason: 'external_import', needs_review: true, rounds: 0, unpaid_work: 'na', experience_level: 'Unknown', report_text: `${item.excerpt} [Source: ${item.source_url}]` };
        const ok = await writeReport(url, hdrs, row, item.company.toLowerCase());
        if (ok) { metrics.accepted++; metrics.imported_reports++; if (checked) metrics.published_reports++; reportCompanies.add(item.company); } else { await release(); note('report write failed'); metrics.rejected++; }
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
        if (save.ok) { metrics.accepted++; metrics.commentary++; } else { await release(); note('commentary write failed'); metrics.rejected++; }
      }
    }
  }
  // Commentary is display-only and must never rewrite a company's score/count cache.
  // Only actual applicant-outcome rows need a score refresh.
  for (const company of reportCompanies) await recomputeCompanyScoreFromReports(url, hdrs, company);
  return res.status(200).json(metrics);
}
