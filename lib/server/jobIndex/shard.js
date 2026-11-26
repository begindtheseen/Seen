// One shard of the job index: every open listing whose id falls in one slice of the uuid space, in a compact form
// (repeated text — employers, places, sources — stored once per shard; times as numbers). Built from the database
// by buildShard (api/job-index.js serves it through the CDN; the loader falls back to building it in-process).

export const FORMAT = 3; // bump when the encoding or the column list changes (it is part of the CDN URL)
export const SHARD_COUNT = 32;
// The columns every search read selects or filters by (api/jobs.js POOL_COLUMNS + apply_mode, areaSearch
// AREA_COLUMNS, the nearest-listings fallback) — never `description`, which stays in the database.
export const INDEX_COLUMNS = ['id', 'title', 'company', 'location', 'salary', 'salary_min', 'apply_url', 'type', 'source',
  'score', 'waste_score', 'search_query', 'lat', 'lng', 'created_at', 'is_employer_posted', 'ats_tenant', 'level',
  'expires_at', 'last_seen_at', 'apply_mode'];
const DICT = new Set(['company', 'location', 'salary', 'type', 'source', 'search_query', 'ats_tenant', 'level', 'apply_mode']);
const EPOCH = new Set(['expires_at', 'last_seen_at']); // filtered/ordered by, never served: kept as epoch ms
const OPTIONAL = new Set(['apply_mode']); // exists once the Apply-on-Seen migration is applied

const SPACE = 0x100000000;
const pad8 = (n) => n.toString(16).padStart(8, '0');
const uuidAt = (n) => `${pad8(n)}-0000-0000-0000-000000000000`;
/** [lo, hi) of shard k as uuid strings (hi null for the last). */
export function shardBounds(k) {
  const step = SPACE / SHARD_COUNT;
  return { lo: uuidAt(k * step), hi: k + 1 < SHARD_COUNT ? uuidAt((k + 1) * step) : null };
}
/** The shard an id belongs to. */
export function shardOf(id) {
  const n = parseInt(String(id).slice(0, 8), 16);
  return Number.isFinite(n) ? Math.min(SHARD_COUNT - 1, Math.floor(n / (SPACE / SHARD_COUNT))) : 0;
}

const SUFFIX = '+00:00';
/** Rows from PostgREST → the compact shard. */
export function encodeShard(k, rows, { builtAt = Date.now(), missing = [] } = {}) {
  const cols = INDEX_COLUMNS.filter((c) => !missing.includes(c));
  const dicts = {}, dictIdx = {};
  for (const c of cols) if (DICT.has(c)) { dicts[c] = []; dictIdx[c] = new Map(); }
  const out = [];
  for (const r of rows) {
    const a = new Array(cols.length);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      let v = r[c] === undefined ? null : r[c];
      if (DICT.has(c)) {
        if (v == null) { a[i] = -1; continue; }
        let j = dictIdx[c].get(v);
        if (j === undefined) { j = dicts[c].length; dicts[c].push(v); dictIdx[c].set(v, j); }
        a[i] = j;
      } else if (EPOCH.has(c)) {
        const t = v == null ? NaN : Date.parse(v);
        a[i] = Number.isFinite(t) ? t : null;
      } else if (c === 'created_at' && typeof v === 'string' && v.endsWith(SUFFIX)) {
        a[i] = v.slice(0, -SUFFIX.length); // restored on decode
      } else if (c === 'created_at' && typeof v === 'string') {
        a[i] = `=${v}`; // any other form, kept as is
      } else a[i] = v;
    }
    out.push(a);
  }
  return { v: FORMAT, shard: k, built_at: builtAt, cols, missing, dicts, rows: out };
}

/** The compact shard → row objects (with the lowercased text and the times the evaluator compares by). */
export function decodeShard(s) {
  if (!s || s.v !== FORMAT || !Array.isArray(s.rows) || !Array.isArray(s.cols)) throw new Error('bad shard');
  const { cols, dicts } = s;
  const rows = new Array(s.rows.length);
  for (let n = 0; n < s.rows.length; n++) {
    const a = s.rows[n];
    const r = {};
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      let v = a[i];
      if (DICT.has(c)) v = v === -1 || v == null ? null : dicts[c][v];
      else if (c === 'created_at' && typeof v === 'string') v = v[0] === '=' ? v.slice(1) : v + SUFFIX;
      r[c] = v === undefined ? null : v;
    }
    rows[n] = prepareRow(r);
  }
  return rows;
}

/**
 * One index row: every index column (null when absent) plus the fields the evaluator reads fast — lowercased text
 * (_lc), the creation time as a number, the row's place in the index order (_o) and its placement (_pl, filled by the
 * area search). Built as one object literal so every row has the same shape (V8 keeps such rows small and fast;
 * rows given properties one by one, or by defineProperty, are several times larger). The extra fields are never
 * copied into an answer: answers hold only the selected columns.
 */
const lower = (v) => (v == null ? null : String(v).toLowerCase());
const epoch = (v) => { if (v == null) return null; if (typeof v === 'number') return v; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
export function prepareRow(r) {
  const ct = r.created_at == null ? null : Date.parse(r.created_at);
  return {
    id: r.id ?? null, title: r.title ?? null, company: r.company ?? null, location: r.location ?? null,
    salary: r.salary ?? null, salary_min: r.salary_min ?? null, apply_url: r.apply_url ?? null, type: r.type ?? null,
    source: r.source ?? null, score: r.score ?? null, waste_score: r.waste_score ?? null, search_query: r.search_query ?? null,
    lat: r.lat ?? null, lng: r.lng ?? null, created_at: r.created_at ?? null, is_employer_posted: r.is_employer_posted ?? null,
    ats_tenant: r.ats_tenant ?? null, level: r.level ?? null, expires_at: epoch(r.expires_at), last_seen_at: epoch(r.last_seen_at),
    apply_mode: r.apply_mode ?? null,
    _lc: { title: lower(r.title), company: lower(r.company), location: lower(r.location), search_query: lower(r.search_query), type: lower(r.type) },
    _t_created_at: Number.isFinite(ct) ? ct : null,
    _o: 0,
    _pl: null,
  };
}

/**
 * Every open listing of shard k, read from the database by id range (primary-key order, 1,000 a read).
 * @param {(path: string) => Promise<Response>} get  a fetch of `${SUPABASE_URL}/rest/v1/${path}` with service headers
 * @returns {Promise<{ rows: object[], missing: string[], reads: number }>}
 */
export async function readShardRows(get, k, { now = new Date().toISOString(), page = 1000 } = {}) {
  const { lo, hi } = shardBounds(k);
  let missing = [];
  const select = () => INDEX_COLUMNS.filter((c) => !missing.includes(c)).join(',');
  const rows = [];
  let after = null, reads = 0;
  for (;;) {
    const range = `${after ? `&id=gt.${after}` : `&id=gte.${lo}`}${hi ? `&id=lt.${hi}` : ''}`;
    const path = () => `jobs?select=${select()}&expires_at=gt.${encodeURIComponent(now)}${range}&order=id.asc&limit=${page}`;
    let r = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      reads++;
      r = await get(path()).catch(() => null);
      if (r && r.status === 400 && !missing.length) { missing = [...OPTIONAL]; continue; } // optional column absent
      if (r && r.ok) break;
    }
    if (!r || !r.ok) throw new Error(`shard ${k} read failed: ${r ? r.status : 'network'}`);
    const list = await r.json();
    if (!Array.isArray(list)) throw new Error(`shard ${k} read: not a list`);
    rows.push(...list);
    if (list.length < page) break;
    after = list[list.length - 1].id;
  }
  return { rows, missing, reads };
}
