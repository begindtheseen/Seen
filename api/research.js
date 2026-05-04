export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const { company, location } = await req.json();
    if (!company) return new Response(JSON.stringify({ error: 'Company name required' }), { status: 400, headers });

    const locationStr = location ? ` in ${location}` : '';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `You are a hiring transparency researcher for Seen, a job board that exposes ghost jobs and bad hiring practices.

Search the web and find REAL information about a company's hiring practices. Look for:
- Reddit posts from r/jobs, r/recruitinghell, r/cscareerquestions
- Glassdoor reviews mentioning ghosting, interview process
- News about layoffs or hiring freezes
- Public complaints about recruitment

After searching, return ONLY a JSON object with real findings. Never fabricate data.

Required JSON fields:
- summary: 2-3 sentences summarizing their hiring reputation based on what you found (string)
- ghost_rate_estimate: % chance they ghost based on findings, null if unclear (number 0-100 or null)  
- response_rate_estimate: % who hear back, null if unclear (number 0-100 or null)
- avg_rounds_estimate: typical interview rounds, null if unclear (number or null)
- known_issues: up to 5 specific hiring complaints found online (array of strings, empty if none found)
- known_positives: up to 3 positives about their hiring found online (array of strings, empty if none found)
- process_notes: what their hiring process looks like based on real reports (string or null)
- data_confidence: "high" if many sources, "medium" if some, "low" if sparse (string)
- sources_note: what sources you actually found (string)
- reddit_mentions: number of relevant Reddit posts found (number)
- glassdoor_rating: Glassdoor rating if found, null if not (number or null)

Return ONLY valid JSON. No markdown, no other text.`,
        messages: [{
          role: 'user',
          content: `Research hiring practices for: ${company}${locationStr}

Search for:
1. "${company} ghosted" OR "${company} hiring process" OR "${company} interview experience"
2. site:reddit.com "${company}" hiring OR ghosted OR interview
3. "${company}" Glassdoor reviews hiring
4. Recent news about ${company} hiring, layoffs, or recruitment${locationStr}

Report exactly what you find. Quote real complaints from Reddit or Glassdoor if found.`
        }]
      })
    });

    if (!response.ok) throw new Error(`Claude API error ${response.status}`);

    const data = await response.json();
    const textContent = data.content?.filter(b => b.type === 'text')?.map(b => b.text)?.join('') || '{}';
    const clean = textContent.replace(/```json|```/g, '').trim();
    
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch(e) { const m = clean.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : { error: 'Parse failed', summary: 'Could not parse research results.', data_confidence: 'low', known_issues: [], known_positives: [], sources_note: 'Search completed but results unclear.' }; }

    return new Response(JSON.stringify(parsed), { status: 200, headers });

  } catch (err) {
    console.error('Research error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
