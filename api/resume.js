export const config = { runtime: 'edge' };

const SYSTEMS = {
  scanner: `You are an expert ATS resume optimizer. Analyze a resume against a job description.
Return ONLY valid JSON:
- match_score: number 0-100
- score_summary: 2-3 sentence honest assessment
- missing_keywords: array of up to 8 exact keywords/phrases from the JD missing from resume
- strong_keywords: array of up to 6 keywords that match well
- specific_fixes: array of up to 4 objects with "current" (exact text from resume) and "improved" (rewritten with better keywords and quantification)
- ghost_risk_note: 1 sentence about this company's hiring reputation if known, or null
Return ONLY valid JSON, no other text.`,

  optimize: `You are an expert resume optimizer. Given a resume and job description, rewrite the resume bullets to match the job's exact language while keeping all facts truthful. 
Return ONLY valid JSON:
- optimized_bullets: array of objects with "original" and "optimized" for each work experience bullet that should change
- keywords_added: array of keywords that were woven in
- summary_rewrite: optimized professional summary if one exists, or a suggested one
- cover_letter_opener: a 2-sentence cover letter opener specific to this company and role, leading with their problem
Return ONLY valid JSON, no other text.`,

  coach: `You are an expert job search strategist. Create a specific action playbook.
Return ONLY valid JSON:
- hiring_manager_script: exact LinkedIn message template (3-4 sentences, specific to this company/role)
- timing_note: 2 sentences on why applying in first 24-48 hours matters for THIS company
- company_intel: 3-5 specific things to know about this company (real intel only, nothing fabricated)
- cover_letter_framework: specific cover letter opening that leads with a company problem and candidate solution
- referral_strategy: exact script for reaching out to a company employee for a referral
Return ONLY valid JSON, no other text.`,

  proposal: `You are an expert career strategist. Create a compelling 30/60/90 day pre-proposal.
Return ONLY valid JSON:
- opening_note: 1-2 sentence intro explaining why you're sending a pre-proposal
- day_30: first 30 days goals — 3-4 bullet points as string with newlines
- day_60: days 31-60 contributions — 3-4 bullet points
- day_90: day 90 impact and outcomes — 3-4 bullet points
Return ONLY valid JSON, no other text.`,

  hiring_manager: `You are a research assistant. Search for the hiring manager at a company for a specific role.
Search Google for: site:linkedin.com "[company]" "[job title]" hiring OR recruiter OR "talent acquisition"
Also try: "[company] [job title] hiring manager" site:linkedin.com

Return ONLY valid JSON:
- found: boolean (true only if you actually found a real specific person)
- name: full name if found, null if not
- title: their actual job title if found, null if not  
- linkedin_url: their LinkedIn profile URL if found, null if not
- search_query: the exact Google search query someone should use to find this person
- note: brief note on how confident you are, or instructions for the user to search manually
CRITICAL: Only set found=true if you actually found a real person. Never fabricate names or URLs.
Return ONLY valid JSON, no other text.`,

  insider_intel: `You are a job market researcher. Find real insider information about getting hired at a company for a specific role.
Search for Reddit posts, Glassdoor reviews, and other public sources about the interview process and hiring at this company.
Return ONLY valid JSON:
- found: boolean (true only if you found real specific information)
- interview_process: description of actual interview stages if found from real sources, null if not found
- tips: array of up to 5 specific tips from real employee/candidate reports (empty array if none found)
- red_flags: array of specific hiring red flags reported by real candidates (empty array if none found)  
- sources: array of source descriptions (e.g. "Reddit r/jobs - 3 posts", "Glassdoor - 47 reviews")
CRITICAL: Every tip must come from a real source. Never fabricate. Empty is better than fake.
Return ONLY valid JSON, no other text.`
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const body = await req.json();
    const { tool, job, company, resume, jobDescription, background } = body;
    if (!tool || !SYSTEMS[tool]) return new Response(JSON.stringify({ error: 'Invalid tool' }), { status: 400, headers });

    let userMessage = '';
    if (tool === 'scanner' || tool === 'optimize') {
      userMessage = `Job Title: ${job}\nCompany: ${company || 'Not specified'}\n\nRESUME:\n${resume || ''}\n\nJOB DESCRIPTION:\n${jobDescription || ''}`;
    } else if (tool === 'coach' || tool === 'proposal') {
      userMessage = `Job Title: ${job}\nCompany: ${company}\n\nJOB DESCRIPTION:\n${jobDescription || ''}\n\nCANDIDATE BACKGROUND:\n${background || 'Not provided'}`;
    } else if (tool === 'hiring_manager') {
      userMessage = `Find the hiring manager or recruiter at ${company} for the role: ${job}. Search Google and LinkedIn for real people. Only return real results.`;
    } else if (tool === 'insider_intel') {
      userMessage = `Find real insider information from Reddit, Glassdoor, and other public sources about getting hired at ${company} for ${job} roles. What do real candidates say about the interview process?`;
    }

    // Use web_search for research tools
    const useWebSearch = ['hiring_manager', 'insider_intel', 'coach'].includes(tool);

    const requestBody = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
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
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) throw new Error(`Claude API error: ${response.status}`);

    const data = await response.json();
    
    // Extract text from response (may include tool_use blocks)
    const text = data.content
      ?.filter(b => b.type === 'text')
      ?.map(b => b.text)
      ?.join('') || '{}';

    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch(e) {
      const match = clean.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { error: 'Could not parse response', found: false };
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers });

  } catch(err) {
    console.error('Resume API error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
