// A small in-memory PostgREST for the admin server tests (a fetch implementation; no sockets).
// Models what the admin handlers use: select (columns, `alias:col`, `*`, json `->>`), eq/neq/gt/gte/lt/lte/in/
// is/like/ilike/cs and `not.`, or=()/and=() trees with SQL three-valued logic, order (asc/desc, nullsfirst/
// nullslast, several keys), limit/offset, max-rows 1000 (like prod), Prefer count=exact (Content-Range),
// return=minimal|representation, resolution=merge-duplicates|ignore-duplicates with on_conflict, PATCH/DELETE
// with filters, and /rpc/<name> (registered functions; anything else answers 404 PGRST202 like PostgREST).
// Every request is logged with its full URL so tests can assert on URL length.

const MAX_ROWS = 1000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/;

function splitTop(s, sep = ',') {
  const out = []; let depth = 0, q = false, cur = '';
  for (const c of s) {
    if (c === '"') q = !q;
    if (!q && (c === '(' || c === '{')) depth++;
    if (!q && (c === ')' || c === '}')) depth--;
    if (!q && depth === 0 && c === sep) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur !== '') out.push(cur);
  return out;
}
const unquote = (v) => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v);
const listVals = (s) => { const inner = s.replace(/^[({]/, '').replace(/[)}]$/, ''); return inner === '' ? [] : splitTop(inner).map((v) => unquote(v.trim())); };

function getPath(row, col) {
  const m = /^([a-zA-Z0-9_]+)(.*)$/.exec(col);
  let v = row[m[1]];
  if (m[2]) {
    for (const p of m[2].split(/->>?/).filter(Boolean)) { if (v == null || typeof v !== 'object') return null; v = v[p.replace(/'/g, '')]; }
    if (m[2].includes('->>') && v != null) v = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return v === undefined ? null : v;
}
function cmp(a, b) {
  if (typeof a === 'string' && typeof b === 'string' && ISO_RE.test(a) && ISO_RE.test(b)) { const x = Date.parse(a), y = Date.parse(b); return x < y ? -1 : x > y ? 1 : 0; }
  if (typeof a === 'number') { const n = Number(b); if (Number.isFinite(n)) return a < n ? -1 : a > n ? 1 : 0; }
  if (typeof a === 'boolean') { const bb = b === 'true' || b === true; return a === bb ? 0 : 1; }
  const s = String(a), t = String(b); return s < t ? -1 : s > t ? 1 : 0;
}
// LIKE / ILIKE without building a RegExp from data: `*` and `%` match any run, `_` one character, `\\x` a literal x.
function likeMatch(pattern, value, ci) {
  const toks = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) toks.push({ lit: pattern[++i] });
    else if (c === '*' || c === '%') toks.push({ any: true });
    else if (c === '_') toks.push({ one: true });
    else toks.push({ lit: c });
  }
  const v = ci ? value.toLowerCase() : value;
  const eq = (a, b) => (ci ? a.toLowerCase() === b : a === b);
  // Iterative wildcard match with one backtrack point (linear in practice).
  let ti = 0, vi = 0, star = -1, mark = 0;
  while (vi < v.length) {
    const t = toks[ti];
    if (t && (t.one || (t.lit !== undefined && eq(t.lit, v[vi])))) { ti++; vi++; }
    else if (t && t.any) { star = ti++; mark = vi; }
    else if (star >= 0) { ti = star + 1; vi = ++mark; }
    else return false;
  }
  while (ti < toks.length && toks[ti].any) ti++;
  return ti === toks.length;
}
function evalOp(row, col, opstr) {
  let neg = false;
  if (opstr.startsWith('not.')) { neg = true; opstr = opstr.slice(4); }
  const dot = opstr.indexOf('.');
  const op = opstr.slice(0, dot); const lit = unquote(opstr.slice(dot + 1));
  const v = getPath(row, col);
  let r;
  switch (op) {
    case 'is': r = lit === 'null' ? v === null : lit === 'true' ? v === true : lit === 'false' ? v === false : false; break;
    case 'eq': r = v === null ? null : cmp(v, lit) === 0; break;
    case 'neq': r = v === null ? null : cmp(v, lit) !== 0; break;
    case 'gt': r = v === null ? null : cmp(v, lit) > 0; break;
    case 'gte': r = v === null ? null : cmp(v, lit) >= 0; break;
    case 'lt': r = v === null ? null : cmp(v, lit) < 0; break;
    case 'lte': r = v === null ? null : cmp(v, lit) <= 0; break;
    case 'like': r = v === null ? null : likeMatch(lit, String(v), false); break;
    case 'ilike': r = v === null ? null : likeMatch(lit, String(v), true); break;
    case 'in': r = v === null ? null : listVals(opstr.slice(dot + 1)).some((x) => cmp(v, x) === 0); break;
    case 'cs': { const want = listVals(opstr.slice(dot + 1)); r = Array.isArray(v) ? want.every((w) => v.map(String).includes(w)) : null; break; }
    default: throw new Error(`fakeRest: unsupported operator ${op}`);
  }
  if (neg) return r === null ? null : !r;
  return r;
}
const and3 = (vs) => (vs.some((v) => v === false) ? false : vs.some((v) => v === null) ? null : true);
const or3 = (vs) => (vs.some((v) => v === true) ? true : vs.some((v) => v === null) ? null : false);
function evalLogic(row, kind, inner, neg) {
  const parts = splitTop(inner.replace(/^\(/, '').replace(/\)$/, ''));
  const vals = parts.map((p) => {
    p = p.trim();
    const m = /^(not\.)?(and|or)(\(.*\))$/s.exec(p);
    if (m) return evalLogic(row, m[2], m[3], !!m[1]);
    const i = p.indexOf('.');
    return evalOp(row, p.slice(0, i), p.slice(i + 1));
  });
  let r = kind === 'and' ? and3(vals) : or3(vals);
  if (neg) r = r === null ? null : !r;
  return r;
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function filterOf(params) {
  const preds = [];
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    if (k === 'or' || k === 'and') preds.push((row) => evalLogic(row, k, v, false));
    else preds.push((row) => evalOp(row, k, v));
  }
  return (row) => preds.every((p) => p(row) === true);
}
function project(rows, sel) {
  if (!sel || sel === '*') return rows.map((r) => ({ ...r }));
  const items = splitTop(sel).map((s) => s.trim()).filter(Boolean);
  return rows.map((r) => {
    const o = {};
    for (const it of items) {
      if (it === '*') { Object.assign(o, r); continue; }
      const am = /^([a-zA-Z0-9_]+):([a-zA-Z0-9_].*)$/.exec(it);
      const alias = am ? am[1] : null; const col = am ? am[2] : it;
      o[alias || col.split(/->>?/).pop()] = getPath(r, col);
    }
    return o;
  });
}
function sortRows(rows, order) {
  if (!order) return rows;
  const keys = splitTop(order).map((s) => { const p = s.split('.'); const desc = p.includes('desc'); return { col: p[0], desc, nf: p.includes('nullsfirst') ? true : p.includes('nullslast') ? false : desc }; });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const x = getPath(a, k.col), y = getPath(b, k.col);
      if (x === null && y === null) continue;
      if (x === null) return k.nf ? -1 : 1;
      if (y === null) return k.nf ? 1 : -1;
      const c = cmp(x, y);
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}

let SEQ = 1000;
export function createFakeRest({ tables = {}, rpcs = {}, numericIds = ['admin_audit_log', 'user_issues', 'company_reddit_disputes', 'duplicate_clusters', 'api_errors', 'listing_disputes', 'credit_transactions', 'cron_runs', 'collector_runs', 'employer_purchases'], pk = {}, missing = [], faults = [] } = {}) {
  const T = tables;
  const log = [];
  const MISSING = new Set(missing);
  const PK = { feature_flags: 'flag_name', ai_credits: 'user_id', company_recompute_queue: 'company_key', employer_perks: 'company', admin_sessions: 'token', suppressed_listings: 'apply_url', company_aliases: 'alias', company_scores: 'company_name', ...pk };
  const NUM = new Set(numericIds);
  const reply = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  // A fault with `applyThen: true` lets the request take effect and then loses the answer (status, or `throw`):
  // the database did it, the caller never heard.
  async function fetchImpl(input, init = {}) {
    const href0 = typeof input === 'string' ? input : input.url;
    const method0 = (init.method || 'GET').toUpperCase();
    for (const f of faults) {
      if (!f.applyThen || !((f.method ? f.method === method0 : true) && href0.includes(f.match))) continue;
      if (f.times != null && f.times <= 0) continue;
      if (f.times != null) f.times--;
      await inner(input, init, true);
      log[log.length - 1].lost = true;
      if (f.throw) throw new Error(f.throw);
      return reply(f.status || 504, { message: 'answer lost' });
    }
    return inner(input, init, false);
  }

  async function inner(input, init = {}, noFaults = false) {
    const href = typeof input === 'string' ? input : input.url;
    const url = new URL(href);
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const prefer = headers.prefer || '';
    const body = init.body ? JSON.parse(init.body) : null;
    const entry = { method, url: href, path: url.pathname, len: href.length, body };
    log.push(entry);
    for (const f of noFaults ? [] : faults) {
      if (f.applyThen || !((f.method ? f.method === method : true) && href.includes(f.match))) continue;
      // `skip`: let the first N matching requests through; `times`: then fail this many (default: every one).
      f.seen = (f.seen || 0) + 1;
      if (f.skip && f.seen <= f.skip) continue;
      if (f.times == null || f.times-- > 0) {
        entry.fault = f.status;
        if (f.delayMs) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, f.delayMs);
            init.signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })); });
          });
          if (!f.status && !f.throw) break; // a delay only: answer normally after it
        }
        if (f.throw) throw new Error(f.throw);
        return reply(f.status, f.body ?? { message: 'fault' });
      }
    }
    // GoTrue admin (password reset, account delete): accepted.
    if (url.pathname.startsWith('/auth/v1/admin/users/')) return reply(200, { id: url.pathname.split('/').pop() });
    const m = /^\/rest\/v1\/(rpc\/)?([a-zA-Z0-9_]+)$/.exec(url.pathname);
    if (!m) return reply(404, { message: 'not found' });
    if (m[1]) {
      const fn = rpcs[m[2]];
      if (!fn) return reply(404, { code: 'PGRST202', message: `Could not find the function public.${m[2]}` });
      const out = await fn(body || {}, T);
      return reply(200, out);
    }
    const table = m[2];
    if (MISSING.has(table)) return reply(404, { code: '42P01', message: `relation "public.${table}" does not exist` });
    if (!T[table]) T[table] = [];
    const params = [...url.searchParams.entries()];
    const sp = url.searchParams;
    const match = filterOf(params);
    const repr = !prefer.includes('return=minimal');
    if (method === 'GET' || method === 'HEAD') {
      let rows = T[table].filter(match);
      const total = rows.length;
      rows = sortRows(rows, sp.get('order'));
      const off = Number(sp.get('offset') || 0);
      let lim = sp.get('limit') != null ? Number(sp.get('limit')) : MAX_ROWS;
      if (headers.range) { const [a, b] = headers.range.split('-').map(Number); lim = Math.min(lim, b - a + 1); }
      lim = Math.min(lim, MAX_ROWS);
      const page = project(rows.slice(off, off + lim), sp.get('select'));
      const h = prefer.includes('count=exact') ? { 'content-range': `${off}-${off + page.length - 1}/${total}` } : {};
      return reply(200, page, h);
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const conflict = sp.get('on_conflict') || PK[table] || null;
      const out = [];
      for (const raw of list) {
        const row = { ...raw };
        if (row.id == null && !PK[table]) row.id = NUM.has(table) ? ++SEQ : `00000000-0000-4000-8000-${String(++SEQ).padStart(12, '0')}`;
        if (row.created_at == null) row.created_at = new Date().toISOString();
        const key = conflict && conflict.split(',');
        const existing = key ? T[table].find((r) => key.every((k) => String(r[k]) === String(row[k]))) : T[table].find((r) => r.id === row.id);
        if (existing) {
          if (prefer.includes('resolution=merge-duplicates')) { Object.assign(existing, raw); out.push(existing); continue; }
          if (prefer.includes('resolution=ignore-duplicates')) continue;
          return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        }
        T[table].push(row);
        out.push(row);
      }
      return repr ? reply(201, project(out, sp.get('select'))) : reply(201, null);
    }
    if (method === 'PATCH') {
      const rows = T[table].filter(match);
      for (const r of rows) Object.assign(r, body);
      return repr ? reply(200, project(rows, sp.get('select'))) : reply(204, null);
    }
    if (method === 'DELETE') {
      const rows = T[table].filter(match);
      T[table] = T[table].filter((r) => !rows.includes(r));
      return repr ? reply(200, project(rows, sp.get('select'))) : reply(204, null);
    }
    return reply(405, { message: 'method' });
  }
  return { fetch: fetchImpl, tables: T, log, faults };
}

/** A res object like Vercel's: status().json(), headers recorded. */
export function makeRes() {
  const r = { statusCode: 200, jsonBody: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.jsonBody = o; return r; };
  r.end = () => r;
  return r;
}
