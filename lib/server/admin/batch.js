// Database helpers for the admin server: the PostgREST client, exact counts that are null (never 0) when
// they fail, keyset paging, chunked id writes that never build a long URL, and RPC calls that tell
// "the function is not there yet" (fall back) apart from "it failed" (report it).
//
// WHY CHUNKS ARE SMALL: PostgREST echoes the whole query string in a Content-Location response header and
// Node's fetch (undici) refuses a response whose headers pass 16 KB — measured on prod 2026-11-10: 390
// uuids in one `id=in.(…)` worked, 400 threw UND_ERR_HEADERS_OVERFLOW, and the old "Approve all" (500 ids)
// approved nothing. A chunk of 40 bare uuids keeps every request URL under 2 KB.

export const ID_CHUNK = 40;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => UUID_RE.test(String(v || ''));

/** The admin PostgREST client. Records every failed call (table + status only, never the query). */
export function makeDb({ url, key, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const failed = [];
  const db = async (path, opts = {}) => {
    let res;
    try {
      res = await fetchImpl(`${url}/rest/v1/${path}`, {
        ...opts,
        headers: {
          apikey: key, Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          ...(opts.headers || {}),
        },
      });
    } catch (e) {
      failed.push({ table: String(path).split('?')[0], status: 0, error: String(e?.message || e).slice(0, 120) });
      return { ok: false, status: 0, headers: { get: () => null }, json: async () => null, text: async () => '' };
    }
    if (!res.ok) failed.push({ table: String(path).split('?')[0], status: res.status });
    return res;
  };
  db.failed = failed;
  db.url = url;
  db.key = key;
  return db;
}

export const rows = async (r) => {
  if (!r || !r.ok) return null;
  const v = await r.json().catch(() => null);
  return Array.isArray(v) ? v : (v == null ? null : v);
};

export const contentRangeTotal = (r) => {
  const v = Number.parseInt(String(r?.headers?.get?.('content-range') || '').split('/')[1], 10);
  return Number.isFinite(v) ? v : null;
};

/** Exact count, or null when the read failed or took longer than `ms`. */
export async function countExact(db, path, ms = 6000) {
  const sep = path.includes('?') ? '&' : '?';
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  try {
    const r = await db(`${path}${sep}limit=1`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' }, signal });
    return r && r.ok ? contentRangeTotal(r) : null;
  } catch { return null; }
}

/**
 * Call an RPC. { ok, absent, status, data }. `absent` = the function is not deployed yet (404 / PGRST202),
 * so the caller falls back to the REST path and gives the same answer.
 */
export async function rpc(db, name, args = {}, opts = {}) {
  const r = await db(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args), ...opts });
  if (r && r.ok) return { ok: true, absent: false, status: r.status, data: await r.json().catch(() => null) };
  const status = r ? r.status : 0;
  const text = r && r.text ? await r.text().catch(() => '') : '';
  const absent = status === 404 || /PGRST202|PGRST205|42883|42P01|does not exist|Could not find the function/i.test(text);
  return { ok: false, absent, status, error: text.slice(0, 200) };
}

export function chunk(list, size = ID_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** `id=in.(a,b,…)` for validated uuids or integers — they need no quoting or encoding, which keeps it short. */
export function idList(ids) {
  return `(${ids.map(String).join(',')})`;
}

/**
 * Read rows by id in short chunks. `ids` must already be validated (uuid or integer).
 * Returns { ok, rows, failedChunks }.
 */
export async function readByIds(db, table, ids, { select = '*', filter = '', col = 'id', size = ID_CHUNK } = {}) {
  const out = [];
  let failedChunks = 0;
  for (const c of chunk(ids, size)) {
    const r = await db(`${table}?${col}=in.${idList(c)}${filter ? `&${filter}` : ''}&select=${select}&limit=${c.length * 50}`);
    const got = await rows(r);
    if (!Array.isArray(got)) { failedChunks++; continue; }
    out.push(...got);
  }
  return { ok: failedChunks === 0, rows: out, failedChunks };
}

/**
 * PATCH rows by id, `filter` (the precondition) repeated in every statement, ≤ID_CHUNK ids per call.
 * Counts what each statement really changed (`select=id`). Stops at the first failure and reports it.
 */
export async function patchByIds(db, table, ids, patch, { filter = '', col = 'id', size = ID_CHUNK, deadline = Infinity } = {}) {
  const changed = [];
  for (const c of chunk(ids, size)) {
    if (Date.now() > deadline) return { ok: true, changed, stoppedEarly: true };
    const r = await db(`${table}?${col}=in.${idList(c)}${filter ? `&${filter}` : ''}&select=${col}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!r || !r.ok) return { ok: false, status: r ? r.status : 0, changed };
    const got = await r.json().catch(() => []);
    for (const g of Array.isArray(got) ? got : []) changed.push(String(g[col]));
  }
  return { ok: true, changed };
}

/** DELETE rows by id the same way. */
export async function deleteByIds(db, table, ids, { filter = '', col = 'id', size = ID_CHUNK, deadline = Infinity } = {}) {
  const deleted = [];
  for (const c of chunk(ids, size)) {
    if (Date.now() > deadline) return { ok: true, deleted, stoppedEarly: true };
    const r = await db(`${table}?${col}=in.${idList(c)}${filter ? `&${filter}` : ''}&select=${col}`, { method: 'DELETE' });
    if (!r || !r.ok) return { ok: false, status: r ? r.status : 0, deleted };
    const got = await r.json().catch(() => []);
    for (const g of Array.isArray(got) ? got : []) deleted.push(String(g[col]));
  }
  return { ok: true, deleted };
}

/** PATCH one filtered set and count the rows it changed. */
export async function patchCounted(db, path, patch) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await db(`${path}${sep}select=*`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!r || !r.ok) return { ok: false, status: r ? r.status : 0, rows: [], changed: 0 };
  const got = await r.json().catch(() => []);
  const list = Array.isArray(got) ? got : [];
  return { ok: true, status: r.status, rows: list, changed: list.length };
}

// ── keyset paging ──────────────────────────────────────────────────────────────────────────────
// A cursor is "<sortValue>|<id>", base64url. The next page is rows strictly after it in the order.

export const encodeCursor = (v) => Buffer.from(String(v), 'utf8').toString('base64url');
export function decodeCursor(c) {
  if (!c || typeof c !== 'string' || c.length > 600) return null;
  try { return Buffer.from(c, 'base64url').toString('utf8'); } catch { return null; }
}

/**
 * One keyset page over `table` ordered by (`order` desc|asc, id same dir).
 * `filter` is a ready PostgREST filter string (values already encoded by pgrest.js); it must not use a
 * top-level `and=` (the cursor condition is added as `and=(or(…))`).
 * Returns { ok, rows, next }.
 */
export async function keysetPage(db, table, { select, filter = '', order = 'created_at', dir = 'desc', idCol = 'id', limit = 50, after = null, idIsNumber = false } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  let where = filter;
  const raw = decodeCursor(after);
  if (raw) {
    const cut = raw.lastIndexOf('|');
    const sortVal = raw.slice(0, cut);
    const idVal = raw.slice(cut + 1);
    const idOk = idIsNumber ? /^\d{1,19}$/.test(idVal) : (isUuid(idVal) || /^\d{1,19}$/.test(idVal));
    if (cut > 0 && sortVal.length > 0 && sortVal.length <= 300 && idOk) {
      const op = dir === 'desc' ? 'lt' : 'gt';
      // Quoted inside the logic tree so a value with commas or parentheses (a company name) is one value.
      const sv = encodeURIComponent(`"${sortVal.replace(/["\\]/g, '')}"`);
      // Nulls sort last, so they are still ahead of any non-null cursor.
      const ks = `and=(or(${order}.${op}.${sv},and(${order}.eq.${sv},${idCol}.${op}.${idVal}),${order}.is.null))`;
      where = where ? `${where}&${ks}` : ks;
    } else if (cut === 0 && idOk) {
      // A null sort value sorts last; continue by id among the nulls.
      const op = dir === 'desc' ? 'lt' : 'gt';
      const ks = `${order}=is.null&${idCol}=${op}.${idVal}`;
      where = where ? `${where}&${ks}` : ks;
    }
  }
  const path = `${table}?select=${select}${where ? `&${where}` : ''}&order=${order}.${dir}.nullslast,${idCol}.${dir}&limit=${lim + 1}`;
  const r = await db(path);
  const got = await rows(r);
  if (!Array.isArray(got)) return { ok: false, status: r ? r.status : 0, rows: [], next: null };
  const page = got.slice(0, lim);
  const last = page[page.length - 1];
  const next = got.length > lim && last ? encodeCursor(`${last[order] ?? ''}|${last[idCol]}`) : null;
  return { ok: true, rows: page, next };
}

/** Every row matching a filter, by keyset pages on the id (PostgREST caps one read at 1,000 rows). */
export async function readAll(db, table, { select, filter = '', idCol = 'id', max = 20000, deadline = Infinity } = {}) {
  const out = [];
  let after = null;
  for (;;) {
    if (Date.now() > deadline) return { ok: false, rows: out, timedOut: true };
    const r = await db(`${table}?select=${select}${filter ? `&${filter}` : ''}${after != null ? `&${idCol}=gt.${encodeURIComponent(after)}` : ''}&order=${idCol}.asc&limit=1000`);
    const page = await rows(r);
    if (!Array.isArray(page)) return { ok: false, rows: out, status: r ? r.status : 0 };
    out.push(...page);
    if (page.length < 1000 || out.length >= max) return { ok: true, rows: out, truncated: page.length === 1000 && out.length >= max };
    after = page[page.length - 1][idCol];
  }
}
