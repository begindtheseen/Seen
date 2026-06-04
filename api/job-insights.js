export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const { jobId, job, company, jobDescription } = body;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  const dbHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  // ── L2: Check DB cache ──────────────────────────────────────────────────
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/job_insights?job_id=eq.${encodeURIComponent(String(jobId))}&expires_at=gt.${new Date().toISOString()}&limit=1`,
        { headers: dbHeaders }
      );
      if (checkRes.ok) {
        const rows = await checkRes.json();
        if (rows?.length) {
          const row = rows[0];
          return res.status(200).json({
            what_they_want: row.what_they_want || [],
            hidden_requirements: row.hidden_requirements || [],
            insider_tip: row.insider_tip || '',
            _src: 'db',
          });
        }
      }
    } catch(e) {
      console.error('job-insights db read:', e.message);
    }
  }

  // ── Not enough data to generate — return empty gracefully ───────────────
  if (!job || !company || !jobDescription || jobDescription.length < 80 || !ANTHROPIC_KEY) {
    return res.status(200).json({ what_they_want: [], hidden_requirements: [], insider_tip: '', _src: 'empty' });
  }

  // ── Generate with Claude Haiku (cheapest, fastest) ──────────────────────
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
        max_tokens: 800,
        system: 'You are a job market analyst. Return ONLY valid JSON with no markdown.',
        messages: [{
          role: 'user',
          content: `Analyze this job posting. Return ONLY this JSON:
{"what_they_want":["<most important skill/trait>","<second>","<third>","<fourth>","<fifth>"],"hidden_requirements":["<unstated expectation>","<second>","<third>"],"insider_tip":"<1 sentence strategic advice for applicants>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${jobDescription.slice(0, 3000)}`
        }]
      })
    });
    if (apiRes.status !== 429) break;
  }

  // On rate limit or error, return empty so the page still works
  if (!apiRes?.ok) {
    console.error('job-insights claude error:', apiRes?.status);
    return res.status(200).json({ what_they_want: [], hidden_requirements: [], insider_tip: '', _src: 'api_err' });
  }

  let parsed;
  try {
    const text = (await apiRes.json()).content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const match = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : null;
  } catch(e) {
    parsed = null;
  }

  if (!parsed?.what_they_want?.length) {
    return res.status(200).json({ what_they_want: [], hidden_requirements: [], insider_tip: '', _src: 'parse_err' });
  }

  // ── Write to DB (upsert — safe for concurrent requests) ─────────────────
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    fetch(`${SUPABASE_URL}/rest/v1/job_insights`, {
      method: 'POST',
      headers: { ...dbHeaders, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        job_id: String(jobId),
        what_they_want: parsed.what_they_want || [],
        hidden_requirements: parsed.hidden_requirements || [],
        insider_tip: parsed.insider_tip || '',
        expires_at: expires,
      }),
    }).catch(e => console.error('job-insights db write:', e.message));
  }

  return res.status(200).json({ ...parsed, _src: 'generated' });
}
