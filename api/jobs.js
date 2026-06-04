export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

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
      ? `Find open ${query} jobs within ${radiusMiles} miles of ${loc}. Search LinkedIn, Indeed, Greenhouse, Lever, Workday. Do multiple searches. Return at least 8 results. If not enough nearby, include remote options.`
      : `Find open ${query} jobs in the US or remote. Search LinkedIn, Indeed, Greenhouse, Lever. Return at least 8 results.`;

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured', jobs: [] });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const dbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    const qNorm = query.toLowerCase().trim();

    // canonical stays in outer scope so the save section can use it
    let canonical = qNorm;

    // ── Smart DB cache check ──────────────────────────────────────────────────
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        // Get canonical + related terms via expansion cache or Haiku
        const expansion = await getQueryExpansion(qNorm, SUPABASE_URL, dbHeaders, ANTHROPIC_KEY);
        canonical = expansion.canonical;
        const searchTerms = [canonical, ...expansion.related].filter(Boolean);

        const now = encodeURIComponent(new Date().toISOString());
        let cached = [], hitTerm = '';

        // Search the DB for each expansion term
        for (const term of searchTerms) {
          if (cached.length >= 3) break;
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/jobs?search_query=ilike.${encodeURIComponent(term)}&expires_at=gt.${now}&limit=25`,
            { headers: dbHeaders }
          );
          if (r.ok) {
            const rows = await r.json();
            if (Array.isArray(rows) && rows.length > cached.length) { cached = rows; hitTerm = term; }
          }
        }

        // Final fallback: keyword match across title + company fields
        if (cached.length < 3) {
          const t3filter = buildFallbackFilter(qNorm);
          if (t3filter) {
            const t3 = await fetch(`${SUPABASE_URL}/rest/v1/jobs?${t3filter}&expires_at=gt.${now}&limit=25`, { headers: dbHeaders });
            if (t3.ok) {
              const rows = await t3.json();
              if (Array.isArray(rows) && rows.length >= 3) { cached = rows; hitTerm = 'keyword-fallback'; }
            }
          }
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

    // Save under the canonical key so all equivalent queries hit this cache
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
          headers: { ...dbHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(rows),
        });
        if (saveRes.ok) {
          console.log(`CACHE SAVED: "${canonical}" @ "${loc}" — ${jobs.length} jobs`);
        } else {
          const errText = await saveRes.text();
          console.error(`CACHE SAVE FAILED: ${saveRes.status}`, errText.slice(0, 300));
        }
      } catch(e) { console.error('CACHE SAVE ERROR:', e.message); }
    }

    return res.status(200).json({ ok: true, jobs, query, location: loc });

  } catch(err) {
    console.error('Jobs error:', err.message);
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}

// ── Query expansion ───────────────────────────────────────────────────────────
// Returns canonical job title + related search terms for any query.
// Checks the query_expansions DB table first (free), falls back to a Haiku call
// (~$0.00001) which is then cached so the same reasoning never runs twice.
async function getQueryExpansion(qNorm, supabaseUrl, dbHeaders, anthropicKey) {
  const fallback = { canonical: qNorm, related: [] };

  // Check expansion cache
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/query_expansions?raw_query=ilike.${encodeURIComponent(qNorm)}&limit=1`,
      { headers: dbHeaders }
    );
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length > 0) {
        return { canonical: rows[0].canonical, related: rows[0].related || [] };
      }
    }
  } catch(e) {}

  if (!anthropicKey) return fallback;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Job search expert. Given a job search query, return its canonical form and related search terms that describe the SAME kind of work.

Return ONLY valid JSON: {"canonical":"...","related":["...","...","..."]}

Rules:
- canonical: the single most standard industry job title (lowercase, 1-6 words)
- related: 4-6 other terms a job seeker or recruiter uses for this SAME type of job
- Keep company specificity: "amazon dsp" → "amazon delivery driver", not just "delivery driver"
- Keep role specificity: "package handler" and "delivery driver" are DIFFERENT jobs — do not conflate them
- Company-only queries like "amazon" → canonical="amazon", related=["amazon warehouse", "amazon delivery driver", "amazon flex", "amazon fulfillment associate"]
- Abbreviations: DSP=delivery service partner=delivery driver, RN=registered nurse, CNA=nursing assistant, SWE=software engineer, CDL=truck driver, HVAC=hvac technician, etc.

Query: "${qNorm}"`
        }]
      })
    });

    if (!r.ok) return fallback;
    const apiData = await r.json();
    const text = (apiData.content || []).find(b => b.type === 'text')?.text || '';
    const match = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').match(/\{[\s\S]*?\}/);
    if (!match) return fallback;

    const parsed = JSON.parse(match[0]);
    const canonical = (parsed.canonical || qNorm).toLowerCase().trim();
    const related = (parsed.related || []).slice(0, 6).map(s => String(s).toLowerCase().trim()).filter(Boolean);

    // Cache forever — fire-and-forget is fine here since it's just a lookup cache
    fetch(`${supabaseUrl}/rest/v1/query_expansions`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ raw_query: qNorm, canonical, related }),
    }).catch(() => {});

    return { canonical, related };
  } catch(e) {
    return fallback;
  }
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
