export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  try {
    // Defensively parse body — Vercel usually does this but guard for edge cases
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
    const { tool } = body;
    if (!tool) return res.status(400).json({ error: 'Missing tool parameter' });

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

    let prompt, systemPrompt;

    // Validate resume text is actually readable before sending to Claude
    if (body.resume !== undefined) {
      const r = body.resume || '';
      const words = (r.match(/[A-Za-z][A-Za-z\s]{2,}/g) || []).join('');
      const readable = words.length;
      // Require >55% readable content AND at least 80 chars of readable words
      if (r.length > 0 && (readable / r.length < 0.55 || readable < 80)) {
        return res.status(400).json({ error: 'RESUME_CORRUPTED' });
      }
    }

    if (tool === 'scanner') {
      const { job, company, resume, jobDescription } = body;
      if (!resume || !jobDescription) return res.status(400).json({ error: 'Resume and job description required' });
      systemPrompt = 'You are an ATS resume scanner. Analyze resume fit for a job and return ONLY valid JSON with no markdown.';
      prompt = `Analyze this resume against the job description. Return ONLY a JSON object:
{"match_score":<0-100>,"score_summary":"<2 sentences>","missing_keywords":["..."],"strong_keywords":["..."],"specific_fixes":[{"current":"<bullet>","improved":"<rewrite>"}],"ghost_risk_note":"<1 sentence>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,3000)}
RESUME:\n${(resume||'').slice(0,4000)}`;

    } else if (tool === 'optimize') {
      const { job, company, resume, jobDescription } = body;
      if (!resume) return res.status(400).json({ error: 'Resume required' });
      systemPrompt = 'You are a resume optimizer. Rewrite resume bullets to match job keywords and improve ATS score. Return ONLY valid JSON.';
      prompt = `Optimize this resume for the job. Return ONLY a JSON object:
{"optimized_bullets":[{"original":"<bullet>","optimized":"<rewrite with keywords>"}],"keywords_added":["..."]}

Find 3-6 bullets that most need improvement.

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,2000)}
RESUME:\n${(resume||'').slice(0,4000)}`;

    } else if (tool === 'coach') {
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      systemPrompt = 'You are a job application strategist. Return ONLY valid JSON.';
      prompt = `Create an application playbook. Return ONLY a JSON object:
{"hiring_manager_script":"<LinkedIn message>","timing_note":"<why apply fast>","company_intel":"<2-3 things about ${company}>","cover_letter_framework":"<3 paragraph framework>","referral_strategy":"<how to get referral>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,2500)}${background?'\nCANDIDATE:\n'+background.slice(0,1000):''}`;

    } else if (tool === 'proposal') {
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return res.status(400).json({ error: 'Job, company, and job description required' });
      systemPrompt = 'You are a career strategist. Return ONLY valid JSON.';
      prompt = `Write a 30/60/90 day plan. Return ONLY a JSON object:
{"day_30":"<30 day plan>","day_60":"<60 day plan>","day_90":"<90 day plan>","opening_note":"<1 sentence>"}

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,2500)}${background?'\nCANDIDATE:\n'+background.slice(0,1000):''}`;

    } else {
      return res.status(400).json({ error: 'Unknown tool: ' + tool });
    }

    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    // Retry up to 2 times on 429 rate limit with backoff
    let apiRes;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 3000));
      apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: requestBody,
      });
      if (apiRes.status !== 429) break;
    }

    if (!apiRes.ok) {
      if (apiRes.status === 429) {
        return res.status(429).json({ error: 'The optimizer is busy right now — try again in a few seconds.' });
      }
      const errText = await apiRes.text();
      throw new Error('Claude API ' + apiRes.status + ': ' + errText.slice(0, 200));
    }

    const apiData = await apiRes.json();
    const text = (apiData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (!objMatch) throw new Error('No JSON in response');

    let parsed;
    try { parsed = JSON.parse(objMatch[0]); }
    catch(e) { throw new Error('Invalid JSON from model'); }

    // If Claude itself returned an error object (e.g. couldn't parse the resume), surface it as 400
    if (parsed.error) {
      return res.status(400).json({ error: 'RESUME_CORRUPTED' });
    }

    return res.status(200).json(parsed);

  } catch(err) {
    console.error('Resume API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
