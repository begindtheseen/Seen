// Automatic company scoring: Claude web-searches Reddit, Glassdoor, Blind
// for real hiring data → computes scores → caches in company_scores table (30 days)
// Priority hierarchy when serving scores:
//   1. Community reports ≥3  (real users, most accurate)
//   2. This web-research cache (Claude searched real posts)
//   3. Job listing averages   (rough signal only)

const SCORE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function calcScore(rr, gr, wait, cnt) {
  return Math.max(0, Math.min(100, Math.round(
    50 + (rr * 40) + (gr * -30) + (Math.min(wait / 60, 1) * -15) + (Math.log(cnt + 1) * 5)
  )));
}

function calcWaste(ghostRate, avgRounds, unpaidRate) {
  return Math.max(0, Math.min(100, Math.round(
    ghostRate * 60 + unpaidRate * 25 + (avgRounds > 4 ? 15 : 0)
  )));
}

function rowToScore(row) {
  const s = row.overall_score;
  let reviews = [];
  if (row.web_reviews) {
    try { reviews = typeof row.web_reviews === 'string' ? JSON.parse(row.web_reviews) : row.web_reviews; } catch(_e) {}
  }
  return {
    overall_score: s,
    ghost_rate: row.ghost_rate,
    response_rate: row.response_rate,
    avg_wait_days: row.avg_wait_days,
    avg_rounds: row.avg_rounds,
    waste: row.waste_score,
    unpaid_rate: row.unpaid_rate,
    report_count: row.report_count || 0,
    data_quality: row.data_quality || 'medium',
    data_source: 'web_research',
    risk_level: s >= 70 ? 'safe' : s >= 40 ? 'warn' : 'danger',
    industry: row.industry || '',
    summary: row.raw_summary || '',
    process_score: s,
    web_reviews: reviews,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
  body = body || {};

  // ── Research mode (replaces research.js) ─────────────────────────────────────
  if (body.action === 'research') {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY missing' });
    const { company: co, location } = body;
    if (!co) return res.status(400).json({ error: 'company required' });
    const locationStr = location ? ` in ${location}` : '';
    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `You are a hiring transparency researcher. Search Reddit (r/jobs, r/recruitinghell, r/cscareerquestions), Glassdoor, and news for real hiring data. Return ONLY valid JSON, no markdown.`,
          messages: [{ role: 'user', content: `Research hiring practices for: ${co}${locationStr}. Return ONLY this JSON: {"summary":"2-3 sentences","ghost_rate_estimate":0-100 or null,"response_rate_estimate":0-100 or null,"avg_rounds_estimate":number or null,"known_issues":["up to 5 real complaints"],"known_positives":["up to 3 positives"],"process_notes":"string or null","data_confidence":"high|medium|low","sources_note":"string","reddit_mentions":number,"glassdoor_rating":number or null}` }],
        })
      });
      if (!apiRes.ok) throw new Error(`Claude ${apiRes.status}`);
      const d = await apiRes.json();
      const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      const clean = txt.replace(/```json|```/g, '').trim();
      let parsed; try { parsed = JSON.parse(clean); } catch(e) { const m = clean.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed', summary: 'Could not parse results.', data_confidence: 'low', known_issues: [], known_positives: [], sources_note: 'Search completed.' }; }
      return res.json(parsed);
    } catch(err) { return res.status(500).json({ error: err.message }); }
  }

  // ── Populate mode: bulk-generate reviews for companies missing them ─────────
  if (body.action === 'populate' || req.method === 'GET') {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY)
      return res.status(500).json({ error: 'Missing env vars' });

    const dbH = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Find companies missing web_reviews — newest row per company wins
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/company_scores?select=company_name,web_reviews&order=created_at.desc&limit=200`,
      { headers: dbH }
    );
    if (!listRes.ok) return res.status(502).json({ error: 'DB list failed', detail: await listRes.text() });
    const rows = await listRes.json();
    // Deduplicate: first occurrence per company_name is the newest (desc order)
    const seen = new Set();
    const deduped = (rows || []).filter(r => { if (!r.company_name || seen.has(r.company_name)) return false; seen.add(r.company_name); return true; });
    const targets = deduped.filter(r => {
      if (!r.web_reviews) return true;
      try { const v = typeof r.web_reviews === 'string' ? JSON.parse(r.web_reviews) : r.web_reviews; return !Array.isArray(v) || v.length === 0; } catch(_e) { return true; }
    }).map(r => r.company_name).filter(Boolean);

    if (!targets.length) return res.json({ ok: true, message: 'All done — every company has reviews!', remaining: 0 });

    const batch = targets.slice(0, 3);
    const remaining = targets.length - batch.length;
    const results = [];

    for (const co of batch) {
      try {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', max_tokens: 2000,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            system: 'You are a hiring transparency researcher. Search Reddit, Glassdoor, and Blind for real applicant experiences. Return ONLY valid JSON — no markdown.',
            messages: [{ role: 'user', content: `Research hiring experience at "${co}". Find 4-6 real applicant quotes from Reddit/Glassdoor/Blind (2023-2025). Return ONLY this JSON: {"ghost_rate":0.0-1.0,"response_rate":0.0-1.0,"avg_rounds":1-8,"avg_wait_days":5-120,"unpaid_rate":0.0-1.0,"report_count":number,"data_quality":"high|medium|low","industry":"string","summary":"2-3 sentences","reviews":[{"text":"quote","sentiment":"positive|negative|mixed","source":"Reddit r/...","year":"2024"}]}` }],
          })
        });
        if (!apiRes.ok) throw new Error(`Claude ${apiRes.status}`);
        const d = await apiRes.json();
        const txt = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        const m = txt.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim().match(/\{[\s\S]*\}/);
        if (!m) throw new Error('no JSON');
        const p = JSON.parse(m[0]);

        const gr = Math.max(0,Math.min(1,Number(p.ghost_rate)||0));
        const rr = Math.max(0,Math.min(1,Number(p.response_rate)||0));
        const wait = Math.max(1,Math.min(180,Number(p.avg_wait_days)||30));
        const rounds = Math.max(1,Math.min(10,Number(p.avg_rounds)||3));
        const unpaid = Math.max(0,Math.min(1,Number(p.unpaid_rate)||0));
        const cnt = Math.max(1,Number(p.report_count)||5);
        const overall = calcScore(rr,gr,wait,cnt);
        const waste = calcWaste(gr,rounds,unpaid);
        const revs = Array.isArray(p.reviews) ? p.reviews.slice(0,6).map(r=>({text:(r.text||'').slice(0,400),sentiment:['positive','negative','mixed'].includes(r.sentiment)?r.sentiment:'mixed',source:(r.source||'').slice(0,80),year:(r.year||'').slice(0,4)})) : [];

        const row = { company_name:co, overall_score:overall, ghost_rate:gr, response_rate:rr, avg_wait_days:Math.round(wait), avg_rounds:Math.round(rounds*10)/10, waste_score:waste, unpaid_rate:unpaid, report_count:cnt, data_quality:p.data_quality||'medium', data_source:'web_search', industry:(p.industry||'').slice(0,80), raw_summary:(p.summary||'').slice(0,500), expires_at:new Date(Date.now()+SCORE_TTL_MS).toISOString(), web_reviews:revs };
        const sv = await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, { method:'POST', headers:{...dbH,Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(row) });
        results.push({ company:co, score:overall, reviews:revs.length, saved:sv.ok });
        console.log(`POPULATE: "${co}" → ${overall}, ${revs.length} reviews, saved:${sv.ok}`);
      } catch(e) {
        // Mark as attempted with empty reviews so it stops blocking the queue
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, { method:'POST', headers:{...dbH,Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify({company_name:co, web_reviews:[]}) });
        } catch(_e) {}
        results.push({ company:co, error:e.message });
        console.error(`POPULATE: "${co}" failed:`, e.message);
      }
      if (batch.indexOf(co) < batch.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    return res.json({ ok:true, processed:results, remaining, message: remaining > 0 ? `Refresh to process next ${Math.min(3,remaining)}` : 'All done!' });
  }

  if (req.method !== 'POST') return res.status(405).end('Method not allowed');
  const { name, force_refresh = false } = body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY missing' });

  const dbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── 1. Check DB cache ─────────────────────────────────────────────────────
  if (!force_refresh && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const now = encodeURIComponent(new Date().toISOString());
      const nameEnc = encodeURIComponent(name.toLowerCase().trim());
      const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.${nameEnc}&expires_at=gt.${now}&order=created_at.desc&limit=1`,
        { headers: dbHeaders }
      );
      if (cacheRes.ok) {
        const rows = await cacheRes.json();
        if (rows?.[0]) {
          console.log(`COMPANY SCORE CACHE HIT: "${name}"`);
          return res.json({ ok: true, score: rowToScore(rows[0]), _src: 'cache' });
        }
      }
    } catch(e) { console.warn('Cache check:', e.message); }
  }

  // ── 2. Research with Claude + web search ──────────────────────────────────
  console.log(`COMPANY SCORE RESEARCH: "${name}"`);

  const systemPrompt = `You are a hiring transparency researcher. Search Reddit (r/recruitinghell, r/jobs, r/cscareerquestions), Glassdoor interview reviews, Blind (teamblind.com), and LinkedIn for real applicant experiences at the company.
Focus on posts from 2023-2025. Count how many posts mention ghosting vs getting responses.
Return ONLY a valid JSON object — no markdown, no explanation.`;

  const userPrompt = `Research the hiring process and applicant experience at "${name}".

Search for: ghosting complaints, interview timelines, number of rounds, unpaid take-home tests, and overall process reputation.

Count the evidence: how many posts report ghosting vs getting a human response?

Also find 4-6 specific quotes or close paraphrases from real applicants on Reddit, Glassdoor, or Blind. Include a mix of positive and negative if they exist. Each review should be a real person's direct experience — not a summary.

Return ONLY this JSON:
{
  "ghost_rate": 0.0-1.0,
  "response_rate": 0.0-1.0,
  "avg_rounds": 1-8,
  "avg_wait_days": 5-120,
  "unpaid_rate": 0.0-1.0,
  "report_count": number_of_community_posts_found,
  "data_quality": "high" or "medium" or "low",
  "industry": "e.g. E-Commerce, Fintech, Consulting",
  "summary": "2-3 sentences describing what applicants actually experience at this company",
  "reviews": [
    {
      "text": "exact quote or close paraphrase from a real post",
      "sentiment": "positive" or "negative" or "mixed",
      "source": "Reddit r/recruitinghell" or "Glassdoor" or "Blind" etc,
      "year": "2024"
    }
  ]
}`;

  let apiRes;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 4000));
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
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })
    });
    if (apiRes.status !== 429 && apiRes.status !== 529) break;
  }

  if (!apiRes.ok) {
    const err = await apiRes.text();
    return res.status(502).json({ error: 'Claude API error', detail: err.slice(0, 150) });
  }

  const data = await apiRes.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

  let parsed;
  try {
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON found');
    parsed = JSON.parse(match[0]);
  } catch(e) {
    console.error('Parse error for', name, ':', e.message, '| raw:', text.slice(0, 200));
    return res.status(502).json({ error: 'Could not parse response', raw: text.slice(0, 200) });
  }

  // ── 3. Compute scores using same formula as frontend ──────────────────────
  const gr     = Math.max(0, Math.min(1,   Number(parsed.ghost_rate)    || 0));
  const rr     = Math.max(0, Math.min(1,   Number(parsed.response_rate) || 0));
  const wait   = Math.max(1, Math.min(180, Number(parsed.avg_wait_days) || 30));
  const rounds = Math.max(1, Math.min(10,  Number(parsed.avg_rounds)    || 3));
  const unpaid = Math.max(0, Math.min(1,   Number(parsed.unpaid_rate)   || 0));
  const cnt    = Math.max(1,               Number(parsed.report_count)  || 5);
  const overall = calcScore(rr, gr, wait, cnt);
  const waste   = calcWaste(gr, rounds, unpaid);

  const reviews = Array.isArray(parsed.reviews) ? parsed.reviews.slice(0, 6).map(r => ({
    text: (r.text || '').slice(0, 400),
    sentiment: ['positive','negative','mixed'].includes(r.sentiment) ? r.sentiment : 'mixed',
    source: (r.source || '').slice(0, 80),
    year: (r.year || '').slice(0, 4),
  })) : [];

  const score = {
    overall_score: overall,
    ghost_rate: gr,
    response_rate: rr,
    avg_wait_days: Math.round(wait),
    avg_rounds: Math.round(rounds * 10) / 10,
    waste,
    unpaid_rate: unpaid,
    report_count: cnt,
    data_quality: parsed.data_quality || 'medium',
    data_source: 'web_research',
    risk_level: overall >= 70 ? 'safe' : overall >= 40 ? 'warn' : 'danger',
    industry: (parsed.industry || '').slice(0, 80),
    summary: (parsed.summary || '').slice(0, 500),
    process_score: overall,
    web_reviews: reviews,
  };

  console.log(`COMPANY SCORE COMPUTED: "${name}" → ${overall} (ghost:${Math.round(gr*100)}%, resp:${Math.round(rr*100)}%)`);

  // ── 4. Cache in DB ────────────────────────────────────────────────────────
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const expires = new Date(Date.now() + SCORE_TTL_MS).toISOString();
    const rowBase = {
      company_name: name.toLowerCase().trim(),
      overall_score: overall,
      ghost_rate: gr,
      response_rate: rr,
      avg_wait_days: Math.round(wait),
      avg_rounds: Math.round(rounds * 10) / 10,
      waste_score: waste,
      unpaid_rate: unpaid,
      report_count: cnt,
      data_quality: score.data_quality,
      data_source: 'web_search',
      industry: score.industry,
      raw_summary: score.summary,
      expires_at: expires,
    };
    try {
      // Try with web_reviews column; fall back without it if column doesn't exist yet
      // Use merge-duplicates so force_refresh actually updates existing cached rows
      const prefer = force_refresh ? 'resolution=merge-duplicates,return=minimal' : 'resolution=ignore-duplicates,return=minimal';
      let saveRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, {
        method: 'POST',
        headers: { ...dbHeaders, Prefer: prefer },
        body: JSON.stringify({ ...rowBase, web_reviews: reviews }),
      });
      if (!saveRes.ok && saveRes.status === 400) {
        const errText = await saveRes.text();
        if (errText.includes('web_reviews') || errText.includes('column')) {
          console.warn('COMPANY SCORE: web_reviews column missing, retrying without it');
          saveRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, {
            method: 'POST',
            headers: { ...dbHeaders, Prefer: prefer },
            body: JSON.stringify(rowBase),
          });
        }
      }
      if (saveRes.ok) console.log(`COMPANY SCORE SAVED: "${name}"`);
      else console.error('Save failed:', await saveRes.text());
    } catch(e) { console.error('Save error:', e.message); }
  }

  return res.json({ ok: true, score, _src: 'fresh' });
}
