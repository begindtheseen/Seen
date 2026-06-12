import { getQueryExpansion } from '../lib/server/expand.js';
import { applyRateLimit, rateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';

// Per-instance request coalescing: concurrent identical searches share one Claude call
const _inflight = new Map();

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  // Parse body early so we can route before rate limiting
  let _body = req.body;
  if (typeof _body === 'string') { try { _body = JSON.parse(_body); } catch(e) { _body = {}; } }
  if (!_body || typeof _body !== 'object') _body = {};

  // ── Location-jobs: merged from api/fetch-location-jobs.js ──────────────────
  if (_body.action === 'location' || (_body.location && !_body.query)) {
    const { allowed: rlOk } = await rateLimit(req, 'fetch-location-jobs');
    if (!rlOk) return res.status(429).json({ error: 'Too many requests — slow down.', jobs: [] });
    return handleLocationJobs(req, res, _body);
  }

  const limited = await applyRateLimit(req, res, 'job-search');
  if (limited) return;

  // Declare catch-block variables in outer scope so the catch handler can access them
  let safeQuery = '';
  let loc = '';
  let inflightKey = '';
  let _inflightResolve, _inflightReject;

  try {
    let body = _body;
    const { query, location, radius } = body;
    if (!query) return res.status(400).json({ error: 'No query' });

    const rawQuery = String(query).trim().slice(0, 200);
    if (!rawQuery) return res.status(400).json({ error: 'No query' });
    // Strip characters that could abuse prompt injection
    safeQuery = rawQuery.replace(/[<>`\\]/g, '').trim();

    loc = (location || '').trim();
    const radiusMiles = radius || 25;

    const systemPrompt = [
      'You are a job search assistant. Search for open job listings using web search.',
      'Search multiple times if needed. Always return at least 8 results.',
      'If the exact city has few results, include nearby cities or remote options.',
      'Return ONLY a valid JSON array with no markdown, no explanation:',
      '[{"title":"...","company":"...","location":"City, State","salary":"$Xk-$Yk or null","url":"apply URL","description":"3-5 sentences describing the role, key responsibilities, and requirements","type":"Full-time","level":"Mid level","source":"LinkedIn/Indeed/etc"}]'
    ].join('\n');

    const userPrompt = loc
      ? `Find open ${safeQuery} jobs within ${radiusMiles} miles of ${loc}. Search LinkedIn, Indeed, Greenhouse, Lever, Workday. Do multiple searches. Return at least 8 results. If not enough nearby, include remote options.`
      : `Find open ${safeQuery} jobs in the US or remote. Search LinkedIn, Indeed, Greenhouse, Lever. Return at least 8 results.`;

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured', jobs: [] });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const dbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    const qNorm = safeQuery.toLowerCase();

    // canonical stays in outer scope so the save section can use it
    let canonical = qNorm;

    // ── Smart DB cache check (parallel) ──────────────────────────────────────
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const now = encodeURIComponent(new Date().toISOString());
        const t3filter = buildFallbackFilter(qNorm);

        // Run expansion lookup AND keyword fallback in parallel — no serial waiting
        const [expansion, kwRows] = await Promise.all([
          getQueryExpansion(qNorm, SUPABASE_URL, dbHeaders, ANTHROPIC_KEY),
          t3filter
            ? fetch(`${SUPABASE_URL}/rest/v1/jobs?${t3filter}&expires_at=gt.${now}&limit=25`, { headers: dbHeaders })
                .then(r => r.ok ? r.json() : []).catch(() => [])
            : Promise.resolve([]),
        ]);

        canonical = expansion.canonical;
        const searchTerms = [canonical, ...expansion.related].filter(Boolean);

        // Run ALL expansion-term DB lookups in parallel
        const termRows = await Promise.all(
          searchTerms.map(term =>
            fetch(`${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.${encodeURIComponent(term)}&expires_at=gt.${now}&limit=25`, { headers: dbHeaders })
              .then(r => r.ok ? r.json() : []).catch(() => [])
          )
        );

        // Pick best result: expansion terms first (most specific), then keyword fallback
        let cached = [], hitTerm = '';
        for (let i = 0; i < termRows.length; i++) {
          if (Array.isArray(termRows[i]) && termRows[i].length > cached.length) {
            cached = termRows[i]; hitTerm = searchTerms[i];
          }
        }
        if (cached.length < 3 && Array.isArray(kwRows) && kwRows.length >= 3) {
          cached = kwRows; hitTerm = 'keyword-fallback';
        }

        if (cached.length >= 3) {
          console.log(`CACHE HIT: "${query}" → "${canonical}" (matched "${hitTerm}") @ "${loc}" — ${cached.length} results`);
          const jobs = cached.map(j => ({
            title: j.title, company: j.company, location: j.location || loc,
            salary: j.salary, url: j.apply_url, description: j.description,
            type: j.type || 'Full-time', level: j.level || 'Mid level',
            source: j.source || 'Seen', score: j.score || 65, waste_score: j.waste_score || 25,
          }));
          return res.status(200).json({ ok: true, jobs, query, location: loc, _src: 'cache' });
        }
      } catch(e) { console.warn('Cache check error:', e.message); }
      console.log(`CACHE MISS: "${query}" → "${canonical}" @ "${loc}" — calling Claude API`);
    }

    // Coalesce concurrent identical searches into one Claude API call
    inflightKey = `${canonical}::${loc}`;
    if (_inflight.has(inflightKey)) {
      console.log(`COALESCED: "${canonical}" @ "${loc}" — waiting on in-flight request`);
      try {
        const coalesced = await _inflight.get(inflightKey);
        return res.status(200).json({ ok: true, ...coalesced, _src: 'coalesced' });
      } catch(e) { /* fall through to make our own call */ }
    }

    const inflightPromise = new Promise((resolve, reject) => { _inflightResolve = resolve; _inflightReject = reject; });
    _inflight.set(inflightKey, inflightPromise);
    setTimeout(() => _inflight.delete(inflightKey), 90_000);

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
    console.log(`API CALLED: "${query}" → "${canonical}" @ "${loc}"`);

    if (!apiRes.ok) {
      // Rate limited — try serving stale (expired) cache before failing
      if ((apiRes.status === 429 || apiRes.status === 529) && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const searchTerms = [canonical, ...(await (async () => {
          try {
            const exp = await fetch(`${SUPABASE_URL}/rest/v1/query_expansions?raw_query=ilike.${encodeURIComponent(canonical)}&limit=1`, { headers: dbHeaders });
            if (exp.ok) { const rows = await exp.json(); return rows[0]?.related || []; }
          } catch(e) {}
          return [];
        })())].filter(Boolean);
        for (const term of searchTerms) {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.${encodeURIComponent(term)}&limit=25`, { headers: dbHeaders });
          if (r.ok) {
            const rows = await r.json();
            if (Array.isArray(rows) && rows.length >= 3) {
              console.log(`STALE CACHE FALLBACK: "${query}" → "${term}" — ${rows.length} results`);
              const jobs = rows.map(j => ({
                title: j.title, company: j.company, location: j.location || loc,
                salary: j.salary, url: j.apply_url, description: j.description,
                type: j.type || 'Full-time', level: j.level || 'Mid level',
                source: j.source || 'Seen', score: j.score || 65, waste_score: j.waste_score || 25,
              }));
              return res.status(200).json({ ok: true, jobs, query, location: loc, _src: 'stale-cache' });
            }
          }
        }
      }
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

    // Save under the canonical key so all equivalent queries hit this cache.
    // merge-duplicates: re-searched jobs get expires_at refreshed (not just ignored).
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
        search_query: canonical,
        score: j.score || 65,
        waste_score: j.waste_score || 25,
        expires_at: expires,
      }));
      try {
        const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
          method: 'POST',
          headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows),
        });
        if (saveRes.ok) {
          console.log(`CACHE SAVED: "${canonical}" @ "${loc}" — ${jobs.length} jobs`);
        } else {
          const errText = await saveRes.text();
          console.error(`CACHE SAVE FAILED: ${saveRes.status}`, errText.slice(0, 300));
        }
      } catch(e) { console.error('CACHE SAVE ERROR:', e.message); }

      // Log every search that hits the API (cache miss → real fetch)
      _logSearch(canonical, loc, jobs.length, SUPABASE_URL, dbHeaders);
    }

    _inflightResolve?.({ jobs, query, location: loc });
    _inflight.delete(inflightKey);
    return res.status(200).json({ ok: true, jobs, query, location: loc });

  } catch(err) {
    console.error('Jobs error:', err.message);
    logError('jobs', err.message, { query: safeQuery, loc });
    _inflightReject?.(err);
    _inflight.delete(inflightKey);
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}

// Fire-and-forget search log — if search_logs table doesn't exist yet, fails silently
function _logSearch(query, location, resultCount, supabaseUrl, headers) {
  fetch(`${supabaseUrl}/rest/v1/search_logs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ query, location: location || '', result_count: resultCount, source: 'api' }),
  }).catch(() => {});
}

// ── Keyword fallback filter ───────────────────────────────────────────────────
// Last-resort DB filter when no expansion term produced results.
// Routes known company names to the company column, everything else to title.
const COMPANIES = new Set([
  'amazon','walmart','target','costco','kroger','cvs','walgreens',
  'ups','fedex','usps','dhl',
  'google','apple','microsoft','meta','netflix','tesla','uber','lyft',
  'doordash','instacart','airbnb','stripe','shopify','salesforce','oracle',
  'ibm','cisco','intel','nvidia',
  'mcdonalds','starbucks','chipotle','dominos',
  'disney','nike','ford','gm','boeing','lockheed',
  'jpmorgan','chase','bankofamerica','wellsfargo','citigroup',
  'pfizer','johnson','unitedhealth','humana','merck','abbvie',
  'deloitte','accenture','kpmg',
]);

function buildFallbackFilter(q) {
  const STOP = new Set([
    'and','or','the','a','an','in','at','for','with','of','to','by','is','are',
    'job','jobs','position','positions','role','roles','work','near','remote',
    'hiring','wanted','open','full','part','time','entry','level',
  ]);
  const words = q.split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 1 && !STOP.has(w))
    .slice(0, 4);

  if (!words.length) return null;

  const conditions = words.map(w =>
    COMPANIES.has(w) ? `company.ilike.*${w}*` : `title.ilike.*${w}*`
  );

  if (conditions.length === 1) {
    const [col, op, val] = conditions[0].split('.');
    return `${col}=${op}.${val}`;
  }
  return `and=${encodeURIComponent(`(${conditions.join(',')})`)}`;
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

// ── handleLocationJobs: merged from api/fetch-location-jobs.js ────────────────
const _STATE_ABBR = {'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','District of Columbia':'DC'};

function _normalizeLoc(loc) {
  if (!loc) return loc;
  const parts = loc.split(',').map(p => p.trim());
  const abbr = _STATE_ABBR[parts[1] || ''] || (parts[1] || '');
  return abbr ? `${parts[0]}, ${abbr}` : parts[0];
}

const _CATS_BY_INDUSTRY = {
  tech: ['Software Engineer','Data Analyst','Product Manager','DevOps Engineer','UX Designer'],
  healthcare: ['Registered Nurse','Medical Assistant','Physical Therapist','LVN','CNA'],
  finance: ['Financial Analyst','Accountant','Business Analyst','Operations Manager','Project Manager'],
  logistics: ['Warehouse Associate','CDL Truck Driver','Operations Manager','Supply Chain Analyst','Logistics Coordinator'],
  retail: ['Customer Service Representative','Restaurant Manager','Retail Manager','Sales Representative','Store Manager'],
  other: ['Project Manager','Operations Manager','Customer Service Representative','Marketing Manager','HR Manager'],
  default: ['Customer Service Representative','Registered Nurse','Software Engineer','Sales Representative','Project Manager','Data Analyst','Accountant','Operations Manager'],
};

async function _fetchAdzuna(what, where, appId, appKey, distKm) {
  const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1');
  url.searchParams.set('app_id', appId); url.searchParams.set('app_key', appKey);
  url.searchParams.set('what', what); url.searchParams.set('results_per_page', '50'); url.searchParams.set('sort_by', 'date');
  if (where && where.toLowerCase() !== 'remote') { url.searchParams.set('where', where); if (distKm) url.searchParams.set('distance', distKm.toString()); }
  const ctrl = new AbortController(); const tmo = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(tmo); if (!res.ok) return [];
    const data = await res.json();
    const expires = new Date(Date.now() + 7*24*60*60*1000).toISOString();
    return (data.results||[]).map(j => ({ title:j.title||what, company:j.company?.display_name||'Unknown', location:j.location?.display_name||where, salary:j.salary_min||j.salary_max?(j.salary_min>=10000?`$${Math.round(j.salary_min/1000)}k`:j.salary_min>0?`$${j.salary_min}/hr`:null):null, description:(j.description||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,8000), apply_url:j.redirect_url||null, source:'Adzuna', type:j.contract_time==='part_time'?'Part-time':'Full-time', level:(/\b(senior|sr\b|lead|principal|staff|architect)\b/i.test(j.title||''))?'Senior':(/\b(junior|jr\b|entry.level|associate|intern)\b/i.test(j.title||''))?'Entry level':(/\b(director|vp\b|vice president|head of|chief)\b/i.test(j.title||''))?'Director+':'Mid level', search_query:what, score:65+(j.salary_min>0?8:0), waste_score:25, expires_at:expires })).filter(j=>j.company!=='Unknown'&&j.apply_url);
  } catch(e) { clearTimeout(tmo); return []; }
}

async function handleLocationJobs(req, res, body) {
  const APP_ID = process.env.ADZUNA_APP_ID, APP_KEY = process.env.ADZUNA_APP_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!APP_ID || !APP_KEY) return res.status(200).json({ error: 'Adzuna not configured', jobs: [] });
  try {
    const { location, industry, radius } = body;
    if (!location) return res.status(400).json({ error: 'No location', jobs: [] });
    const cats = _CATS_BY_INDUSTRY[industry] || _CATS_BY_INDUSTRY.default;
    const distKm = radius ? Math.round(parseInt(radius) * 1.609) : 40;
    const normLoc = _normalizeLoc(location), cityOnly = normLoc.split(',')[0].trim();
    let results = await Promise.allSettled(cats.slice(0,6).map(cat => _fetchAdzuna(cat, normLoc, APP_ID, APP_KEY, distKm)));
    let allJobs = results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
    if (!allJobs.length && cityOnly !== normLoc) {
      results = await Promise.allSettled(cats.slice(0,4).map(cat => _fetchAdzuna(cat, cityOnly, APP_ID, APP_KEY, distKm)));
      allJobs = results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
    }
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && allJobs.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/jobs`, { method:'POST', headers:{apikey:SUPABASE_SERVICE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(allJobs) });
    }
    return res.status(200).json({ ok:true, jobs:allJobs, location });
  } catch(err) {
    logError('fetch-location-jobs', err.message);
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}
