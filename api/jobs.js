export const config = { runtime: 'edge' };

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }});

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const { query, location } = await req.json();
    if (!query) return new Response(JSON.stringify({ error: 'No query' }), { status: 400, headers });

    const loc = (location || '').trim();
    const results = [];

    // Try Adzuna if keys are set
    if (ADZUNA_APP_ID && ADZUNA_APP_KEY) {
      try {
        const locParam = loc ? `&location0=us&location1=${encodeURIComponent(loc)}` : '&location0=us';
        const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=15&what=${encodeURIComponent(query)}${locParam}&content-type=application/json`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          for (const job of (data.results || [])) {
            results.push({
              title: job.title,
              company: job.company?.display_name || 'Unknown',
              location: job.location?.display_name || loc || 'Remote',
              salary: job.salary_min && job.salary_max
                ? `$${Math.round(job.salary_min/1000)}k–$${Math.round(job.salary_max/1000)}k`
                : job.salary_min ? `$${Math.round(job.salary_min/1000)}k+` : null,
              description: job.description?.slice(0, 300),
              url: job.redirect_url,
              source: 'Adzuna',
              posted: job.created,
            });
          }
        }
      } catch(e) { console.warn('Adzuna error:', e.message); }
    }

    // If no Adzuna keys or no results, use Claude + web search to find real listings
    if (results.length === 0) {
      const searchQuery = loc
        ? `${query} jobs in ${loc} site:linkedin.com OR site:indeed.com OR site:greenhouse.io OR site:lever.co 2025`
        : `${query} jobs remote OR "United States" site:linkedin.com OR site:indeed.com OR site:greenhouse.io 2025`;

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `You are a job search assistant. Search for real currently open job listings. 
Return ONLY valid JSON array of up to 12 jobs:
[{"title":"...","company":"...","location":"...","salary":"$Xk–$Yk or null","url":"real apply URL","description":"1-2 sentences","type":"Full-time/Part-time","level":"Entry/Mid/Senior","source":"LinkedIn/Indeed/Greenhouse/etc","posted":"date or null"}]
CRITICAL: Only include real verified open positions. No fabricated listings. If you cannot find real listings, return [].
Return ONLY the JSON array, no other text.`,
          messages: [{ role: 'user', content: `Find real open ${query} jobs${loc ? ` in ${loc}` : ' in the US or remote'}. Search now and return actual listings.` }]
        })
      });

      if (claudeRes.ok) {
        const claudeData = await claudeRes.json();
        const text = (claudeData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const match = clean.match(/\[[\s\S]*\]/);
        if (match) {
          try {
            const jobs = JSON.parse(match[0]);
            results.push(...jobs.filter(j => j.title && j.company));
          } catch(e) {}
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, jobs: results, query, location: loc }), { status: 200, headers });

  } catch(err) {
    console.error('Jobs API error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
