import { createHmac, timingSafeEqual } from 'crypto';
import { getQueryExpansion } from '../lib/server/expand.js';
import { applyRateLimit, rateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { filterAndRank, filterByLocation, sortByProximity, locationDbTerm } from './_utils/jobRelevance.js';
import { aggregateForQuery, upsertJobs, inferLevel } from '../lib/server/jobSources.js';
import { scoreJob, wasteScore, scoreRow, explainListingScore } from '../lib/server/jobScore.js';
import { geocodeLocation, haversineMiles, milesToKm } from '../lib/server/geo.js';

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

  // ── Company jobs: fetch/search jobs for a specific company ─────────────────
  if (_body.action === 'company_jobs') {
    if (await applyRateLimit(req, res, 'job-search')) return;
    return handleCompanyJobs(req, res, _body);
  }

  // ── Recommended jobs: personalized from resume_skills ────────────────────
  if (_body.action === 'recommended') {
    if (await applyRateLimit(req, res, 'job-search')) return;
    return handleRecommended(req, res, _body);
  }

  // ── Get single job by ID — direct link / refresh fallback ──────────────────
  if (_body.action === 'get_by_id') {
    if (await applyRateLimit(req, res, 'job-search')) return;
    const { id } = _body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });
    const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
    if (!U || !K) return res.status(503).json({ error: 'DB unavailable' });
    try {
      const r = await fetch(
        `${U}/rest/v1/jobs?id=eq.${encodeURIComponent(id)}&select=id,title,company,location,salary,apply_url,url,description,type,level,source,score,waste_score,availability_status&limit=1`,
        { headers: { apikey: K, Authorization: `Bearer ${K}` } }
      );
      const rows = r.ok ? await r.json() : [];
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Not found' });
      // Attach the score's factor breakdown so the detail page can show WHY, not just a number.
      const job = { ...rows[0], ...scoreRow(rows[0]), score_explanation: explainListingScore(rows[0]) };
      return res.status(200).json({ job });
    } catch (e) {
      logError('jobs/get_by_id', e.message);
      return res.status(500).json({ error: 'DB error' });
    }
  }

  const limited = await applyRateLimit(req, res, 'job-search');
  if (limited) return;

  // Declare catch-block variables in outer scope so the catch handler can access them
  let safeQuery = '';
  let loc = '';
  let inflightKey = '';
  let _inflightResolve, _inflightReject;
  let dbMatches = []; // related listings already in our DB (merged with any API top-up)
  let relevanceQuery = ''; // raw query + expansion terms — what we filter relevance against

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

    // Keep a listing if it's within the radius; rank the whole list nearest-first. Jobs with
    // coordinates use true great-circle distance; legacy rows without coords fall back to the
    // coarse city → state match so they're never wrongly dropped.
    const applyRadius = (list) => {
      if (!loc) return Array.isArray(list) ? list : [];
      // Remote search: distance is meaningless — prefer listings that say remote, keep the rest.
      if (isRemote) {
        const arr = Array.isArray(list) ? list : [];
        const isRem = (j) => /\bremote\b|\bwork from home\b|\banywhere\b/i.test(`${j.location || ''} ${j.description || ''}`);
        return [...arr.filter(isRem), ...arr.filter(j => !isRem(j))];
      }
      if (!center) return filterByLocation(list, loc); // geocode failed → coarse city/state
      const withCoords = [], withoutCoords = [];
      for (const j of (list || [])) {
        if (j.lat != null && j.lng != null) withCoords.push(j); else withoutCoords.push(j);
      }
      const near = withCoords
        .map(j => ({ j, d: haversineMiles(center, j) }))
        .filter(x => x.d <= radiusMiles + 1) // 1mi buffer for border rounding
        .sort((a, b) => a.d - b.d)
        .map(x => x.j);
      return [...near, ...filterByLocation(withoutCoords, loc)];
    };
    // Widen ranking (never-empty path): keep everything, nearest-first, no radius cap.
    const rankByDistanceKeepAll = (list) => {
      if (!loc) return Array.isArray(list) ? list : [];
      if (!center) return sortByProximity(list, loc);
      return (list || [])
        .map((j, i) => ({ j, d: (j.lat != null && j.lng != null) ? haversineMiles(center, j) : Infinity, i }))
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
        // Pre-filter the pool to the searched place (city, else state) so we fetch
        // location-relevant listings — not jobs from anywhere. '' for national searches.
        const locTerm = locationDbTerm(loc);
        const locClause = locTerm ? `&location=ilike.*${encodeURIComponent(locTerm)}*` : '';

        const [expansion, kwRows, coRows, tgtRows, centerResolved] = await Promise.all([
          getQueryExpansion(qNorm, SUPABASE_URL, dbHeaders),
          t3filter
            ? fetch(`${SUPABASE_URL}/rest/v1/jobs?${t3filter}${locClause}&expires_at=gt.${now}&limit=60`, { headers: dbHeaders })
                .then(r => r.ok ? r.json() : []).catch(() => [])
            : Promise.resolve([]),
          // Company-column match so ANY company name surfaces its listings — not
          // just the hardcoded set in buildFallbackFilter.
          fetch(`${SUPABASE_URL}/rest/v1/jobs?company=ilike.*${qEnc}*${locClause}&expires_at=gt.${now}&limit=60`, { headers: dbHeaders })
            .then(r => r.ok ? r.json() : []).catch(() => []),
          // Admin-tunable aggregation target (feature_flags.job_search_target.percentage).
          fetch(`${SUPABASE_URL}/rest/v1/feature_flags?flag_name=eq.job_search_target&select=percentage&limit=1`, { headers: dbHeaders })
            .then(r => r.ok ? r.json() : []).catch(() => []),
          // Geocode the searched place once (cached) — overlapped with the DB reads.
          // 'remote' is not a place: skip geocoding (a null center + remote loc also skips
          // the radius filter below).
          loc && !isRemote ? geocodeLocation(loc, SUPABASE_URL, SUPABASE_SERVICE_KEY) : Promise.resolve(null),
        ]);
        center = centerResolved;

        // Below TARGET related listings → top up from the live API. Admin lowers this
        // to calm aggregation, raises it to aggregate harder. Clamped to a sane range.
        const tp = parseInt(tgtRows?.[0]?.percentage, 10);
        const TARGET = Number.isFinite(tp) && tp > 0 ? Math.min(60, Math.max(5, tp)) : 20;

        canonical = expansion.canonical;
        relatedTerms = expansion.related || [];
        const searchTerms = [canonical, ...expansion.related].filter(Boolean);
        // Filter relevance against the raw query AND its expansion terms, so synonym
        // matches (e.g. "SWE" → "Software Engineer") are kept, not dropped.
        relevanceQuery = [safeQuery, ...searchTerms].filter(Boolean).join(' ');

        // Search both search_query and title columns so jobs cached under different
        // query keys still surface for synonymous searches.
        const termRows = await Promise.all(
          searchTerms.map(term => {
            const orFilter = `or=${encodeURIComponent(`(search_query.ilike.*${term}*,title.ilike.*${term}*)`)}`;
            return fetch(`${SUPABASE_URL}/rest/v1/jobs?${orFilter}${locClause}&expires_at=gt.${now}&limit=60`, { headers: dbHeaders })
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
        dbMatches = filterAndRank(pool, relevanceQuery).map(j => ({
          id: j.id || null, // keep the DB id — without it /jobs/<id> permalinks can never resolve
          title: j.title, company: j.company, location: j.location || loc,
          salary: j.salary, url: j.apply_url || j.url || null, description: j.description,
          type: j.type || 'Full-time', level: inferLevel(j.title || ''),
          source: j.source || 'Seen', ...scoreRow(j),
          lat: j.lat ?? null, lng: j.lng ?? null, posted_at: j.created_at || null,
        }));
        // Keep only listings within the searched radius (true distance when we have
        // coordinates, else coarse city → state), nearest first.
        dbMatches = applyRadius(dbMatches);

        if (dbMatches.length >= TARGET) {
          console.log(`DB HIT: "${query}" → "${canonical}" @ "${loc}" (${radiusMiles}mi) — ${dbMatches.length} in-radius results (no API call)`);
          return res.status(200).json({ ok: true, jobs: dbMatches.slice(0, 60), query, location: loc, _src: 'db' });
        }
      } catch(e) { console.warn('DB-first search error:', e.message); }
      console.log(`DB TOP-UP: "${query}" → "${canonical}" @ "${loc}" — ${dbMatches.length} in DB, pulling more from API`);
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
      const agg = await aggregateForQuery({
        query: canonical,
        location: loc,
        relatedTerms,
        supabaseUrl: SUPABASE_URL,
        serviceKey: SUPABASE_SERVICE_KEY,
        adzunaAppId: process.env.ADZUNA_APP_ID,
        adzunaAppKey: process.env.ADZUNA_APP_KEY,
        distanceKm, // Adzuna scopes the live pull to the searched radius
      });
      // Map the freshly-saved listings into the UI shape, then relevance + radius filter.
      jobs = (agg.jobs || []).map(j => ({
        id: j.id || null, // keep the DB id when the upsert returned one
        title: j.title, company: j.company, location: j.location || loc,
        salary: j.salary, url: j.apply_url || j.url || null, description: j.description,
        type: j.type || 'Full-time', level: inferLevel(j.title || ''),
        source: j.source || 'Seen', ...scoreRow(j),
        lat: j.lat ?? null, lng: j.lng ?? null, posted_at: j.created_at || null,
      }));
      jobs = applyRadius(filterAndRank(jobs, relevanceQuery));
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
    let finalJobs = applyRadius(filterAndRank(merged, relevanceQuery)).slice(0, 60);
    let widened = false;

    // ── NEVER return nothing — but widen GEOGRAPHICALLY, not nationwide ───────────
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

    // Stage 1 — expand the radius around the SAME location (≈4× the radius, 60–250mi).
    // Only when there are ZERO in-radius matches: a radius search must honor its radius,
    // so we never pad a real in-radius result set with farther listings. Widening is the
    // never-empty safety net, not a top-up.
    if (finalJobs.length === 0 && loc) {
      widened = true;
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
        console.log(`WIDENED (geo): "${query}" expanded ${radiusMiles}→${expandedMiles}mi, added ${wideJobs.length}`);
      } catch (e) { console.warn('geo-widen error:', e.message); }
      finalJobs = rankByDistanceKeepAll(filterAndRank(dedupJobs([...merged, ...wideJobs]), relevanceQuery)).slice(0, 60);
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
      finalJobs = rankByDistanceKeepAll(filterAndRank(dedupJobs([...merged, ...wideJobs]), relevanceQuery)).slice(0, 60);
    }

    // ── Absolute last resort ─────────────────────────────────────────────────────
    // The query matched nothing anywhere (typo/nonsense/brand-new niche). Show the
    // nearest available listings regardless of query so the board is never empty.
    if (!finalJobs.length) {
      widened = true;
      finalJobs = await nearestListings(loc, SUPABASE_URL, dbHeaders);
      console.log(`NEAREST FALLBACK: "${query}" @ "${loc}" — ${finalJobs.length} nearby listings`);
    }

    const result = { jobs: finalJobs, query, location: loc, radius: radiusMiles, _src: widened ? 'widened' : (jobs.length ? 'aggregated' : 'db'), widened };
    _inflightResolve?.(result);
    _inflight.delete(inflightKey);
    return res.status(200).json({ ok: true, ...result });

  } catch(err) {
    console.error('Jobs error:', err.message);
    logError('jobs', err.message, { query: safeQuery, loc });
    _inflightReject?.(err);
    _inflight.delete(inflightKey);
    return res.status(500).json({ error: err.message, jobs: [] });
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
  try {
    const agg = await aggregateForQuery({
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

    const { skills = [], seniority, function: fn } = skillsRows[0];
    const topSkills = skills.slice(0, 5);
    const now = encodeURIComponent(new Date().toISOString());

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

    const allResults = await Promise.all([...titleQueries, ...descQueries]);

    // Deduplicate
    const seenIds = new Set();
    const unique = allResults.flat().filter(j => {
      if (!j?.id || seenIds.has(j.id)) return false;
      seenIds.add(j.id);
      return true;
    });

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
