export const config = { runtime: 'edge' };

// On-demand Adzuna fetch for a user's specific city
// Called when the user's city has fewer than 10 results in Supabase

const CATEGORIES_BY_INDUSTRY = {
  tech: ['Software Engineer', 'Data Analyst', 'Product Manager', 'DevOps Engineer', 'UX Designer'],
  healthcare: ['Registered Nurse', 'Medical Assistant', 'Physical Therapist', 'LVN', 'CNA'],
  finance: ['Financial Analyst', 'Accountant', 'Business Analyst', 'Operations Manager', 'Project Manager'],
  logistics: ['Warehouse Associate', 'CDL Truck Driver', 'Operations Manager', 'Supply Chain Analyst', 'Logistics Coordinator'],
  retail: ['Customer Service Representative', 'Restaurant Manager', 'Retail Manager', 'Sales Representative', 'Store Manager'],
  other: ['Project Manager', 'Operations Manager', 'Customer Service Representative', 'Marketing Manager', 'HR Manager'],
  default: ['Customer Service Representative', 'Operations Manager', 'Registered Nurse', 'Software Engineer', 'Sales Representative', 'Project Manager', 'Data Analyst', 'Accountant'],
};

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
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
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
      expires_at: expires,
    })).filter(j => j.company !== 'Unknown' && j.apply_url);
  } catch (e) {
    return [];
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }});

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  const APP_ID = process.env.ADZUNA_APP_ID;
  const APP_KEY = process.env.ADZUNA_APP_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!APP_ID || !APP_KEY) {
    return new Response(JSON.stringify({ error: 'Adzuna not configured', jobs: [] }), { status: 200, headers });
  }

  try {
    const { location, industry } = await req.json();
    if (!location) return new Response(JSON.stringify({ error: 'No location', jobs: [] }), { status: 400, headers });

    const categories = CATEGORIES_BY_INDUSTRY[industry] || CATEGORIES_BY_INDUSTRY.default;

    // Fetch top 6 categories in parallel
    const results = await Promise.allSettled(
      categories.slice(0, 6).map(cat => fetchAdzuna(cat, location, APP_ID, APP_KEY))
    );

    const allJobs = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Save to Supabase so future visits are instant
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && allJobs.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(allJobs),
      });
    }

    return new Response(JSON.stringify({ ok: true, jobs: allJobs, location }), { status: 200, headers });
  } catch (err) {
    console.error('fetch-location-jobs error:', err.message);
    return new Response(JSON.stringify({ error: err.message, jobs: [] }), { status: 500, headers });
  }
}
