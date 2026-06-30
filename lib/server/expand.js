// Shared query expansion utility.
// Given any raw job search query, returns a canonical job title + related terms by checking the
// query_expansions DB cache first, then asking the LLM gateway once and caching forever. The LLM
// call runs through lib/server/llm.js (Groq/OpenAI by default, Anthropic only if the admin flag is
// on) and only the first time a unique query variant is seen. If no LLM provider is configured it
// degrades to the raw query — job search still works, it just loses synonym expansion.
import { chat, llmAvailable } from './llm.js';

export async function getQueryExpansion(qNorm, supabaseUrl, dbHeaders /* , anthropicKey (unused — gateway picks the provider) */) {
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

  if (!llmAvailable()) return fallback;

  try {
    const parsed = await chat({
      system: 'You are a job search expert. Return ONLY valid JSON, no markdown.',
      maxTokens: 350,
      timeoutMs: 12000,
      json: true,
      user: `Given a job search query, return its canonical form and related search terms that describe the SAME kind of work.

Return ONLY valid JSON: {"canonical":"...","related":["...","...","..."]}

Rules:
- canonical: the single most standard industry job title (lowercase, 1-6 words)
- related: 8-10 terms a job seeker OR recruiter might use for this SAME type of job. Include:
  • Common abbreviations AND their expansions (ML↔machine learning, SWE↔software engineer, RN↔registered nurse, NP↔nurse practitioner, CNA↔certified nursing assistant, CDL↔truck driver, HVAC↔hvac technician, PM↔product manager, UX↔user experience designer, QA↔quality assurance, DSP↔delivery driver, etc.)
  • Synonym job titles (software engineer↔software developer↔programmer)
  • Plural/singular variants if meaningful
  • Level-prefixed variants when common ("senior software engineer", "junior data analyst")
  • Industry-specific alternate names that recruiters actually post
- Keep company specificity: "amazon dsp" → canonical="amazon delivery driver", related includes "amazon dsp driver", "amazon flex driver", "delivery driver"
- Keep role specificity: "package handler" and "delivery driver" are DIFFERENT jobs — do not conflate
- Company-only queries like "amazon" → canonical="amazon", related=["amazon warehouse associate", "amazon delivery driver", "amazon flex", "amazon fulfillment associate", "amazon sort center"]
- Proper nouns stay lowercase in canonical; always lowercase everything

Query: "${qNorm}"`,
    });

    const canonical = (parsed.canonical || qNorm).toLowerCase().trim();
    const related = (parsed.related || []).slice(0, 10).map(s => String(s).toLowerCase().trim()).filter(Boolean);

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
