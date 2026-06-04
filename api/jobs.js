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

    // Expand abbreviations and normalize for consistent cache keys
    // e.g. "Amazon DSP" → "amazon delivery driver", "RN" → "registered nurse"
    const qNorm = normalizeQuery(query);

    // ── Server-side DB cache check (3 tiers) ─────────────────────────────────
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const now = encodeURIComponent(new Date().toISOString());
        let cached = [], hitTier = 0;

        // Tier 1: exact normalized search_query match
        const t1 = await fetch(`${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.${encodeURIComponent(qNorm)}&expires_at=gt.${now}&limit=25`, { headers: dbHeaders });
        if (t1.ok) { cached = await t1.json(); if (cached.length >= 3) hitTier = 1; }

        // Tier 2: normalized query is a substring of a stored search_query
        // e.g. "nurse" hits "registered nurse"
        if (cached.length < 3) {
          const t2 = await fetch(`${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.*${encodeURIComponent(qNorm)}*&expires_at=gt.${now}&limit=25`, { headers: dbHeaders });
          if (t2.ok) { const r = await t2.json(); if (r.length > cached.length) { cached = r; if (cached.length >= 3) hitTier = 2; } }
        }

        // Tier 3: company + role keyword matching across the right fields
        // "amazon" alone → company field (all Amazon jobs regardless of role)
        // "delivery driver" → title field (all delivery drivers from every company)
        // "amazon delivery driver" → company=amazon + title contains delivery+driver
        if (cached.length < 3) {
          const t3filter = buildTier3Filter(qNorm);
          if (t3filter) {
            const t3 = await fetch(`${SUPABASE_URL}/rest/v1/jobs?${t3filter}&expires_at=gt.${now}&limit=25`, { headers: dbHeaders });
            if (t3.ok) { const r = await t3.json(); if (Array.isArray(r) && r.length >= 3) { cached = r; hitTier = 3; } }
          }
        }

        if (cached?.length >= 3) {
          console.log(`CACHE HIT tier=${hitTier}: "${query}" → "${qNorm}" @ "${loc}" — ${cached.length} results`);
          const jobs = cached.map(j => ({
            title: j.title, company: j.company, location: j.location || loc,
            salary: j.salary, url: j.apply_url, description: j.description,
            type: j.type || 'Full-time', level: j.level || 'Mid level',
            source: j.source || 'Seen', score: j.score || 65, waste_score: j.waste_score || 25,
          }));
          return res.status(200).json({ ok: true, jobs, query, location: loc, _src: 'cache' });
        }
      } catch(e) { console.warn('Cache check error:', e.message); }
      console.log(`CACHE MISS: "${query}" → "${qNorm}" @ "${loc}" — calling Claude API`);
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

// Expand common abbreviations to their canonical job title form so
// "Amazon DSP", "Amazon driver", and "Amazon delivery driver" all map
// to the same normalized key and hit the same cache bucket.
function normalizeQuery(q) {
  const ABBREV = {
    'dsp':  'delivery driver',
    'rn':   'registered nurse',
    'lpn':  'licensed practical nurse',
    'lvn':  'licensed vocational nurse',
    'cna':  'certified nursing assistant',
    'cna\'s': 'certified nursing assistant',
    'swe':  'software engineer',
    'pm':   'product manager',
    'qa':   'quality assurance engineer',
    'hr':   'human resources',
    'cdl':  'commercial truck driver',
    'ux':   'ux designer',
    'ui':   'ui designer',
    'ml':   'machine learning engineer',
    'hvac': 'hvac technician',
    'cpa':  'accountant',
    'pt':   'physical therapist',
    'ot':   'occupational therapist',
    'np':   'nurse practitioner',
    'pa':   'physician assistant',
    'med':  'medical',
  };
  let n = q.toLowerCase().trim();
  for (const [abbr, full] of Object.entries(ABBREV)) {
    n = n.replace(new RegExp(`\\b${abbr}\\b`, 'gi'), full);
  }
  return n.replace(/\s+/g, ' ').trim();
}

// Known company names — keywords matching these search the `company` column
// so "amazon" alone returns all Amazon jobs, not just ones with "amazon" in the title.
const COMPANIES = new Set([
  'amazon','walmart','target','costco','kroger','cvs','walgreens','dollar',
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

// Build a PostgREST filter for tier-3 cache lookup.
// Company keywords → filter on `company` field; everything else → filter on `title`.
// Single condition uses a direct filter; multiple conditions use and=().
function buildTier3Filter(q) {
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
    // Simple single-column filter: e.g. company=ilike.*amazon*
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
