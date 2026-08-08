import { createHmac, timingSafeEqual } from 'crypto';
import { getQueryExpansion } from '../lib/server/expand.js';
import { applyRateLimit, rateLimit, rateLimitGlobal, resolveRateBucket } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { filterAndRank, filterByLocation, sortByProximity, locationDbTerm, expandQueryTerms } from './_utils/jobRelevance.js';
import { aggregateForQuery, upsertJobs, inferLevel, wasRecentlyPulled, recordPull } from '../lib/server/jobSources.js';
import { aggregateWithSources } from '../lib/jobs/expand.js';
import { deriveResumeJobQuery, pullResumeJobFloor } from '../lib/server/resumeJobMatch.js';
import { scoreJob, wasteScore, scoreRow, explainListingScore } from '../lib/server/jobScore.js';
import { computeListingFreshness } from '../lib/server/listingFreshness.js';
import { geocodeLocation, haversineMiles, milesToKm, hasUsableCoords, geoBoxClause, sanitizeCoords } from '../lib/server/geo.js';

// ── Suppressed listings (migration 047) ─────────────────────────────────────────────────────
// Admins can "delete" an ephemeral (live-search) listing they've confirmed dead; its apply_url
// lands in suppressed_listings and we filter it out of search so a re-search can't resurface it.
// The set is cached module-side for 60s (admin-driven, changes rarely) and the loader is
// fail-safe: any error yields an empty set, so search never breaks on this.
const _normUrl = (u) => (u == null ? '' : String(u).trim());
let _suppressCache = { at: 0, set: new Set() };
async function getSuppressedSet(url, headers) {
  const now = Date.now();
  if (_suppressCache.set.size >= 0 && now - _suppressCache.at < 60_000) return _suppressCache.set;
  try {
    const r = await fetch(`${url}/rest/v1/suppressed_listings?select=apply_url&limit=5000`, { headers });
    if (r.ok) {
      const rows = await r.json();
      _suppressCache = { at: now, set: new Set((Array.isArray(rows) ? rows : []).map((x) => _normUrl(x.apply_url)).filter(Boolean)) };
    } else {
      _suppressCache = { at: now, set: _suppressCache.set }; // keep last good set on a transient error
    }
  } catch { _suppressCache = { at: now, set: _suppressCache.set }; }
  return _suppressCache.set;
}
// Drop any listing whose apply_url (mapped to `url` in the UI shape) is suppressed.
const dropSuppressed = (list, set) =>
  (!set || set.size === 0) ? list : list.filter((j) => !set.has(_normUrl(j.url || j.apply_url)))

// Featured employers (Engine E4) — companies with an active paid featured perk. Cached 60s,
// fail-safe. Their listings get a `featured` flag (badge on the card) and sort to the top.
let _featCache = { at: 0, set: new Set() }
async function getFeaturedSet(url, headers) {
  const now = Date.now()
  if (now - _featCache.at < 60_000) return _featCache.set
  try {
    const r = await fetch(`${url}/rest/v1/employer_perks?featured_until=gt.${encodeURIComponent(new Date().toISOString())}&select=company&limit=500`, { headers })
    if (r.ok) {
      const rows = await r.json()
      _featCache = { at: now, set: new Set((Array.isArray(rows) ? rows : []).map((x) => String(x.company || '').toLowerCase()).filter(Boolean)) }
    } else { _featCache = { at: now, set: _featCache.set } }
  } catch { _featCache = { at: now, set: _featCache.set } }
  return _featCache.set
}
// Flag featured listings and stable-sort them first (paid placement; never a score change).
const applyFeatured = (list, set) => {
  if (!set || set.size === 0) return list
  const marked = list.map((j) => ({ ...j, featured: set.has(String(j.company || '').toLowerCase()) }))
  return marked.map((j, i) => [j, i]).sort((a, b) => (b[0].featured - a[0].featured) || (a[1] - b[1])).map(([j]) => j)
};

// Verify a Supabase JWT (HS256) and return the user id, or null. Decoding the payload
// WITHOUT this check would let anyone forge a token and read another user's data.
function _verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const mac = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    const sig = Buffer.from(s, 'base64url');
    const exp = Buffer.from(mac, 'base64url');
    if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!payload.sub || payload.exp < Date.now() / 1000) return null;
    return payload.sub;
  } catch { return null; }
}
async function _resolveUid(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) { const uid = _verifyJWT(token, secret); if (uid) return uid; }
  // Fallback: validate via Supabase auth API when the local secret is unset/mismatched.
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
  if (U && K) {
    try {
      const r = await fetch(`${U}/auth/v1/user`, { headers: { apikey: K, Authorization: `Bearer ${token}` } });
      if (r.ok) return (await r.json())?.id || null;
    } catch { /* ignore */ }
  }
  return null;
}

// Per-instance request coalescing: concurrent identical searches share one live aggregation
const _inflight = new Map();

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  // Parse body early so we can route before rate limiting
  let _body = req.body;
  if (typeof _body === 'string') { try { _body = JSON.parse(_body); } catch(e) { _body = {}; } }
  if (!_body || typeof _body !== 'object') _body = {};

  // ── Location-jobs: merged from api/fetch-location-jobs.js ──────────────────
  if (_body.action === 'location' || (_body.location && !_body.query)) {
    const { allowed: rlOk } = await rateLimit(req, 'fetch-location-jobs');
    if (!rlOk) return res.status(429).json({ error: 'Too many requests — slow down.', jobs: [] });
    return handleLocationJobs(req, res, _body);
  }

  // Rate bucket: the signed-in USER when the request carries a verifiable JWT, else the IP.
  // Per-user buckets are the scale fix for shared IPs (household/office/CGNAT) — users no
  // longer starve each other out of one shared allowance.
  const rlBucket = resolveRateBucket(req);

  // ── Company jobs: fetch/search jobs for a specific company ─────────────────
  if (_body.action === 'company_jobs') {
    if (await applyRateLimit(req, res, 'job-read', { bucketKey: rlBucket.key })) return;
    return handleCompanyJobs(req, res, _body);
  }

  // ── Recommended jobs: personalized from resume_skills ────────────────────
  if (_body.action === 'recommended') {
    if (await applyRateLimit(req, res, 'job-read', { bucketKey: rlBucket.key })) return;
    return handleRecommended(req, res, _body);
  }

  // ── Get single job by ID — direct link / refresh fallback ──────────────────
  if (_body.action === 'get_by_id') {
    if (await applyRateLimit(req, res, 'job-read', { bucketKey: rlBucket.key })) return;
    const { id } = _body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });
    const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
    if (!U || !K) return res.status(503).json({ error: 'DB unavailable' });
    try {
      // NOTE: jobs has apply_url ONLY — selecting a phantom `url` column made PostgREST
      // reject the whole select, so every direct /jobs/<id> link 404'd. Same class as the
      // employer-listings phantom-url bug; `url` is aliased from apply_url in the response.
      const r = await fetch(
        `${U}/rest/v1/jobs?id=eq.${encodeURIComponent(id)}&select=id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,availability_status,created_at,last_seen_at,last_checked_at,availability_report_count,is_employer_posted&limit=1`,
        { headers: { apikey: K, Authorization: `Bearer ${K}` } }
      );
      const rows = r.ok ? await r.json() : [];
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Not found' });
      // Attach the score's factor breakdown so the detail page can show WHY, not just a number,
      // plus the factual freshness descriptor (our-own-observation facts — never an employer verdict).
      const job = {
        ...rows[0], url: rows[0].apply_url || null,
        ...scoreRow(rows[0]), score_explanation: explainListingScore(rows[0]),
        freshness: computeListingFreshness(rows[0]),
      };
      return res.status(200).json({ job });
    } catch (e) {
      logError('jobs/get_by_id', e.message);
      return res.status(500).json({ error: 'DB error' });
    }
  }

  // Main search: the per-bucket 'job-search' cap is an ABUSE ceiling (~10/min sustained),
  // not a usage meter — the cheap DB-first path below must survive real traffic. The
  // expensive live top-up is separately budgeted at the aggregation branch.
  const limited = await applyRateLimit(req, res, 'job-search', { bucketKey: rlBucket.key });
  if (limited) return;

  // Declare catch-block variables in outer scope so the catch handler can access them
  let safeQuery = '';
  let loc = '';
  let inflightKey = '';
  let _inflightResolve, _inflightReject;
  let dbMatches = []; // related listings already in our DB (merged with any API top-up)
  let relevanceQuery = ''; // the ORIGINAL user query — what relevance is judged against
  let synonyms = []; // canonical + expansion terms — true-synonym signals (matched vs the TITLE)
  let searchTerms = []; // original + canonical + deterministic expansion — the DB pool + corpus reads
  const PAGE_MIN = 10; // below this many results we widen (geo, then corpus, then national)

  try {
    let body = _body;
    const { query, location, radius } = body;
    if (!query) return res.status(400).json({ error: 'No query' });

    const rawQuery = String(query).trim().slice(0, 200);
    if (!rawQuery) return res.status(400).json({ error: 'No query' });
    // Strip characters that could abuse prompt injection
    safeQuery = rawQuery.replace(/[<>`\\]/g, '').trim();
    relevanceQuery = safeQuery;

    loc = (location || '').trim();

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const dbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Admin-suppressed dead listings to filter out + featured employers to boost (fail-safe).
    const suppressedSet = await getSuppressedSet(SUPABASE_URL, dbHeaders)
    const featuredSet = await getFeaturedSet(SUPABASE_URL, dbHeaders);

    const qNorm = safeQuery.toLowerCase();

    // canonical + expansion terms stay in outer scope so the aggregation step can use them
    let canonical = qNorm;
    let relatedTerms = [];

    // ── Radius ───────────────────────────────────────────────────────────────
    // Real distance search: clamp the requested radius, geocode the searched place once
    // (cached), and pass the distance to Adzuna so the live pull is already scoped. `center`
    // is filled in during the DB-first Promise.all below (overlapped with the DB reads).
    // radius === '0'/'remote' means REMOTE: skip geo filtering entirely and search remote
    // listings — the old clamp silently turned "Remote" into an ordinary 25-mile search.
    const isRemote = String(radius) === '0' || String(radius).toLowerCase() === 'remote';
    if (isRemote) { loc = 'remote'; }
    const radiusMiles = isRemote ? Infinity : Math.min(500, Math.max(5, parseInt(radius, 10) || 25));
    const distanceKm = isRemote ? null : milesToKm(radiusMiles);
    let center = null; // { lat, lng } | null (null → geocode unavailable, fall back to city/state)

    // Exact-circle refine of an ALREADY-bbox-scoped page (the DB did the heavy geo pre-filter
    // on jobs_latlng_idx — see geoClause below; this runs only on the ≤60-row page, cheap).
    // Keep a listing only if its coords are usable AND within the radius, nearest-first.
    // NULL and (0,0) coords are UNKNOWN, not a real point — they are EXCLUDED from a
    // location-scoped search and never leak in via coarse text matching (the old bug). They
    // still appear in Remote/national searches. Only when geocoding the SEARCH place itself
    // failed (no center) do we degrade to coarse city → state text matching.
    const applyRadius = (list) => {
      if (!loc) return Array.isArray(list) ? list : [];
      // Remote search: distance is meaningless — prefer listings that say remote, keep the rest.
      if (isRemote) {
        const arr = Array.isArray(list) ? list : [];
        const isRem = (j) => /\bremote\b|\bwork from home\b|\banywhere\b/i.test(`${j.location || ''} ${j.description || ''}`);
        return [...arr.filter(isRem), ...arr.filter(j => !isRem(j))];
      }
      if (!center) return filterByLocation(list, loc); // search geocode failed → coarse city/state
      return (list || [])
        .filter(hasUsableCoords) // drop NULL / (0,0) — unknown location, can't be distance-checked
        .map(j => ({ j, d: haversineMiles(center, j) }))
        .filter(x => x.d <= radiusMiles + 1) // 1mi buffer for border rounding
        .sort((a, b) => a.d - b.d)
        .map(x => x.j);
    };
    // Widen ranking (never-empty path): keep everything, nearest-first, no radius cap. Unknown
    // coords (NULL / 0,0) sort last (Infinity) rather than being placed at a bogus (0,0) point.
    const rankByDistanceKeepAll = (list) => {
      if (!loc) return Array.isArray(list) ? list : [];
      if (!center) return sortByProximity(list, loc);
      return (list || [])
        .map((j, i) => ({ j, d: hasUsableCoords(j) ? haversineMiles(center, j) : Infinity, i }))
        .sort((a, b) => (a.d - b.d) || (a.i - b.i))
        .map(x => x.j);
    };

    // ── DB-FIRST search ──────────────────────────────────────────────────────
    // Serve from our own jobs corpus, relevance-filtered to the query (and to the
    // company, for company-name searches). Only top up from the live API when we
    // have fewer than TARGET related listings — so as the corpus grows we API-call
    // less and less. The fetched top-up is stored back, growing the corpus further.
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const now = encodeURIComponent(new Date().toISOString());
        const t3filter = buildFallbackFilter(qNorm);
        const qEnc = encodeURIComponent(qNorm);

        // Geocode the searched place FIRST (cached in geocode_cache — usually one fast DB read)
        // so the DB query itself is geo-scoped. THE SCALE FIX: we never fetch the whole ~22k
        // corpus and haversine it in Node. Overlap the geocode with the cheap expansion +
        // aggregation-target reads that don't depend on it.
        const [expansion, tgtRows, centerResolved] = await Promise.all([
          getQueryExpansion(qNorm, SUPABASE_URL, dbHeaders),
          // Admin-tunable aggregation target (feature_flags.job_search_target.percentage).
          fetch(`${SUPABASE_URL}/rest/v1/feature_flags?flag_name=eq.job_search_target&select=percentage&limit=1`, { headers: dbHeaders })
            .then(r => r.ok ? r.json() : []).catch(() => []),
          // 'remote' is not a place: skip geocoding (a null center + remote loc also skips the
          // distance filter below).
          loc && !isRemote ? geocodeLocation(loc, SUPABASE_URL, SUPABASE_SERVICE_KEY) : Promise.resolve(null),
        ]);
        center = centerResolved;

        // DB-side geo scope applied to EVERY pool query:
        //  • center resolved → indexed bounding-box range scan (jobs_latlng_idx, migration 033),
        //    NULL/(0,0) excluded. The DB returns only rows near the point — Node never loads the
        //    corpus; the exact-circle haversine refine (applyRadius) runs on the ≤60-row page.
        //  • geocode failed  → coarse `location ilike city/state` text (honest degrade).
        //  • remote/national → no geo scope.
        // The box (not the old exact-city text) is what lets a radius search surface NEARBY
        // cities — Irvine/Santa Ana for a "Tustin" search — instead of only name matches.
        const locTerm = locationDbTerm(loc);
        const textClause = locTerm ? `&location=ilike.*${encodeURIComponent(locTerm)}*` : '';
        const geoClause = isRemote ? '' : (center ? geoBoxClause(center, radiusMiles) : textClause);

        // Below TARGET related listings → top up from the live API. Admin lowers this
        // to calm aggregation, raises it to aggregate harder. Clamped to a sane range.
        // Aggregate whenever we have fewer than TARGET genuinely-relevant in-radius listings
        // — a full page, so even a niche query (budtender) fires a fresh Adzuna pull instead
        // of showing a thin/empty board. Admin-tunable; sane default 25.
        const tp = parseInt(tgtRows?.[0]?.percentage, 10);
        const TARGET = Number.isFinite(tp) && tp > 0 ? Math.min(60, Math.max(5, tp)) : 25;

        canonical = expansion.canonical || qNorm;
        // DETERMINISTIC (no-AI) expansion — the curated role families bridge "theft prevention"
        // → "asset protection", "warehouse" → "material handler" even though the LLM expansion
        // has been dormant since 2026-07-03 (owner directive: no paid AI). Merge with any LLM
        // related terms so the bridge exists on EVERY search, not just cached ones.
        const curatedRelated = expandQueryTerms(qNorm);
        relatedTerms = [...new Set([...(expansion.related || []), ...curatedRelated])].filter(Boolean);
        // Pool reads: the ORIGINAL query FIRST (so rows stamped search_query=<query> — the
        // "Asset Protection Specialist" fetched for "theft prevention" — surface even when the
        // canonical differs), then canonical + related, deduped, capped to bound the parallel reads.
        searchTerms = [...new Set([qNorm, canonical, ...relatedTerms].filter(Boolean))].slice(0, 6);
        // Relevance is judged against the ORIGINAL query; the canonical + expansion terms
        // are passed as SYNONYMS (matched as phrases against the TITLE, generic single
        // words dropped). This keeps real synonyms ("SWE" → "Software Engineer") while
        // closing the leak where a loose expansion token ("sales") pulled in a "Sales
        // Manager" for a "budtender" search. relevanceQuery stays the raw user query.
        relevanceQuery = safeQuery;
        synonyms = searchTerms;

        // Keyword-fallback + company-column pool reads, geo-scoped by the DB (bbox ANDs with
        // the query filters). Company-column match surfaces ANY company name, not just the
        // hardcoded buildFallbackFilter set.
        const [kwRows, coRows] = await Promise.all([
          t3filter
            ? fetch(`${SUPABASE_URL}/rest/v1/jobs?${t3filter}${geoClause}&expires_at=gt.${now}&limit=60`, { headers: dbHeaders })
                .then(r => r.ok ? r.json() : []).catch(() => [])
            : Promise.resolve([]),
          fetch(`${SUPABASE_URL}/rest/v1/jobs?company=ilike.*${qEnc}*${geoClause}&expires_at=gt.${now}&limit=60`, { headers: dbHeaders })
            .then(r => r.ok ? r.json() : []).catch(() => []),
        ]);

        // Search both search_query and title columns so jobs cached under different
        // query keys still surface for synonymous searches.
        const termRows = await Promise.all(
          searchTerms.map(term => {
            const orFilter = `or=${encodeURIComponent(`(search_query.ilike.*${term}*,title.ilike.*${term}*)`)}`;
            return fetch(`${SUPABASE_URL}/rest/v1/jobs?${orFilter}${geoClause}&expires_at=gt.${now}&limit=60`, { headers: dbHeaders })
              .then(r => r.ok ? r.json() : []).catch(() => []);
          })
        );

        // Pool everything, dedup, then keep only listings RELATED to the query,
        // ranked by relevance (title > company > description) then quality score.
        const pool = [], seen = new Set();
        for (const arr of [coRows, ...termRows, kwRows]) {
          for (const row of (Array.isArray(arr) ? arr : [])) {
            const key = row.id ?? `${(row.title||'').toLowerCase()}|${(row.company||'').toLowerCase()}|${(row.location||'').toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            pool.push(row);
          }
        }
        dbMatches = filterAndRank(pool, relevanceQuery, { synonyms, canonical }).map(j => ({
          id: j.id || null, // keep the DB id — without it /jobs/<id> permalinks can never resolve
          title: j.title, company: j.company, location: j.location || loc,
          salary: j.salary, url: j.apply_url || j.url || null, description: j.description,
          type: j.type || 'Full-time', level: inferLevel(j.title || ''),
          source: j.source || 'Seen', ...scoreRow(j),
          search_query: j.search_query || null, // provenance for the merged re-filter downstream
          lat: j.lat ?? null, lng: j.lng ?? null, posted_at: j.created_at || null,
        }));
        // Keep only listings within the searched radius (true distance when we have
        // coordinates, else coarse city → state), nearest first.
        dbMatches = applyRadius(dbMatches);

        if (dbMatches.length >= TARGET) {
          console.log(`DB HIT: "${query}" → "${canonical}" @ "${loc}" (${radiusMiles}mi) — ${dbMatches.length} in-radius results (no API call)`);
          return res.status(200).json({ ok: true, jobs: applyFeatured(dropSuppressed(dbMatches.slice(0, 60), suppressedSet), featuredSet), query, location: loc, _src: 'db' });
        }
      } catch(e) { console.warn('DB-first search error:', e.message); }
      console.log(`DB TOP-UP: "${query}" → "${canonical}" @ "${loc}" — ${dbMatches.length} in DB, pulling more from API`);
    }

    // ── Scale guard #1: dedupe/cooldown ──────────────────────────────────────────
    // The corpus is thin by design, so a niche/first-time query legitimately drops here.
    // But we must NOT re-pull the SAME (query, location) from Adzuna on every repeat within
    // a short window — the last pull already stored everything it found (fresh for 14 days).
    // If we pulled this (query, location) recently, serve the cached DB rows and SKIP the
    // external call. Fail-open (a missing table / DB blip → allow the pull); the global
    // aggregation budget below is the always-on backstop.
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY &&
        await wasRecentlyPulled(canonical, loc, SUPABASE_URL, SUPABASE_SERVICE_KEY)) {
      let cached = dbMatches.slice(0, 60);
      // A recent pull already stored everything Adzuna had for this (query, location), so we skip
      // the paid re-pull — but a THIN boxed page must not surface as "1 result" when we hold plenty
      // just outside the box. Fill from our own corpus (query-relevant, nearest-first) — pure DB.
      if (cached.length < PAGE_MIN) {
        const corpus = await corpusRelevant({ supabaseUrl: SUPABASE_URL, dbHeaders, terms: searchTerms, query: relevanceQuery, canonical, synonyms, center, loc, limit: 60 });
        cached = dedupByIdentity([...cached, ...corpus]).slice(0, 60);
      }
      if (!cached.length) cached = await nearestListings(loc, SUPABASE_URL, dbHeaders);
      console.log(`COOLDOWN: "${canonical}" @ "${loc}" pulled recently — serving ${cached.length} cached (no API call)`);
      return res.status(200).json({ ok: true, jobs: applyFeatured(dropSuppressed(cached, suppressedSet), featuredSet), query, location: loc, _src: 'db-cooldown' });
    }

    // ── Expensive live top-up: BUDGETED, never user-blocking ─────────────────────
    // Live aggregation (Adzuna pulls + first-time LLM expansion) is the only costly part
    // of a search. It's capped per bucket AND by a global platform budget so 10k users
    // searching at once can't stampede external spend — and when the budget is out we
    // serve what the corpus already has (degraded), never a 429: search must never go
    // blank over budget.
    const [topupBucket, topupGlobal] = await Promise.all([
      rateLimit(req, 'job-search-topup', { bucketKey: rlBucket.key }),
      rateLimitGlobal('agg-global'),
    ]);
    if (!topupBucket.allowed || !topupGlobal.allowed) {
      let degradedJobs = dbMatches.slice(0, 60);
      // Budget's out for the paid pull, but the corpus is free — fill a thin page from what we
      // already hold (query-relevant, nearest-first) before falling back to query-agnostic nearest.
      if (degradedJobs.length < PAGE_MIN) {
        const corpus = await corpusRelevant({ supabaseUrl: SUPABASE_URL, dbHeaders, terms: searchTerms, query: relevanceQuery, canonical, synonyms, center, loc, limit: 60 });
        degradedJobs = dedupByIdentity([...degradedJobs, ...corpus]).slice(0, 60);
      }
      if (!degradedJobs.length) degradedJobs = await nearestListings(loc, SUPABASE_URL, dbHeaders);
      console.log(`DEGRADED (top-up budget out — bucket:${topupBucket.allowed} global:${topupGlobal.allowed}): "${query}" @ "${loc}" — ${degradedJobs.length} DB results`);
      return res.status(200).json({ ok: true, jobs: applyFeatured(dropSuppressed(degradedJobs, suppressedSet), featuredSet), query, location: loc, _src: 'db-degraded', degraded: true });
    }

    // ── Not enough in our corpus → aggregate LIVE from keyless sources ───────────
    // Pull fresh listings from Adzuna for the canonical query (+ expansion terms) at
    // this location, SAVE them — jobs AND their companies — to the DB, then merge with
    // what we already had. Every under-served search grows the corpus, so popular
    // searches get progressively faster (more DB hits) and our data compounds over time.
    // Coalesce concurrent identical searches into one live aggregation.
    inflightKey = `${canonical}::${loc}`;
    if (_inflight.has(inflightKey)) {
      console.log(`COALESCED: "${canonical}" @ "${loc}" — waiting on in-flight aggregation`);
      try {
        const coalesced = await _inflight.get(inflightKey);
        return res.status(200).json({ ok: true, ...coalesced, _src: 'coalesced' });
      } catch(e) { /* fall through to run our own */ }
    }

    const inflightPromise = new Promise((resolve, reject) => { _inflightResolve = resolve; _inflightReject = reject; });
    _inflight.set(inflightKey, inflightPromise);
    setTimeout(() => _inflight.delete(inflightKey), 90_000);

    let jobs = [];
    try {
      // Multi-source expansion: employer-direct ATS (registered Greenhouse/Lever/Ashby/… boards
      // matching the query's company) FIRST, then Adzuna as the demoted gap-filler — and snowball
      // any ATS tenant the results reveal into the source registry. Every valid discovery persists
      // to the shared corpus, so the next user benefits without a live fetch.
      const agg = await aggregateWithSources({
        query: canonical,
        location: loc,
        relatedTerms,
        supabaseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_KEY,
        adzunaAppId: process.env.ADZUNA_APP_ID,
        adzunaAppKey: process.env.ADZUNA_APP_KEY,
        distanceKm, // Adzuna scopes the live pull to the searched radius
      });
      // Record the pull so an identical repeat search within the cooldown window serves the
      // now-cached rows instead of hitting Adzuna again (fire-and-forget; only after a real
      // pull ran, so a failure never locks out retries).
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) recordPull(canonical, loc, agg.jobs?.length || 0, SUPABASE_URL, SUPABASE_SERVICE_KEY);
      // Map the freshly-saved listings into the UI shape, then relevance + radius filter.
      jobs = (agg.jobs || []).map(j => ({
        id: j.id || null, // keep the DB id when the upsert returned one
        title: j.title, company: j.company, location: j.location || loc,
        salary: j.salary, url: j.apply_url || j.url || null, description: j.description,
        type: j.type || 'Full-time', level: inferLevel(j.title || ''),
        source: j.source || 'Seen', ...scoreRow(j),
        search_query: j.search_query || null, // provenance survives into the relevance filter
        lat: j.lat ?? null, lng: j.lng ?? null, posted_at: j.created_at || null,
      }));
      jobs = applyRadius(filterAndRank(jobs, relevanceQuery, { synonyms, canonical }));
      console.log(`AGGREGATED: "${query}" → "${canonical}" @ "${loc}" — ${agg.jobs?.length || 0} fetched, ${agg.upserted || 0} saved, ${jobs.length} relevant`);
      if (SUPABASE_URL && SUPABASE_SERVICE_KEY) _logSearch(canonical, loc, jobs.length, SUPABASE_URL, dbHeaders);
    } catch (e) {
      console.warn('aggregateForQuery error:', e.message);
    }

    // Merge the listings already in our DB with the fresh aggregated results
    // (deduped, relevance-ranked) so the user always gets the fullest related set.
    const mergedSeen = new Set();
    const merged = [];
    for (const j of [...dbMatches, ...jobs]) {
      const key = `${(j.title||'').toLowerCase()}|${(j.company||'').toLowerCase()}|${(j.location||'').toLowerCase()}`;
      if (mergedSeen.has(key)) continue;
      mergedSeen.add(key);
      merged.push(j);
    }
    let finalJobs = applyRadius(filterAndRank(merged, relevanceQuery, { synonyms, canonical })).slice(0, 60);
    let widened = false;
    // A niche/sparse query should still return a FULL page (owner directive). Below PAGE_MIN
    // in-radius results we widen to fill it — closest listings always lead (rankByDistanceKeepAll),
    // so the radius is honored in RANK even as farther-out matches fill the rest of the page. A
    // query that already has a full page never widens. (PAGE_MIN is declared in the outer scope.)

    // ── Fill a thin page by widening GEOGRAPHICALLY, not nationwide ───────────────
    // A radius search can come up thin (a role that's sparse within, say, 10mi) even
    // though it's plentiful a bit farther out. Rather than teleport to national results
    // (jumping to jobs 100s–1000s of miles away), first EXPAND the radius around the same
    // place, so "nearby" stays nearby. Only if that's still empty do we fall back to a
    // national pull. rankByDistanceKeepAll always shows the closest listings first.
    const toUi = j => ({
      id: j.id || null, // keep the DB id — /jobs/<id> permalinks depend on it
      title: j.title, company: j.company, location: j.location || loc,
      salary: j.salary, url: j.apply_url || j.url || null, description: j.description,
      type: j.type || 'Full-time', level: inferLevel(j.title || ''),
      source: j.source || 'Seen', ...scoreRow(j),
      search_query: j.search_query || null,
      lat: j.lat ?? null, lng: j.lng ?? null, posted_at: j.created_at || null,
    });
    const dedupJobs = arr => {
      const s = new Set(), out = [];
      for (const j of arr) {
        const key = `${(j.title||'').toLowerCase()}|${(j.company||'').toLowerCase()}|${(j.location||'').toLowerCase()}`;
        if (s.has(key)) continue; s.add(key); out.push(j);
      }
      return out;
    };

    // Stage 1 — expand the radius around the SAME location (≈4× the radius, 60–250mi) when
    // the in-radius page is thin (< PAGE_MIN). Closest listings still lead, so a real
    // in-radius result is never buried — we only ADD farther matches to fill an otherwise
    // sparse page (the niche-query case the owner wants full). A full page never widens.
    if (finalJobs.length < PAGE_MIN && loc) {
      widened = finalJobs.length === 0; // only a truly-empty in-radius page counts as "widened" in the response flag
      const expandedMiles = Math.min(250, Math.max(radiusMiles * 4, 60));
      let wideJobs = [];
      try {
        const wide = await aggregateForQuery({
          query: canonical, location: loc, relatedTerms,
          supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY,
          adzunaAppId: process.env.ADZUNA_APP_ID, adzunaAppKey: process.env.ADZUNA_APP_KEY,
          distanceKm: milesToKm(expandedMiles),
        });
        wideJobs = (wide.jobs || []).map(toUi);
        console.log(`WIDENED (geo): "${query}" expanded ${radiusMiles}→${expandedMiles}mi, ${finalJobs.length} in-radius, added ${wideJobs.length}`);
      } catch (e) { console.warn('geo-widen error:', e.message); }
      // ALSO re-read our OWN corpus at the wider radius — the geo-boxed pool never saw the jobs
      // we already hold just outside the box (the 9 Target listings within 100mi of a small city
      // the 25mi box hid). Pure DB; complements the paid Adzuna widen instead of relying on it.
      const corpusWide = await corpusRelevant({ supabaseUrl: SUPABASE_URL, dbHeaders, terms: searchTerms, query: relevanceQuery, canonical, synonyms, center, loc, limit: 60 });
      finalJobs = rankByDistanceKeepAll(filterAndRank(dedupJobs([...merged, ...wideJobs, ...corpusWide]), relevanceQuery, { synonyms, canonical })).slice(0, 60);
    }

    // Stage 2 — national query (no location) that's empty, or nothing within the expanded
    // radius: pull nationally as the last broadening step, still ranked nearest-first.
    if (finalJobs.length === 0) {
      widened = true;
      let wideJobs = [];
      try {
        const wide = await aggregateForQuery({
          query: canonical, location: '', relatedTerms,
          supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY,
          adzunaAppId: process.env.ADZUNA_APP_ID, adzunaAppKey: process.env.ADZUNA_APP_KEY,
        });
        wideJobs = (wide.jobs || []).map(toUi);
        console.log(`WIDENED (national): "${query}" added ${wideJobs.length}`);
      } catch (e) { console.warn('national-widen error:', e.message); }
      finalJobs = rankByDistanceKeepAll(filterAndRank(dedupJobs([...merged, ...wideJobs]), relevanceQuery, { synonyms, canonical })).slice(0, 60);
    }

    // ── Absolute last resort ─────────────────────────────────────────────────────
    // The query matched nothing anywhere (typo/nonsense/brand-new niche). Show the
    // nearest available listings regardless of query so the board is never empty.
    if (!finalJobs.length) {
      widened = true;
      finalJobs = await nearestListings(loc, SUPABASE_URL, dbHeaders);
      console.log(`NEAREST FALLBACK: "${query}" @ "${loc}" — ${finalJobs.length} nearby listings`);
    }

    const result = { jobs: applyFeatured(dropSuppressed(finalJobs, suppressedSet), featuredSet), query, location: loc, radius: radiusMiles, _src: widened ? 'widened' : (jobs.length ? 'aggregated' : 'db'), widened };
    _inflightResolve?.(result);
    _inflight.delete(inflightKey);
    return res.status(200).json({ ok: true, ...result });

  } catch(err) {
    console.error('Jobs error:', err.message);
    logError('jobs', err.message, { query: safeQuery, loc });
    _inflightReject?.(err);
    _inflight.delete(inflightKey);
    // Graceful degradation: the live API call failed (billing/rate-limit/outage), but if
    // we already pulled related listings from our own corpus, serve those rather than an
    // empty error — search should never go blank just because the top-up couldn't run.
    if (dbMatches.length) {
      return res.status(200).json({ ok: true, jobs: dbMatches.slice(0, 60), query: safeQuery, location: loc, _src: 'db-fallback' });
    }
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}

// Dedup UI rows by their title|company|location identity (first occurrence wins).
function dedupByIdentity(arr) {
  const seen = new Set(), out = [];
  for (const j of (arr || [])) {
    if (!j) continue;
    const key = `${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}|${(j.location || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
}

// ── Query-relevant listings from our OWN corpus, WITHOUT the tight geo box ────────────────────
// The geo-boxed pool reads only see jobs within the searched radius — so the 9 Target listings we
// already hold within 100mi of a small city (but outside a 25mi box) stay invisible, and a thin
// page shows "1 result" when we have plenty nearby. This reads the corpus for the query's terms
// with NO box, applies the SAME relevance bar, and ranks nearest-first. Pure DB — no paid pull —
// so it's safe to call on the cooldown / degraded / geo-widen paths. Never throws.
async function corpusRelevant({ supabaseUrl, dbHeaders, terms, query, canonical, synonyms, center, loc, limit = 60 }) {
  if (!supabaseUrl) return [];
  const now = encodeURIComponent(new Date().toISOString());
  const cols = 'id,created_at,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,search_query,lat,lng';
  const uniq = [...new Set((terms || []).map(t => String(t || '').toLowerCase().trim()).filter(t => t.length > 1))].slice(0, 6);
  if (!uniq.length) return [];
  try {
    const arrays = await Promise.all(uniq.map(t => {
      const orf = `or=${encodeURIComponent(`(company.ilike.*${t}*,title.ilike.*${t}*,search_query.ilike.*${t}*)`)}`;
      return fetch(`${supabaseUrl}/rest/v1/jobs?${orf}&expires_at=gt.${now}&select=${cols}&limit=120`, { headers: dbHeaders })
        .then(r => r.ok ? r.json() : []).catch(() => []);
    }));
    const pool = [], seen = new Set();
    for (const arr of arrays) for (const row of (Array.isArray(arr) ? arr : [])) {
      const key = row.id ?? `${(row.title || '').toLowerCase()}|${(row.company || '').toLowerCase()}|${(row.location || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(row);
    }
    let rel = filterAndRank(pool, query, { synonyms, canonical });
    // Nearest-first (unknown coords last), relevance order as the tiebreak.
    if (center && hasUsableCoords(center)) {
      rel = rel.map((j, i) => ({ j, d: hasUsableCoords(j) ? haversineMiles(center, j) : Infinity, i }))
        .sort((a, b) => (a.d - b.d) || (a.i - b.i)).map(x => x.j);
    } else if (loc) {
      rel = sortByProximity(rel, loc);
    }
    return rel.slice(0, limit).map(j => ({
      id: j.id || null,
      title: j.title, company: j.company, location: j.location || loc,
      salary: j.salary, url: j.apply_url || j.url || null, description: j.description,
      type: j.type || 'Full-time', level: inferLevel(j.title || ''),
      source: j.source || 'Seen', ...scoreRow(j),
      search_query: j.search_query || null,
      lat: j.lat ?? null, lng: j.lng ?? null, posted_at: j.created_at || null,
    }));
  } catch (e) {
    console.warn('corpusRelevant error:', e.message);
    return [];
  }
}

// Last-resort listings so a search is NEVER empty: nearest non-expired jobs regardless
// of query (city → state), else the most recent quality listings anywhere.
async function nearestListings(loc, supabaseUrl, dbHeaders) {
  if (!supabaseUrl) return [];
  const now = encodeURIComponent(new Date().toISOString());
  // id + created_at must be in the select — without them mapUi's id was always null and
  // /jobs/<id> permalinks from this fallback path could never resolve.
  const cols = 'id,created_at,title,company,location,salary,apply_url,description,type,level,source,score,waste_score';
  const mapUi = rows => (Array.isArray(rows) ? rows : []).map(j => ({
    id: j.id || null,
    title: j.title, company: j.company, location: j.location,
    salary: j.salary, url: j.apply_url, description: j.description,
    type: j.type || 'Full-time', level: inferLevel(j.title || ''),
    source: j.source || 'Seen', ...scoreRow(j),
    posted_at: j.created_at || null,
  }));
  try {
    const term = locationDbTerm(loc);
    if (term) {
      const r = await fetch(`${supabaseUrl}/rest/v1/jobs?location=ilike.*${encodeURIComponent(term)}*&expires_at=gt.${now}&select=${cols}&order=score.desc&limit=24`, { headers: dbHeaders });
      const rows = r.ok ? await r.json() : [];
      if (Array.isArray(rows) && rows.length) return mapUi(rows);
    }
    // Nothing local — surface the most recently-seen quality listings anywhere.
    const r2 = await fetch(`${supabaseUrl}/rest/v1/jobs?expires_at=gt.${now}&select=${cols}&order=last_seen_at.desc&limit=24`, { headers: dbHeaders });
    return mapUi(r2.ok ? await r2.json() : []);
  } catch (e) {
    console.warn('nearestListings error:', e.message);
    return [];
  }
}

// Fire-and-forget search log — if search_logs table doesn't exist yet, fails silently
function _logSearch(query, location, resultCount, supabaseUrl, headers) {
  fetch(`${supabaseUrl}/rest/v1/search_logs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ query, location: location || '', result_count: resultCount, source: 'api' }),
  }).catch(() => {});
}

// ── Keyword fallback filter ───────────────────────────────────────────────────
// Last-resort DB filter when no expansion term produced results.
// Routes known company names to the company column, everything else to title.
const COMPANIES = new Set([
  'amazon','walmart','target','costco','kroger','cvs','walgreens',
  'ups','fedex','usps','dhl',
  'google','apple','microsoft','meta','netflix','tesla','uber','lyft',
  'doordash','instacart','airbnb','stripe','shopify','salesforce','oracle',
  'ibm','cisco','intel','nvidia',
  'mcdonalds','starbucks','chipotle','dominos',
  'disney','nike','ford','gm','boeing','lockheed',
  'jpmorgan','chase','bankofamerica','wellsfargo','citigroup',
  'pfizer','johnson','unitedhealth','humana','merck','abbvie',
  'deloitte','accenture','kpmg',
]);

function buildFallbackFilter(q) {
  const STOP = new Set([
    'and','or','the','a','an','in','at','for','with','of','to','by','is','are',
    'job','jobs','position','positions','role','roles','work','near','remote',
    'hiring','wanted','open','full','part','time','entry','level',
  ]);
  const words = q.split(/\s+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length > 1 && !STOP.has(w))
    .slice(0, 5);

  if (!words.length) return null;

  const conditions = [];
  // Full phrase match first (most specific — catches "machine learning engineer" as a unit)
  if (words.length > 1) conditions.push(`title.ilike.*${words.join(' ')}*`);

  // Individual word matches (OR — any word is a useful signal)
  for (const w of words) {
    conditions.push(COMPANIES.has(w) ? `company.ilike.*${w}*` : `title.ilike.*${w}*`);
  }

  if (conditions.length === 1) {
    const [col, op, val] = conditions[0].split('.');
    return `${col}=${op}.${val}`;
  }
  return `or=${encodeURIComponent(`(${conditions.join(',')})`)}`;
}

// ── handleCompanyJobs: DB lookup + live search for a specific company ─────────
async function handleCompanyJobs(req, res, body) {
  const { company } = body;
  if (!company || typeof company !== 'string') return res.status(400).json({ error: 'company required', jobs: [] });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'DB unavailable', jobs: [] });

  const dbHeaders = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
  const safeName = company.trim().slice(0, 100).replace(/[<>`\\]/g, '');
  const now = encodeURIComponent(new Date().toISOString());

  // Check DB first (non-expired listings for this company)
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/jobs?company=ilike.*${encodeURIComponent(safeName)}*&expires_at=gt.${now}&select=id,title,company,location,salary,apply_url,source,type,level,score,waste_score&order=score.desc&limit=20`,
      { headers: dbHeaders }
    );
    const cached = r.ok ? await r.json() : [];
    if (Array.isArray(cached) && cached.length >= 3) {
      const jobs = cached.map(j => ({ title: j.title, company: j.company, location: j.location, salary: j.salary, url: j.apply_url, source: j.source, type: j.type, level: inferLevel(j.title || ''), ...scoreRow(j) }));
      return res.status(200).json({ ok: true, jobs, _src: 'cache' });
    }
  } catch(e) { console.warn('company_jobs cache:', e.message); }

  // No cached jobs — aggregate LIVE from keyless sources (Adzuna), saving the jobs AND
  // creating the company. Keyed by the company name so future visits hit the DB cache.
  // Draws from the same GLOBAL aggregation budget as the main search — when it's out,
  // return the (thin) DB result instead of spending; the cron refresh will fill in.
  try {
    const budget = await rateLimitGlobal('agg-global');
    if (!budget.allowed) {
      console.log(`COMPANY DEGRADED (global agg budget out): "${safeName}"`);
      return res.status(200).json({ ok: true, jobs: [], _src: 'db-degraded', degraded: true });
    }
    // Employer-direct first: if this company has a registered ATS board, pull it straight from the
    // source (real openings, real apply URLs), then Adzuna as fallback. Snowballs new tenants too.
    const agg = await aggregateWithSources({
      query: safeName,
      location: '',
      supabaseUrl: SUPABASE_URL,
      serviceKey: SUPABASE_SERVICE_KEY,
      adzunaAppId: process.env.ADZUNA_APP_ID,
      adzunaAppKey: process.env.ADZUNA_APP_KEY,
    });
    // Adzuna's keyword match can surface adjacent roles — keep only listings actually
    // at this company (normalized name overlaps either direction).
    const target = safeName.toLowerCase();
    const jobs = (agg.jobs || [])
      .filter(j => {
        const co = (j.company || '').toLowerCase();
        return co && (co.includes(target) || target.includes(co));
      })
      .map(j => ({
        title: j.title, company: j.company, location: j.location,
        salary: j.salary, url: j.apply_url || j.url || null, description: j.description,
        source: j.source, type: j.type, level: inferLevel(j.title || ''),
        ...scoreRow(j),
      }));
    console.log(`COMPANY AGGREGATED: "${safeName}" — ${agg.jobs?.length || 0} fetched, ${agg.upserted || 0} saved, ${jobs.length} matched`);
    return res.status(200).json({ ok: true, jobs, _src: 'aggregated' });
  } catch(e) {
    logError('company_jobs', e.message, { company: safeName });
    return res.status(200).json({ ok: true, jobs: [], _src: 'error' });
  }
}

// ── handleRecommended: personalized jobs from resume_skills ──────────────────
async function handleRecommended(req, res, _body) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'DB unavailable', jobs: [] });

  // Verify the JWT signature before trusting its user_id (previously the payload was
  // base64-decoded with no signature check — trivially forgeable).
  const user_id = await _resolveUid(req);
  if (!user_id) return res.status(401).json({ error: 'Auth required', jobs: [] });

  const dbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Fetch this user's extracted resume skills
    const skillsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/resume_skills?user_id=eq.${encodeURIComponent(user_id)}&select=skills,seniority,function,years_exp,top_titles&limit=1`,
      { headers: dbHeaders }
    );
    const skillsRows = skillsRes.ok ? await skillsRes.json() : [];
    if (!Array.isArray(skillsRows) || !skillsRows.length || !skillsRows[0]?.skills?.length) {
      return res.status(200).json({ ok: true, jobs: [], reason: 'no_resume' });
    }

    const { skills = [], seniority, function: fn, top_titles } = skillsRows[0];
    const topSkills = skills.slice(0, 5);
    const now = encodeURIComponent(new Date().toISOString());

    // The résumé's real ROLE (title first, else function, else strongest skill) — a
    // high-recall query that catches listings pure skill-matching misses: a "Budtender"
    // whose skills are "customer service, POS" would otherwise never surface a budtender
    // listing. Same derivation the parse-time warm uses.
    const roleQuery = deriveResumeJobQuery({ top_titles, function: fn, skills });

    // Map resume seniority to job level filter terms
    const levelTerms = { junior: 'entry', mid: 'mid', senior: 'senior', staff: 'senior', principal: 'senior', executive: 'director' };
    const levelFilter = seniority ? levelTerms[seniority] : null;

    // Parallel queries: title matches (strong signal) + description matches (weak signal)
    const titleQueries = topSkills.slice(0, 3).map(skill => {
      const safe = skill.replace(/[^a-zA-Z0-9\s\-+#.]/g, '').trim().slice(0, 40);
      if (!safe) return Promise.resolve([]);
      const url = `${SUPABASE_URL}/rest/v1/jobs?title=ilike.*${encodeURIComponent(safe)}*&expires_at=gt.${now}&select=id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score&order=score.desc&limit=8`;
      return fetch(url, { headers: dbHeaders }).then(r => r.ok ? r.json() : []).catch(() => []);
    });

    const descQueries = topSkills.slice(0, 2).map(skill => {
      const safe = skill.replace(/[^a-zA-Z0-9\s\-+#.]/g, '').trim().slice(0, 40);
      if (!safe) return Promise.resolve([]);
      const url = `${SUPABASE_URL}/rest/v1/jobs?description=ilike.*${encodeURIComponent(safe)}*&expires_at=gt.${now}&select=id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score&order=score.desc&limit=5`;
      return fetch(url, { headers: dbHeaders }).then(r => r.ok ? r.json() : []).catch(() => []);
    });

    // Role-title match — listings whose TITLE is the résumé's actual role (e.g. "budtender"),
    // the signal skill-matching alone misses. Cheap DB read, folded into the same round-trip.
    const roleTitleQuery = roleQuery
      ? [fetch(`${SUPABASE_URL}/rest/v1/jobs?title=ilike.*${encodeURIComponent(roleQuery.slice(0, 40))}*&expires_at=gt.${now}&select=id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score&order=score.desc&limit=10`, { headers: dbHeaders }).then(r => r.ok ? r.json() : []).catch(() => [])]
      : [];

    const allResults = await Promise.all([...titleQueries, ...descQueries, ...roleTitleQuery]);

    // Deduplicate
    const seenIds = new Set();
    const unique = allResults.flat().filter(j => {
      if (!j?.id || seenIds.has(j.id)) return false;
      seenIds.add(j.id);
      return true;
    });

    // ── Floor: a résumé rail is NEVER allowed to be thin ──────────────────────────
    // If our corpus doesn't have enough for this résumé yet (niche role / cold start), pull
    // LIVE for the résumé's role through the SAME aggregation the search uses — inheriting its
    // 3h cooldown + global-budget guards (no second uncapped pull). A niche résumé still fills.
    // Best-effort: on cooldown/budget skip we simply serve the DB rows we have.
    const RECS_MIN = 6;
    if (unique.length < RECS_MIN && roleQuery) {
      const floor = await pullResumeJobFloor({
        query: roleQuery,
        location: '', // the rail's DB queries aren't geo-scoped — a national role pull fills it
        supabaseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_KEY,
        adzunaAppId: process.env.ADZUNA_APP_ID,
        adzunaAppKey: process.env.ADZUNA_APP_KEY,
      });
      // Relevance-filter the live pull against the role using the SAME ranker the search uses,
      // so the rail only gains genuinely on-role listings — then merge what's new. Curated
      // role-family synonyms bridge the résumé's role title to differently-titled listings.
      const floorRelevant = filterAndRank(floor.jobs || [], roleQuery, { synonyms: expandQueryTerms(roleQuery), canonical: roleQuery });
      for (const j of floorRelevant) {
        const key = j.id || j.apply_url || `${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}`;
        if (!key || seenIds.has(key)) continue;
        seenIds.add(key);
        unique.push({
          id: j.id || null, title: j.title, company: j.company, location: j.location,
          salary: j.salary, apply_url: j.apply_url || j.url || null, description: j.description,
          type: j.type || 'Full-time', level: j.level, source: j.source || 'Seen',
          score: j.score, waste_score: j.waste_score,
        });
      }
    }

    // Rank by skill overlap relevance
    const skillsLower = skills.map(s => s.toLowerCase());
    const ranked = unique.map(j => {
      const titleL = (j.title || '').toLowerCase();
      const descL = (j.description || '').toLowerCase();
      let matchScore = scoreRow(j).score;
      for (const s of skillsLower.slice(0, 5)) { if (titleL.includes(s)) matchScore += 10; }
      let descHits = 0;
      for (const s of skillsLower) { if (descL.includes(s)) descHits++; }
      matchScore += Math.min(descHits * 2, 12);
      if (levelFilter && (j.level || '').toLowerCase().includes(levelFilter)) matchScore += 5;
      return { ...j, _matchScore: matchScore };
    });
    ranked.sort((a, b) => b._matchScore - a._matchScore);

    const jobs = ranked.slice(0, 8).map(j => ({
      id: j.id,
      title: j.title,
      company: j.company,
      location: j.location,
      salary: j.salary,
      apply_url: j.apply_url,
      description: j.description,
      type: j.type || 'Full-time',
      level: inferLevel(j.title || ''),
      source: j.source || 'Seen',
      ...scoreRow(j),
    }));

    return res.status(200).json({ ok: true, jobs, skills: topSkills.slice(0, 3), seniority, function: fn });
  } catch (e) {
    logError('jobs/recommended', e.message, { user_id });
    return res.status(500).json({ error: e.message, jobs: [] });
  }
}

// ── handleLocationJobs: merged from api/fetch-location-jobs.js ────────────────
const _STATE_ABBR = {'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','District of Columbia':'DC'};

function _normalizeLoc(loc) {
  if (!loc) return loc;
  const parts = loc.split(',').map(p => p.trim());
  const abbr = _STATE_ABBR[parts[1] || ''] || (parts[1] || '');
  return abbr ? `${parts[0]}, ${abbr}` : parts[0];
}

const _CATS_BY_INDUSTRY = {
  tech: ['Software Engineer','Data Analyst','Product Manager','DevOps Engineer','UX Designer'],
  healthcare: ['Registered Nurse','Medical Assistant','Physical Therapist','LVN','CNA'],
  finance: ['Financial Analyst','Accountant','Business Analyst','Operations Manager','Project Manager'],
  logistics: ['Warehouse Associate','CDL Truck Driver','Operations Manager','Supply Chain Analyst','Logistics Coordinator'],
  retail: ['Customer Service Representative','Restaurant Manager','Retail Manager','Sales Representative','Store Manager'],
  other: ['Project Manager','Operations Manager','Customer Service Representative','Marketing Manager','HR Manager'],
  default: ['Customer Service Representative','Registered Nurse','Software Engineer','Sales Representative','Project Manager','Data Analyst','Accountant','Operations Manager'],
};

async function _fetchAdzuna(what, where, appId, appKey, distKm) {
  const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1');
  url.searchParams.set('app_id', appId); url.searchParams.set('app_key', appKey);
  url.searchParams.set('what', what); url.searchParams.set('results_per_page', '50'); url.searchParams.set('sort_by', 'date');
  if (where && where.toLowerCase() !== 'remote') { url.searchParams.set('where', where); if (distKm) url.searchParams.set('distance', distKm.toString()); }
  const ctrl = new AbortController(); const tmo = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(tmo); if (!res.ok) return [];
    const data = await res.json();
    const expires = new Date(Date.now() + 7*24*60*60*1000).toISOString();
    return (data.results||[]).map(j => {
      const salary = j.salary_min||j.salary_max ? (j.salary_min>=10000?`$${Math.round(j.salary_min/1000)}k`:j.salary_min>0?`$${j.salary_min}/hr`:null) : null;
      // Keep Adzuna's coordinates so location-browsed listings are distance-filterable too;
      // (0,0)/non-finite → NULL (honest "unknown"), never a bogus equator point.
      const { lat: adzLat, lng: adzLng } = sanitizeCoords(j.latitude, j.longitude);
      const mapped = {
        title: j.title||what,
        company: j.company?.display_name||'Unknown',
        location: j.location?.display_name||where,
        salary,
        salary_min: j.salary_min||0,
        description: (j.description||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,8000),
        apply_url: j.redirect_url||null,
        source: 'Adzuna',
        type: j.contract_time==='part_time'?'Part-time':'Full-time',
        level: inferLevel(j.title || ''),
        search_query: what,
        expires_at: expires,
        lat: adzLat,
        lng: adzLng,
      };
      return { ...mapped, score: scoreJob(mapped), waste_score: wasteScore(mapped) };
    }).filter(j=>j.company!=='Unknown'&&j.apply_url);
  } catch(e) { clearTimeout(tmo); return []; }
}

async function handleLocationJobs(req, res, body) {
  const APP_ID = process.env.ADZUNA_APP_ID, APP_KEY = process.env.ADZUNA_APP_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL, SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!APP_ID || !APP_KEY) return res.status(200).json({ error: 'Adzuna not configured', jobs: [] });
  try {
    const { location, industry, radius } = body;
    if (!location) return res.status(400).json({ error: 'No location', jobs: [] });
    const cats = _CATS_BY_INDUSTRY[industry] || _CATS_BY_INDUSTRY.default;
    const distKm = radius ? Math.round(parseInt(radius) * 1.609) : 40;
    const normLoc = _normalizeLoc(location), cityOnly = normLoc.split(',')[0].trim();
    let results = await Promise.allSettled(cats.slice(0,6).map(cat => _fetchAdzuna(cat, normLoc, APP_ID, APP_KEY, distKm)));
    let allJobs = results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
    if (!allJobs.length && cityOnly !== normLoc) {
      results = await Promise.allSettled(cats.slice(0,4).map(cat => _fetchAdzuna(cat, cityOnly, APP_ID, APP_KEY, distKm)));
      allJobs = results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value);
    }
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && allJobs.length) {
      // upsertJobs stamps company_id + creates any missing companies, so location
      // browsing grows the companies table too (not just jobs).
      await upsertJobs(allJobs, SUPABASE_URL, SUPABASE_SERVICE_KEY);
    }
    return res.status(200).json({ ok:true, jobs:allJobs, location });
  } catch(err) {
    logError('fetch-location-jobs', err.message);
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}
