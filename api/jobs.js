export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
    const { query, location, radius } = body;
    if (!query) return res.status(400).json({ error: 'No query' });

    const loc = (location || '').trim();
    const radiusMiles = radius || 25;

    const systemPrompt = [
      'You are a job search assistant. Search for open job listings using web search.',
      'Search multiple times if needed. Always return at least 8 results.',
      'If the exact city has few results, include nearby cities or remote options.',
      'Return ONLY a valid JSON array with no markdown, no explanation:',
      '[{"title":"...","company":"...","location":"City, State","salary":"$Xk-$Yk or null","url":"apply URL","description":"3-5 sentences describing the role, key responsibilities, and requirements","type":"Full-time","level":"Mid level","source":"LinkedIn/Indeed/etc"}]'
    ].join('\n');

    const userPrompt = loc
      ? 'Find open ' + query + ' jobs within ' + radiusMiles + ' miles of ' + loc + '. Search LinkedIn, Indeed, Greenhouse, Lever, Workday. Do multiple searches. Return at least 8 results. If not enough nearby, include remote options.'
      : 'Find open ' + query + ' jobs in the US or remote. Search LinkedIn, Indeed, Greenhouse, Lever. Return at least 8 results.';

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured', jobs: [] });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const dbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Normalize query for consistent cache keys
    const qNorm = query.toLowerCase().trim();

    // ── Server-side DB cache check ────────────────────────────────────────────
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        // Exact match first (cheapest), then broadened ILIKE if not enough
        const exactUrl = `${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.${encodeURIComponent(qNorm)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=25`;
        const broadUrl = `${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.${encodeURIComponent('%' + qNorm + '%')}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=25`;

        let cached = [];
        const exactRes = await fetch(exactUrl, { headers: dbHeaders });
        if (exactRes.ok) cached = await exactRes.json();

        if (cached.length < 3) {
          const broadRes = await fetch(broadUrl, { headers: dbHeaders });
          if (broadRes.ok) cached = await broadRes.json();
        }

        if (cached?.length >= 3) {
          console.log(`CACHE HIT: "${query}" @ "${loc}" — ${cached.length} results from DB`);
          const jobs = cached.map(j => ({
            title: j.title, company: j.company, location: j.location || loc,
            salary: j.salary, url: j.apply_url, description: j.description,
            type: j.type || 'Full-time', level: j.level || 'Mid level',
            source: j.source || 'Seen', score: j.score || 65, waste_score: j.waste_score || 25,
          }));
          return res.status(200).json({ ok: true, jobs, query, location: loc, _src: 'cache' });
        }
      } catch(e) { console.warn('Cache check error:', e.message); }
      console.log(`CACHE MISS: "${query}" @ "${loc}" — calling Claude API`);
    }

    let apiRes;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const retryAfter = apiRes?.headers?.get('retry-after');
        const waitMs = retryAfter ? Math.min(parseInt(retryAfter) * 1000, 20000) : attempt * 5000;
        await new Promise(r => setTimeout(r, waitMs));
      }
      apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
      if (apiRes.status !== 429 && apiRes.status !== 529) break;
    }
    console.log(`API CALLED: "${query}" @ "${loc}"`);

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      throw new Error('API ' + apiRes.status + ': ' + errText.slice(0, 150));
    }

    const data = await apiRes.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    let jobs = [];
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const arrMatch = clean.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { jobs = JSON.parse(arrMatch[0]); } catch(e) {}
    }

    jobs = jobs.filter(j => j.title && j.company && j.company !== 'Unknown');
    jobs = jobs.map(j => ({ ...j, score: scoreJob(j), waste_score: wasteScore(j) }));
    jobs.sort((a, b) => b.score - a.score);

    // Await the save — fire-and-forget is unreliable in Vercel serverless
    // (execution context can terminate after res.json() before the fetch lands)
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && jobs.length) {
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const rows = jobs.map(j => ({
        title: j.title,
        company: j.company,
        location: j.location || loc || 'US',
        salary: j.salary || null,
        description: (j.description || '').slice(0, 8000),
        apply_url: j.url || null,
        source: j.source || 'Web search',
        type: j.type || 'Full-time',
        level: j.level || 'Mid level',
        search_query: qNorm,
        score: j.score || 65,
        waste_score: j.waste_score || 25,
        expires_at: expires,
      }));
      try {
        const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates,return=minimal',
          },
          body: JSON.stringify(rows),
        });
        if (saveRes.ok) {
          console.log(`CACHE SAVED: "${qNorm}" @ "${loc}" — ${jobs.length} jobs`);
        } else {
          const errText = await saveRes.text();
          console.error(`CACHE SAVE FAILED: ${saveRes.status}`, errText.slice(0, 300));
        }
      } catch (e) {
        console.error('CACHE SAVE ERROR:', e.message);
      }
    }

    return res.status(200).json({ ok: true, jobs, query, location: loc });

  } catch(err) {
    console.error('Jobs error:', err.message);
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}

function scoreJob(job) {
  let s = 65;
  const src = (job.source || '').toLowerCase();
  const co = (job.company || '').toLowerCase();
  if (src.includes('greenhouse') || src.includes('lever') || src.includes('workday')) s += 12;
  if (src.includes('linkedin')) s += 5;
  if (job.salary) s += 8;
  if (['stripe','linear','figma','notion','vercel'].some(g => co.includes(g))) s += 15;
  if (['amazon','accenture','cognizant','infosys'].some(g => co.includes(g))) s -= 15;
  return Math.min(95, Math.max(25, s));
}

function wasteScore(job) {
  let w = 25;
  const co = (job.company || '').toLowerCase();
  if (['amazon','accenture','cognizant','infosys','wipro'].some(g => co.includes(g))) w += 35;
  return Math.min(85, w);
}
