// Cron: self-filling company pages — the company-enrichment queue worker.
//
// Every 15 minutes (vercel.json) this claims ≤3 companies that real visitors looked up while they
// had ZERO first-party reports (queued by api/reports.js → lib/server/enrichmentQueue.js), finds
// public Reddit hiring threads about each, extracts first-hand experiences with the free LLM gateway,
// and writes them as attributed, down-weighted reports. The whole pipeline lives in
// lib/server/companyEnrichmentWorker.js (I/O injected, unit-tested); this file is auth + wiring.
//
// AUTH (fails closed, like api/prune-jobs.js): the Vercel cron header, CRON_SECRET (Authorization:
// Bearer — what Vercel sends when CRON_SECRET is set — or x-cron-secret), or a valid admin session.
// Vercel crons fire as GET; a manual POST with the same credentials runs the same thing.
//
// Before the migration (20261017140000) is applied the claim RPC 404s and the run returns
// { ok:false, reason:'queue_unavailable' } having touched nothing.

import { logError } from '../lib/server/errlog.js';
import { runEnrichment } from '../lib/server/companyEnrichmentWorker.js';
import { readEnrichConfig } from './_utils/companyEnrichment.js';
import { isVercelCron } from '../lib/server/cronAuth.js';

async function authorized(req) {
  if (isVercelCron(req)) return true;
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization === `Bearer ${secret}` || req.headers['x-cron-secret'] === secret)) return true;
  const adminToken = String(req.headers['x-admin-token'] || '').trim();
  const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
  if (!adminToken || !SB || !SK) return false;
  try {
    const r = await fetch(`${SB}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`, {
      headers: { apikey: SK, Authorization: `Bearer ${SK}` }, signal: AbortSignal.timeout(5000),
    });
    const sess = r.ok ? (await r.json())?.[0] : null;
    return !!sess && new Date(sess.expires_at) >= new Date();
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await authorized(req))) return res.status(401).json({ error: 'Unauthorized' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'DB not configured' });

  try {
    const summary = await runEnrichment({ url, key, config: readEnrichConfig(), log: (m) => console.log(m) });
    if (!summary.ok) console.warn('[enrich-companies]', summary.reason, summary.status || '');
    for (const c of summary.companies) {
      if (c.status === 'error' || c.status === 'retry') logError('enrich-companies/company', c.reason || 'failed', { company: c.company });
    }
    return res.status(200).json(summary);
  } catch (e) {
    logError('enrich-companies', e);
    return res.status(500).json({ ok: false, error: 'enrichment run failed' });
  }
}
