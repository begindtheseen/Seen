import { orLiteral, ilikeContains } from '../lib/server/pgrest.js';
import { createHmac, timingSafeEqual } from 'crypto';
import { getQueryExpansion } from '../lib/server/expand.js';
import { applyRateLimit, rateLimit, rateLimitGlobal, resolveRateBucket } from '../lib/server/ratelimit.js';
import { jobsReadFromQuery, setPublicCache } from '../lib/server/publicRead.js';
import { logError } from '../lib/server/errlog.js';
import { checkLiveness, checkableId } from '../lib/server/listingLiveness.js';
import { filterAndRank, relevanceScore, isTitleRelated, sortByProximity, locationDbTerm, expandQueryTerms, parseLocation, locationScore, searchFitFromSignal } from './_utils/jobRelevance.js';
import { sortByPriority, companyMatchesQuery, queryNamesCompany, isSeedListing } from '../lib/server/jobPriority.js';
import { waitUntil } from '@vercel/functions';
import { aggregateForQuery, inferLevel, wasRecentlyPulled, recordPull } from '../lib/server/jobSources.js';

// Adzuna rows stored before 2026-10-20 carry Adzuna's own salary ESTIMATE (salary_is_predicted) as if it were
// the posting's pay (adzunaPay() drops estimates at ingest since then; a re-seen row keeps its old value). A
// tester saw "$416k–$624k/yr" on a Turing teaser. Those rows show no pay at all.
const ADZUNA_ESTIMATE_CUTOFF = '2026-10-20';
export function honestSalary(j) {
  if (/^adzuna$/i.test(String(j?.source || '')) && j?.created_at && String(j.created_at) < ADZUNA_ESTIMATE_CUTOFF) return null;
  const s = j?.salary == null ? null : String(j.salary).trim();
  if (!s) return null;
  // A pay line below any legal wage is a parse of tips, a stipend or a per-task rate ("$2/hr" on a DashMart card):
  // better no pay than a wrong one.
  const nums = (s.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/gi) || []).map((m) => { const mm = m.match(/([\d,]+(?:\.\d+)?)\s*(k)?/i); return parseFloat(mm[1].replace(/,/g, '')) * (mm[2] ? 1000 : 1); }).filter((n) => n > 0);
  if (nums.length) {
    const hourly = /\/\s*h(?:ou)?r\b|per hour|hourly/i.test(s);
    const top = Math.max(...nums);
    if (hourly ? top < MIN_HOURLY : top < 12000) return null; // the same floor lib/jobs/pay.js renders by
    if (!hourly && /^adzuna$/i.test(String(j?.source || '')) && top > 350000) return null; // an hourly contractor rate × 2080
  }
  return s;
}

// A title that ends in a place outside the US ("Team Lead, Android – Athens, Greece") is a non-US posting even when
// its location field says "Remote": the location scope check runs on that tail too (lib/jobs/usLocation.js).
// Letters of any script: "Malmö, Sweden", "Košice, Slovakia", "Gdańsk, Poland" (Speechify, a Remote search
// 2026-11-03) fell through an ASCII-only pattern and were served as US remote rows.
function titleNamesNonUs(title) {
  const t = String(title || '');
  const m = t.match(/(?:[-–—|(]\s*)([\p{Lu}][\p{L}\p{M}\d .'’-]*,\s*[\p{Lu}][\p{L}\p{M}\d .'’-]+)\)?\s*$/u);
  if (m && locationScope(m[1]) === 'non_us') return true;
  const paren = t.match(/\(([\p{Lu}][\p{L}\p{M} .'’-]{2,30})\)\s*$/u); // "(Canada)", "(United Kingdom)"
  return !!(paren && locationScope(paren[1]) === 'non_us');
}
import { locationScope } from '../lib/jobs/usLocation.js';
import { preferFullText } from '../lib/jobs/listingTwins.js';
import { loadTenantNames, applyTenantNames, withTenantName } from '../lib/server/tenantNames.js';
import { aggregateWithSources } from '../lib/jobs/expand.js';
import { scoreJob, wasteScore, scoreRow, explainListingScore } from '../lib/server/jobScore.js';
import { computeListingFreshness } from '../lib/server/listingFreshness.js';
import { listingSignals } from '../lib/server/listingSignals.js';
import { geocodeLocation, haversineMiles, milesToKm, hasUsableCoords, boundingBox } from '../lib/server/geo.js';
import { findResumeMatches } from '../lib/server/resumeMatches.js';
import { serviceDb, readRecentApplications } from '../lib/server/jobKeys.js';
import { hasRailCache, readRailCache, writeRailCache, railSignature, railCacheState } from '../lib/server/railCache.js';
import { geocodePlace, placesWithin } from '../lib/geo/usPlaces.js';
import { placeListing, withinRadius, inState as geoInState, placeSearch, RADIUS_OPTIONS, stateName, isNonUsLocation } from '../lib/geo/radius.js';
import { readAreaRows, rankArea, pageArea } from '../lib/server/areaSearch.js';
import { MIN_HOURLY } from '../lib/jobs/pay.js';
import { collapseLocationVariants, roleKey } from '../lib/jobs/groupListings.js';

// ── Where a listing is ──────────────────────────────────────────────────────────────────────
// A row's point: its own coordinates, else its location text placed by the vendored US places
// table (lib/geo/usPlaces.js). Text naming only a state ("Arizona", "Remote - TX") has no point,
// and neither does a non-US line. Exported for the tests.
// Both are lib/geo/radius.js (placeListing / inState) — the one rule every surface measures by.
export function rowPoint(j) {
  if (!j) return null;
  const p = placeListing(j);
  const first = p.points[0];
  if (!first) return null;
  return p.source === 'coords' ? { lat: first.lat, lng: first.lng } : { lat: first.lat, lng: first.lng, name: first.name, state: first.state };
}
const inState = (j, state) => !!j && geoInState(j, state);

// PostgREST-safe ilike value: no logic-tree punctuation; a "." matches anything ("St. Louis" / "St Louis").
const ilikeTerm = (s) => String(s || '').replace(/[(),*\\:"]/g, ' ').replace(/\./g, '*').replace(/\s+/g, ' ').trim().toLowerCase();
const NEARBY_PLACE_TERMS = 10;

// DB-side scope for a radius search: the bounding box, OR the row's location text naming the
// searched city, OR one of the biggest places inside the radius written "<Place>, <ST>" or
// "<Place>, <State>" (state-anchored so "Mesa" does not read every "Costa Mesa"). nearSearch then
// measures every row it returns. Two `or=` params on one read are ANDed (verified 2026-10-23).
export function placeScopeClause(center, miles, cityTerm) {
  const parts = [];
  const b = boundingBox(center, miles);
  const f = (n) => n.toFixed(6);
  if (b) parts.push(`and(lat.gte.${f(b.latMin)},lat.lte.${f(b.latMax)},lng.gte.${f(b.lngMin)},lng.lte.${f(b.lngMax)})`);
  const city = ilikeTerm(cityTerm);
  const terms = new Set();
  if (city.length >= 2) terms.add(`location.ilike.*${city}*`);
  for (const p of placesWithin(center, miles, { limit: NEARBY_PLACE_TERMS, minPop: 2000 })) {
    const name = ilikeTerm(p.name);
    if (name.length < 3 || name === city) continue;
    // `_` (any one character) stands for the comma: a comma would split PostgREST's or=() list.
    terms.add(`location.ilike.*${name}_ ${p.state.toLowerCase()}*`);
    const full = STATE_NAMES[p.state];
    if (full) terms.add(`location.ilike.*${name}_ ${full}*`);
  }
  parts.push(...terms);
  return parts.length ? `&or=${encodeURIComponent(`(${parts.join(',')})`)}` : '';
}

// DB-side scope for a whole-state search: the state's name, or its code after a comma, at the end
// or followed by one more character ("Austin, TX", "Austin, TX 78701", "Austin, TX, US").
export function stateScopeClause(state) {
  const full = STATE_NAMES[state];
  const code = state.toLowerCase();
  const parts = [`location.ilike.*_ ${code}`, `location.ilike.*_ ${code}_*`];
  if (full) parts.push(`location.ilike.*${full}*`);
  return `&or=${encodeURIComponent(`(${parts.join(',')})`)}`;
}
const STATE_NAMES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut',
  DE: 'delaware', DC: 'district of columbia', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
  IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
  MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana',
  NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
  NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania',
  PR: 'puerto rico', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas',
  UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
};

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
// Flag featured listings, then stable-sort by priority tier (lib/server/jobPriority.js):
// Featured (paid) → posted on Seen by the employer → everything else. Order only, never a score.
const applyFeatured = (list, set) => {
  const has = !!set && set.size > 0
  const marked = list.map((j) => ({ ...j, featured: has && set.has(String(j.company || '').toLowerCase()) }))
  return sortByPriority(marked)
};

// Listings employers posted (or imported) directly on Seen. A small set, cached 60s, fail-safe.
// Every search checks it so a relevant direct post is never hidden by the geo-boxed pool reads
// (a "Remote" post has no coordinates, so the radius box would otherwise drop it).
let _empCache = { at: 0, rows: [] }
async function getEmployerPostedPool(url, headers) {
  const now = Date.now()
  if (now - _empCache.at < 60_000) return _empCache.rows
  try {
    const iso = encodeURIComponent(new Date().toISOString())
    // employer_user_id IS NOT NULL rides the partial index idx_jobs_employer_user_id (migration 055) —
    // every employer-posted row has an owner. The old is_employer_posted=eq.true + order=created_at +
    // select=* had no index and seq-scanned the whole table: 4.5s on prod, paid by every cold instance.
    const cols = 'id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,search_query,lat,lng,created_at,is_employer_posted,availability_status,ats_tenant'
    const q = (c) => fetch(`${url}/rest/v1/jobs?employer_user_id=not.is.null&is_employer_posted=eq.true&expires_at=gt.${iso}&select=${c}&limit=500`, { headers })
    // apply_mode exists only once the Apply-on-Seen migration is applied; before that, selecting it
    // 400s — retry without it so search priority never depends on that migration.
    let r = await q(`${cols},apply_mode`)
    if (r.status === 400) r = await q(cols)
    if (r.ok) {
      const rows = await r.json()
      _empCache = { at: now, rows: Array.isArray(rows) ? rows : [] }
    } else { _empCache = { at: now, rows: _empCache.rows } }
  } catch { _empCache = { at: now, rows: _empCache.rows } }
  return _empCache.rows
}

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

// ── Who is searching: the signed-in person's résumé family + industry (api/_utils/jobRelevance.js) ──
// Read once per user per 10 minutes from resume_skills (the rail's self-healed signal) and the profile's
// industry; anonymous searches and any read failure → null (no boost). Never blocks the DB reads: it runs
// alongside them and is awaited only where the pool is ranked.
const FIT_TTL_MS = 10 * 60_000;
const _fitCache = new Map();
async function resolveSearchFit(req, url, headers) {
  try {
    if (!url || !req?.headers?.authorization) return null;
    const uid = await _resolveUid(req);
    if (!uid) return null;
    const hit = _fitCache.get(uid);
    if (hit && Date.now() - hit.at < FIT_TTL_MS) return hit.fit;
    const u = encodeURIComponent(uid);
    const [skills, prof] = await Promise.all([
      fetch(`${url}/rest/v1/resume_skills?user_id=eq.${u}&select=top_titles,function&limit=1`, { headers }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch(`${url}/rest/v1/profiles?id=eq.${u}&select=industry&limit=1`, { headers }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    const row = Array.isArray(skills) && skills[0] ? skills[0] : {};
    const fit = searchFitFromSignal({ top_titles: row.top_titles, function: row.function, industry: Array.isArray(prof) && prof[0] ? prof[0].industry : null });
    _fitCache.set(uid, { at: Date.now(), fit });
    if (_fitCache.size > 5000) _fitCache.delete(_fitCache.keys().next().value);
    return fit;
  } catch { return null; }
}

// Per-instance request coalescing: concurrent identical searches share one live aggregation
const _inflight = new Map();

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  // The two company-page reads (listing signals, a company's open roles) are public and identical for
  // every visitor, so they are also served as cacheable GETs (lib/server/publicRead.js): same body, same
  // handler, and the CDN answers repeat visitors instead of the database. Everything else stays POST.
  const publicRead = req.method === 'GET' ? jobsReadFromQuery(req.query) : null;
  if (req.method !== 'POST' && !publicRead) return res.status(405).end('Method not allowed');

  // Parse body early so we can route before rate limiting
  let _body = publicRead || req.body;
  if (typeof _body === 'string') { try { _body = JSON.parse(_body); } catch(e) { _body = {}; } }
  if (!_body || typeof _body !== 'object') _body = {};

  // Rate bucket: the signed-in USER when the request carries a verifiable JWT, else the IP.
  // Per-user buckets are the scale fix for shared IPs (household/office/CGNAT) — users no
  // longer starve each other out of one shared allowance.
  const rlBucket = resolveRateBucket(req);

  // ── Company jobs: fetch/search jobs for a specific company ─────────────────
  if (_body.action === 'company_jobs') {
    if (await applyRateLimit(req, res, 'job-read', { bucketKey: rlBucket.key })) return;
    setPublicCache(res, 'company_jobs');
    return handleCompanyJobs(req, res, _body);
  }

  // ── Listing signals: a company's rating from its own open posts (not its applicant grade) ──
  if (_body.action === 'listing_signals') {
    if (await applyRateLimit(req, res, 'job-read', { bucketKey: rlBucket.key })) return;
    setPublicCache(res, 'listing_signals');
    return handleListingSignals(req, res, _body);
  }

  // ── Recommended jobs: personalized from resume_skills ────────────────────
  if (_body.action === 'recommended') {
    if (await applyRateLimit(req, res, 'job-read', { bucketKey: rlBucket.key })) return;
    return handleRecommended(req, res, _body);
  }

  // ── Is this job still open? One polite request to its source, asked when its page/drawer opens ──
  // (lib/server/listingLiveness.js). A row checked in the last 24 h is answered from the row; a job the
  // source says is gone is hidden from search at once and kept for anyone who saved or applied to it.
  if (_body.action === 'liveness') {
    if (await applyRateLimit(req, res, 'job-read', { bucketKey: rlBucket.key })) return;
    const id = checkableId(_body.id);
    if (!id) return res.status(200).json({ state: 'unknown', checked_at: null, via: 'no_row', fresh: false });
    const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
    if (!U || !K) return res.status(503).json({ error: 'DB unavailable' });
    const db = (path, opts = {}) => fetch(`${U}/rest/v1/${path}`, { ...opts, headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    try {
      const out = await checkLiveness({ jobId: id, db });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(out);
    } catch (e) {
      logError('jobs/liveness', e.message);
      return res.status(200).json({ state: 'unknown', checked_at: null, via: 'error', fresh: false });
    }
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
      const cols = 'id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,availability_status,created_at,last_seen_at,last_checked_at,availability_report_count,is_employer_posted,ats_tenant';
      const get = (select) => fetch(`${U}/rest/v1/jobs?id=eq.${encodeURIComponent(id)}&select=${select}&limit=1`, { headers: { apikey: K, Authorization: `Bearer ${K}` } });
      // apply_mode exists once the Apply-on-Seen migration is applied; before that the column is
      // missing and PostgREST 400s the select, so retry without it (lib/server/seenApply.js).
      // edited_at + status ('filled') exist once migration 20261018170000 is applied.
      let r = await get(`${cols},apply_mode,edited_at,status`);
      if (r.status === 400) r = await get(`${cols},apply_mode`);
      if (r.status === 400) r = await get(cols);
      const rows = r.ok ? await r.json() : [];
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Not found' });
      // Attach the score's factor breakdown so the detail page can show WHY, not just a number,
      // plus the factual freshness descriptor (our-own-observation facts — never an employer verdict).
      const job = withTenantName({
        ...rows[0], url: rows[0].apply_url || null,
        salary: honestSalary(rows[0]), // the same pay rule as every list (a stored sub-wage line is never shown)
        ...scoreRow(rows[0]), score_explanation: explainListingScore(rows[0]),
        freshness: computeListingFreshness(rows[0]),
      }, await loadTenantNames(U, { apikey: K, Authorization: `Bearer ${K}` }));
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

  let dbMatches = []; // related listings already in our DB (merged with any API top-up)
  let fit = null; // the signed-in searcher's résumé family / industry (jobRelevance.searchFitFromSignal), or null
  let relevanceQuery = ''; // the ORIGINAL user query — what relevance is judged against
  let synonyms = []; // canonical + expansion terms — true-synonym signals (matched vs the TITLE)
  let searchTerms = []; // original + canonical + deterministic expansion — the DB pool + corpus reads
  const PAGE_MIN = 10; // below this many results we widen (geo, then corpus, then national)
  // Paging ("Show 60 more"): `offset` is a multiple of PAGE into the ranked, in-radius matches. The
  // pool reads widen with it so a later page has rows to rank; capped so one search stays bounded.
  const PAGE = 60;
  const MAX_OFFSET = 240;
  const TITLE_POOL_MIN = 200; // a title read is never shallower than this
  let offset = 0;
  let poolLimit = PAGE + 1;
  let poolFull = false; // a title/search_query read came back full → more matches exist past this page
  let serve = async (list) => list; // final shaping of every response (set once the search context exists)

  try {
    let body = _body;
    const { query, location, radius } = body;
    // A place and no title: every open listing Seen holds in that area (lib/server/areaSearch.js). Seen's own
    // rows only — the untitled path once pulled six fixed job categories from Adzuna into the corpus.
    if (!String(query || '').trim()) {
      if (String(location || '').trim()) return await handleAreaSearch(req, res, body);
      return res.status(400).json({ error: 'No query' });
    }

    const rawQuery = String(query).trim().slice(0, 200);
    if (!rawQuery) return res.status(400).json({ error: 'No query' });
    // Strip characters that could abuse prompt injection
    safeQuery = rawQuery.replace(/[<>`\\]/g, '').trim();
    relevanceQuery = safeQuery;

    loc = (location || '').trim();
    const rawOffset = parseInt(body.offset, 10);
    offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.min(MAX_OFFSET, Math.floor(rawOffset / PAGE) * PAGE) : 0;
    // One row past the page: a full read means the corpus holds more than this page can show.
    poolLimit = PAGE + offset + 1;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const dbHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Admin-suppressed dead listings to filter out + featured employers to boost (fail-safe).
    // The employer-posted pool is only needed when the response is shaped, so it loads in parallel
    // with the search's own DB reads instead of in front of them (serve() awaits it).
    const employerPoolP = SUPABASE_URL && SUPABASE_SERVICE_KEY ? getEmployerPostedPool(SUPABASE_URL, dbHeaders) : Promise.resolve([]);
    // Board slug → registered employer name (lib/server/tenantNames.js), cached per instance; a row
    // still stored under its slug ("plscareers") is served as the name the registry holds for it.
    const tenantNamesP = SUPABASE_URL && SUPABASE_SERVICE_KEY ? loadTenantNames(SUPABASE_URL, dbHeaders) : Promise.resolve(new Map());
    const fitP = resolveSearchFit(req, SUPABASE_URL, dbHeaders);
    const [suppressedSet, featuredSet] = await Promise.all([
      getSuppressedSet(SUPABASE_URL, dbHeaders),
      getFeaturedSet(SUPABASE_URL, dbHeaders),
    ]);

    const qNorm = safeQuery.toLowerCase();

    // canonical + expansion terms stay in outer scope so the aggregation step can use them
    let canonical = qNorm;
    let relatedTerms = [];

    // ── Radius ───────────────────────────────────────────────────────────────
    // Real distance search: clamp the requested radius, place the searched location, and pass the
    // distance to Adzuna so the live pull is already scoped. The place comes from the vendored US
    // places table (lib/geo/usPlaces.js — no network); only a name it does not know goes to
    // geocodeLocation (geocode_cache, then Nominatim) in the DB-first Promise.all below.
    // radius === '0'/'remote' means REMOTE: skip geo filtering entirely and search remote
    // listings — the old clamp silently turned "Remote" into an ordinary 25-mile search.
    const isRemote = String(radius) === '0' || String(radius).toLowerCase() === 'remote';
    // A listing is remote when its location/type says so, or its text says so plainly near the top (a
    // description that merely mentions "remote" — "not remote", "remote teams we support" — ranked a San
    // Francisco office job #1 in a Remote search).
    const isRemoteListing = (j) => /\bremote\b|\bwork from home\b|\banywhere\b/i.test(`${j.location || ''} ${j.type || ''}`)
      || (/\b(?:fully|100%|is|are) remote\b|\bremote[- ](?:first|friendly|ok|position|role|work|job)\b|\bwork from home\b|\bwork from anywhere\b/i.test(String(j.description || '').slice(0, 600))
        && !/\b(?:not|no|non-?)\s*remote\b|\bon-?site only\b/i.test(String(j.description || '').slice(0, 600)));
    if (isRemote) { loc = 'remote'; }
    const radiusMiles = isRemote ? Infinity : Math.min(500, Math.max(5, parseInt(radius, 10) || 25));
    const distanceKm = isRemote ? null : milesToKm(radiusMiles);
    const searchedPlace = loc && !isRemote ? geocodePlace(loc) : null;
    // A whole-state search ("Texas") is a state filter, not a circle around the state's middle.
    const searchState = searchedPlace && searchedPlace.stateOnly ? searchedPlace.state : null;
    let center = searchedPlace && !searchState ? { lat: searchedPlace.lat, lng: searchedPlace.lng } : null; // null → fall back to city/state text

    // Is a listing inside the searched area? ONE predicate, used to filter the in-radius page, to
    // stamp `in_radius` on every served row (the client never reorders in-radius rows below the
    // fill-ins) and to count `in_radius` for the honest banner.
    //  • Remote search → only listings that say remote. (Partitioning "remote first, keep the rest"
    //    served 58 non-remote Dallas/Phoenix rows as a "Remote" result.)
    //  • A point for the row (its own coords, else its location text placed by usPlaces) → great-circle
    //    distance from the searched point (1 mi buffer for border rounding). A row whose text says only
    //    a state ("Arizona") has no point: it is never inside a city radius.
    //  • No point at all → in the area only when its own text names the searched city.
    //  • Whole-state search → the row's text places it in that state.
    //  • Search location could not be placed (no center) → coarse city / same-state text match.
    // Order is NOT changed here: in-radius rows keep their relevance order (relevance first,
    // transparency score as the tiebreak) instead of nearest-first, which scrambled matches.
    const parsedLoc = parseLocation(loc);
    const namesSearchedCity = (j) => !!(parsedLoc && parsedLoc.city) && locationScore(j.location, parsedLoc) === 3;
    const nearSearch = (j) => {
      if (!loc) return true;
      if (isRemote) return isRemoteListing(j);
      if (searchState) return inState(j, searchState) || locationScore(j.location, parsedLoc) >= 2;
      if (!center) return locationScore(j.location, parsedLoc) >= 2;
      // lib/geo/radius.js withinRadius: any of the row's places within the radius, exactly (no buffer, so a
      // wider radius always holds every row of a narrower one).
      const w = withinRadius(j, center, radiusMiles);
      if (w.miles != null) return w.in;
      return namesSearchedCity(j);
    };
    const applyRadius = (list) => (Array.isArray(list) ? list : []).filter(nearSearch);

    // Every response goes through serve(): add the relevant listings employers posted on Seen,
    // drop admin-suppressed ones, flag Featured, stamp `in_radius` + `relevance` on every row, then
    // order: searched area first, priority tier within it (lib/server/jobPriority.js — the client's
    // sort keeps the same partition). A direct post is included when the search names its company
    // or the listing matches the query, and it is remote or inside the searched area. Reads
    // relevanceQuery/synonyms at call time (they are filled in by the DB-first block below).
    let seedsDropped = 0; // Seen's own seed/test rows kept out of results (reported, never served)
    serve = async (list, { withPosts = true, limit = PAGE } = {}) => {
      const base = Array.isArray(list) ? list : [];
      // A later page carries only its own slice: the direct posts already led page one.
      const employerPool = withPosts ? await employerPoolP : [];
      const relevant = (employerPool || []).filter((row) =>
        companyMatchesQuery(row.company, relevanceQuery) ||
        filterAndRank([row], relevanceQuery, { synonyms, canonical, fit }).length > 0);
      const inArea = relevant.filter((row) => !loc || isRemote || isRemoteListing(row) || nearSearch(row));
      const postIds = new Set(inArea.map((r) => r.id).filter(Boolean));
      const out = [], seenKeys = new Set();
      // Rows that name a non-US place never reach a US search (lib/jobs/usLocation.js — the same
      // judgement the ingest makes; stored rows from before it, and from paths that lacked it, are
      // still in the corpus: a Lever "La Roca del Valles, Barcelona" cashier answered "cashier ·
      // Phoenix" on 2026-10-23). An Adzuna teaser of a posting we hold in full from the employer's
      // board is hidden behind that full-text row (lib/jobs/listingTwins.js).
      for (const j of preferFullText([...inArea.map(toUiRow), ...base])) {
        if (isNonUsLocation(j.location) || titleNamesNonUs(j.title)) continue;
        if (isSeedListing(j)) { seedsDropped++; continue; }
        const key = j.id || `${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}|${(j.location || '').toLowerCase()}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const flagged = {
          ...j,
          employer_posted: postIds.has(j.id) || j.employer_posted === true,
          in_radius: nearSearch(j),
          relevance: relevanceScore(j, relevanceQuery, { synonyms, canonical, fit }),
          // A MATCH (the role typed) vs an opening that only shares a word with it — the page lists
          // matches first and the rest under "Other openings" (jobRelevance.isTitleRelated).
          related: isTitleRelated(j, relevanceQuery, { canonical }),
        };
        // A search that names the company (company name typed into the job search) ranks that
        // company's listings first — jobPriority.priorityTier, kept by the client's sort too.
        out.push(queryNamesCompany(j.company, relevanceQuery) ? { ...flagged, company_match: true } : flagged);
      }
      // A Remote search: a board that posts one remote role once per city ("Team Lead, Android Core Product -
      // Cleveland, OH, USA" × 46, round 3) is one row here, carrying `also_in` (lib/jobs/groupListings.js).
      // The callers hand a Remote search several pages of candidates (candidates()) so the page is still full after.
      const rows = isRemote ? collapseLocationVariants(out).slice(0, limit) : out;
      return applyTenantNames(applyFeatured(dropSuppressed(rows, suppressedSet), featuredSet), await tenantNamesP);
    };
    // How many ranked rows to hand serve() for one page: a Remote search's per-city copies collapse there.
    const candidates = (arr, n = PAGE) => arr.slice(0, isRemote ? n * 5 : n);
    const countInRadius = (jobs) => (jobs || []).filter((j) => j.in_radius !== false).length;

    // ── DB-FIRST search ──────────────────────────────────────────────────────
    // Serve from our own jobs corpus, relevance-filtered to the query (and to the
    // company, for company-name searches). Only top up from the live API when we
    // have fewer than TARGET related listings — so as the corpus grows we API-call
    // less and less. The fetched top-up is stored back, growing the corpus further.
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const now = encodeURIComponent(new Date().toISOString());
        const t3filter = buildFallbackFilter(qNorm);

        // Place the searched location FIRST so the DB query itself is geo-scoped. THE SCALE FIX:
        // we never fetch the whole corpus and haversine it in Node. A place the vendored table
        // does not know goes to geocodeLocation (geocode_cache, then Nominatim), overlapped with
        // the cheap expansion + aggregation-target reads that don't depend on it.
        const [expansion, tgtRows, centerResolved] = await Promise.all([
          getQueryExpansion(qNorm, SUPABASE_URL, dbHeaders),
          // Admin-tunable aggregation target (feature_flags.job_search_target.percentage).
          fetch(`${SUPABASE_URL}/rest/v1/feature_flags?flag_name=eq.job_search_target&select=percentage&limit=1`, { headers: dbHeaders })
            .then(r => r.ok ? r.json() : []).catch(() => []),
          // 'remote' is not a place, and a whole state is a filter, not a point.
          loc && !isRemote && !searchedPlace ? geocodeLocation(loc, SUPABASE_URL, SUPABASE_SERVICE_KEY) : Promise.resolve(center),
        ]);
        center = centerResolved;

        // DB-side geo scope applied to EVERY pool query:
        //  • center → indexed bounding-box range scan (jobs_latlng_idx, migration 033) OR the row's
        //    location text naming the searched city or one of the biggest places inside the radius
        //    (placeScopeClause). Many rows have no coordinates (497 of 509 coordinate-less Phoenix
        //    rows on 2026-10-23 were ATS-board rows saying "Phoenix, AZ"); the text half reads them,
        //    nearSearch then measures each from its placed text.
        //  • whole-state search → the state's name or ", XX" in the location text.
        //  • location not placed → coarse `location ilike city/state` text (honest degrade).
        //  • remote/national → no geo scope.
        const locTerm = locationDbTerm(loc);
        const textClause = locTerm ? `&location=ilike.*${encodeURIComponent(locTerm)}*` : '';
        const geoClause = isRemote ? ''
          : searchState ? stateScopeClause(searchState)
          : center ? placeScopeClause(center, radiusMiles, parsedLoc && parsedLoc.city)
          : textClause;

        // Below TARGET related listings → top up from the live API. Admin lowers this
        // to calm aggregation, raises it to aggregate harder. Clamped to a sane range.
        // Aggregate whenever we have fewer than TARGET genuinely-relevant in-radius listings
        // — a full page, so even a niche query (budtender) fires a fresh Adzuna pull instead
        // of showing a thin/empty board. Admin-tunable; sane default 25.
        const tp = parseInt(tgtRows?.[0]?.percentage, 10);
        const TARGET = Number.isFinite(tp) && tp > 0 ? Math.min(60, Math.max(5, tp)) : 25;

        canonical = expansion.canonical || qNorm;
        // DETERMINISTIC (no-AI) expansion — the curated role families bridge "theft prevention"
        // → "asset protection", "warehouse" → "material handler". Seen calls no model API; merge
        // with any related terms cached in query_expansions so the bridge exists on EVERY search.
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
        // All pool reads in ONE parallel round (keyword + company + every term) — they're independent.
        //
        // Every read is ORDERED and the title reads are capped apart from the provenance reads. Without an
        // order Postgres hands back whichever rows it reaches first, so a capped read answered a 10-mile
        // search with the Tempe Target team leads and the 25-mile search without them: the rows stamped
        // search_query="team lead" (any title) filled the one shared cap before the title matches did.
        // Widening a radius must only ADD rows (every related row at 10 mi is still there at 25 and 50 mi)
        // and two loads of one URL must agree (round 3, 2026-11-03; api/jobs.pool.test.mjs).
        const ORDER = '&order=score.desc.nullslast,id.asc';
        const TITLE_POOL = Math.max(TITLE_POOL_MIN, poolLimit);
        const read = (filter, limit) => fetch(`${SUPABASE_URL}/rest/v1/jobs?${filter}${geoClause}&expires_at=gt.${now}${ORDER}&limit=${limit}`, { headers: dbHeaders })
          .then(r => r.ok ? r.json() : []).catch(() => []);
        const [[kwRows, coRows], titleRows, stampRows] = await Promise.all([Promise.all([
          t3filter ? read(t3filter, poolLimit) : Promise.resolve([]),
          read(`company=ilike.${ilikeContains(qNorm)}`, poolLimit),
        ]),
          // The TITLE reads: what a search is a match for. Deep enough that a specific query reads every
          // title in the area (prod 2026-11-03: 10 "team lead" titles within 50 mi of Phoenix).
          Promise.all(searchTerms.map(term => read(`title=ilike.*${encodeURIComponent(orLiteral(term))}*`, TITLE_POOL))),
          // The provenance reads: rows our own aggregation fetched FOR this query (search_query), whatever
          // their title, so synonymous searches still find them.
          Promise.all(searchTerms.map(term => read(`search_query=ilike.*${encodeURIComponent(orLiteral(term))}*`, poolLimit))),
        ]);
        const termRows = [...titleRows, ...stampRows];

        poolFull = titleRows.some((arr) => Array.isArray(arr) && arr.length >= TITLE_POOL) || stampRows.some((arr) => Array.isArray(arr) && arr.length >= poolLimit);
        fit = await fitP;
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
        dbMatches = filterAndRank(pool, relevanceQuery, { synonyms, canonical, fit }).map(j => toUiRow(j, loc));
        // Keep only listings within the searched radius (true distance when we have
        // coordinates, else coarse city → state), nearest first.
        dbMatches = applyRadius(dbMatches);
        // Rows serve() would drop anyway (Seen's own seed rows, non-US places) leave the ranked set here,
        // so a page sliced from it is a full page, never 59 rows.
        const kept = dbMatches.filter((j) => !isSeedListing(j) && !isNonUsLocation(j.location) && !titleNamesNonUs(j.title));
        seedsDropped += dbMatches.filter(isSeedListing).length;
        dbMatches = kept;

        // A later page ("Show 60 more") is a slice of the same ranked matches — no top-up, no fill-ins.
        // The pool is re-read wider for every page and re-ranked, so a row's rank can move between
        // reads: the client sends the ids it already shows (`exclude`) and gets the best 60 it does not
        // have — never a repeat, whatever the read order.
        if (offset > 0) {
          const shown = new Set((Array.isArray(body.exclude) ? body.exclude : []).slice(0, MAX_OFFSET + PAGE).map(String));
          const rest = dbMatches.filter((j) => !shown.has(String(j.id)));
          const jobs = await serve(candidates(rest), { withPosts: false });
          return res.status(200).json({ ok: true, jobs, in_radius: countInRadius(jobs), query, location: loc, radius: Number.isFinite(radiusMiles) ? radiusMiles : null, offset, has_more: offset + PAGE <= MAX_OFFSET && (rest.length > PAGE || (poolFull && rest.length >= PAGE)), _src: 'db-page' });
        }
        if (dbMatches.length >= TARGET) {
          console.log(`DB HIT: "${query}" → "${canonical}" @ "${loc}" (${radiusMiles}mi) — ${dbMatches.length} in-radius results (no API call)`);
          const jobs = await serve(candidates(dbMatches));
          if (seedsDropped) console.log(`SEED ROWS DROPPED: ${seedsDropped}`);
          return res.status(200).json({ ok: true, jobs, in_radius: countInRadius(jobs), query, location: loc, radius: Number.isFinite(radiusMiles) ? radiusMiles : null, offset: 0, has_more: dbMatches.length > PAGE || (poolFull && dbMatches.length >= PAGE), _src: 'db' });
        }
      } catch(e) { console.warn('DB-first search error:', e.message); }
      console.log(`DB TOP-UP: "${query}" → "${canonical}" @ "${loc}" — ${dbMatches.length} in DB, pulling more from API`);
    }

    // A later page that the DB-first block could not answer (DB error) is an empty last page, never
    // page one again.
    if (offset > 0) return res.status(200).json({ ok: true, jobs: [], in_radius: 0, query, location: loc, offset, has_more: false, _src: 'db-page' });

    // ── INSTANT RESPONSE (owner directive 2026-10-17: a search never waits on a live pull) ──────
    // Below TARGET this handler used to AWAIT a live Adzuna/ATS aggregation (plus geo and national
    // widening pulls) before answering — 4–30s. Now the user gets the best page our own corpus holds
    // right away, and the live top-up runs AFTER the response (waitUntil) and saves what it finds to
    // the corpus. The response says topup:'pending'; the jobs page re-fetches once, silently, with
    // db_only:true, and every later search reads the new listings straight from the DB.
    // The cooldown and the per-bucket + global top-up budgets still gate every live pull.
    const dbOnly = body.db_only === true;
    const canPull = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY) && !dbOnly;
    inflightKey = `${canonical}::${loc}`;

    // Fill a thin in-radius page from our own corpus (query-relevant, nearest-first), then the
    // nearest listings so the board is never empty. Pure DB.
    const pageP = (async () => {
      let page = candidates(dbMatches);
      let fallback = null; // 'outside_radius' | 'remote_thin' | 'unrelated' — the client labels the page by this
      if (page.length < PAGE_MIN && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const corpus = await corpusRelevant({ supabaseUrl: SUPABASE_URL, dbHeaders, terms: searchTerms, query: relevanceQuery, canonical, synonyms, fit, center, loc, limit: 60 });
        const before = page.length;
        page = dedupByIdentity([...page, ...corpus]).slice(0, 60);
        if (page.length > before) fallback = isRemote ? 'remote_thin' : 'outside_radius';
      }
      if (!page.length && SUPABASE_URL && SUPABASE_SERVICE_KEY) { page = await nearestListings(loc, SUPABASE_URL, dbHeaders); if (page.length) fallback = 'unrelated'; }
      return { page, fallback };
    })();
    // Decide whether a live top-up may run — in parallel with building the page. The budget is only
    // consumed when no recent pull already covered this (query, location).
    const decisionP = (async () => {
      if (!canPull) return 'skip';
      if (_inflight.has(inflightKey)) return 'inflight';
      if (await wasRecentlyPulled(canonical, loc, SUPABASE_URL, SUPABASE_SERVICE_KEY)) return 'cooldown';
      const [topupBucket, topupGlobal] = await Promise.all([
        rateLimit(req, 'job-search-topup', { bucketKey: rlBucket.key }),
        rateLimitGlobal('agg-global'),
      ]);
      return topupBucket.allowed && topupGlobal.allowed ? 'pull' : 'budget';
    })();
    const [{ page, fallback }, decision] = await Promise.all([pageP, decisionP]);

    if (decision === 'pull' && !_inflight.has(inflightKey)) {
      const key = inflightKey;
      const work = liveTopUp().catch((e) => console.warn('live top-up error:', e.message)).finally(() => _inflight.delete(key));
      _inflight.set(key, work);
      setTimeout(() => _inflight.delete(key), 90_000);
      waitUntil(work);
    }

    // The live pull (runs after the response). Everything it finds is upserted into the corpus by
    // aggregateWithSources / aggregateForQuery; nothing here touches the response.
    async function liveTopUp() {
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
      // Record the pull so a repeat search inside the cooldown window doesn't pull again.
      recordPull(canonical, loc, agg.jobs?.length || 0, SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const fresh = (agg.jobs || []).map((j) => toUiRow(j, loc));
      const inRadius = applyRadius(filterAndRank(dedupByIdentity([...dbMatches, ...fresh]), relevanceQuery, { synonyms, canonical, fit }));
      console.log(`TOP-UP: "${query}" → "${canonical}" @ "${loc}" — ${agg.jobs?.length || 0} fetched, ${agg.upserted || 0} saved, ${inRadius.length} relevant in radius`);
      _logSearch(canonical, loc, inRadius.length, SUPABASE_URL, dbHeaders);
      // Still thin → widen geographically (≈4× the radius, 60–250mi), and nationally if nothing at
      // all matched. Same behaviour as before, just after the response; results land in the corpus.
      if (inRadius.length < PAGE_MIN && loc) {
        const expandedMiles = Math.min(250, Math.max(radiusMiles * 4, 60));
        const wide = await aggregateForQuery({
          query: canonical, location: loc, relatedTerms,
          supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY,
          adzunaAppId: process.env.ADZUNA_APP_ID, adzunaAppKey: process.env.ADZUNA_APP_KEY,
          distanceKm: milesToKm(expandedMiles),
        }).catch((e) => { console.warn('geo-widen error:', e.message); return { jobs: [] }; });
        console.log(`TOP-UP WIDENED (geo): "${query}" ${radiusMiles}→${expandedMiles}mi, added ${(wide.jobs || []).length}`);
      }
      if (inRadius.length === 0) {
        const wide = await aggregateForQuery({
          query: canonical, location: '', relatedTerms,
          supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY,
          adzunaAppId: process.env.ADZUNA_APP_ID, adzunaAppKey: process.env.ADZUNA_APP_KEY,
        }).catch((e) => { console.warn('national-widen error:', e.message); return { jobs: [] }; });
        console.log(`TOP-UP WIDENED (national): "${query}" added ${(wide.jobs || []).length}`);
      }
    }

    const pending = decision === 'pull' || decision === 'inflight';
    const widened = dbMatches.length === 0 && page.length > 0;
    // serve() puts every in-area row first (the corpus fill-ins carry in_radius:false) and the
    // response says how many are in the radius, so the client can label the page honestly.
    const jobs = await serve(page);
    const inRadius = countInRadius(jobs);
    console.log(`INSTANT: "${query}" @ "${loc}" — ${jobs.length} served (${inRadius} in radius, fallback ${fallback || 'none'}), top-up ${decision}`);
    return res.status(200).json({
      ok: true, jobs, in_radius: inRadius, query, location: loc, radius: Number.isFinite(radiusMiles) ? radiusMiles : null,
      offset: 0, has_more: dbMatches.length > PAGE || (poolFull && dbMatches.length >= PAGE),
      _src: dbOnly ? 'db-refresh' : `db-${decision}`, widened, fallback,
      topup: pending ? 'pending' : null,
      ...(decision === 'budget' ? { degraded: true } : {}),
    });

  } catch(err) {
    console.error('Jobs error:', err.message);
    logError('jobs', err.message, { query: safeQuery, loc });
    // Graceful degradation: the live API call failed (billing/rate-limit/outage), but if
    // we already pulled related listings from our own corpus, serve those rather than an
    // empty error — search should never go blank just because the top-up couldn't run.
    if (dbMatches.length) {
      const jobs = await serve(dbMatches.slice(0, 60)).catch(() => dbMatches.slice(0, 60));
      return res.status(200).json({ ok: true, jobs, in_radius: jobs.filter((j) => j.in_radius !== false).length, query: safeQuery, location: loc, _src: 'db-fallback' });
    }
    return res.status(500).json({ error: err.message, jobs: [] });
  }
}

// DB jobs row → the UI listing shape every search response uses.
function toUiRow(j, loc = '') {
  return {
    id: j.id || null, // keep the DB id — without it /jobs/<id> permalinks can never resolve
    title: j.title, company: j.company, location: j.location || loc,
    salary: honestSalary(j), url: j.apply_url || j.url || null, description: j.description,
    type: j.type || 'Full-time', level: inferLevel(j.title || ''),
    source: j.source || 'Seen', ...scoreRow(j),
    search_query: j.search_query || null, // provenance for the merged re-filter downstream
    lat: j.lat ?? null, lng: j.lng ?? null, posted_at: j.created_at || null,
    employer_posted: j.is_employer_posted === true, // posted on Seen by the employer → search priority
    apply_mode: j.is_employer_posted === true ? (j.apply_mode || 'external') : 'external', // Apply on Seen
    ats_tenant: j.ats_tenant || null, // the board slug this row was stored under (lib/server/tenantNames.js)
  };
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
async function corpusRelevant({ supabaseUrl, dbHeaders, terms, query, canonical, synonyms, fit = null, center, loc, limit = 60 }) {
  if (!supabaseUrl) return [];
  const now = encodeURIComponent(new Date().toISOString());
  const cols = 'id,created_at,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,search_query,lat,lng,ats_tenant';
  const uniq = [...new Set((terms || []).map(t => String(t || '').toLowerCase().trim()).filter(t => t.length > 1))].slice(0, 6);
  if (!uniq.length) return [];
  try {
    const arrays = await Promise.all(uniq.map(t => {
      const tl = orLiteral(t);
      const orf = `or=${encodeURIComponent(`(company.ilike.*${tl}*,title.ilike.*${tl}*,search_query.ilike.*${tl}*)`)}`;
      return fetch(`${supabaseUrl}/rest/v1/jobs?${orf}&expires_at=gt.${now}&select=${cols}&order=score.desc.nullslast,id.asc&limit=120`, { headers: dbHeaders })
        .then(r => r.ok ? r.json() : []).catch(() => []);
    }));
    const pool = [], seen = new Set();
    for (const arr of arrays) for (const row of (Array.isArray(arr) ? arr : [])) {
      const key = row.id ?? `${(row.title || '').toLowerCase()}|${(row.company || '').toLowerCase()}|${(row.location || '').toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(row);
    }
    let rel = filterAndRank(pool, query, { synonyms, canonical, fit });
    // Nearest-first (rows we cannot place last), relevance order as the tiebreak.
    if (center && hasUsableCoords(center)) {
      rel = rel.map((j, i) => { const p = rowPoint(j); return { j, d: p ? haversineMiles(center, p) : Infinity, i }; })
        .sort((a, b) => (a.d - b.d) || (a.i - b.i)).map(x => x.j);
    } else if (loc) {
      rel = sortByProximity(rel, loc);
    }
    return rel.slice(0, limit).map(j => ({
      id: j.id || null,
      title: j.title, company: j.company, location: j.location || loc,
      salary: honestSalary(j), url: j.apply_url || j.url || null, description: j.description,
      type: j.type || 'Full-time', level: inferLevel(j.title || ''),
      source: j.source || 'Seen', ...scoreRow(j),
      search_query: j.search_query || null,
      lat: j.lat ?? null, lng: j.lng ?? null, posted_at: j.created_at || null,
      ats_tenant: j.ats_tenant || null,
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
  const cols = 'id,created_at,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,ats_tenant';
  const mapUi = rows => (Array.isArray(rows) ? rows : []).map(j => ({
    id: j.id || null,
    title: j.title, company: j.company, location: j.location,
    salary: honestSalary(j), url: j.apply_url, description: j.description,
    type: j.type || 'Full-time', level: inferLevel(j.title || ''),
    source: j.source || 'Seen', ...scoreRow(j),
    posted_at: j.created_at || null,
    ats_tenant: j.ats_tenant || null,
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

// The ONE employer-name key for the company page's listing reads (company_jobs, listing_signals):
// legal suffixes dropped, hyphens and spaces alike — "Coca-Cola" ↔ "Coca Cola", never "Amazon Flex" ↔ "Amazon".
const companyNameKey = n => String(n || '').toLowerCase().trim().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?)\.?$/i, '').replace(/[\s-]+/g, ' ').trim();
const companyIlike = name => encodeURIComponent(`*${String(name).toLowerCase().trim().replace(/[\s-]+/g, '*')}*`);

// ── handleListingSignals: every open post of ONE company → lib/server/listingSignals.js ─────────
// Read-only. Up to 3,000 posts (3 pages); cached per instance for 30 minutes (posts change hourly at most).
const SIGNALS_CACHE = new Map();
async function handleListingSignals(req, res, body) {
  const company = typeof body.company === 'string' ? body.company.trim().slice(0, 100).replace(/[<>`\\]/g, '') : '';
  if (!company) return res.status(400).json({ error: 'company required' });
  const SUPABASE_URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !KEY) return res.status(503).json({ error: 'DB unavailable' });
  const key = companyNameKey(company);
  const hit = SIGNALS_CACHE.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return res.status(200).json({ ok: true, signals: hit.value, _src: 'cache' });
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const now = encodeURIComponent(new Date().toISOString());
  const rows = [];
  try {
    for (let page = 0; page < 3; page++) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/jobs?company=ilike.${companyIlike(company)}&expires_at=gt.${now}&availability_status=eq.active&select=company,salary,source,source_type,ats_provider,is_employer_posted,score,created_at&order=id.asc&limit=1000&offset=${page * 1000}`, { headers });
      if (!r.ok) return res.status(502).json({ error: 'Could not read the job posts — try again.' });
      const batch = await r.json();
      rows.push(...batch.filter(j => companyNameKey(j.company) === key));
      if (batch.length < 1000) break;
    }
  } catch (e) { logError('listing_signals', e.message, { company }); return res.status(502).json({ error: 'Could not read the job posts — try again.' }); }
  const value = listingSignals(rows);
  SIGNALS_CACHE.set(key, { at: Date.now(), value });
  if (SIGNALS_CACHE.size > 2000) SIGNALS_CACHE.delete(SIGNALS_CACHE.keys().next().value);
  return res.status(200).json({ ok: true, signals: value });
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

  // Check DB first (non-expired listings for THIS company). Wildcards only between tokens
  // ("coca-cola" ↔ "Coca Cola"), then an exact normalized-name check — the old `*name*`
  // contains-match listed Amazon Flex under Amazon and every United* employer under United.
  const nameKey = companyNameKey;
  try {
    const pattern = companyIlike(safeName);
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/jobs?company=ilike.${pattern}&expires_at=gt.${now}&select=id,title,company,location,salary,apply_url,source,type,level,score,waste_score,ats_tenant&order=score.desc&limit=40`,
      { headers: dbHeaders }
    );
    const cached = preferFullText((r.ok ? await r.json() : []).filter(j => nameKey(j.company) === nameKey(safeName) && locationScope(j.location) !== 'non_us')).slice(0, 20);
    if (Array.isArray(cached) && cached.length >= 3) {
      const names = await loadTenantNames(SUPABASE_URL, dbHeaders);
      const jobs = applyTenantNames(cached.map(j => ({ title: j.title, company: j.company, location: j.location, salary: honestSalary(j), url: j.apply_url, source: j.source, type: j.type, level: inferLevel(j.title || ''), ...scoreRow(j), ats_tenant: j.ats_tenant || null })), names);
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
        salary: honestSalary(j), url: j.apply_url || j.url || null, description: j.description,
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

// ── handleRecommended: "Matched to your résumé" from the person's job keys ──────
// lib/server/resumeMatches.js findResumeMatches — the SAME matcher as the matched-jobs emails. Each job
// carries `match_reason` ("You were a Cashier at Fry's Food Stores (2019–2023).") and the response says
// what it counts. No padding: zero matches is reason 'no_matches'.
async function handleRecommended(req, res, _body) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'DB unavailable', jobs: [] });

  // Verify the JWT signature before trusting its user_id (previously the payload was
  // base64-decoded with no signature check — trivially forgeable).
  const user_id = await _resolveUid(req);
  if (!user_id) return res.status(401).json({ error: 'Auth required', jobs: [] });

  // Instant answers (lib/server/railCache.js): the person's kept rail, when it still describes their résumé, city and
  // recent applications, is answered in one round trip; an old one is answered and rebuilt after the response.
  const db = serviceDb(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    if (await hasRailCache(db)) {
      const uid = encodeURIComponent(user_id);
      const [profRows, apps, cached] = await Promise.all([
        db(`profiles?id=eq.${uid}&select=resume_updated_at,city&limit=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        readRecentApplications(db, user_id),
        readRailCache(db, user_id),
      ]);
      const prof = Array.isArray(profRows) ? profRows[0] : null;
      if (prof) {
        const sig = railSignature({ resumeUpdatedAt: prof.resume_updated_at, city: prof.city, applications: apps || [] });
        const state = railCacheState(cached, sig);
        if (state !== 'rebuild') {
          if (state === 'stale' && !_railRefreshing.has(user_id)) {
            _railRefreshing.add(user_id);
            waitUntil(buildRail(SUPABASE_URL, SUPABASE_SERVICE_KEY, user_id)
              .then((out) => (out.keep ? writeRailCache(db, user_id, out.body, sig) : null))
              .catch((e) => logError('jobs/recommended-refresh', e.message, { user_id }))
              .finally(() => _railRefreshing.delete(user_id)));
          }
          return res.status(200).json({ ...cached.payload, cached_at: new Date(cached.builtAt).toISOString() });
        }
        const out = await buildRail(SUPABASE_URL, SUPABASE_SERVICE_KEY, user_id);
        if (out.keep) waitUntil(writeRailCache(db, user_id, out.body, sig));
        return res.status(200).json(out.body);
      }
    }
    const out = await buildRail(SUPABASE_URL, SUPABASE_SERVICE_KEY, user_id);
    return res.status(200).json(out.body);
  } catch (e) {
    logError('jobs/recommended', e.message, { user_id });
    return res.status(500).json({ error: e.message, jobs: [] });
  }
}
const _railRefreshing = new Set(); // one background rebuild per person per instance

/** The rail computed now: { body, keep } (keep = may be stored as this person's kept answer). */
async function buildRail(SUPABASE_URL, SUPABASE_SERVICE_KEY, user_id) {
  const dbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  const m = await findResumeMatches({ supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_KEY, userId: user_id });
  // a partial or unreadable answer is shown but never kept: the next request computes again
  const keep = !m.partial && m.reason !== 'unavailable';
  const hasResume = m.hasResume;
  const heal = m.heal;
  // The current title nothing could place ("unknown is not a direction"): the screen says so and offers a search.
  const nd = m.keys && m.keys.no_direction ? { title: String(m.keys.no_direction.title || '').slice(0, 120), company: m.keys.no_direction.company ? String(m.keys.no_direction.company).slice(0, 120) : null } : null;
  if (m.reason) {
    if (heal) await heal;
    return { body: { ok: true, jobs: [], skills: [], has_resume: hasResume, city: m.city || null, city_source: m.citySource || null, reason: m.reason, no_direction: nd }, keep };
  }
  const { ranked, city, citySource } = m;

  // A summary row is shown only for the person's own job, labelled — and never when its source has closed:
  // up to 4 of them get the drawer's liveness check (lib/server/listingLiveness.js: answered from the row when
  // it was checked in the last 24 h, else one paced request, 3 s cap, cached; a closed one is marked expired).
  const pool = ranked.slice(0, 12);
  const liveDb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...dbHeaders, ...(opts.headers || {}) } });
  let checks = 0;
  const live = await Promise.all(pool.map((j) => (j._summaryOnly && checkableId(j.id) && checks++ < 4
    ? checkLiveness({ jobId: j.id, db: liveDb, timeoutMs: 3000 }).catch(() => null)
    : null)));
  const shown = pool.filter((j, i) => live[i]?.state !== 'gone');
  const names = await loadTenantNames(SUPABASE_URL, dbHeaders);
  const jobs = shown.slice(0, 8).map(j => withTenantName({
    id: j.id,
    title: j.title,
    company: j.company,
    ats_tenant: j.ats_tenant || null,
    location: j.location,
    salary: honestSalary(j),
    apply_url: j.apply_url,
    description: j.description,
    type: j.type || 'Full-time',
    level: inferLevel(j.title || ''),
    source: j.source || 'Seen',
    match_reason: j._reason,
    // the checks behind the sentence (field, licences, years, limits, level) — each one passed
    match_checks: Array.isArray(j._checks) ? j._checks : undefined,
    match_basis: j._basis,
    summary_only: !!j._summaryOnly,
    miles: Number.isFinite(j._miles) ? j._miles : null,
    remote: !!j._remote,
    ...scoreRow(j),
  }, names));

  if (heal) await heal; // rebuilt keys land before the function returns
  return { body: { ok: true, jobs, skills: [], seniority: null, function: null, has_resume: hasResume, city, city_source: citySource, matched_total: ranked.length, partial: !!m.partial, reason: jobs.length ? null : (nd ? 'no_direction' : 'no_matches'), no_direction: nd }, keep };
}

// ── Area search: a place and no title ────────────────────────────────────────────────────────
// Every open US listing Seen holds within the radius of the place (or in the state, for a whole-state search),
// nearest first (or newest first), with the true total and a cursor that pages to the last one. Remote
// listings are not "in the area": they are counted apart (`remote_total`) and included only on request
// (`include_remote`). Filters run here, before the count, so the total is what a person can page through.
// No live third-party pull. lib/server/areaSearch.js holds the read / measure / page logic.
const AREA_PAGE = 60;
const AREA_FULL_COLS = 'id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,search_query,lat,lng,created_at,is_employer_posted,ats_tenant';
const AREA_SORTS = new Set(['nearest', 'recent']);
const AREA_LEVELS = new Set(['entry', 'senior']);
const AREA_TYPES = new Set(['Full-time', 'Part-time']);
const AREA_POSTED = new Set(['1', '7', '30']);
const AREA_NICHES = new Set(['tech', 'healthcare', 'retail', 'logistics', 'finance', 'other']);

async function handleAreaSearch(req, res, body) {
  const t0 = Date.now();
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
  const loc = String(body.location || '').trim().slice(0, 120);
  let place = placeSearch(loc);
  // The device's position, when the person allowed it (the 📍 button): the search is centred on them, not on
  // their town's middle. Only US-mainland/AK/HI/PR coordinates are taken.
  const glat = Number(body.lat), glng = Number(body.lng);
  if (Number.isFinite(glat) && Number.isFinite(glng) && glat > 17 && glat < 72 && glng > -180 && glng < -64 && (place.kind === 'point' || place.reason === 'needs_position')) {
    place = { ...place, kind: 'point', lat: glat, lng: glng, label: place.kind === 'point' ? `your location (near ${place.label})` : 'your location', reason: null, suggestions: [], device: true };
  }
  const base = { ok: true, mode: 'area', query: '', location: loc, jobs: [], total: 0, remote_total: 0, in_radius: 0, has_more: false, next_cursor: null };
  // "remote" / "Remote US" typed as the place, or the Remote option with no title: every remote job in the US.
  if (place.kind !== 'remote' && (String(body.radius) === '0' || String(body.radius).toLowerCase() === 'remote')) {
    place = { kind: 'remote', lat: null, lng: null, state: null, name: null, label: 'Remote jobs in the US', zip: null, reason: null, suggestions: [] };
  }
  if (place.kind === 'none') {
    const message = place.reason === 'non_us' ? `Seen lists jobs in the United States — “${loc}” is outside it.`
      : place.reason === 'needs_position' ? 'Type a city or ZIP, or allow your location.'
      : place.reason === 'ambiguous' ? `There’s more than one ${loc} — pick the one you mean.`
      : place.reason === 'not_in_state' ? `We couldn’t find “${loc.split(',')[0].trim()}” in that state.`
      : `We couldn’t find a US place called “${loc}”.`;
    return res.status(200).json({ ...base, area: null, unplaced: { reason: place.reason, suggestions: place.suggestions }, message });
  }
  if (!U || !K) return res.status(503).json({ error: 'DB unavailable', jobs: [] });
  const r = parseInt(body.radius, 10);
  const miles = place.kind === 'state' || place.kind === 'county' || place.kind === 'remote' ? null : (Number.isFinite(r) && r >= 5 && r <= 500 ? r : 25);
  const sort = AREA_SORTS.has(body.sort) ? body.sort : 'nearest';
  const includeRemote = body.include_remote === true;
  const filters = {
    niche: AREA_NICHES.has(body.niche) ? body.niche : '',
    level: AREA_LEVELS.has(body.level) ? body.level : '',
    jobType: AREA_TYPES.has(body.type) ? body.type : '',
    posted: AREA_POSTED.has(String(body.posted)) ? String(body.posted) : '',
    pay: body.pay === true,
  };
  const headers = { apikey: K, Authorization: `Bearer ${K}` };
  const db = async (path) => {
    const resp = await fetch(`${U}/rest/v1/${path}`, { headers });
    if (!resp.ok) throw new Error(`area read ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    return resp.json();
  };

  try {
    const [suppressed, tenantNames] = await Promise.all([getSuppressedSet(U, headers), loadTenantNames(U, headers)]);
    const exclude = (row) => isSeedListing(row) || titleNamesNonUs(row.title) || (row.apply_url && suppressed.has(_normUrl(row.apply_url)));
    const rankOpts = { includeRemote, filters, sort, exclude, level: inferLevel, salary: honestSalary };
    const count = async (m) => {
      const { rows } = await readAreaRows({ db, area: place, miles: m, budgetMs: 4000, waitUntil });
      return rankArea(rows, place, m, rankOpts);
    };
    const { rows, complete, cached, pending, reads } = await readAreaRows({ db, area: place, miles: miles ?? 0, waitUntil });
    const { list, remoteTotal, onsiteTotal } = rankArea(rows, place, miles ?? 0, rankOpts);
    const { page, hasMore, nextCursor, before } = pageArea(list, typeof body.cursor === 'string' ? body.cursor : null, AREA_PAGE, sort);

    // The page's full rows, in the page's order (a row deleted since the read is simply not shown).
    let full = [];
    if (page.length) {
      const ids = page.map((x) => x.row.id).filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
      const got = ids.length ? await db(`jobs?id=in.(${ids.join(',')})&select=${AREA_FULL_COLS}`) : [];
      const byId = new Map((Array.isArray(got) ? got : []).map((j) => [String(j.id), j]));
      full = page.map((x) => {
        const j = byId.get(String(x.row.id));
        if (!j) return null;
        return {
          ...toUiRow(j, loc),
          in_radius: true, related: true, remote: x.remote,
          distance_miles: x.miles, distance_by: x.by, near_place: x.place,
        };
      }).filter(Boolean);
    }
    const jobs = applyTenantNames(full, tenantNames);

    // Nothing here → say how many the next radius up holds.
    let wider = null;
    if (!list.length && place.kind === 'point' && complete) {
      const next = RADIUS_OPTIONS.find((o) => o > miles);
      if (next) { const w = await count(next); wider = { radius: next, total: w.list.length, remote_total: w.remoteTotal }; }
    }
    console.log(`AREA: "${loc}" ${miles ?? 'state'}mi — ${list.length} (${onsiteTotal} on-site, ${remoteTotal} remote) of ${rows.length} rows, ${reads} reads${cached ? ' (cached)' : ''}, page from ${before}, ${Date.now() - t0}ms${complete ? '' : pending ? ' STILL READING' : ' INCOMPLETE'}`);
    // Not user-specific (no position, no account): the edge may serve it to the next visitor for two minutes.
    // A partial answer ("still counting") is never cached.
    if (complete && !place.device) res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    else res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ...base,
      mode: place.kind === 'state' || place.kind === 'county' || place.kind === 'remote' ? place.kind : 'area',
      ...(place.understood ? { understood: place.understood } : {}),
      pending: pending === true,
      jobs, in_radius: jobs.length,
      // The page shows one card per employer + job title (lib/jobs/groupListings.js — "+N more locations"), so the
      // count of jobs is told apart from the count of listings (locations).
      total: list.length, jobs_total: new Set(list.map((x) => roleKey(x.row))).size,
      onsite_total: onsiteTotal, remote_total: remoteTotal, include_remote: includeRemote,
      has_more: hasMore, next_cursor: nextCursor, offset: before, page_size: AREA_PAGE, sort,
      radius: miles,
      area: { kind: place.kind, label: place.label, name: place.name, state: place.state, state_name: place.state ? stateName(place.state) : null, zip: place.zip, approx: place.approx === true, lat: place.lat, lng: place.lng, radius: miles },
      complete, wider, _src: cached ? 'area-cached' : 'area', ms: Date.now() - t0,
    });
  } catch (e) {
    logError('jobs/area', e.message, { loc });
    return res.status(500).json({ error: 'The area search did not finish — try again.', jobs: [] });
  }
}
