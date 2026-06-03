// On-demand Adzuna fetch for a user's specific city
// Called when the user's city has no results in Supabase

const STATE_ABBR = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
  'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
  'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
  'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
  'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  'District of Columbia':'DC',
};

// Normalize "Norwalk, California" → "Norwalk, CA" so Adzuna geocodes it correctly
function normalizeLocation(loc) {
  if (!loc) return loc;
  const parts = loc.split(',').map(p => p.trim());
  const city = parts[0];
  const state = parts[1] || '';
  const abbr = STATE_ABBR[state] || state;
  return abbr ? `${city}, ${abbr}` : city;
}

const CATEGORIES_BY_INDUSTRY = {
  tech: ['Software Engineer', 'Data Analyst', 'Product Manager', 'DevOps Engineer', 'UX Designer'],
  healthcare: ['Registered Nurse', 'Medical Assistant', 'Physical Therapist', 'LVN', 'CNA'],
  finance: ['Financial Analyst', 'Accountant', 'Business Analyst', 'Operations Manager', 'Project Manager'],
  logistics: ['Warehouse Associate', 'CDL Truck Driver', 'Operations Manager', 'Supply Chain Analyst', 'Logistics Coordinator'],
  retail: ['Customer Service Representative', 'Restaurant Manager', 'Retail Manager', 'Sales Representative', 'Store Manager'],
  other: ['Project Manager', 'Operations Manager', 'Customer Service Representative', 'Marketing Manager', 'HR Manager'],
  default: ['Customer Service Representative', 'Registered Nurse', 'Software Engineer', 'Sales Representative', 'Project Manager', 'Data Analyst', 'Accountant', 'Operations Manager'],
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

async function fetchAdzuna(what, where, appId, appKey, distanceKm) {
  const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1');
  url.searchParams.set('app_id', appId);
  url.searchParams.set('app_key', appKey);
  url.searchParams.set('what', what);
  if (where && where.toLowerCase() !== 'remote') {
    url.searchParams.set('where', where);
    if (distanceKm) url.searchParams.set('distance', distanceKm.toString());
  }
  url.searchParams.set('results_per_page', '50');
  url.searchParams.set('sort_by', 'date');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    return (data.results || []).map(j => ({
      title: j.title || what,
      company: j.company?.display_name || 'Unknown',
      location: j.location?.display_name || where,
      salary: formatSalary(j.salary_min, j.salary_max),
      description: (j.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 2000),
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
    clearTimeout(timeout);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const APP_ID = process.env.ADZUNA_APP_ID;
  const APP_KEY = process.env.ADZUNA_APP_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!APP_ID || !APP_KEY) {
    return res.status(200).json({ error: 'Adzuna not configured', jobs: [] });
  }

  try {
    const { location, industry, radius } = req.body || {};
    if (!location) return res.status(400).json({ error: 'No location', jobs: [] });

    const categories = CATEGORIES_BY_INDUSTRY[industry] || CATEGORIES_BY_INDUSTRY.default;
    // Convert miles to km for Adzuna's distance param (default 25mi → ~40km)
    const distanceKm = radius ? Math.round(parseInt(radius) * 1.609) : 40;
    // Normalize "Norwalk, California" → "Norwalk, CA" for Adzuna geocoder
    const normalizedLoc = normalizeLocation(location);
    const cityOnly = normalizedLoc.split(',')[0].trim();

    let results = await Promise.allSettled(
      categories.slice(0, 6).map(cat => fetchAdzuna(cat, normalizedLoc, APP_ID, APP_KEY, distanceKm))
    );
    let allJobs = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

    // If normalized city+state returned nothing, retry with just the city name
    if (!allJobs.length && cityOnly !== normalizedLoc) {
      results = await Promise.allSettled(
        categories.slice(0, 4).map(cat => fetchAdzuna(cat, cityOnly, APP_ID, APP_KEY, distanceKm))
      );
      allJobs = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    }

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

    return res.status(200).json({ ok: true, jobs: allJobs, location });
  } catch (err) {
    console.error('fetch-location-jobs error:', err.message);
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}
