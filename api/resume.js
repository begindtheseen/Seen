export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }});
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = await req.json();
    const { tool } = body;

    if (!tool) return new Response(JSON.stringify({ error: 'Missing tool parameter' }), { status: 400, headers });

    const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
    if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY not configured');

    let prompt, systemPrompt;

    if (tool === 'scanner') {
      const { job, company, resume, jobDescription } = body;
      if (!resume || !jobDescription) return new Response(JSON.stringify({ error: 'Resume and job description required' }), { status: 400, headers });

      systemPrompt = 'You are an ATS resume scanner. Analyze resume fit for a job and return ONLY valid JSON with no markdown.';
      prompt = `Analyze this resume against the job description. Return ONLY a JSON object:
{
  "match_score": <0-100 integer>,
  "score_summary": "<2 sentences on overall fit>",
  "missing_keywords": ["<keyword>", ...],
  "strong_keywords": ["<keyword>", ...],
  "specific_fixes": [{"current": "<bullet from resume>", "improved": "<rewritten bullet>"}, ...],
  "ghost_risk_note": "<1 sentence on ghost risk for ${company || 'this company'}>"
}

JOB: ${job} at ${company}
JOB DESCRIPTION:
${(jobDescription || '').slice(0, 3000)}

RESUME:
${(resume || '').slice(0, 4000)}`;

    } else if (tool === 'optimize') {
      const { job, company, resume, jobDescription } = body;
      if (!resume) return new Response(JSON.stringify({ error: 'Resume required' }), { status: 400, headers });

      systemPrompt = 'You are a resume optimizer. Rewrite resume bullets to match job keywords and improve ATS score. Return ONLY valid JSON.';
      prompt = `Optimize this resume for the job. Return ONLY a JSON object:
{
  "optimized_bullets": [
    {"original": "<original bullet>", "optimized": "<rewritten bullet with keywords>"},
    ...
  ],
  "keywords_added": ["<keyword1>", "<keyword2>", ...]
}

Find 3-6 bullets that most need improvement. Add relevant keywords from the job description.

JOB: ${job} at ${company}
JOB DESCRIPTION:
${(jobDescription || '').slice(0, 2000)}

RESUME:
${(resume || '').slice(0, 4000)}`;

    } else if (tool === 'coach') {
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return new Response(JSON.stringify({ error: 'Job, company, and job description required' }), { status: 400, headers });

      systemPrompt = 'You are a job application strategist. Give actionable, specific advice. Return ONLY valid JSON.';
      prompt = `Create an application playbook for this candidate. Return ONLY a JSON object:
{
  "hiring_manager_script": "<LinkedIn message template to find/reach hiring manager, 3-4 sentences>",
  "timing_note": "<why applying in first 24-48 hours matters, specific to this role/company>",
  "company_intel": "<2-3 key things to know about ${company}'s culture/hiring based on the JD>",
  "cover_letter_framework": "<3-paragraph framework: hook, body, close — specific to this role>",
  "referral_strategy": "<how to get a referral at ${company}, specific steps>"
}

JOB: ${job} at ${company}
JOB DESCRIPTION:
${(jobDescription || '').slice(0, 2500)}
${background ? '\nCANDIDATE BACKGROUND:\n' + background.slice(0, 1000) : ''}`;

    } else if (tool === 'proposal') {
      const { job, company, jobDescription, background } = body;
      if (!job || !company || !jobDescription) return new Response(JSON.stringify({ error: 'Job, company, and job description required' }), { status: 400, headers });

      systemPrompt = 'You are a career strategist. Write a compelling 30/60/90 day plan. Return ONLY valid JSON.';
      prompt = `Write a 30/60/90 day plan for a candidate applying for this role. Return ONLY a JSON object:
{
  "day_30": "<First 30 days plan — learning, onboarding, quick wins. 3-4 specific bullet points as a string with newlines>",
  "day_60": "<Days 31-60 — contributing, building relationships, first projects. 3-4 specific points>",
  "day_90": "<Days 61-90 — leading initiatives, measurable impact, strategy. 3-4 specific points>",
  "opening_note": "<1 sentence framing why this candidate is ready to hit the ground running>"
}

JOB: ${job} at ${company}
JOB DESCRIPTION:
${(jobDescription || '').slice(0, 2500)}
${background ? '\nCANDIDATE BACKGROUND:\n' + background.slice(0, 1000) : ''}`;

    } else {
      return new Response(JSON.stringify({ error: 'Unknown tool: ' + tool }), { status: 400, headers });
    }

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!apiRes.ok) {
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

    return new Response(JSON.stringify(parsed), { status: 200, headers });

  } catch(err) {
    console.error('Resume API error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
