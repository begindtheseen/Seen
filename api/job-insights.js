import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { gateAI } from '../lib/server/credits.js';

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
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

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

  if (!job || !company || !jobDescription || jobDescription.length < 80 || !ANTHROPIC_KEY) {
    return res.status(200).json({ what_they_want: [], hidden_requirements: [], insider_tip: '', description_summary: '', _src: 'empty' });
  }

  // Cache miss → costs 1 credit (shared cache means most users never pay)
  const gate = await gateAI(req, 'job_insights');
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, balance: gate.balance ?? 0, _src: 'no_credits' });

  // ── One Claude Haiku call — insights only, or insights + summary if clipped ──
  // 2000 chars of input is plenty for accurate insights (~500 tokens).
  // Only pay for a summary when the description is actually truncated.
  const descInput = jobDescription.slice(0, 2000);
  const wantSummary = !!needsSummary;

  const prompt = wantSummary
    ? `Analyze this job posting. Return ONLY this JSON:
{"what_they_want":["<skill/trait>","<2>","<3>","<4>","<5>"],"hidden_requirements":["<unstated expectation>","<2>","<3>"],"insider_tip":"<1 sentence strategic advice>","description_summary":"<2-3 paragraph complete overview of the role, responsibilities, and requirements — written for job seekers. The description below may be cut off; complete the picture from context.>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${descInput}`
    : `Analyze this job posting. Return ONLY this JSON:
{"what_they_want":["<skill/trait>","<2>","<3>","<4>","<5>"],"hidden_requirements":["<unstated expectation>","<2>","<3>"],"insider_tip":"<1 sentence strategic advice>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${descInput}`;

  let apiRes;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const wait = apiRes?.headers?.get('retry-after');
      await new Promise(r => setTimeout(r, wait ? Math.min(parseInt(wait) * 1000, 15000) : attempt * 4000));
    }
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: wantSummary ? 900 : 500,
        system: 'You are a job market analyst. Return ONLY valid JSON with no markdown.',
        messages: [{ role: 'user', content: prompt }],
      })
    });
    if (apiRes.status !== 429 && apiRes.status !== 529) break;
  }

  if (!apiRes?.ok) {
    const errMsg = `claude ${apiRes?.status}`;
    console.error('job-insights claude error:', errMsg);
    logError('job-insights', errMsg, { jobId, status: apiRes?.status });
    return res.status(200).json({ what_they_want: [], hidden_requirements: [], insider_tip: '', description_summary: '', _src: 'api_err' });
  }

  let parsed;
  try {
    const text = (await apiRes.json()).content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const match = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : null;
  } catch(e) { parsed = null; }

  if (!parsed?.what_they_want?.length) {
    return res.status(200).json({ what_they_want: [], hidden_requirements: [], insider_tip: '', description_summary: '', _src: 'parse_err' });
  }

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
