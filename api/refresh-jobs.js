export const config = { runtime: 'edge' };

// 50 Adzuna searches per cron run — covers major US metros + categories
// 250 free calls/day × 50 results = up to 12,500 real listings per day
const ALL_SEARCHES = [
  // Healthcare
  { what: 'Registered Nurse', where: 'Los Angeles, CA' },
  { what: 'Registered Nurse', where: 'New York, NY' },
  { what: 'Registered Nurse', where: 'Chicago, IL' },
  { what: 'Registered Nurse', where: 'Houston, TX' },
  { what: 'Registered Nurse', where: 'Phoenix, AZ' },
  { what: 'Medical Assistant', where: 'Los Angeles, CA' },
  { what: 'Medical Assistant', where: 'Dallas, TX' },
  { what: 'Medical Assistant', where: 'Phoenix, AZ' },
  { what: 'Physical Therapist', where: 'Los Angeles, CA' },
  { what: 'Physical Therapist', where: 'Chicago, IL' },
  { what: 'LVN', where: 'Orange County, CA' },
  { what: 'CNA', where: 'New York, NY' },
  { what: 'CNA', where: 'Atlanta, GA' },
  { what: 'Clinical Research Coordinator', where: 'Boston, MA' },
  { what: 'Social Worker', where: 'New York, NY' },
  // Tech
  { what: 'Software Engineer', where: 'San Francisco, CA' },
  { what: 'Software Engineer', where: 'Seattle, WA' },
  { what: 'Software Engineer', where: 'Austin, TX' },
  { what: 'Software Engineer', where: 'New York, NY' },
  { what: 'Software Engineer', where: 'Remote' },
  { what: 'Data Analyst', where: 'New York, NY' },
  { what: 'Data Analyst', where: 'Chicago, IL' },
  { what: 'Data Analyst', where: 'Remote' },
  { what: 'Product Manager', where: 'San Francisco, CA' },
  { what: 'UX Designer', where: 'New York, NY' },
  { what: 'UX Designer', where: 'Remote' },
  { what: 'DevOps Engineer', where: 'Remote' },
  // Business / Finance
  { what: 'Financial Analyst', where: 'New York, NY' },
  { what: 'Financial Analyst', where: 'Chicago, IL' },
  { what: 'Marketing Manager', where: 'New York, NY' },
  { what: 'Marketing Manager', where: 'Los Angeles, CA' },
  { what: 'Project Manager', where: 'Remote' },
  { what: 'Project Manager', where: 'Houston, TX' },
  { what: 'Operations Manager', where: 'Dallas, TX' },
  { what: 'Accountant', where: 'Boston, MA' },
  { what: 'HR Manager', where: 'Atlanta, GA' },
  { what: 'Business Analyst', where: 'Chicago, IL' },
  { what: 'Sales Representative', where: 'Miami, FL' },
  { what: 'Sales Representative', where: 'Remote' },
  // Logistics / Trades
  { what: 'Warehouse Associate', where: 'Los Angeles, CA' },
  { what: 'Warehouse Associate', where: 'Chicago, IL' },
  { what: 'CDL Truck Driver', where: 'Dallas, TX' },
  { what: 'CDL Truck Driver', where: 'Houston, TX' },
  { what: 'Electrician', where: 'Phoenix, AZ' },
  { what: 'Construction Manager', where: 'Denver, CO' },
  // Retail / Service
  { what: 'Customer Service Representative', where: 'Remote' },
  { what: 'Restaurant Manager', where: 'Miami, FL' },
  { what: 'Teacher', where: 'Los Angeles, CA' },
  { what: 'Teacher', where: 'Chicago, IL' },
];

function formatSalary(min, max) {
  if (!min && !max) return null;
  const fmt = v => v >= 10000 ? `$${Math.round(v / 1000)}k` : (v > 0 ? `$${v}/hr` : null);
  const fmin = fmt(min), fmax = fmt(max);
  if (fmin && fmax && fmin !== fmax) return `${fmin}–${fmax}`;
  return fmin || fmax || null;
}

function inferLevel(title) {
  const t = (title || '').toLowerCase();
  if (/\b(senior|sr\b|lead|principal|staff|architect)\b/.test(t)) return 'Senior';
  if (/\b(junior|jr\b|entry.level|associate|intern)\b/.test(t)) return 'Entry level';
  if (/\b(director|vp\b|vice president|head of|chief)\b/.test(t)) return 'Director+';
  return 'Mid level';
}

function scoreJob(company, salaryMin) {
  let s = 65;
  const co = (company || '').toLowerCase();
  if (salaryMin > 0) s += 8;
  if (['stripe', 'figma', 'notion', 'vercel', 'linear', 'google', 'microsoft', 'apple', 'meta', 'netflix'].some(g => co.includes(g))) s += 15;
  if (['amazon', 'accenture', 'cognizant', 'infosys', 'wipro', 'tata'].some(g => co.includes(g))) s -= 15;
  return Math.min(95, Math.max(35, s));
}

function wasteScore(company) {
  const co = (company || '').toLowerCase();
  let w = 25;
  if (['amazon', 'accenture', 'cognizant', 'infosys', 'wipro'].some(g => co.includes(g))) w += 35;
  return Math.min(85, w);
}

async function fetchAdzuna(what, where, appId, appKey) {
  const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1');
  url.searchParams.set('app_id', appId);
  url.searchParams.set('app_key', appKey);
  url.searchParams.set('what', what);
  if (where && where.toLowerCase() !== 'remote') url.searchParams.set('where', where);
  url.searchParams.set('results_per_page', '50');
  url.searchParams.set('sort_by', 'date');

  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(j => ({
      title: j.title || what,
      company: j.company?.display_name || 'Unknown',
      location: j.location?.display_name || where,
      salary: formatSalary(j.salary_min, j.salary_max),
      description: (j.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 400),
      apply_url: j.redirect_url || null,
      source: 'Adzuna',
      type: j.contract_time === 'part_time' ? 'Part-time' : 'Full-time',
      level: inferLevel(j.title),
      search_query: what,
      score: scoreJob(j.company?.display_name, j.salary_min),
      waste_score: wasteScore(j.company?.display_name),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })).filter(j => j.company !== 'Unknown' && j.apply_url);
  } catch (e) {
    console.warn('Adzuna fetch error:', e.message);
    return [];
  }
}

async function upsertJobs(jobs, supabaseUrl, serviceKey) {
  if (!jobs.length) return { upserted: 0 };
  const res = await fetch(`${supabaseUrl}/rest/v1/jobs`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(jobs),
  });
  return { upserted: jobs.length, ok: res.ok, status: res.status };
}

async function deleteExpired(supabaseUrl, serviceKey) {
  await fetch(`${supabaseUrl}/rest/v1/jobs?expires_at=lt.${new Date().toISOString()}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=minimal',
    },
  });
}

export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json' };

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }
  }

  const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
  const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return new Response(JSON.stringify({ error: 'Missing ADZUNA_APP_ID or ADZUNA_APP_KEY env vars. Sign up free at developer.adzuna.com' }), { status: 500, headers });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' }), { status: 500, headers });
  }

  try {
    await deleteExpired(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Run all 50 searches in batches of 10 to stay under rate limits
    const allJobs = [];
    const batchSize = 10;
    for (let i = 0; i < ALL_SEARCHES.length; i += batchSize) {
      const batch = ALL_SEARCHES.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(s => fetchAdzuna(s.what, s.where, ADZUNA_APP_ID, ADZUNA_APP_KEY))
      );
      results.filter(r => r.status === 'fulfilled').forEach(r => allJobs.push(...r.value));
    }

    // Upsert in batches of 25
    const upsertResults = [];
    for (let i = 0; i < allJobs.length; i += 25) {
      const result = await upsertJobs(allJobs.slice(i, i + 25), SUPABASE_URL, SUPABASE_SERVICE_KEY);
      upsertResults.push(result);
    }

    return new Response(JSON.stringify({
      ok: true,
      date: new Date().toISOString(),
      searches: ALL_SEARCHES.length,
      found: allJobs.length,
      upserted: upsertResults.reduce((sum, r) => sum + (r.upserted || 0), 0),
    }), { status: 200, headers });

  } catch (err) {
    console.error('refresh-jobs error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
