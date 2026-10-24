// Public, read-only API calls as cacheable GETs.
//
// Why: Vercel's CDN caches a function response only for GET/HEAD with `Cache-Control: s-maxage` (a POST
// is never cached, whatever header it carries). Every company-page read was a POST, so with several
// visitors on the site every one of them paid a full Supabase round trip — and under load (2026-10-24
// production measurement) each of those reads waited 5–25 s behind the jobs-table work on the shared
// instance, while the ONE GET endpoint with cache headers (employer-replies) answered in <100 ms from
// the CDN. These helpers map a GET query to the same handler body the POST uses, so the handlers stay
// the single source of truth and the response is byte-identical either way.
//
// Only reads with no user-specific content are listed here. Anything that writes, spends, or depends on
// the caller's identity stays POST-only and uncached.

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : Array.isArray(v) && typeof v[0] === 'string' ? v[0].slice(0, max) : '');

/** GET /api/reports?type=… → the POST body api/reports.js already routes. null = not a public read. */
export function reportsReadFromQuery(query) {
  const q = query || {};
  const type = str(q.type, 40);
  const name = str(q.name).trim();
  switch (type) {
    case 'score':       return name ? { name } : null;
    case 'list': {
      const company = str(q.company).trim();
      return company ? { company, city: str(q.city, 120) } : null;
    }
    case 'benchmark':   return name ? { action: 'industry_benchmark', name } : null;
    case 'perk':        return name ? { action: 'employer_perk', name } : null;
    case 'leaderboard': return { action: 'leaderboard' };
    default:            return null;
  }
}

/** GET /api/jobs?action=… → the POST body api/jobs.js routes. Only the company-page reads. */
export function jobsReadFromQuery(query) {
  const q = query || {};
  const action = str(q.action, 40);
  const company = str(q.company, 100).trim();
  if ((action === 'listing_signals' || action === 'company_jobs') && company) return { action, company };
  return null;
}

/**
 * CDN cache policy per public read, in seconds. `sMaxage` is how long the edge serves the answer
 * without asking the function; `swr` how much longer it may serve the stale copy while refreshing
 * in the background (a visitor never waits on that refresh). Scores and report lists change when
 * a report lands, so they are held for one minute; the rest moves on a cron cadence.
 */
export const PUBLIC_READ_CACHE = Object.freeze({
  score:            { sMaxage: 60,  swr: 600 },
  list:             { sMaxage: 60,  swr: 600 },
  benchmark:        { sMaxage: 600, swr: 1200 },
  perk:             { sMaxage: 300, swr: 600 },
  leaderboard:      { sMaxage: 300, swr: 600 },
  listing_signals:  { sMaxage: 600, swr: 1800 },
  company_jobs:     { sMaxage: 300, swr: 600 },
  reddit:           { sMaxage: 600, swr: 3600 },
  reddit_checking:  { sMaxage: 30,  swr: 60 },
});

/** The Cache-Control value for a public read. */
export function publicCacheControl(kind) {
  const p = PUBLIC_READ_CACHE[kind];
  if (!p) throw new Error(`unknown public read kind: ${kind}`);
  return `public, s-maxage=${p.sMaxage}, stale-while-revalidate=${p.swr}`;
}

/**
 * Sets Cache-Control on a response. On a GET this is what lets the CDN serve the next visitor; on a
 * POST the header is inert at the edge (Vercel never caches POST) but harmless, so the same call
 * serves both routes.
 */
export function setPublicCache(res, kind) {
  res.setHeader('Cache-Control', publicCacheControl(kind));
}
