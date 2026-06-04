// Shared query expansion utility.
// Given any raw job search query, returns a canonical job title + related terms
// by checking the query_expansions DB cache first, then calling Haiku once and
// caching the result forever. The Haiku call costs ~$0.00001 and only runs
// the first time a unique query variant is seen.
export async function getQueryExpansion(qNorm, supabaseUrl, dbHeaders, anthropicKey) {
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
- Abbreviations: DSP=delivery driver, RN=registered nurse, CNA=nursing assistant, SWE=software engineer, CDL=truck driver, HVAC=hvac technician, etc.

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
