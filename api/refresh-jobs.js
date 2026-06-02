export const config = { runtime: 'edge' };

// Rotates through these search sets daily so we get broad coverage over time
const SEARCH_SETS = [
  // Set A — Healthcare
  [
    { query: 'Registered Nurse ICU', location: 'Los Angeles, CA' },
    { query: 'Physical Therapist', location: 'Orange County, CA' },
    { query: 'Medical Assistant', location: 'Phoenix, AZ' },
    { query: 'Registered Nurse ER', location: 'New York, NY' },
    { query: 'LVN Urgent Care', location: 'Houston, TX' },
  ],
  // Set B — Tech
  [
    { query: 'Software Engineer', location: 'Remote' },
    { query: 'Data Analyst', location: 'New York, NY' },
    { query: 'Product Manager', location: 'San Francisco, CA' },
    { query: 'UX Designer', location: 'Remote' },
    { query: 'DevOps Engineer', location: 'Remote' },
  ],
  // Set C — Business / Finance
  [
    { query: 'Financial Analyst', location: 'Chicago, IL' },
    { query: 'Marketing Manager', location: 'New York, NY' },
    { query: 'Operations Manager', location: 'Dallas, TX' },
    { query: 'Project Manager', location: 'Remote' },
    { query: 'Sales Representative', location: 'Austin, TX' },
  ],
  // Set D — Local high-demand
  [
    { query: 'Customer Service Representative', location: 'Remote' },
    { query: 'Warehouse Associate', location: 'Los Angeles, CA' },
    { query: 'CDL Truck Driver', location: 'Houston, TX' },
    { query: 'Restaurant Manager', location: 'Orange County, CA' },
    { query: 'Accountant', location: 'Boston, MA' },
  ],
  // Set E — Mixed senior roles
  [
    { query: 'Software Engineer Senior', location: 'Seattle, WA' },
    { query: 'Registered Nurse Travel', location: 'Remote' },
    { query: 'Product Designer', location: 'Remote' },
    { query: 'Clinical Research Coordinator', location: 'Los Angeles, CA' },
    { query: 'Civil Engineer', location: 'Atlanta, GA' },
  ],
];

// Rotate based on day of week (0-4)
function getTodaySearchSet() {
  return SEARCH_SETS[new Date().getDay() % SEARCH_SETS.length];
}

async function searchJobs(query, location, apiKey) {
  const loc = (location || '').trim();
  const userPrompt = loc
    ? `Find open ${query} jobs within 25 miles of ${loc}. Search LinkedIn, Indeed, Greenhouse, Lever, Workday, company career pages. Do multiple searches. Return at least 8 real, currently-open listings. If not enough nearby, include remote. Include direct apply URLs when available.`
    : `Find open ${query} jobs in the US or remote. Search LinkedIn, Indeed, Greenhouse, Lever. Return at least 8 real, currently-open listings. Include direct apply URLs.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: [
        'You are a job search assistant. Find REAL, currently-open job listings using web search.',
        'Only return listings that exist right now — check that they are active before including them.',
        'Return ONLY a valid JSON array, no markdown, no explanation:',
        '[{"title":"...","company":"...","location":"City, State","salary":"$Xk-$Yk or null","url":"direct apply URL or company careers page","description":"2-3 sentences about the role","type":"Full-time","level":"Mid level","source":"LinkedIn/Indeed/Greenhouse/etc","posted":"recent/1 week ago/etc"}]',
      ].join('\n'),
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (!arrMatch) return [];

  let jobs = [];
  try { jobs = JSON.parse(arrMatch[0]); } catch(e) { return []; }

  return jobs
    .filter(j => j.title && j.company && j.company !== 'Unknown')
    .map(j => ({
      title: j.title,
      company: j.company,
      location: j.location || loc || 'US',
      salary: j.salary || null,
      description: j.description || null,
      apply_url: j.url || null,
      source: j.source || 'Web search',
      type: j.type || 'Full-time',
      level: j.level || 'Mid level',
      search_query: query,
      score: scoreJob(j),
      waste_score: wasteScore(j),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }));
}

function scoreJob(job) {
  let s = 65;
  const src = (job.source || '').toLowerCase();
  const co = (job.company || '').toLowerCase();
  if (src.includes('greenhouse') || src.includes('lever') || src.includes('workday')) s += 12;
  if (src.includes('linkedin')) s += 5;
  if (job.salary) s += 8;
  if (['stripe', 'linear', 'figma', 'notion', 'vercel'].some(g => co.includes(g))) s += 15;
  if (['amazon', 'accenture', 'cognizant', 'infosys'].some(g => co.includes(g))) s -= 15;
  return Math.min(95, Math.max(25, s));
}

function wasteScore(job) {
  let w = 25;
  const co = (job.company || '').toLowerCase();
  if (['amazon', 'accenture', 'cognizant', 'infosys', 'wipro'].some(g => co.includes(g))) w += 35;
  return Math.min(85, w);
}

async function upsertJobs(jobs, supabaseUrl, serviceKey) {
  if (!jobs.length) return { upserted: 0 };
  const res = await fetch(`${supabaseUrl}/rest/v1/jobs`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(jobs),
  });
  return { upserted: jobs.length, ok: res.ok, status: res.status };
}

async function deleteExpired(supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/jobs?expires_at=lt.${new Date().toISOString()}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal',
      },
    }
  );
  return { ok: res.ok, status: res.status };
}

export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json' };

  // Verify cron secret — Vercel passes Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing env vars: ANTHROPIC_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY required' }), { status: 500, headers });
  }

  try {
    const searches = getTodaySearchSet();
    console.log(`refresh-jobs: running ${searches.length} searches for day ${new Date().getDay()}`);

    // Run all searches in parallel
    const results = await Promise.allSettled(
      searches.map(s => searchJobs(s.query, s.location, ANTHROPIC_KEY))
    );

    const allJobs = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    console.log(`refresh-jobs: found ${allJobs.length} total listings`);

    // Upsert in batches of 20
    const batchSize = 20;
    const upsertResults = [];
    for (let i = 0; i < allJobs.length; i += batchSize) {
      const batch = allJobs.slice(i, i + batchSize);
      const result = await upsertJobs(batch, SUPABASE_URL, SUPABASE_SERVICE_KEY);
      upsertResults.push(result);
    }

    // Delete expired listings
    const deleteResult = await deleteExpired(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    return new Response(JSON.stringify({
      ok: true,
      date: new Date().toISOString(),
      searches: searches.map(s => `${s.query} — ${s.location || 'US'}`),
      found: allJobs.length,
      upsertBatches: upsertResults,
      expired_deleted: deleteResult,
    }), { status: 200, headers });

  } catch(err) {
    console.error('refresh-jobs error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
