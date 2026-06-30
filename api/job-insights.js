import { applyRateLimit } from '../lib/server/ratelimit.js';
import { gateAI } from '../lib/server/credits.js';
import { buildJobInsights } from '../lib/server/jobInsights.js';

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
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const dbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  // ── DB cache — shared across all users, 7-day TTL ──────────────────────
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/job_insights?job_id=eq.${encodeURIComponent(String(jobId))}&expires_at=gt.${new Date().toISOString()}&limit=1`,
        { headers: dbHeaders }
      );
      if (checkRes.ok) {
        const rows = await checkRes.json();
        // Skip cache if caller needs a summary but the cached row has none
        if (rows?.length && (!needsSummary || rows[0].description_summary)) {
          const row = rows[0];
          return res.status(200).json({
            what_they_want: row.what_they_want || [],
            hidden_requirements: row.hidden_requirements || [],
            insider_tip: row.insider_tip || '',
            description_summary: row.description_summary || '',
            _src: 'db',
          });
        }
      }
    } catch(e) {
      console.error('job-insights db read:', e.message);
    }
  }

  if (!job || !company || !jobDescription || jobDescription.length < 80) {
    return res.status(200).json({ what_they_want: [], hidden_requirements: [], insider_tip: '', description_summary: '', _src: 'empty' });
  }

  // Cache miss → costs 1 credit (shared cache means most users never pay)
  const gate = await gateAI(req, 'job_insights');
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, balance: gate.balance ?? 0, _src: 'no_credits' });

  // ── Deterministic, KEYLESS generation (no Anthropic). Instant, no rate limits. ──
  const parsed = buildJobInsights({ title: job, company, description: jobDescription, needsSummary: !!needsSummary });

  // ── Upsert to DB — safe for concurrent first-opens of the same job ──────
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    fetch(`${SUPABASE_URL}/rest/v1/job_insights`, {
      method: 'POST',
      headers: { ...dbHeaders, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        job_id: String(jobId),
        what_they_want: parsed.what_they_want || [],
        hidden_requirements: parsed.hidden_requirements || [],
        insider_tip: parsed.insider_tip || '',
        description_summary: parsed.description_summary || '',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    }).catch(e => console.error('job-insights db write:', e.message));
  }

  return res.status(200).json({ ...parsed, _src: 'generated' });
}
