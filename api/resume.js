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
      // Count pure alphabetic words (3+ letters) — catches binary/base64 garbage
      // which has essentially no real English words, while allowing resumes heavy
      // with dates, numbers, abbreviations, and medical/technical codes.
      const wordMatches = r.match(/[A-Za-z]{3,}/g) || [];
      if (r.length > 100 && wordMatches.length < 20) {
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
      systemPrompt = 'You are a career strategist who aligns candidate experience to specific job requirements. Return ONLY valid JSON with no markdown.';
      prompt = `Tailor this resume specifically for the ${job} role at ${company}.

Step 1: Identify the 5-6 most important requirements, skills, or qualities this employer is actually hiring for.
Step 2: Find which of the candidate's real experiences best match each of those requirements.
Step 3: Rewrite 4-6 bullets to make the connection explicit — use the employer's exact language and terminology.

Rules:
- Never fabricate experience. Only rewrite based on what the candidate actually did.
- Mirror the JD's vocabulary exactly (if JD says "pipeline management" don't write "sales tracking").
- Each rewritten bullet must directly address one of the job's key requirements.
- A recruiter should read each bullet and immediately see why it's relevant to THIS role.

JOB: ${job} at ${company}
JOB DESCRIPTION:\n${(jobDescription||'').slice(0,2500)}
RESUME:\n${(resume||'').slice(0,4000)}

Return ONLY this JSON:
{"job_priorities":["<top requirement>","<second>","<third>","<fourth>","<fifth>"],"optimized_bullets":[{"original":"<exact text from resume>","optimized":"<rewritten to address JD requirement>","addresses":"<which priority in 3-5 words>"}],"keywords_added":["<exact JD term>"]}`;

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
      max_tokens: tool === 'optimize' ? 2500 : 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    // Retry up to 5 times on 429 (rate limit) or 529 (overloaded) — both are transient
    let apiRes;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        const retryAfter = apiRes?.headers?.get('retry-after');
        const waitMs = retryAfter ? Math.min(parseInt(retryAfter) * 1000, 30000) : attempt * 6000;
        await new Promise(r => setTimeout(r, waitMs));
      }
      apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: requestBody,
      });
      if (apiRes.status !== 429 && apiRes.status !== 529) break;
    }

    if (!apiRes.ok) {
      if (apiRes.status === 429 || apiRes.status === 529) {
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
