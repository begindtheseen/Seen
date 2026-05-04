export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': 'https://seenjobs.io',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { company, location } = await req.json();

    if (!company) {
      return new Response(JSON.stringify({ error: 'Company name required' }), { status: 400, headers });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `You are a job market research assistant for Seen, a job board transparency platform.
Research companies and return ONLY real, factual information about their hiring practices.
NEVER make up data. If you don't know something, say so honestly.
Return a JSON object with these exact fields:
- summary: 2-3 sentence honest description of their hiring reputation (string)
- ghost_rate_estimate: estimated % chance they ghost applicants based on known reputation, null if unknown (number 0-100 or null)
- response_rate_estimate: estimated % who hear back, null if unknown (number 0-100 or null)
- avg_rounds_estimate: typical interview rounds, null if unknown (number or null)
- known_issues: array of up to 4 specific known complaints about their hiring (array of strings, empty array if none known)
- known_positives: array of up to 3 known positives about their hiring (array of strings, empty array if none known)
- process_notes: 1-2 sentences about their typical hiring process if known (string or null)
- data_confidence: "high", "medium", or "low"
- sources_note: brief note on where this reputation comes from (string)
Return ONLY valid JSON, no markdown, no other text.`,
        messages: [{
          role: 'user',
          content: `Research the hiring practices and reputation of: ${company}${location ? ' in ' + location : ''}. What do job seekers commonly say about their hiring process? Do they ghost applicants? What is the interview process like?`
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return new Response(JSON.stringify(parsed), { status: 200, headers });

  } catch (err) {
    console.error('Research API error:', err);
    return new Response(JSON.stringify({ error: 'Research failed' }), { status: 500, headers });
  }
}
