// "All the jobs in an area": a search with a place and no job title (api/jobs.js). Reads Seen's own
// listings only — never a live third-party pull — and answers with every open US listing inside the
// radius, nearest first (or newest first), with a true total and keyset paging that reaches the last row.
//
//   readAreaRows({ db, area, miles })         → light rows the database holds in/around the area (cached)
//   rankArea(rows, area, miles, opts)         → { list, remoteTotal } — measured, filtered, ordered (pure)
//   pageArea(list, cursor, size)              → { page, nextCursor, hasMore } (pure)
//
// Where a listing is and whether it is inside the radius is lib/geo/radius.js — the same rule every
// other surface uses. The database read is a superset (bounding box for rows with coordinates, words of
// every place in the circle for rows without — lib/geo/usPlaces.js areaTextPatterns); every row it returns
// is then measured. A read that would pass PostgREST's 1,000-row cap is split by id range until each part
// is under it, so nothing is silently dropped (`complete` says so if a part could not be finished).

import { withinRadius, inState, placeListing, isRemoteListing, stateName } from '../geo/radius.js';
import { areaTextPatterns, placesByPopulation } from '../geo/usPlaces.js';
import { matchesFilters } from '../jobs/jobFilters.js';
import { orLiteral } from './pgrest.js';

export const AREA_COLUMNS = 'id,title,company,location,lat,lng,type,created_at,salary,source,apply_url,is_employer_posted';
const CAP = 1000; // PostgREST max-rows
const MAX_DEPTH = 7; // up to 128 id ranges per read
const CACHE_MS = 5 * 60 * 1000;
const READ_BUDGET_MS = 40_000; // the whole read, background included (api/jobs.js has 60 s)
const CACHE_MAX = 60;
const URL_BUDGET = 3000; // characters of patterns per request
// Terms per request: past about a dozen the planner stops using the trigram index and scans the table
// (a 45-term OR hit the 8 s statement timeout on 2026-11-10; 3 terms answered in 80 ms).
const MAX_TERMS = Number(process.env.AREA_MAX_TERMS) || 8;

// ── Database read ────────────────────────────────────────────────────────────────────────────

const pad8 = (n) => n.toString(16).padStart(8, '0');
const uuidAt = (n) => `${pad8(n)}-0000-0000-0000-000000000000`;
const SPACE = 0x100000000; // ids are uuids; the first 32 bits split the id space evenly

// A row that names the state: ", AZ" at the end or before more text, the state's name, "AZ - Phoenix".
function statePatterns(state) {
  const st = state.toLowerCase();
  const full = stateName(state).toLowerCase();
  return [`*_ ${orLiteral(st)}`, `*_ ${orLiteral(st)}_*`, `*${orLiteral(full)}*`, `${orLiteral(st)} - *`, `${orLiteral(st)} *`];
}

/** The filters (PostgREST query fragments, leading '&') whose union holds every row of the area. */
export function areaFilters(area, miles) {
  const out = [];
  const f = (n) => n.toFixed(6);
  // OR of `ilike` patterns: each one is answered by the trigram index on jobs.location (a POSIX regex
  // alternation is not, and timed out on this table), chunked so one URL stays small.
  const regexChunks = (patterns) => {
    const chunks = [];
    let cur = [];
    let len = 0;
    for (const p of patterns) {
      const term = `location.ilike.${p}`;
      if (cur.length && (len + term.length + 1 > URL_BUDGET || cur.length >= MAX_TERMS)) { chunks.push(cur); cur = []; len = 0; }
      cur.push(term); len += term.length + 1;
    }
    if (cur.length) chunks.push(cur);
    return chunks.map((c) => `&or=${encodeURIComponent(`(${c.join(',')})`)}`);
  };
  if (area.kind === 'point') {
    const latPad = miles / 68.7;
    const lngPad = miles / (68.7 * Math.max(0.01, Math.cos((area.lat * Math.PI) / 180)));
    out.push(`&lat=gte.${f(area.lat - latPad)}&lat=lte.${f(area.lat + latPad)}&lng=gte.${f(area.lng - lngPad)}&lng=lte.${f(area.lng + lngPad)}`);
    // Rows with no coordinates, by the words their location uses for the places in the circle.
    // Only rows WITHOUT coordinates: a row with coordinates is in the box or not. (A listing naming several
    // places keeps NULL coordinates — scripts/geo/backfill-job-coords.mjs leaves those rows — so every place
    // it names is read here.) Once the backfill has run, this read is small.
    for (const c of regexChunks(areaTextPatterns({ lat: area.lat, lng: area.lng }, miles))) out.push(`&lat=is.null${c}`);
  } else if (area.kind === 'state') {
    const pats = statePatterns(area.state);
    // Listings that write only a big city ("Phoenix", "Houston; Seattle").
    for (const p of placesByPopulation(100000)) {
      if (p.state === area.state) pats.push(`*${p.name.toLowerCase().split('.').map((x) => orLiteral(x)).join('*')}*`);
    }
    for (const c of regexChunks(pats)) out.push(c);
  }
  return out;
}

// ── Load limits: this read must never be able to hurt the database ───────────────────────────
// ONE limiter for every area read on the instance: at most 4 requests in flight, whoever asked. A search may
// issue at most READ_CAP requests in all; a search that would need more is answered as incomplete.
const IN_FLIGHT = 4;
const READ_CAP = 160;
let _active = 0;
const _queue = [];
function pump() {
  while (_active < IN_FLIGHT && _queue.length) {
    const job = _queue.shift();
    _active++;
    job.fn().then(job.res, job.rej).finally(() => { _active--; pump(); });
  }
}
const queued = (fn) => new Promise((res, rej) => { _queue.push({ fn, res, rej }); pump(); });

/**
 * Every row matching `filter`, whatever the count: one request when it fits under the cap, else the id
 * range is halved until each part does (each part is complete without an ORDER BY, which on this table
 * walks the primary key and times out). Rows land in `sink` as they arrive, so a search that runs out of
 * time can still show what it has.
 */
async function readComplete(ctx, filter, lo = 0, hi = SPACE, depth = 0) {
  if (Date.now() > ctx.deadline || ctx.reads >= READ_CAP) { ctx.complete = false; return; }
  ctx.reads++;
  const range = `${lo > 0 ? `&id=gte.${uuidAt(lo)}` : ''}${hi < SPACE ? `&id=lt.${uuidAt(hi)}` : ''}`;
  let rows = null;
  try {
    rows = await queued(() => ctx.db(`jobs?select=${AREA_COLUMNS}${filter}${range}&limit=${CAP}`));
  } catch (e) {
    // A statement timeout on a wide read: the halves are smaller reads. Deep down, it is incomplete.
    if (depth >= 3) { ctx.complete = false; return; }
  }
  if (rows !== null && !Array.isArray(rows)) { ctx.complete = false; return; }
  if (rows && rows.length < CAP) { ctx.add(rows); return; }
  if (depth >= MAX_DEPTH) { if (rows) ctx.add(rows); ctx.complete = false; return; }
  const mid = lo + Math.floor((hi - lo) / 2);
  await Promise.all([readComplete(ctx, filter, lo, mid, depth + 1), readComplete(ctx, filter, mid, hi, depth + 1)]);
}

// After the coordinate backfill (scripts/geo/backfill-job-coords.mjs) the same two reads apply, but the box then
// holds nearly every placeable row and the coordinate-less text read covers only rows that name several places,
// a state, remote or nothing — with the partial trigram index on those rows (the report's SQL) each text read is
// a small index scan.

const _cache = new Map(); // key → { at, miles, rows, complete }
const _inflight = new Map(); // key → { promise, ctx }
const areaKey = (area) => (area.kind === 'state' ? `state:${area.state}` : `pt:${area.lat.toFixed(4)},${area.lng.toFixed(4)}`);

/**
 * The rows the database holds in and around the area (a superset; rankArea measures them). Cached per instance
 * for 5 minutes (a cached read of the same centre at a WIDER radius serves a narrower one; filters and sort run
 * on the cached rows, so the cache answers every filter combination).
 *
 * Time: the answer comes back within `budgetMs` (default 8 s). A read still running then is answered with the
 * rows found so far and `complete: false, pending: true`; it keeps going in the background (via `waitUntil`, at
 * most READ_BUDGET_MS in all) and fills the cache, so the person's next request — the page asks again a few
 * seconds later — gets the whole area.
 * @param {{ db: (path: string) => Promise<any>, area: object, miles: number, now?: number, budgetMs?: number, waitUntil?: (p: Promise<any>) => void }} a
 */
export async function readAreaRows({ db, area, miles, now = Date.now(), budgetMs = 8000, waitUntil = null }) {
  const key = areaKey(area);
  for (const [k, v] of _cache) if (now - v.at > CACHE_MS) _cache.delete(k);
  const hit = [..._cache.entries()].find(([k, v]) => k.startsWith(`${key}|`) && (area.kind === 'state' || v.miles >= miles));
  if (hit) return { rows: hit[1].rows, complete: hit[1].complete, cached: true, reads: 0 };

  const cacheKey = `${key}|${area.kind === 'state' ? 0 : miles}`;
  let job = _inflight.get(cacheKey);
  if (!job) {
    const seen = new Set();
    const ctx = {
      db, deadline: Date.now() + READ_BUDGET_MS, reads: 0, complete: true, rows: [],
      add(list) { for (const row of list) { if (!row || seen.has(row.id)) continue; seen.add(row.id); this.rows.push(row); } },
    };
    const promise = (async () => {
      const nowIso = encodeURIComponent(new Date(now).toISOString());
      const filters = areaFilters(area, miles);
      await Promise.all(filters.map((f) => readComplete(ctx, `&expires_at=gt.${nowIso}${f}`)));
      if (ctx.complete) {
        if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
        _cache.set(cacheKey, { at: now, miles, rows: ctx.rows, complete: true });
      }
      _inflight.delete(cacheKey);
      return ctx;
    })();
    job = { promise, ctx };
    _inflight.set(cacheKey, job);
  }
  let timer;
  const done = await Promise.race([job.promise, new Promise((r) => { timer = setTimeout(() => r(null), budgetMs); })]);
  clearTimeout(timer);
  if (done) return { rows: done.rows, complete: done.complete, cached: false, reads: done.reads };
  if (waitUntil) waitUntil(job.promise.catch(() => null));
  return { rows: job.ctx.rows.slice(), complete: false, pending: true, cached: false, reads: job.ctx.reads };
}
export function _clearAreaCache() { _cache.clear(); _inflight.clear(); }
/** For tests: how many reads are in flight on this instance right now. */
export function _inFlight() { return _active; }

// ── Measuring, filtering, ordering ───────────────────────────────────────────────────────────

const placeMemo = new Map(); // location text → placeListing result for a coordinate-less row
function placed(row) {
  if (row.lat != null && row.lng != null) return placeListing(row);
  const k = `${row.location || ''}\u0001${row.type || ''}`;
  let p = placeMemo.get(k);
  if (!p) { p = placeListing(row); if (placeMemo.size > 50000) placeMemo.clear(); placeMemo.set(k, p); }
  return p;
}

/**
 * Measure every row, keep the ones in the area that pass the filters, order them.
 * @param {object[]} rows light rows (AREA_COLUMNS)
 * @param {{ kind: 'point'|'state', lat?: number, lng?: number, state?: string, name?: string|null }} area
 * @param {number} miles
 * @param {{ includeRemote?: boolean, filters?: object, sort?: 'nearest'|'recent', exclude?: (row: object) => boolean,
 *   level?: (title: string) => string, salary?: (row: object) => string|null, now?: number }} opts
 * @returns {{ list: Array<{ row: object, miles: number|null, by: string|null, place: string|null, remote: boolean }>, remoteTotal: number, onsiteTotal: number }}
 */
export function rankArea(rows, area, miles, opts = {}) {
  const { includeRemote = false, filters = {}, sort = 'nearest', exclude = () => false, level = () => '', salary = (r) => r.salary || null, now = Date.now() } = opts;
  const nameKey = area.kind === 'point' && area.name ? area.name.toLowerCase() : '';
  const out = [];
  let remoteTotal = 0, onsiteTotal = 0;
  for (const row of rows) {
    if (!row || exclude(row)) continue;
    const p = placed(row);
    let m;
    if (area.kind === 'state') {
      if (!inState(p, area.state)) continue;
      m = { in: true, miles: null, by: 'state', place: null };
    } else {
      m = withinRadius({ ...p, location: row.location }, { lat: area.lat, lng: area.lng }, miles, { nameKey });
      if (!m.in) continue;
    }
    const remote = p.remote || isRemoteListing(row);
    const view = { title: row.title, company: row.company, source: row.source, type: row.type, level: level(row.title || ''), posted_at: row.created_at, salary: salary(row) };
    if (!matchesFilters(view, filters, now)) continue;
    if (remote) remoteTotal++; else onsiteTotal++;
    if (remote && !includeRemote) continue;
    out.push({ row, miles: m.miles, by: m.by, place: m.place, remote });
  }
  out.sort(sort === 'recent' ? byRecent : byNearest);
  return { list: out, remoteTotal, onsiteTotal };
}

const t = (x) => Date.parse(x.row.created_at || '') || 0;
const d = (x) => (x.miles == null ? Number.POSITIVE_INFINITY : x.miles);
const byId = (a, b) => (String(a.row.id) < String(b.row.id) ? -1 : String(a.row.id) > String(b.row.id) ? 1 : 0);
function byNearest(a, b) { return (d(a) - d(b)) || (t(b) - t(a)) || byId(a, b); }
function byRecent(a, b) { return (t(b) - t(a)) || (d(a) - d(b)) || byId(a, b); }

// ── Paging ───────────────────────────────────────────────────────────────────────────────────
// The cursor is the LAST row shown, as its sort key — the next page starts strictly after it in the same
// order, so a row is never shown twice and none is skipped, whatever was added to Seen in between
// (a listing added before the cursor's position simply is not in this walk-through).

export function encodeCursor(x, sort) {
  if (!x) return null;
  return Buffer.from(JSON.stringify({ s: sort, d: x.miles, t: x.row.created_at || null, id: String(x.row.id) })).toString('base64url');
}
export function decodeCursor(c) {
  if (!c || typeof c !== 'string' || c.length > 400) return null;
  try {
    const o = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    return o && typeof o.id === 'string' ? o : null;
  } catch { return null; }
}

/**
 * One page after the cursor.
 * @returns {{ page: object[], nextCursor: string|null, hasMore: boolean, before: number }}
 */
export function pageArea(list, cursor, size, sort = 'nearest') {
  const c = decodeCursor(cursor);
  let start = 0;
  if (c) {
    const probe = { row: { id: c.id, created_at: c.t }, miles: c.d };
    const cmp = sort === 'recent' ? byRecent : byNearest;
    start = list.findIndex((x) => cmp(x, probe) > 0);
    if (start < 0) start = list.length;
  }
  const page = list.slice(start, start + size);
  const hasMore = start + size < list.length;
  return { page, hasMore, nextCursor: hasMore ? encodeCursor(page[page.length - 1], sort) : null, before: start };
}
