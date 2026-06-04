// Node.js serverless — no edge runtime, supports maxDuration in vercel.json
// 60 searches split into 6 batches of 10, one batch per cron run (6× daily)
// Each batch completes in ~5s well under the 60s maxDuration

const ALL_SEARCHES = [
  // Batch 0 — 2am UTC — Healthcare mid/senior
  { what: 'Registered Nurse', where: 'Los Angeles, CA' },
  { what: 'Registered Nurse', where: 'New York, NY' },
  { what: 'Registered Nurse', where: 'Chicago, IL' },
  { what: 'Registered Nurse', where: 'Houston, TX' },
  { what: 'Registered Nurse', where: 'Phoenix, AZ' },
  { what: 'Physical Therapist', where: 'Los Angeles, CA' },
  { what: 'Physical Therapist', where: 'Chicago, IL' },
  { what: 'LVN', where: 'Orange County, CA' },
  { what: 'Social Worker', where: 'New York, NY' },
  { what: 'Clinical Research Coordinator', where: 'Boston, MA' },
  // Batch 1 — 6am UTC — Healthcare entry level
  { what: 'CNA', where: 'New York, NY' },
  { what: 'CNA', where: 'Atlanta, GA' },
  { what: 'CNA', where: 'Los Angeles, CA' },
  { what: 'Medical Assistant', where: 'Los Angeles, CA' },
  { what: 'Medical Assistant', where: 'Dallas, TX' },
  { what: 'Medical Assistant', where: 'Phoenix, AZ' },
  { what: 'Home Health Aide', where: 'New York, NY' },
  { what: 'Home Health Aide', where: 'Chicago, IL' },
  { what: 'Patient Care Technician', where: 'Houston, TX' },
  { what: 'Pharmacy Technician', where: 'Los Angeles, CA' },
  // Batch 2 — 10am UTC — Tech mid/senior + Finance
  { what: 'Software Engineer', where: 'San Francisco, CA' },
  { what: 'Software Engineer', where: 'Seattle, WA' },
  { what: 'Software Engineer', where: 'Austin, TX' },
  { what: 'Software Engineer', where: 'New York, NY' },
  { what: 'Software Engineer', where: 'Remote' },
  { what: 'Product Manager', where: 'San Francisco, CA' },
  { what: 'DevOps Engineer', where: 'Remote' },
  { what: 'Financial Analyst', where: 'New York, NY' },
  { what: 'Financial Analyst', where: 'Chicago, IL' },
  { what: 'Accountant', where: 'Boston, MA' },
  // Batch 3 — 2pm UTC — Tech entry + Business entry
  { what: 'Junior Software Engineer', where: 'Remote' },
  { what: 'Junior Software Engineer', where: 'New York, NY' },
  { what: 'Data Analyst', where: 'New York, NY' },
  { what: 'Data Analyst', where: 'Remote' },
  { what: 'UX Designer', where: 'Remote' },
  { what: 'Administrative Assistant', where: 'New York, NY' },
  { what: 'Administrative Assistant', where: 'Los Angeles, CA' },
  { what: 'Customer Service Representative', where: 'Remote' },
  { what: 'Customer Service Representative', where: 'New York, NY' },
  { what: 'Business Analyst', where: 'Chicago, IL' },
  // Batch 4 — 6pm UTC — Retail + Logistics entry
  { what: 'Sales Associate', where: 'Los Angeles, CA' },
  { what: 'Sales Associate', where: 'New York, NY' },
  { what: 'Sales Associate', where: 'Chicago, IL' },
  { what: 'Retail Associate', where: 'Remote' },
  { what: 'Warehouse Associate', where: 'Los Angeles, CA' },
  { what: 'Warehouse Associate', where: 'Chicago, IL' },
  { what: 'CDL Truck Driver', where: 'Dallas, TX' },
  { what: 'Delivery Driver', where: 'Los Angeles, CA' },
  { what: 'Customer Service Associate', where: 'Miami, FL' },
  { what: 'Receptionist', where: 'New York, NY' },
  // Batch 5 — 10pm UTC — Trades + Education + Mixed entry
  { what: 'Electrician', where: 'Phoenix, AZ' },
  { what: 'Construction Worker', where: 'Denver, CO' },
  { what: 'Restaurant Manager', where: 'Miami, FL' },
  { what: 'Server', where: 'New York, NY' },
  { what: 'Teacher', where: 'Los Angeles, CA' },
  { what: 'Teacher', where: 'Chicago, IL' },
  { what: 'Project Manager', where: 'Remote' },
  { what: 'Marketing Coordinator', where: 'New York, NY' },
  { what: 'HR Coordinator', where: 'Atlanta, GA' },
  { what: 'Operations Associate', where: 'Dallas, TX' },
];

const BATCH_HOURS = [2, 6, 10, 14, 18, 22]; // UTC hours matching cron schedule
const BATCH_SIZE = 10;

function getCurrentBatch() {
  const hour = new Date().getUTCHours();
  // Find closest scheduled hour, default batch 0
  let best = 0, bestDiff = 99;
  BATCH_HOURS.forEach((h, i) => {
    const diff = Math.abs(hour - h);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s per call max
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(j => ({
      title: j.title || what,
      company: j.company?.display_name || 'Unknown',
      location: j.location?.display_name || where,
      salary: formatSalary(j.salary_min, j.salary_max),
      description: (j.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 8000),
      apply_url: j.redirect_url || null,
      source: 'Adzuna',
      type: j.contract_time === 'part_time' ? 'Part-time' : 'Full-time',
      level: inferLevel(j.title),
      search_query: what,
      score: scoreJob(j.company?.display_name, j.salary_min),
      waste_score: wasteScore(j.company?.display_name),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })).filter(j => j.company !== 'Unknown' && j.apply_url && j.description && j.description.length > 80);
  } catch (e) {
    clearTimeout(timeout);
    console.warn('Adzuna fetch error:', e.message);
    return [];
  }
}

async function upsertJobs(jobs, supabaseUrl, serviceKey) {
  if (!jobs.length) return { upserted: 0, rows: [] };
  const res = await fetch(`${supabaseUrl}/rest/v1/jobs?select=id,title,company,description`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(jobs),
  });
  if (!res.ok) return { upserted: 0, rows: [] };
  const rows = await res.json();
  return { upserted: Array.isArray(rows) ? rows.length : 0, rows: Array.isArray(rows) ? rows : [] };
}

// Pre-generate insights for jobs that don't have them yet.
// 5 concurrent Haiku calls, max 20 jobs per cron run (~8s total).
// After the first pass the DB fills up and this becomes a near no-op.
async function pregenInsights(jobs, supabaseUrl, serviceKey, anthropicKey) {
  if (!jobs.length || !anthropicKey || !supabaseUrl || !serviceKey) return;

  const eligible = jobs.filter(j => j.id && j.description && j.description.length > 80).slice(0, 20);
  if (!eligible.length) return;

  // Batch-check which job_ids already have valid cached insights
  const idList = eligible.map(j => `"${j.id}"`).join(',');
  let existingIds = new Set();
  try {
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/job_insights?job_id=in.(${idList})&expires_at=gt.${new Date().toISOString()}&select=job_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      existingIds = new Set((existing || []).map(r => String(r.job_id)));
    }
  } catch(e) { /* table may not exist yet — skip */ return; }

  const needed = eligible.filter(j => !existingIds.has(String(j.id)));
  if (!needed.length) return;

  // Generate 5 at a time — fast, cheap, safe on rate limits
  const CONCURRENCY = 5;
  for (let i = 0; i < needed.length; i += CONCURRENCY) {
    await Promise.all(needed.slice(i, i + CONCURRENCY).map(job => _generateOne(job, supabaseUrl, serviceKey, anthropicKey)));
  }
}

async function _generateOne(job, supabaseUrl, serviceKey, anthropicKey) {
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        system: 'You are a job market analyst. Return ONLY valid JSON with no markdown.',
        messages: [{
          role: 'user',
          content: `Analyze this job posting. Return ONLY this JSON:
{"what_they_want":["<skill/trait>","<2>","<3>","<4>","<5>"],"hidden_requirements":["<unstated expectation>","<2>","<3>"],"insider_tip":"<1 sentence strategic advice>","description_summary":"<2-3 paragraph overview of role, responsibilities, and requirements written for job seekers>"}

JOB: ${job.title} at ${job.company}
JOB DESCRIPTION:\n${(job.description || '').slice(0, 2000)}`
        }]
      })
    });
    if (!apiRes.ok) return;

    const text = (await apiRes.json()).content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const match = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]);
    if (!parsed?.what_they_want?.length) return;

    await fetch(`${supabaseUrl}/rest/v1/job_insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        job_id: String(job.id),
        what_they_want: parsed.what_they_want || [],
        hidden_requirements: parsed.hidden_requirements || [],
        insider_tip: parsed.insider_tip || '',
        description_summary: parsed.description_summary || '',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
  } catch(e) {
    console.error('pregen _generateOne:', e.message);
  }
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

// Scan every active listing and immediately remove any that fail quality standards.
// Runs every cron hit — cheap (only fetches id + description + apply_url).
async function deleteJunk(supabaseUrl, serviceKey) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/jobs?select=id,description,apply_url&expires_at=gt.${new Date().toISOString()}&limit=2000`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!res.ok) return { removed: 0 };
    const rows = await res.json();

    const badIds = (rows || []).filter(r =>
      !r.description ||
      r.description.trim().length < 80 ||
      !r.apply_url
    ).map(r => r.id);

    if (!badIds.length) return { removed: 0 };

    // Delete in chunks of 100 to stay inside URL length limits
    for (let i = 0; i < badIds.length; i += 100) {
      const chunk = badIds.slice(i, i + 100);
      await fetch(`${supabaseUrl}/rest/v1/jobs?id=in.(${chunk.join(',')})`, {
        method: 'DELETE',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Prefer: 'return=minimal',
        },
      });
    }

    console.log(`deleteJunk: removed ${badIds.length} junk listings`);
    return { removed: badIds.length };
  } catch(e) {
    console.error('deleteJunk error:', e.message);
    return { removed: 0 };
  }
}

export default async function handler(req, res) {
  const headers = { 'Content-Type': 'application/json' };

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
    if (authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
  const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return res.status(500).json({ error: 'Missing ADZUNA_APP_ID or ADZUNA_APP_KEY' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
  }

  try {
    const [, junkResult] = await Promise.all([
      deleteExpired(SUPABASE_URL, SUPABASE_SERVICE_KEY),
      deleteJunk(SUPABASE_URL, SUPABASE_SERVICE_KEY),
    ]);

    // Pick which batch of 10 to run based on current UTC hour
    // Pass ?batch=0..4 to override (useful for manual trigger of all batches)
    const batchParam = new URL(req.url, 'https://x').searchParams.get('batch');
    const batchIndex = batchParam !== null ? parseInt(batchParam) : getCurrentBatch();
    const searches = ALL_SEARCHES.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);

    // Run all 10 searches in parallel
    const results = await Promise.allSettled(
      searches.map(s => fetchAdzuna(s.what, s.where, ADZUNA_APP_ID, ADZUNA_APP_KEY))
    );
    const allJobs = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

    // Upsert in batches of 25, collect returned rows for insight pre-gen
    const upsertResults = [];
    for (let i = 0; i < allJobs.length; i += 25) {
      const result = await upsertJobs(allJobs.slice(i, i + 25), SUPABASE_URL, SUPABASE_SERVICE_KEY);
      upsertResults.push(result);
    }

    // Pre-generate insights for new/uncached jobs — eliminates thundering herd.
    // Awaited with a 30s cap so cron stays well within 60s maxDuration.
    const allRows = upsertResults.flatMap(r => r.rows || []);
    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    await Promise.race([
      pregenInsights(allRows, SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_KEY),
      new Promise(r => setTimeout(r, 30000)),
    ]).catch(e => console.error('pregen error (non-fatal):', e.message));

    return res.status(200).json({
      ok: true,
      date: new Date().toISOString(),
      batch: batchIndex,
      searches: searches.length,
      found: allJobs.length,
      upserted: upsertResults.reduce((sum, r) => sum + (r.upserted || 0), 0),
      purged: junkResult.removed,
    });

  } catch (err) {
    console.error('refresh-jobs error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
