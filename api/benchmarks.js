import { applyRateLimit } from './_utils/ratelimit.js';
import { logError } from './_utils/errlog.js';

const CORS_HEADERS = (req, res) => {
  const _o = req.headers.origin || '';
  const _devO = !_o || _o.includes('localhost') || _o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', (_devO || ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(_o)) ? (_o || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
};

// Industry baseline benchmarks (Greenhouse 2023, LinkedIn Talent Insights, Indeed Hiring Lab)
const INDUSTRY = {
  ghost_rate: 0.55,
  response_rate: 0.20,
  interview_rate: 0.025,
  avg_wait_days: 21,
  avg_rounds: 2.5,
  offer_rate: 0.008,
};

export default async function handler(req, res) {
  CORS_HEADERS(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const dbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── GET: industry or company stats ───────────────────────────────────────────
  if (req.method === 'GET') {
    const limited = await applyRateLimit(req, res, 'benchmarks');
    if (limited) return;

    const { type, name, names } = req.query || {};

    if (type === 'industry') {
      return res.status(200).json({ ok: true, benchmarks: INDUSTRY });
    }

    if (type === 'company' && name) {
      const safe = String(name).slice(0, 100);
      const stats = await fetchCompanyStats(safe, SUPABASE_URL, dbHeaders);
      return res.status(200).json({ ok: true, stats });
    }

    if (type === 'batch' && names) {
      const nameList = String(names).split(',').slice(0, 25).map(n => n.trim()).filter(Boolean);
      const statsArr = await Promise.all(nameList.map(n => fetchCompanyStats(n, SUPABASE_URL, dbHeaders)));
      const result = {};
      nameList.forEach((n, i) => { if (statsArr[i]) result[n.toLowerCase()] = statsArr[i]; });
      return res.status(200).json({ ok: true, stats: result });
    }

    return res.status(400).json({ error: 'type required: industry|company|batch' });
  }

  // ── POST: quick_submit ────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const limited = await applyRateLimit(req, res, 'report-submit');
    if (limited) return;

    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
      const { action } = body || {};

      if (action !== 'quick_submit') return res.status(400).json({ error: 'action must be quick_submit' });

      const { company, outcome, role, city } = body;
      if (!company || !outcome) return res.status(400).json({ error: 'company and outcome required' });

      const VALID = new Set(['ghosted', 'rejected', 'autoreject', 'hired', 'offer', 'interview', 'human', 'waiting']);
      if (!VALID.has(outcome)) return res.status(400).json({ error: 'invalid outcome' });

      const safeCompany = String(company).slice(0, 120).replace(/[<>`\\]/g, '').trim();
      const safeRole    = role ? String(role).slice(0, 120).replace(/[<>`\\]/g, '').trim() : '';
      const safeCity    = city ? String(city).slice(0,  80).replace(/[<>`\\]/g, '').trim() : '';
      if (!safeCompany) return res.status(400).json({ error: 'company required' });

      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return res.status(200).json({ ok: true, submitted: true, _src: 'noop' });
      }

      const row = {
        company_name:      safeCompany,
        outcome,
        role:              safeRole,
        city:              safeCity,
        platform:          'Seen',
        experience_level:  'Unknown',
      };

      const r = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
        method: 'POST',
        headers: { ...dbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify(row),
      });

      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        console.error('quick_submit failed:', r.status, errText.slice(0, 200));
        return res.status(400).json({ error: 'Submit failed' });
      }
      return res.status(200).json({ ok: true, submitted: true });

    } catch(err) {
      logError('benchmarks', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end('Method not allowed');
}

async function fetchCompanyStats(name, supabaseUrl, dbHeaders) {
  if (!supabaseUrl || !dbHeaders.apikey) return null;
  try {
    const enc = encodeURIComponent(name);
    // Fetch company_scores (pre-computed AI research) and recent reports in parallel
    const [scoresRes, reportsRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/company_scores?company_name=ilike.${enc}&select=company_name,overall_score,ghost_rate,response_rate,avg_wait_days,avg_rounds,waste_score,report_count,data_quality&order=created_at.desc&limit=1`, { headers: dbHeaders }),
      fetch(`${supabaseUrl}/rest/v1/reports?company_name=ilike.${enc}&select=outcome,rounds,created_at&order=created_at.desc&limit=150`, { headers: dbHeaders }),
    ]);

    const [scores, reports] = await Promise.all([
      scoresRes.ok ? scoresRes.json() : [],
      reportsRes.ok ? reportsRes.json() : [],
    ]);

    const cs = Array.isArray(scores) ? scores[0] : null;
    const reps = Array.isArray(reports) ? reports : [];
    const total = reps.length;

    // Outcome distribution from community reports
    const dist = {};
    for (const r of reps) {
      const oc = r.outcome || 'unknown';
      dist[oc] = (dist[oc] || 0) + 1;
    }

    // Fall back to computing rates from reports if company_scores missing
    const ghost_rate = cs?.ghost_rate ?? (total >= 5 ? (dist.ghosted || 0) / total : null);
    const response_rate = cs?.response_rate ?? (total >= 5
      ? ((dist.hired || 0) + (dist.offer || 0) + (dist.interview || 0) + (dist.human || 0)) / total
      : null);

    return {
      company_name:   cs?.company_name || name,
      overall_score:  cs?.overall_score || null,
      ghost_rate,
      response_rate,
      avg_wait_days:  cs?.avg_wait_days || null,
      avg_rounds:     cs?.avg_rounds || null,
      waste_score:    cs?.waste_score || null,
      report_count:   total || cs?.report_count || 0,
      data_quality:   cs?.data_quality || (total >= 10 ? 'strong' : total >= 3 ? 'moderate' : 'limited'),
      outcome_dist:   dist,
    };
  } catch(e) {
    return null;
  }
}
