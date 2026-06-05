// One-shot batch populate: fetches company names from company_scores that are
// missing web_reviews, then runs Claude web-search for each.
// Call repeatedly until done — processes up to 3 per invocation (Vercel 60s limit).
// Requires: ALTER TABLE company_scores ADD COLUMN IF NOT EXISTS web_reviews JSONB DEFAULT '[]'::jsonb;

const SCORE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

async function researchCompany(name, ANTHROPIC_KEY) {
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

  if (!apiRes.ok) throw new Error(`Claude API ${apiRes.status}: ${(await apiRes.text()).slice(0, 100)}`);

  const data = await apiRes.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in response');
  return JSON.parse(match[0]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  if (!ANTHROPIC_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  let body = req.body || {};
  if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }

  const dbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── 1. Find companies that need reviews ────────────────────────────────────
  // If a specific company is requested, just do that one
  let targets = [];
  if (body.company) {
    targets = [body.company];
  } else {
    // Fetch all company_scores rows — find those with null/empty web_reviews
    try {
      const listRes = await fetch(
        `${SUPABASE_URL}/rest/v1/company_scores?select=company_name,web_reviews&order=created_at.asc&limit=200`,
        { headers: dbHeaders }
      );
      if (!listRes.ok) return res.status(502).json({ error: 'Could not fetch company list', detail: await listRes.text() });
      const rows = await listRes.json();
      targets = (rows || [])
        .filter(r => {
          if (!r.web_reviews) return true;
          try {
            const v = typeof r.web_reviews === 'string' ? JSON.parse(r.web_reviews) : r.web_reviews;
            return !Array.isArray(v) || v.length === 0;
          } catch(_e) { return true; }
        })
        .map(r => r.company_name)
        .filter(Boolean);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (!targets.length) {
    return res.json({ ok: true, message: 'All companies already have reviews', processed: [], remaining: 0 });
  }

  // Process up to 3 per invocation to stay within Vercel timeout
  const BATCH = Math.min(3, targets.length);
  const batch = targets.slice(0, BATCH);
  const remaining = targets.length - BATCH;

  const results = [];

  for (const companyName of batch) {
    console.log(`POPULATE REVIEWS: researching "${companyName}"`);
    try {
      const parsed = await researchCompany(companyName, ANTHROPIC_KEY);

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

      const expires = new Date(Date.now() + SCORE_TTL_MS).toISOString();
      const row = {
        company_name: companyName,
        overall_score: overall,
        ghost_rate: gr,
        response_rate: rr,
        avg_wait_days: Math.round(wait),
        avg_rounds: Math.round(rounds * 10) / 10,
        waste_score: waste,
        unpaid_rate: unpaid,
        report_count: cnt,
        data_quality: parsed.data_quality || 'medium',
        data_source: 'web_search',
        industry: (parsed.industry || '').slice(0, 80),
        raw_summary: (parsed.summary || '').slice(0, 500),
        expires_at: expires,
        web_reviews: reviews,
      };

      // UPSERT: update existing row or insert new
      let saveRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, {
        method: 'POST',
        headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      });
      if (!saveRes.ok && saveRes.status === 400) {
        const errText = await saveRes.text();
        if (errText.includes('web_reviews') || errText.includes('column')) {
          console.warn('web_reviews column missing, retrying without it');
          delete row.web_reviews;
          saveRes = await fetch(`${SUPABASE_URL}/rest/v1/company_scores`, {
            method: 'POST',
            headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(row),
          });
        }
      }

      const saved = saveRes.ok;
      console.log(`POPULATE REVIEWS: "${companyName}" → score:${overall}, reviews:${reviews.length}, saved:${saved}`);
      results.push({ company: companyName, score: overall, reviews: reviews.length, saved });
    } catch(e) {
      console.error(`POPULATE REVIEWS: "${companyName}" failed:`, e.message);
      results.push({ company: companyName, error: e.message });
    }

    // Small pause between Claude calls to avoid rate limits
    if (batch.indexOf(companyName) < batch.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return res.json({
    ok: true,
    processed: results,
    remaining,
    message: remaining > 0 ? `Call again to process next ${Math.min(3, remaining)} companies` : 'All done!',
  });
}
