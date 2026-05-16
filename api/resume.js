export const config = { runtime: 'edge' };

const SYSTEMS = {
  scanner: `You are an expert ATS resume optimizer. Analyze a resume against a job description.
Return ONLY valid JSON with these exact fields:
{ "match_score": 0-100, "score_summary": "2-3 sentences", "missing_keywords": ["array"], "strong_keywords": ["array"], "specific_fixes": [{"current":"...","improved":"..."}], "ghost_risk_note": "1 sentence or null" }
Return ONLY the JSON object, no markdown, no backticks, no other text.`,

  optimize: `You are an expert ATS resume optimizer. Rewrite resume bullets to match the job description's exact language. Keep all facts true — only change wording and add keywords.
Return ONLY valid JSON with these exact fields:
{ "optimized_bullets": [{"original":"exact bullet from resume","optimized":"rewritten version with keywords"}], "keywords_added": ["keyword1","keyword2"], "summary_rewrite": "rewritten summary or null", "cover_letter_opener": "2-sentence opener leading with company problem" }
Return ONLY the JSON object, no markdown, no backticks, no other text.`,

  coach: `You are an expert job search strategist. Create a specific action playbook for this role.
Return ONLY valid JSON:
{ "hiring_manager_script": "exact LinkedIn message", "timing_note": "2 sentences", "company_intel": "3-5 specific facts", "cover_letter_framework": "specific opening paragraph", "referral_strategy": "exact outreach script" }
Return ONLY the JSON object, no markdown, no backticks, no other text.`,

  proposal: `You are an expert career strategist. Create a 30/60/90 day pre-proposal.
Return ONLY valid JSON:
{ "opening_note": "1-2 sentences", "day_30": "bullet points as string", "day_60": "bullet points as string", "day_90": "bullet points as string" }
Return ONLY the JSON object, no markdown, no backticks, no other text.`,

  hiring_manager: `You are a research assistant. Find the hiring manager at a company for a specific role using web search.
Return ONLY valid JSON:
{ "found": true/false, "name": "full name or null", "title": "their title or null", "linkedin_url": "URL or null", "search_query": "exact Google query to find them", "note": "confidence note" }
CRITICAL: Only set found=true if you found a real specific person. Never fabricate.
Return ONLY the JSON object, no markdown, no backticks, no other text.`,

  insider_intel: `You are a job market researcher. Find real insider hiring information from Reddit, Glassdoor, and public sources.
Return ONLY valid JSON:
{ "found": true/false, "interview_process": "description or null", "tips": ["tip1","tip2"], "red_flags": ["flag1"], "sources": ["source1"] }
CRITICAL: Every item must come from a real source. Empty arrays are better than fabricated content.
Return ONLY the JSON object, no markdown, no backticks, no other text.`
};

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
    const { tool, job, company, resume, jobDescription, background } = body;
    if (!tool || !SYSTEMS[tool]) return new Response(JSON.stringify({ error: 'Invalid tool' }), { status: 400, headers });

    // Truncate resume to avoid token limits (keep first 3000 chars — enough for a full resume)
    const resumeTruncated = resume ? resume.slice(0, 3000) : '';
    const jdTruncated = jobDescription ? jobDescription.slice(0, 2000) : '';

    let userMessage = '';
    if (tool === 'scanner' || tool === 'optimize') {
      userMessage = `Job Title: ${job}\nCompany: ${company || 'Not specified'}\n\nJOB DESCRIPTION:\n${jdTruncated}\n\nRESUME:\n${resumeTruncated}`;
    } else if (tool === 'coach' || tool === 'proposal') {
      userMessage = `Job Title: ${job}\nCompany: ${company}\n\nJOB DESCRIPTION:\n${jdTruncated}\n\nCANDIDATE BACKGROUND:\n${background || resumeTruncated || 'Not provided'}`;
    } else if (tool === 'hiring_manager') {
      userMessage = `Find the hiring manager or recruiter at ${company} for the role: ${job}. Use web search to find real people on LinkedIn. Only return real results you can verify.`;
    } else if (tool === 'insider_intel') {
      userMessage = `Search Reddit, Glassdoor, and other public sources for real candidate experiences applying to ${company} for ${job} roles. What is the interview process like? What tips do real candidates share?`;
    }

    const useWebSearch = ['hiring_manager', 'insider_intel', 'coach'].includes(tool);

    const requestBody = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: SYSTEMS[tool],
      messages: [{ role: 'user', content: userMessage }]
    };

    if (useWebSearch) {
      requestBody.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`API ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();

    // Extract all text blocks from response
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('') || '{}';

    // Clean and parse JSON
    let clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Extract JSON object if surrounded by other text
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) clean = jsonMatch[0];

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch(e) {
      // Return a helpful error with what we got
      console.error('Parse failed. Raw:', clean.slice(0, 300));
      parsed = { error: 'Response parse failed', raw: clean.slice(0, 200) };
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers });

  } catch(err) {
    console.error('Resume API error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
