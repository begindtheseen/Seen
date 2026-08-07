// Résumé → jobs floor. The "no one is ever allowed to not find jobs they want" guarantee.
//
// A parsed résumé is the strongest possible job-seeking signal. When we have one we want the
// /jobs "Matched to your résumé" rail to be ALWAYS full — even for a niche résumé whose role
// isn't in our corpus yet. Rather than build a parallel matcher, we derive a plain SEARCH
// QUERY from the parsed résumé (the person's real role/title) and route it through the SAME
// on-demand aggregation the fixed job search uses. That inherits the whole floor for free:
// relevance is judged upstream, the live top-up fills a thin corpus, and — critically — the
// 3h per-(query,location) cooldown + the global aggregation budget keep it scale-safe.
//
// Pure derivation lives here (unit-tested); the pull is a thin, guarded wrapper over
// jobSources.aggregateForQuery — no new Adzuna path, no second uncapped pull.

import { aggregateForQuery, wasRecentlyPulled, recordPull } from './jobSources.js';
import { rateLimitGlobal } from './ratelimit.js';

// A résumé "function" (from resumeAnalysis.extractCareerSignal FUNCTION_MAP) → a concrete,
// searchable role title. Only used as a fallback when the résumé carried no usable job title.
const FUNCTION_ROLE = {
  engineering: 'software engineer',
  design: 'designer',
  product: 'product manager',
  marketing: 'marketing',
  sales: 'sales representative',
  data: 'data analyst',
  finance: 'accountant',
  legal: 'legal',
  ops: 'operations',
};

// Words that describe seniority/employment-type, not the role itself. Stripped from a title so
// "Senior Software Engineer (Contract)" derives the searchable role "software engineer" — a
// broader, higher-recall query than the person's exact stamped title.
const TITLE_NOISE_RE = /\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|entry[-\s]?level|intern|internship|trainee|apprentice|contract|contractor|temporary|temp|part[-\s]?time|full[-\s]?time|remote|hybrid|onsite|on[-\s]?site|i{1,3}|iv|v|\d+)\b/gi;

function cleanQuery(s) {
  return String(s || '')
    .replace(/[<>`\\|()[\]{}]/g, ' ')      // strip characters that abuse filters / injection
    .replace(/[•·–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

// A candidate query is usable if it has real letters and isn't a bare number / single char.
function usableQuery(s) {
  const c = cleanQuery(s);
  return c.length >= 2 && /[a-z]{2,}/i.test(c) ? c.toLowerCase() : '';
}

/**
 * Derive a single, high-recall SEARCH QUERY from a parsed-résumé signal.
 * Priority: the person's real job title (top_titles) → their function mapped to a role →
 * their strongest skill. Returns '' when the résumé yielded nothing searchable (caller skips).
 *
 * @param {{ top_titles?: string[], function?: string, skills?: string[] }} signal
 * @returns {string}
 */
export function deriveResumeJobQuery(signal = {}) {
  const titles = Array.isArray(signal?.top_titles) ? signal.top_titles : [];
  for (const t of titles) {
    // Prefer the role stripped of seniority/type noise (higher recall); fall back to the
    // raw title when stripping leaves nothing (e.g. a title that was only "Lead").
    const stripped = usableQuery(cleanQuery(t).replace(TITLE_NOISE_RE, ' '));
    if (stripped) return stripped;
    const raw = usableQuery(t);
    if (raw) return raw;
  }

  const fn = String(signal?.function || '').toLowerCase().trim();
  if (FUNCTION_ROLE[fn]) return FUNCTION_ROLE[fn];

  const skills = Array.isArray(signal?.skills) ? signal.skills : [];
  for (const s of skills) {
    const q = usableQuery(s);
    if (q) return q;
  }
  return '';
}

/**
 * Fill the corpus for a résumé-derived query by routing it through the SAME live aggregation
 * the fixed job search uses — inheriting its scale guards. Fire-and-forget safe.
 *
 * Scale safety (identical to api/jobs.js search top-up):
 *  1. cooldown — skip if this (query, location) was pulled within the window (corpus is fresh).
 *  2. global budget — skip if the platform-wide aggregation budget is spent (never overspend).
 * Only after both pass does it call aggregateForQuery (Adzuna pull + upsert) and record the pull.
 *
 * @returns {Promise<{ jobs: any[], pulled: boolean, reason: string }>}
 */
export async function pullResumeJobFloor({
  query,
  location = '',
  supabaseUrl,
  serviceKey,
  adzunaAppId,
  adzunaAppKey,
}) {
  const q = String(query || '').trim();
  if (!q || !supabaseUrl || !serviceKey || !adzunaAppId || !adzunaAppKey) {
    return { jobs: [], pulled: false, reason: 'noop' };
  }

  // 1) Cooldown — the last pull for this (query, location) already stored everything it found
  //    (fresh ~14 days). Fail-open on a missing table / DB blip (global budget is the backstop).
  if (await wasRecentlyPulled(q, location, supabaseUrl, serviceKey)) {
    return { jobs: [], pulled: false, reason: 'cooldown' };
  }

  // 2) Global aggregation budget — the platform-wide cap shared with search, so a flood of
  //    résumé uploads can never stampede external spend. Out of budget → serve nothing new.
  const budget = await rateLimitGlobal('agg-global');
  if (!budget.allowed) return { jobs: [], pulled: false, reason: 'budget' };

  try {
    const agg = await aggregateForQuery({
      query: q,
      location,
      relatedTerms: [],       // single-term pull — cheapest, one Adzuna call
      supabaseUrl,
      serviceKey,
      adzunaAppId,
      adzunaAppKey,
    });
    // Record only after a real pull ran, so a failure never locks out retries.
    recordPull(q, location, agg.jobs?.length || 0, supabaseUrl, serviceKey);
    return { jobs: Array.isArray(agg.jobs) ? agg.jobs : [], pulled: true, reason: 'aggregated' };
  } catch {
    return { jobs: [], pulled: false, reason: 'error' };
  }
}
