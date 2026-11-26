// The job index: every open listing's searchable columns, held in memory on each server instance, so a search reads
// no database at all (2026-11-26: on production, searches took 5–24 s and a few phones at once broke search, because
// every search sent 20–30 `ilike` reads to Postgres and common words ran past its 8 s statement timeout).
//
// This is how established job boards answer searches: from a search index built off the main database, not from the
// main database. Here the index is 32 shards (lib/server/jobIndex/shard.js), served by GET /api/job-index through
// Vercel's CDN — so the database is read for the index about once per shard every few minutes per region, whatever
// the number of instances or searches. An instance loads all shards at start (≈146k rows, a second or two), takes new
// listings every minute (one indexed read of rows created since the last one), and re-reads the shards every
// ten minutes in the background. A search never waits on any of that once the index is loaded.
//
// Until the index is loaded on an instance (its first seconds), or if it cannot be loaded at all, every caller reads
// the database exactly as before: the index is an accelerator, never a single point of failure.
//
//   warmJobIndex({ waitUntil })                start loading (no wait)
//   getJobIndex({ waitMs, waitUntil })         → the index when loaded (waits up to waitMs for a cold load), else null
//   indexRead(qs, opts)                        → rows | { status: 400 } | null  (queryIndex on the loaded index)
//   jobIndexStatus()                           → what is loaded, how fresh (for logs and the health check)

import { createHmac } from 'crypto';
import { queryIndex, comparator, warmColumns } from './evaluate.js';
import { FORMAT, SHARD_COUNT, INDEX_COLUMNS, decodeShard, encodeShard, prepareRow, readShardRows, shardOf } from './shard.js';

const REFRESH_MS = 10 * 60_000; // re-read every shard (picks up changed, expired and deleted rows)
const DELTA_MS = 60_000; // new listings since the last read
const RECENT_KEEP_MS = 30 * 60_000; // new rows re-applied over a shard the CDN served from before they existed
const CDN_TIMEOUT_MS = 15_000;
const CDN_CONCURRENCY = 8;
const LOCAL_CONCURRENCY = 4; // building shards from the database ourselves (CDN unreachable): a few at a time
// DEFAULT_ORDER (score desc nulls last, id asc) without the general comparator's per-key work: the index is sorted by
// it on every build. Ids from PostgREST are lowercase uuids, so text order = uuid order.
const DEFAULT_CMP = (a, b) => {
  const x = a.score, y = b.score;
  if (x !== y) {
    if (x == null) return 1;
    if (y == null) return -1;
    if (x !== y) return y - x;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
export { comparator };

const state = {
  shards: new Array(SHARD_COUNT).fill(null), // { rows, builtAt, loadedAt, via }
  index: null, // { rows (DEFAULT_ORDER), cols, missing, memo, version, builtAt, size }
  loading: null,
  refreshing: null,
  delta: null,
  lastFull: 0,
  lastDelta: 0,
  watermark: null, // newest created_at seen (ms)
  recent: new Map(), // id → { row, at }
  version: 0,
  failures: 0,
  lastError: null,
  lastFailAt: 0,
  via: { cdn: 0, local: 0 },
};

/** The token the shard endpoint asks for (so the whole corpus is not one public URL). */
export function indexToken(key = process.env.SUPABASE_SERVICE_KEY || '') {
  return createHmac('sha256', String(key)).update(`job-index:${FORMAT}`).digest('hex').slice(0, 32);
}

function dbGet() {
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
  if (!U || !K) return null;
  const headers = { apikey: K, Authorization: `Bearer ${K}` };
  return (path) => fetch(`${U}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(12_000) });
}

/** Where this deployment's CDN answers /api/job-index, or null (local run: build from the database). */
function cdnBase() {
  if (process.env.JOB_INDEX_BASE) return { base: process.env.JOB_INDEX_BASE.replace(/\/$/, ''), headers: {} };
  if (!process.env.VERCEL) return null;
  if (process.env.VERCEL_ENV === 'production') return { base: `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'seenjobs.io'}`, headers: {} };
  if (process.env.VERCEL_URL) {
    // A preview sits behind Vercel's login, which its own servers cannot pass without the automation bypass secret.
    // Without it the preview reads production's copy (the same database; a different FORMAT answers 409 and the
    // shard is built here instead).
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) return { base: `https://${process.env.VERCEL_URL}`, headers: { 'x-vercel-protection-bypass': bypass } };
    return { base: 'https://seenjobs.io', headers: {} };
  }
  return null;
}

async function loadShardFromCdn(k) {
  const c = cdnBase();
  if (!c) return null;
  const url = `${c.base}/api/job-index?shard=${k}&v=${FORMAT}&k=${indexToken()}`;
  const r = await fetch(url, { headers: c.headers, signal: AbortSignal.timeout(CDN_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`cdn shard ${k}: ${r.status}`);
  const body = await r.json();
  return { body, cache: r.headers.get('x-vercel-cache') || '' };
}

let _localActive = 0;
const _localQueue = [];
function localSlot(fn) {
  return new Promise((res, rej) => {
    const run = () => { _localActive++; fn().then(res, rej).finally(() => { _localActive--; const n = _localQueue.shift(); if (n) n(); }); };
    if (_localActive < LOCAL_CONCURRENCY) run(); else _localQueue.push(run);
  });
}
async function loadShardLocal(k) {
  const get = dbGet();
  if (!get) throw new Error('no database configured');
  return localSlot(async () => {
    const { rows, missing } = await readShardRows(get, k);
    return { body: encodeShard(k, rows, { missing }), cache: 'LOCAL' };
  });
}

const tick = () => new Promise((r) => setImmediate(r));

async function loadShard(k) {
  let got = null;
  try { got = await loadShardFromCdn(k); } catch (e) { state.lastError = e.message; state.cdnError = e.message; }
  if (got) state.via.cdn++;
  else { got = await loadShardLocal(k); state.via.local++; }
  await tick();
  const rows = decodeShard(got.body);
  return { rows, builtAt: Number(got.body.built_at) || Date.now(), loadedAt: Date.now(), missing: got.body.missing || [], cache: got.cache };
}

/** Rebuild the searchable index from the shards (+ recent rows the shards predate). Only when every shard is in. */
function rebuild() {
  if (state.shards.some((s) => !s)) return;
  const byId = new Map();
  let missing = new Set();
  for (const s of state.shards) {
    for (const r of s.rows) byId.set(r.id, r);
    for (const m of s.missing || []) missing.add(m);
  }
  const now = Date.now();
  for (const [id, x] of state.recent) {
    if (now - x.at > RECENT_KEEP_MS) { state.recent.delete(id); continue; }
    const s = state.shards[shardOf(id)];
    // a shard built after the row was read holds it (or a newer copy) already
    if (s && s.builtAt > x.at + 5_000) continue;
    byId.set(id, x.row);
  }
  const rows = [...byId.values()].sort(DEFAULT_CMP);
  for (let i = 0; i < rows.length; i++) rows[i]._o = i;
  let wm = state.watermark || 0;
  for (const r of rows) if (r._t_created_at && r._t_created_at > wm) wm = r._t_created_at;
  state.watermark = wm || null;
  const cols = new Set(INDEX_COLUMNS.filter((c) => !missing.has(c)));
  state.version++;
  if (state.index) state.index.dead = true;
  state.index = { rows, fresh: [], shadow: new Set(), cols, missing, memo: new Map(), version: state.version, builtAt: Math.min(...state.shards.map((s) => s.builtAt)), size: rows.length };
  warmColumns(state.index);
}

/**
 * New rows from a delta read, added beside the loaded index (`fresh`, in index order) without touching the base: the
 * base, its memo and its column strings stay valid until the next full reload. A fresh row that replaces a base row
 * hides it (`shadow`).
 */
function mergeRecent() {
  const idx = state.index;
  if (!idx) return;
  const byId = idx.byId || (idx.byId = new Map(idx.rows.map((r) => [String(r.id).toLowerCase(), r])));
  const fresh = [];
  const shadow = new Set();
  for (const [id, x] of state.recent) {
    const s = state.shards[shardOf(id)];
    if (s && s.builtAt > x.at + 5_000 && byId.has(String(id).toLowerCase())) continue; // the base already holds it
    fresh.push(x.row);
    if (byId.has(String(id).toLowerCase())) shadow.add(id);
  }
  fresh.sort(DEFAULT_CMP);
  for (const r of fresh) if (r._t_created_at && r._t_created_at > (state.watermark || 0)) state.watermark = r._t_created_at;
  state.version++;
  state.index = { ...idx, fresh, shadow, all: null, version: state.version, size: idx.rows.length - shadow.size + fresh.length };
}

async function runPool(ks, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, ks.length) }, async () => { while (next < ks.length) { const k = ks[next++]; await fn(k); } }));
}

function loadAll() {
  if (state.loading) return state.loading;
  const t0 = Date.now();
  state.loading = (async () => {
    const fresh = new Array(SHARD_COUNT).fill(null);
    let failed = 0;
    await runPool([...Array(SHARD_COUNT).keys()], CDN_CONCURRENCY, async (k) => {
      try { fresh[k] = await loadShard(k); } catch (e) { failed++; state.lastError = e.message; }
    });
    // A refresh replaces each shard it could read; a first load needs every one.
    for (let k = 0; k < SHARD_COUNT; k++) if (fresh[k]) state.shards[k] = fresh[k];
    if (failed) { state.failures++; state.lastFailAt = Date.now(); }
    rebuild();
    state.lastFull = Date.now();
    const local = fresh.filter((s) => s && s.cache === 'LOCAL').length;
    console.log(`[job-index] ${state.index ? 'loaded' : 'NOT loaded'} ${state.index ? state.index.size : 0} rows in ${Date.now() - t0} ms (cdn ${fresh.filter((s) => s && s.cache !== 'LOCAL').length}, local ${local}, failed ${failed}; cache ${[...new Set(fresh.filter(Boolean).map((s) => s.cache || '-'))].join('/')})${local && state.cdnError ? ` — cdn said: ${String(state.cdnError).slice(0, 120)}` : ''}`);
  })().finally(() => { state.loading = null; });
  return state.loading;
}

/** New listings since the newest one held (an indexed range read on jobs.created_at). */
function readDelta() {
  if (state.delta) return state.delta;
  const get = dbGet();
  if (!get || !state.index || !state.watermark) return Promise.resolve();
  state.delta = (async () => {
    const since = new Date(state.watermark - 120_000).toISOString(); // overlap: a row committed late still lands
    const now = encodeURIComponent(new Date().toISOString());
    const cols = [...state.index.cols].join(',');
    let added = 0;
    let after = since;
    for (let page = 0; page < 5; page++) {
      const r = await get(`jobs?select=${cols}&created_at=gt.${encodeURIComponent(after)}&expires_at=gt.${now}&order=created_at.asc&limit=1000`).catch(() => null);
      if (!r || !r.ok) break;
      const list = await r.json().catch(() => null);
      if (!Array.isArray(list) || !list.length) break;
      const at = Date.now();
      for (const raw of list) {
        const row = prepareRow({ ...raw });
        const prev = state.recent.get(row.id);
        state.recent.set(row.id, { row, at });
        if (!prev) added++;
      }
      if (list.length < 1000) break;
      after = list[list.length - 1].created_at;
    }
    state.lastDelta = Date.now();
    if (added) mergeRecent();
  })().catch(() => { state.lastDelta = Date.now(); }).finally(() => { state.delta = null; });
  return state.delta;
}

// On for every Vercel deployment; elsewhere (a local run, the test suite) only when asked (JOB_INDEX=on, or a shard
// server named by JOB_INDEX_BASE). Off with JOB_INDEX=off anywhere — every read then goes to the database as before.
function enabled() {
  if (process.env.JOB_INDEX === 'off') return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return false;
  return !!(process.env.VERCEL || process.env.JOB_INDEX === 'on' || process.env.JOB_INDEX_BASE);
}

/** Start loading the index on this instance (module start): no wait. */
export function warmJobIndex({ waitUntil = null } = {}) {
  if (state.index || state.loading) return;
  if (!enabled()) return;
  void waitUntil;
  loadAll().catch(() => null);
}

/**
 * The loaded index, or null. Starts a cold load and waits up to `waitMs` for it; keeps a loaded one fresh in the
 * background (refresh / delta) without making the caller wait. `fresh: true` waits (≤ 2 s) for a delta read when the
 * last one is more than 5 s old — the page's silent re-read after a live top-up wants the rows just saved.
 */
export async function getJobIndex({ waitMs = 0, waitUntil = null, fresh = false } = {}) {
  if (!enabled()) return null;
  const bg = (p) => { if (p && waitUntil) waitUntil(p.catch(() => null)); };
  // A full load is never tied to a request (waitUntil): building shards here when the CDN fails can outlast the
  // function's limit, and an invocation that hits it is ended with its instance — and the index it was loading.
  // The load keeps going while the instance serves requests.
  if (!state.index) {
    // A first load that could not finish is retried at most every 30 s (not on every request).
    if (!state.loading && state.lastFailAt && Date.now() - state.lastFailAt < 30_000) return null;
    const p = loadAll();
    if (waitMs > 0) {
      let t;
      await Promise.race([p.catch(() => null), new Promise((r) => { t = setTimeout(r, waitMs); })]);
      clearTimeout(t);
    }
    return state.index;
  }
  const now = Date.now();
  if (now - state.lastFull > REFRESH_MS && !state.loading) loadAll().catch(() => null);
  if (fresh && now - state.lastDelta > 5_000) {
    const p = readDelta();
    bg(p);
    let t;
    await Promise.race([p, new Promise((r) => { t = setTimeout(r, 2_000); })]);
    clearTimeout(t);
  } else if (now - state.lastDelta > DELTA_MS) bg(readDelta());
  return state.index;
}

/** A PostgREST read of `jobs` answered from the loaded index: rows, { status: 400 }, or null (read the database). */
export function indexRead(qs, opts = {}) {
  const idx = state.index;
  if (!idx) return null;
  try { return queryIndex(idx, qs, opts); } catch (e) { state.lastError = e.message; return null; }
}

/** Every row of the loaded index (base + fresh), or null — for readers that measure every row themselves (area search). */
export function indexRows() {
  const i = state.index;
  if (!i) return null;
  if (!i.fresh || !i.fresh.length) return i.rows;
  if (!i.all) i.all = i.rows.filter((r) => !i.shadow.has(r.id)).concat(i.fresh);
  return i.all;
}

export function jobIndexStatus() {
  const i = state.index;
  return {
    loaded: !!i, rows: i ? i.size : 0, version: state.version,
    built_at: i ? new Date(i.builtAt).toISOString() : null,
    loaded_at: state.lastFull ? new Date(state.lastFull).toISOString() : null,
    delta_at: state.lastDelta ? new Date(state.lastDelta).toISOString() : null,
    recent: state.recent.size, shards: state.shards.filter(Boolean).length, via: { ...state.via },
    failures: state.failures, last_error: state.lastError,
  };
}

/** Tests: install an index from rows (already prepared or raw). */
export function _setIndexForTest(rows, { missing = [] } = {}) {
  const prepared = rows.map((r) => (r._lc ? r : prepareRow({ ...r })));
  prepared.sort(DEFAULT_CMP);
  prepared.forEach((r, i) => { r._o = i; });
  state.version++;
  state.index = rows ? { rows: prepared, fresh: [], shadow: new Set(), cols: new Set(INDEX_COLUMNS.filter((c) => !missing.includes(c))), missing: new Set(missing), memo: new Map(), version: state.version, builtAt: Date.now(), size: prepared.length } : null;
  state.lastFull = Date.now(); state.lastDelta = Date.now();
}
export function _clearIndexForTest() { state.index = null; state.shards.fill(null); state.recent.clear(); state.watermark = null; }
/** Tests: run a full shard reload now (as the ten-minute refresh does). */
export function _reloadForTest() { return loadAll(); }
