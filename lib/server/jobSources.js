// Keyless job-aggregation engine — the SINGLE source of truth for pulling live job
// listings from free sources, normalizing them, creating their companies, and upserting
// them into the DB. Used by BOTH the scheduled cron (api/refresh-jobs.js) AND on-demand
// search top-up (api/jobs.js), so the two can never drift. No API keys beyond Adzuna's
// free tier; no external AI.

// ── Company-name canonicalization ──────────────────────────────────────────────
// Keeps all subsidiaries/variants under one brand so listings roll up to one company page.
const _ALIASES = {
  'aws': 'Amazon', 'amazon web services': 'Amazon', 'amazon.com': 'Amazon',
  'amazon fresh': 'Amazon', 'amazon logistics': 'Amazon', 'whole foods': 'Amazon',
  'whole foods market': 'Amazon', 'zappos': 'Amazon', 'ring': 'Amazon', 'twitch': 'Amazon',
  'facebook': 'Meta', 'instagram': 'Meta', 'whatsapp': 'Meta', 'meta platforms': 'Meta',
  'alphabet': 'Google', 'alphabet inc': 'Google', 'google llc': 'Google', 'youtube': 'Google',
  'deepmind': 'Google', 'waymo': 'Google',
  'microsoft corp': 'Microsoft', 'microsoft corporation': 'Microsoft',
  'apple inc': 'Apple', 'jpmorgan chase': 'JPMorgan', 'jp morgan': 'JPMorgan',
  'goldman sachs group': 'Goldman Sachs', 'bank of america corp': 'Bank of America',
  'wells fargo bank': 'Wells Fargo', 'unitedhealth group': 'UnitedHealth',
  'cvs pharmacy': 'CVS Health', 'cvs caremark': 'CVS Health',
  'deloitte llp': 'Deloitte', 'deloitte consulting': 'Deloitte',
  'walmart inc': 'Walmart', 'wal-mart': 'Walmart', 'target corporation': 'Target',
  'costco wholesale': 'Costco', 'salesforce inc': 'Salesforce', 'salesforce.com': 'Salesforce',
  'slack': 'Salesforce', 'tableau': 'Salesforce',
  'ibm corporation': 'IBM', 'international business machines': 'IBM',
  'oracle corporation': 'Oracle', 'accenture plc': 'Accenture',
  'tesla inc': 'Tesla', 'tesla motors': 'Tesla',
  'lockheed martin corporation': 'Lockheed Martin',
  'raytheon technologies': 'Raytheon', 'boeing company': 'Boeing',
  'spacex': 'SpaceX', 'space exploration technologies': 'SpaceX',
  'netflix inc': 'Netflix', 'uber technologies': 'Uber', 'lyft inc': 'Lyft',
  'shopify inc': 'Shopify', 'doordash inc': 'DoorDash',
  "mcdonald's corporation": "McDonald's", 'mcdonalds': "McDonald's",
  'starbucks corporation': 'Starbucks', 'instacart': 'Instacart', 'maplebear': 'Instacart',
};
const _SFXRE = /[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings)\.?$/i;
export function normalizeCompany(raw) {
  if (!raw) return raw;
  const k = raw.toLowerCase().trim();
  if (_ALIASES[k]) return _ALIASES[k];
  const k2 = k.replace(_SFXRE, '').trim();
  return _ALIASES[k2] || raw.trim();
}

// ── Small pure helpers ──────────────────────────────────────────────────────────
export function formatSalary(min, max) {
  if (!min && !max) return null;
  const fmt = v => v >= 10000 ? `$${Math.round(v / 1000)}k` : (v > 0 ? `$${v}/hr` : null);
  const fmin = fmt(min), fmax = fmt(max);
  if (fmin && fmax && fmin !== fmax) return `${fmin}–${fmax}`;
  return fmin || fmax || null;
}

export function inferLevel(title) {
  const t = (title || '').toLowerCase();
  if (/\b(senior|sr\b|lead|principal|staff|architect)\b/.test(t)) return 'Senior';
  if (/\b(junior|jr\b|entry.level|associate|intern)\b/.test(t)) return 'Entry level';
  if (/\b(director|vp\b|vice president|head of|chief)\b/.test(t)) return 'Director+';
  return 'Mid level';
}

export function scoreJob(company, salaryMin) {
  let s = 65;
  const co = (company || '').toLowerCase();
  if (salaryMin > 0) s += 8;
  if (['stripe', 'figma', 'notion', 'vercel', 'linear', 'google', 'microsoft', 'apple', 'meta', 'netflix'].some(g => co.includes(g))) s += 15;
  if (['amazon', 'accenture', 'cognizant', 'infosys', 'wipro', 'tata'].some(g => co.includes(g))) s -= 15;
  return Math.min(95, Math.max(35, s));
}

export function wasteScore(company) {
  const co = (company || '').toLowerCase();
  let w = 25;
  if (['amazon', 'accenture', 'cognizant', 'infosys', 'wipro'].some(g => co.includes(g))) w += 35;
  return Math.min(85, w);
}

// Strip HTML, collapse whitespace, cap length.
export function cleanDescription(raw) {
  return (raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

// Build a normalized job row in the exact shape upsertJobs() expects, applying the junk
// filter. Returns null if the job fails quality standards (no company/url/description).
export function buildJob({ title, company, location, salary, description, apply_url, source, type, searchQuery, salaryMin = 0 }) {
  const co = normalizeCompany(company) || 'Unknown';
  const desc = cleanDescription(description);
  const url = apply_url || null;
  if (co === 'Unknown' || !url || !desc || desc.length <= 80) return null;
  const now = new Date().toISOString();
  return {
    title: (title || '').trim() || null,
    company: co,
    location: (location || 'Remote').trim() || 'Remote',
    salary: salary || null,
    description: desc,
    apply_url: url,
    source,
    type: type === 'Part-time' ? 'Part-time' : 'Full-time',
    level: inferLevel(title),
    score: scoreJob(co, salaryMin),
    waste_score: wasteScore(co),
    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    availability_status: 'active',
    last_seen_at: now,
    last_checked_at: now,
    search_query: (searchQuery || title || '').toLowerCase().trim(),
  };
}

// ── Bounded-concurrency map ─────────────────────────────────────────────────────
// Runs at most `limit` tasks at once. Prevents the socket exhaustion ("fetch failed")
// that unbounded Promise.all over hundreds of external fetches causes.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

// ── Sources ─────────────────────────────────────────────────────────────────────
// Adzuna — keyed (free tier), honors what + where, all industries + locations.
export async function fetchAdzuna(what, where, appId, appKey) {
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
    const now = new Date().toISOString();
    return (data.results || []).map(j => ({
      title: j.title || what,
      company: normalizeCompany(j.company?.display_name) || 'Unknown',
      location: j.location?.display_name || where,
      salary: formatSalary(j.salary_min, j.salary_max),
      description: (j.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 8000),
      apply_url: j.redirect_url || null,
      source: 'Adzuna',
      type: j.contract_time === 'part_time' ? 'Part-time' : 'Full-time',
      level: inferLevel(j.title),
      score: scoreJob(normalizeCompany(j.company?.display_name), j.salary_min),
      waste_score: wasteScore(normalizeCompany(j.company?.display_name)),
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      availability_status: 'active',
      last_seen_at: now,
      last_checked_at: now,
    })).filter(j => j.company !== 'Unknown' && j.apply_url && j.description && j.description.length > 80);
  } catch (e) {
    clearTimeout(timeout);
    console.warn('Adzuna fetch error:', e.message);
    return [];
  }
}

// Generic fetch-with-timeout wrapper (8s). Returns parsed JSON or null.
async function fetchJson(url, { headers = {}, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// Remotive — keyless remote-jobs feed. https://remotive.com/api/remote-jobs
async function fetchRemotive() {
  try {
    const data = await fetchJson('https://remotive.com/api/remote-jobs?limit=200');
    if (!data?.jobs) return [];
    return (data.jobs || []).map(j => buildJob({
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location || 'Remote',
      salary: j.salary || null,
      description: j.description,
      apply_url: j.url,
      source: 'Remotive',
      type: j.job_type === 'part_time' ? 'Part-time' : 'Full-time',
      searchQuery: j.category || j.title,
    })).filter(Boolean);
  } catch (e) {
    console.warn('Remotive fetch error:', e.message);
    return [];
  }
}

// Arbeitnow — keyless EU/global job board. https://www.arbeitnow.com/api/job-board-api
async function fetchArbeitnow() {
  try {
    const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api');
    if (!data?.data) return [];
    return (data.data || []).map(j => {
      const types = Array.isArray(j.job_types) ? j.job_types.join(' ').toLowerCase() : String(j.job_types || '').toLowerCase();
      return buildJob({
        title: j.title,
        company: j.company_name,
        location: j.remote ? 'Remote' : (j.location || 'Remote'),
        description: j.description,
        apply_url: j.url,
        source: 'Arbeitnow',
        type: /part|teilzeit/.test(types) ? 'Part-time' : 'Full-time',
        searchQuery: j.title,
      });
    }).filter(Boolean);
  } catch (e) {
    console.warn('Arbeitnow fetch error:', e.message);
    return [];
  }
}

// Jobicy — keyless remote-jobs feed. https://jobicy.com/api/v2/remote-jobs
async function fetchJobicy() {
  try {
    const data = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=50');
    if (!data?.jobs) return [];
    return (data.jobs || []).map(j => {
      const jt = Array.isArray(j.jobType) ? j.jobType.join(' ').toLowerCase() : String(j.jobType || '').toLowerCase();
      return buildJob({
        title: j.jobTitle,
        company: j.companyName,
        location: j.jobGeo || 'Remote',
        salary: (j.annualSalaryMin || j.annualSalaryMax) ? formatSalary(Number(j.annualSalaryMin) || 0, Number(j.annualSalaryMax) || 0) : null,
        salaryMin: Number(j.annualSalaryMin) || 0,
        description: j.jobDescription || j.jobExcerpt,
        apply_url: j.url,
        source: 'Jobicy',
        type: /part/.test(jt) ? 'Part-time' : 'Full-time',
        searchQuery: Array.isArray(j.jobIndustry) ? j.jobIndustry[0] : (j.jobIndustry || j.jobTitle),
      });
    }).filter(Boolean);
  } catch (e) {
    console.warn('Jobicy fetch error:', e.message);
    return [];
  }
}

// RemoteOK — keyless feed. https://remoteok.com/api  (first element is metadata, skipped)
async function fetchRemoteOK() {
  try {
    const data = await fetchJson('https://remoteok.com/api', { headers: { 'User-Agent': 'SeenJobBoard/1.0 (+https://seenjobs.io)' } });
    if (!Array.isArray(data)) return [];
    return data.slice(1).map(j => buildJob({
      title: j.position,
      company: j.company,
      location: j.location || 'Remote',
      salary: (Number(j.salary_min) > 0 || Number(j.salary_max) > 0) ? formatSalary(Number(j.salary_min) || 0, Number(j.salary_max) || 0) : null,
      salaryMin: Number(j.salary_min) || 0,
      description: j.description,
      apply_url: j.apply_url || j.url,
      source: 'RemoteOK',
      type: 'Full-time',
      searchQuery: Array.isArray(j.tags) ? j.tags[0] : (j.position || ''),
    })).filter(Boolean);
  } catch (e) {
    console.warn('RemoteOK fetch error:', e.message);
    return [];
  }
}

// The Muse — keyless public jobs API. https://www.themuse.com/api/public/jobs?page=N
async function fetchTheMuse(pages = 3) {
  const all = [];
  for (let page = 1; page <= pages; page++) {
    try {
      const data = await fetchJson(`https://www.themuse.com/api/public/jobs?page=${page}`);
      if (!data?.results) continue;
      for (const j of data.results) {
        const loc = Array.isArray(j.locations) && j.locations[0]?.name ? j.locations[0].name : 'Remote';
        const level = Array.isArray(j.levels) && j.levels[0]?.name ? j.levels[0].name : '';
        all.push(buildJob({
          title: j.name,
          company: j.company?.name,
          location: loc,
          description: j.contents,
          apply_url: j.refs?.landing_page,
          source: 'The Muse',
          type: /part/i.test(level) ? 'Part-time' : 'Full-time',
          searchQuery: (Array.isArray(j.categories) && j.categories[0]?.name) ? j.categories[0].name : j.name,
        }));
      }
    } catch (e) {
      console.warn(`The Muse fetch error (page ${page}):`, e.message);
    }
  }
  return all.filter(Boolean);
}

// Run all keyless secondary sources concurrently; any failure is isolated.
export async function fetchSecondarySources() {
  const settled = await Promise.allSettled([
    fetchRemotive(),
    fetchArbeitnow(),
    fetchJobicy(),
    fetchRemoteOK(),
    fetchTheMuse(3),
  ]);
  const bySource = {};
  const jobs = [];
  for (const r of settled) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const j of r.value) {
        bySource[j.source] = (bySource[j.source] || 0) + 1;
        jobs.push(j);
      }
    }
  }
  return { jobs, bySource };
}

// ── Company create + job upsert ─────────────────────────────────────────────────
// Cache company name → id across warm invocations to avoid duplicate lookups.
const _companyIdCache = {};

// Blocks placeholder/garbage values from entering the companies table.
export function isValidCompanyName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 200) return false;
  if (!/[a-zA-Z]/.test(n)) return false;
  if (n.startsWith('#')) return false;
  const lower = n.toLowerCase();
  const BLOCKED = new Set([
    'unknown','n/a','na','none','test','company','employer','null','undefined',
    'other','various','multiple','anonymous','private','confidential','tbd','tba',
    'not specified','not listed','not provided','see description',
  ]);
  if (BLOCKED.has(lower)) return false;
  return true;
}

export async function getOrCreateCompanyId(name, supabaseUrl, serviceKey) {
  if (!name || !isValidCompanyName(name)) return null;
  const canon = normalizeCompany(name);
  if (_companyIdCache[canon]) return _companyIdCache[canon];
  const h = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  // Look up by canonical name first
  const look = await fetch(
    `${supabaseUrl}/rest/v1/companies?name=eq.${encodeURIComponent(canon)}&select=id&limit=1`,
    { headers: h }
  );
  if (look.ok) {
    const rows = await look.json();
    if (rows?.[0]?.id) {
      _companyIdCache[canon] = rows[0].id;
      return rows[0].id;
    }
  }
  // Create it
  const create = await fetch(`${supabaseUrl}/rest/v1/companies`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ name: canon }),
  });
  if (create.ok) {
    const rows = await create.json();
    const id = Array.isArray(rows) ? rows[0]?.id : rows?.id;
    if (id) { _companyIdCache[canon] = id; return id; }
  }
  return null;
}

export async function upsertJobs(jobs, supabaseUrl, serviceKey) {
  if (!jobs.length) return { upserted: 0, rows: [] };

  // Stamp company_id on every job before inserting (creates the company if missing).
  const withIds = await Promise.all(jobs.map(async j => {
    const cid = await getOrCreateCompanyId(j.company, supabaseUrl, serviceKey);
    return cid ? { ...j, company_id: cid } : j;
  }));

  const res = await fetch(`${supabaseUrl}/rest/v1/jobs?select=id,title,company,description`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(withIds),
  });
  if (!res.ok) return { upserted: 0, rows: [] };
  const rows = await res.json();
  return { upserted: Array.isArray(rows) ? rows.length : 0, rows: Array.isArray(rows) ? rows : [] };
}

// ── On-demand aggregation for a single user search ──────────────────────────────
// When a search finds too few listings in our corpus, pull LIVE from Adzuna for the
// query (+ a few expansion terms) at the searched location, then persist the results —
// creating any missing companies and upserting the jobs (merge-duplicates so re-searches
// refresh expires_at instead of duplicating). Every under-served search grows the corpus.
// Adzuna honors what+where across all industries/locations, so it's the right source for
// arbitrary user queries; the broad remote/tech secondary feeds stay cron-only to keep
// search latency low and results location-relevant. Returns { jobs, upserted }.
export async function aggregateForQuery({
  query,
  location = '',
  relatedTerms = [],
  supabaseUrl,
  serviceKey,
  adzunaAppId,
  adzunaAppKey,
  maxTerms = 3,
}) {
  if (!adzunaAppId || !adzunaAppKey || !supabaseUrl || !serviceKey) return { jobs: [], upserted: 0 };
  const canon = String(query || '').toLowerCase().trim();
  if (!canon) return { jobs: [], upserted: 0 };

  // Canonical query first, then a few expansion terms — deduped, capped for latency.
  const terms = [];
  const seenTerm = new Set();
  for (const t of [canon, ...(Array.isArray(relatedTerms) ? relatedTerms : [])]) {
    const s = String(t || '').toLowerCase().trim();
    if (s && !seenTerm.has(s)) { seenTerm.add(s); terms.push(s); }
    if (terms.length >= maxTerms) break;
  }

  // Live Adzuna fetch per term at the searched location (bounded concurrency).
  const arrays = await mapLimit(terms, 3, async t => {
    const jobs = await fetchAdzuna(t, location, adzunaAppId, adzunaAppKey);
    // Stamp the canonical search key so these listings surface for this query later.
    return jobs.map(j => ({ ...j, search_query: canon }));
  });

  // Dedup by title|company|location.
  const seen = new Set();
  const deduped = [];
  for (const arr of arrays) {
    for (const j of (arr || [])) {
      if (!j) continue;
      const key = `${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}|${(j.location || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(j);
    }
  }
  if (!deduped.length) return { jobs: [], upserted: 0 };

  // Persist: creates any missing companies + upserts jobs (merge-duplicates).
  const { upserted } = await upsertJobs(deduped, supabaseUrl, serviceKey);
  return { jobs: deduped, upserted };
}
