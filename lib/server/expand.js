// Shared query expansion utility.
// Given any raw job search query, returns a canonical job title + related terms from the
// query_expansions DB cache (rows stored by earlier runs). No model is called (owner decision
// 2026-10-26: Seen uses no model API): on a cache miss the raw query is returned unchanged and job
// search relies on the curated synonyms in api/_utils/jobRelevance.js expandQueryTerms.

export async function getQueryExpansion(qNorm, supabaseUrl, dbHeaders) {
  const fallback = { canonical: qNorm, related: [] };
  if (!supabaseUrl || !dbHeaders) return fallback;
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
  } catch (e) {}
  return fallback;
}
