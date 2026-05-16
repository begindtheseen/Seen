export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }});

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const { query, location, radius } = await req.json();
    if (!query) return new Response(JSON.stringify({ error: 'No query' }), { status: 400, headers });

    const loc = (location || '').trim();
    const radiusMiles = radius || 25;

    // Build smart search terms
    const locationContext = loc
      ? `${loc} OR "${loc} area" OR "near ${loc}" within ${radiusMiles} miles`
      : 'United States OR Remote OR US';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `You are a job search engine. Search for job listings and return results.

Search strategy:
1. Search: "${query} jobs ${loc}" site:linkedin.com/jobs OR site:indeed.com OR site:greenhouse.io OR site:lever.co OR site:workday.com
2. If few results, also search: "${query} hiring ${loc} 2025"
3. If still few results, broaden: "${query} jobs ${loc ? 'near ' + loc : 'remote OR US'}"

Always return at least 8 results. If exact location has few openings, include nearby cities or remote options.

Return ONLY a valid JSON array:
[{
  "title": "exact job title",
  "company": "company name",
  "location": "City, State or Remote",
  "salary": "$Xk-$Yk or null",
  "url": "direct apply URL",
  "description": "2-3 sentence summary of the role",
  "type": "Full-time or Part-time or Contract",
  "level": "Entry level or Mid level or Senior",
  "source": "LinkedIn or Indeed or Greenhouse etc"
}]

Return ONLY the JSON array. No explanation, no markdown fences.`,
        messages: [{
          role: 'user',
          content: `Search for: ${query} jobs${loc ? ' in or near ' + loc + ' (' + radiusMiles + ' mile radius)' : ' in the US or Remote'}

Do multiple searches if needed. Return at least 8 positions. Include a mix of companies. If the exact city has limited results, include nearby cities or remote options clearly labeled.`
        }]
      })
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const data = await response.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Aggressive JSON extraction
    let jobs = [];
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const arrMatch = clean.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { jobs = JSON.parse(arrMatch[0]); } catch(e) {}
    }

    // Filter out junk
    jobs = jobs.filter(j => j.title && j.company && j.company !== 'Unknown');

    // Score each job based on company reputation signals
    jobs = jobs.map(job => ({
      ...job,
      score: scoreJob(job),
      waste_score: wasteScore(job),
    }));

    // Sort by score
    jobs.sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({ ok: true, jobs, query, location: loc, radius: radiusMiles }), { status: 200, headers });

  } catch(err) {
    console.error('Jobs API error:', err.message);
    return new Response(JSON.stringify({ error: err.message, jobs: [] }), { status: 500, headers });
  }
}

function scoreJob(job) {
  let score = 65;
  const co = (job.company || '').toLowerCase();
  const src = (job.source || '').toLowerCase();

  // Boost verified sources
  if (src.includes('greenhouse') || src.includes('lever') || src.includes('workday')) score += 12;
  if (src.includes('linkedin')) score += 5;

  // Boost if salary is listed
  if (job.salary) score += 8;

  // Known good companies
  const good = ['stripe','linear','figma','notion','vercel','supabase','shopify'];
  if (good.some(g => co.includes(g))) score += 15;

  // Known ghost companies
  const ghost = ['amazon','accenture','cognizant','infosys','tcs'];
  if (ghost.some(g => co.includes(g))) score -= 15;

  return Math.min(95, Math.max(25, score));
}

function wasteScore(job) {
  let waste = 25;
  const co = (job.company || '').toLowerCase();
  const ghost = ['amazon','accenture','cognizant','infosys','tcs','wipro'];
  if (ghost.some(g => co.includes(g))) waste += 35;
  return Math.min(85, waste);
}
