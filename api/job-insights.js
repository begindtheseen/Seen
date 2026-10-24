// Job insights — deterministic, keyless (lib/server/jobInsights.js), cached per job for 7 days
// in public.job_insights and shared by every user. A cache HIT is free; a MISS costs
// JOB_INSIGHTS_COST (1) credit via gateAI. Nothing is ever charged silently: the client first
// sends { probe: true } (free, never generates) to learn whether the job is cached, shows the
// price only when it is not, and pays with an explicit tap.
//
// Every 200 answer carries the ledger facts the UI renders from:
//   _src   'db' (cached, free) | 'generated' (charged) | 'empty' (no description) | 'uncached' (probe miss)
//   cost   credits this call charged (0 or JOB_INSIGHTS_COST)
//   charged  true only when a credit was actually consumed
//   price  on a probe miss: what a real call would cost
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { gateAI } from '../lib/server/credits.js';
import { JOB_INSIGHTS_COST } from '../lib/server/creditRules.js';
import { buildJobInsights } from '../lib/server/jobInsights.js';
import { createHash } from 'node:crypto';

// The posting text an insight was built from, as a short stable key (whitespace-insensitive).
export function hashText(text) {
  return createHash('sha256').update(String(text || '').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

export default async function handler(req, res) {
  const _o = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', !_o || _o.includes('localhost') || ['https://seenjobs.io','https://www.seenjobs.io'].includes(_o) ? (_o || '*') : 'https://seenjobs.io');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (await applyRateLimit(req, res, 'job-insights')) return;
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const { jobId, job, company, jobDescription, needsSummary } = body;
  const probe = body.probe === true;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const dbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  // ── DB cache — shared across all users, 7-day TTL ──────────────────────
  // Keyed by the job AND the text it was built from: `${jobId}:${descHash}`. Every write builds the
  // full insight (summary included — it is deterministic and free to compute), so ANY visitor's
  // probe for the same posting is a free hit. Before 2026-10-24 a second visitor's probe answered
  // cached:false: the write was fire-and-forget after the response (a serverless instance may be
  // frozen before it lands), and a row whose summary came out empty was skipped for every caller
  // that asked for one — i.e. every caller. Rows written under the bare jobId before that are still
  // read (with the old summary rule).
  const descHash = jobDescription ? hashText(jobDescription) : '';
  const cacheKey = descHash ? `${String(jobId)}:${descHash}` : '';
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const keys = [cacheKey, String(jobId)].filter(Boolean).map(k => `"${k.replace(/"/g, '')}"`).join(',');
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/job_insights?job_id=in.(${encodeURIComponent(keys)})&expires_at=gt.${new Date().toISOString()}&limit=2`,
        { headers: dbHeaders }
      );
      if (checkRes.ok) {
        const rows = await checkRes.json();
        const list = Array.isArray(rows) ? rows : [];
        // The posting-keyed row is complete by construction; a legacy bare-id row only when it
        // carries what the caller needs.
        const row = list.find(r => cacheKey && r.job_id === cacheKey)
          || list.find(r => r.job_id === String(jobId) && (!needsSummary || r.description_summary || r.description_summary === undefined))
          || null;
        if (row) {
          // Prod's job_insights has no description_summary column until migration
          // 20261024130000 is applied; the summary is a deterministic excerpt of the posting the
          // caller sent, so it is rebuilt here (free) rather than lost.
          const summary = row.description_summary ?? (needsSummary && job && company && jobDescription
            ? buildJobInsights({ title: job, company, description: jobDescription, needsSummary: true }).description_summary : '');
          return res.status(200).json({
            what_they_want: row.what_they_want || [],
            hidden_requirements: row.hidden_requirements || [],
            insider_tip: row.insider_tip || '',
            description_summary: summary || '',
            cached: true, _src: 'db', cost: 0, charged: false,
          });
        }
      }
    } catch(e) {
      console.error('job-insights db read:', e.message);
    }
  }

  if (!job || !company || !jobDescription || jobDescription.length < 80) {
    return res.status(200).json({ what_they_want: [], hidden_requirements: [], insider_tip: '', description_summary: '', _src: 'empty', cost: 0, charged: false });
  }

  // Probe: the caller only wants to know whether this job is cached. Never gate, never
  // generate, never charge — answer with the price a real call would cost.
  if (probe) {
    return res.status(200).json({ cached: false, price: JOB_INSIGHTS_COST, _src: 'uncached', cost: 0, charged: false });
  }

  // Cache miss → costs JOB_INSIGHTS_COST (shared cache means most users never pay)
  const gate = await gateAI(req, 'job_insights');
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, balance: gate.balance ?? 0, _src: 'no_credits', cost: 0, charged: false });

  // ── Deterministic, KEYLESS generation (no Anthropic). Instant, no rate limits. ──
  // Always the full insight (summary included) so the shared row serves every later caller.
  const parsed = buildJobInsights({ title: job, company, description: jobDescription, needsSummary: true });

  // ── Upsert to DB — safe for concurrent first-opens of the same job. AWAITED: the shared row
  // must exist before the next visitor probes (an un-awaited write may never land). Prod's table
  // has had no description_summary column (verified 2026-10-24: 0 rows ever stored — every write
  // was a 400), so a 400 retries without it. ──────
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const row = {
      job_id: cacheKey || String(jobId),
      what_they_want: parsed.what_they_want || [],
      hidden_requirements: parsed.hidden_requirements || [],
      insider_tip: parsed.insider_tip || '',
      description_summary: parsed.description_summary || '',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const write = (body) => fetch(`${SUPABASE_URL}/rest/v1/job_insights`, {
      method: 'POST',
      headers: { ...dbHeaders, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(body),
    });
    try {
      const w = await write(row);
      if (w && w.status === 400) {
        const { description_summary: _omit, ...withoutSummary } = row;
        const w2 = await write(withoutSummary);
        if (w2 && !w2.ok) console.error('job-insights db write:', w2.status);
      } else if (w && !w.ok) console.error('job-insights db write:', w.status);
    } catch (e) { console.error('job-insights db write:', e.message); }
  }

  return res.status(200).json({ ...parsed, _src: 'generated', cost: JOB_INSIGHTS_COST, charged: true, balance: gate.balance, pro: !!gate.pro });
}
