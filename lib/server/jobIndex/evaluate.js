// Answers a PostgREST read of `jobs` from the in-memory job index (lib/server/jobIndex/index.js), exactly as
// PostgREST would answer it from the table — for the subset of PostgREST the search uses. Why: a search sends
// 20–30 `ilike` reads; on production (2026-11-26) a common word ("engineer") ran past Postgres' 8 s statement
// timeout on every read and a few phones searching at once queued every other request behind them. The same reads
// answered here take a few milliseconds and put nothing on the database.
//
//   queryIndex(index, qs, { uncapped }) → { rows } | { status: 400 } | null
//     qs        the query string after `jobs?` (filters, select, order, limit, offset), as the caller sends it
//     rows      new objects holding only the selected columns (callers may change them freely)
//     null      a read this evaluator does not handle (a column the index does not hold, an operator it does
//               not know): the caller reads the database instead, so nothing is ever answered wrongly.
//
// Supported: column filters eq neq gt gte lt lte like ilike is in (each optionally `not.`), logic trees
// or=(…) and=(…) not.or=(…) nested, select (plain columns), order (asc/desc, nullsfirst/nullslast), limit, offset,
// and PostgREST's max-rows cap of 1,000 (unless `uncapped`).
//
// Semantics kept from Postgres: like/ilike `%`/`*` any run, `_` any one character, `\` escapes the next
// character; NULL never matches a comparison; ORDER BY default NULLS LAST for asc, NULLS FIRST for desc;
// uuids compare as lowercase hex text; timestamps compare by instant.

export const NUMERIC = new Set(['score', 'waste_score', 'lat', 'lng', 'salary_min', 'salary_max']);
export const TIME = new Set(['created_at', 'expires_at', 'last_seen_at']);
export const BOOL = new Set(['is_employer_posted']);
const MAX_ROWS = 1000;

// ── Parsing ────────────────────────────────────────────────────────────────────────────────

function decode(s) {
  try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return null; }
}

/** Split `a,b(c,d),"e,f"` at top-level commas (parentheses and double quotes nest). */
function splitTop(s) {
  const out = [];
  let depth = 0, q = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '\\' && i + 1 < s.length) { cur += ch + s[++i]; continue; }
      if (ch === '"') q = false;
      cur += ch;
      continue;
    }
    if (ch === '"') { q = true; cur += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (q || depth !== 0) return null;
  out.push(cur);
  return out;
}

const unquote = (v) => {
  const t = v.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).replace(/\\(.)/g, '$1');
  return v;
};

const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in']);

/** `op.value` / `not.op.value` for a column → condition, or null when not supported. */
function parseOpValue(col, rest) {
  let negate = false;
  let s = rest;
  if (s.startsWith('not.')) { negate = true; s = s.slice(4); }
  const dot = s.indexOf('.');
  if (dot < 0) return null;
  const op = s.slice(0, dot);
  const value = s.slice(dot + 1);
  if (!OPS.has(op)) return null;
  return { kind: 'col', col, op, value, negate };
}

/** One item of a logic tree: `col.op.value`, `and(…)`, `or(…)`, `not.and(…)`, `not.or(…)`. */
function parseTreeItem(item) {
  const s = item.trim();
  const m = s.match(/^(not\.)?(and|or)\((.*)\)$/s);
  if (m) return parseTree(m[2], m[3], !!m[1]);
  const dot = s.indexOf('.');
  if (dot <= 0) return null;
  return parseOpValue(s.slice(0, dot), s.slice(dot + 1));
}

function parseTree(kind, inner, negate = false) {
  const parts = splitTop(inner);
  if (!parts || !parts.length) return null;
  const items = [];
  for (const p of parts) {
    const c = parseTreeItem(p);
    if (!c) return null;
    items.push(c);
  }
  return { kind, items, negate };
}

/**
 * The query string → { conds, select, order, limit, offset }, or null when anything in it is not supported.
 * Repeated keys are ANDed (PostgREST: two `or=` params on one read both apply).
 */
export function parseQuery(qs) {
  const conds = [];
  let select = null, order = null, limit = null, offset = 0;
  for (const raw of String(qs || '').replace(/^\?/, '').split('&')) {
    if (!raw) continue;
    const eq = raw.indexOf('=');
    if (eq <= 0) return null;
    const key = decode(raw.slice(0, eq));
    const val = decode(raw.slice(eq + 1));
    if (key == null || val == null) return null;
    if (key === 'select') {
      const cols = val.split(',').map((c) => c.trim()).filter(Boolean);
      if (!cols.length || cols.some((c) => !/^[a-z_][a-z0-9_]*$/.test(c))) return null;
      select = cols;
    } else if (key === 'order') {
      order = [];
      for (const part of val.split(',')) {
        const bits = part.trim().split('.');
        const col = bits[0];
        if (!/^[a-z_][a-z0-9_]*$/.test(col)) return null;
        let dir = 'asc', nulls = null;
        for (const b of bits.slice(1)) {
          if (b === 'asc' || b === 'desc') dir = b;
          else if (b === 'nullsfirst' || b === 'nullslast') nulls = b;
          else return null;
        }
        order.push({ col, dir, nullsFirst: nulls ? nulls === 'nullsfirst' : dir === 'desc' });
      }
    } else if (key === 'limit') {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0) return null;
      limit = n;
    } else if (key === 'offset') {
      const n = Number(val);
      if (!Number.isInteger(n) || n < 0) return null;
      offset = n;
    } else if (key === 'or' || key === 'and' || key === 'not.or' || key === 'not.and') {
      const neg = key.startsWith('not.');
      const kind = neg ? key.slice(4) : key;
      if (!(val.startsWith('(') && val.endsWith(')'))) return null;
      const t = parseTree(kind, val.slice(1, -1), neg);
      if (!t) return null;
      conds.push(t);
    } else {
      if (!/^[a-z_][a-z0-9_]*$/.test(key)) return null;
      const c = parseOpValue(key, val);
      if (!c) return null;
      conds.push(c);
    }
  }
  return { conds, select, order, limit, offset };
}

// ── Compiling conditions to row predicates ─────────────────────────────────────────────────

/** The literal runs of a LIKE pattern (what any match must contain), lowercased. */
export function likeLiterals(pattern) {
  return likeTokens(pattern.toLowerCase()).filter((t) => t !== '%' && t !== '_');
}
function likeTokens(p) {
  const toks = [];
  let lit = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\' && i + 1 < p.length) { lit += p[++i]; continue; }
    if (ch === '%' || ch === '*') { if (lit) { toks.push(lit); lit = ''; } if (toks[toks.length - 1] !== '%') toks.push('%'); continue; }
    if (ch === '_') { if (lit) { toks.push(lit); lit = ''; } toks.push('_'); continue; }
    lit += ch;
  }
  if (lit) toks.push(lit);
  return toks;
}

/** A LIKE pattern (PostgREST `*` = `%`) → a test on the (already lowercased when ci) text. */
export function compileLike(pattern, ci) {
  const p = ci ? pattern.toLowerCase() : pattern;
  // Tokens: literal runs, '%' (any run), '_' (one character).
  const toks = [];
  let lit = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\' && i + 1 < p.length) { lit += p[++i]; continue; }
    if (ch === '%' || ch === '*') { if (lit) { toks.push(lit); lit = ''; } if (toks[toks.length - 1] !== '%') toks.push('%'); continue; }
    if (ch === '_') { if (lit) { toks.push(lit); lit = ''; } toks.push('_'); continue; }
    lit += ch;
  }
  if (lit) toks.push(lit);
  // Fast paths: lit, %lit, lit%, %lit%, %.
  const lits = toks.filter((t) => t !== '%');
  if (!toks.includes('_') && lits.length <= 1) {
    const L = lits[0] || '';
    const lead = toks[0] === '%', trail = toks[toks.length - 1] === '%';
    if (!L) return () => true; // '%' alone (or empty → only '' matches)
    if (lead && trail) return (s) => s.includes(L);
    if (lead) return (s) => s.endsWith(L);
    if (trail) return (s) => s.startsWith(L);
    return (s) => s === L;
  }
  // Only `%` between literal runs (no `_`): the runs in order, leftmost each time — no regular expression.
  if (!toks.includes('_')) {
    const lead = toks[0] !== '%', trail = toks[toks.length - 1] !== '%';
    const runs = toks.filter((t) => t !== '%');
    return (s) => {
      let from = 0, to = s.length;
      let i = 0, j = runs.length;
      if (lead) { if (!s.startsWith(runs[0])) return false; from = runs[0].length; i = 1; }
      if (trail && j > i) { const last = runs[j - 1]; if (!s.endsWith(last) || s.length - last.length < from) return false; to = s.length - last.length; j--; }
      for (; i < j; i++) { const at = s.indexOf(runs[i], from); if (at < 0 || at + runs[i].length > to) return false; from = at + runs[i].length; }
      return true;
    };
  }
  const src = toks.map((t) => (t === '%' ? '[\\s\\S]*' : t === '_' ? '[\\s\\S]' : t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
  const re = new RegExp(`^${src}$`, 'u');
  return (s) => re.test(s);
}

const toTime = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

/** The value a column compares by, for a row. Lowercased copies of text columns are kept on the row (_lc). */
export function cmpValue(row, col) {
  if (TIME.has(col)) {
    const k = `_t_${col}`;
    if (row[k] !== undefined) return row[k];
    const v = row[col];
    return v == null ? null : typeof v === 'number' ? v : toTime(v);
  }
  return row[col];
}

function lcOf(row, col) {
  const lc = row._lc;
  if (lc && lc[col] !== undefined) return lc[col];
  const v = row[col];
  return v == null ? null : String(v).toLowerCase();
}

function typed(col, raw) {
  if (NUMERIC.has(col)) { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
  if (TIME.has(col)) { const t = toTime(raw); return t == null ? undefined : t; }
  if (BOOL.has(col)) return raw === 'true' ? true : raw === 'false' ? false : undefined;
  return raw;
}

/** condition → (row) => boolean, or null when not supported. `cols` = the columns the index holds. */
export function compile(cond, cols) {
  if (cond.kind === 'and' || cond.kind === 'or') {
    const fns = [];
    for (const it of cond.items) { const f = compile(it, cols); if (!f) return null; fns.push(f); }
    const base = cond.kind === 'and' ? (r) => { for (const f of fns) if (!f(r)) return false; return true; } : (r) => { for (const f of fns) if (f(r)) return true; return false; };
    return cond.negate ? (r) => !base(r) : base;
  }
  const { col, op, negate } = cond;
  if (!cols.has(col)) return null;
  let value = unquote(cond.value);
  let fn;
  if (op === 'is') {
    const v = value.toLowerCase();
    if (v === 'null') fn = (r) => r[col] == null;
    else if (v === 'true') fn = (r) => r[col] === true;
    else if (v === 'false') fn = (r) => r[col] === false;
    else return null;
    return negate ? (r) => !fn(r) : fn;
  }
  if (op === 'like' || op === 'ilike') {
    if (NUMERIC.has(col) || TIME.has(col) || BOOL.has(col)) return null; // Postgres would cast; not needed here
    const ci = op === 'ilike';
    const test = compileLike(value, ci);
    const LC = { title: (r) => r._lc.title, company: (r) => r._lc.company, location: (r) => r._lc.location, search_query: (r) => r._lc.search_query, type: (r) => r._lc.type };
    const get = LC[col] || ((r) => lcOf(r, col));
    fn = ci ? (r) => { const s = get(r); return s != null && test(s); } : (r) => { const s = r[col]; return s != null && test(String(s)); };
  } else if (op === 'in') {
    if (!(value.startsWith('(') && value.endsWith(')'))) return null;
    const parts = splitTop(value.slice(1, -1));
    if (!parts) return null;
    const vals = [];
    for (const p of parts) { const t = typed(col, unquote(p).trim()); if (t === undefined) return null; vals.push(col === 'id' ? String(t).toLowerCase() : t); }
    const set = new Set(vals);
    fn = (r) => { const v = cmpValue(r, col); return v != null && set.has(col === 'id' ? String(v).toLowerCase() : v); };
  } else {
    const t = typed(col, value);
    if (t === undefined) return null;
    const ref = col === 'id' ? String(t).toLowerCase() : t;
    const get = col === 'id' ? (r) => (r.id == null ? null : String(r.id).toLowerCase()) : (r) => cmpValue(r, col);
    switch (op) {
      case 'eq': fn = (r) => { const v = get(r); return v != null && v === ref; }; break;
      case 'neq': fn = (r) => { const v = get(r); return v != null && v !== ref; }; break;
      case 'gt': fn = (r) => { const v = get(r); return v != null && v > ref; }; break;
      case 'gte': fn = (r) => { const v = get(r); return v != null && v >= ref; }; break;
      case 'lt': fn = (r) => { const v = get(r); return v != null && v < ref; }; break;
      case 'lte': fn = (r) => { const v = get(r); return v != null && v <= ref; }; break;
      default: return null;
    }
  }
  // NOT on a comparison: NULL stays unmatched (NOT NULL is NULL in SQL).
  if (negate) { const f = fn; return (r) => r[col] != null && !f(r); }
  return fn;
}

/** Columns a condition reads. */
function condCols(cond, out = new Set()) {
  if (cond.kind === 'col') out.add(cond.col);
  else for (const it of cond.items) condCols(it, out);
  return out;
}

/** A stable text key for a condition (for the per-index memo of whole-index matches). */
export function condKey(cond) {
  if (cond.kind === 'col') return `${cond.negate ? '!' : ''}${cond.col}.${cond.op}.${cond.value}`;
  return `${cond.negate ? '!' : ''}${cond.kind}(${cond.items.map(condKey).join(',')})`;
}

// A condition worth remembering across reads: text matching (the slow part) — never a timestamp compare, whose
// value is "now" and differs on every read.
function memoable(cond) {
  if (cond.kind !== 'col') return cond.items.every(memoable);
  if (TIME.has(cond.col)) return false;
  return true;
}
// How cheap a condition is to start from, lower first: an `ilike` on the job title/company/stamp is selective.
function driverRank(cond) {
  if (cond.kind === 'col') {
    if ((cond.op === 'ilike' || cond.op === 'like') && ['title', 'company', 'search_query'].includes(cond.col)) return 0;
    if (cond.op === 'ilike' || cond.op === 'like' || cond.op === 'eq' || cond.op === 'in') return 1;
    return 3;
  }
  return 2;
}

// ── Ordering ───────────────────────────────────────────────────────────────────────────────

export function comparator(order) {
  const keys = order.map(({ col, dir, nullsFirst }) => ({ col, desc: dir === 'desc', nullsFirst, id: col === 'id' }));
  return (a, b) => {
    for (const k of keys) {
      let x = cmpValue(a, k.col), y = cmpValue(b, k.col);
      if (k.id) { x = x == null ? null : String(x).toLowerCase(); y = y == null ? null : String(y).toLowerCase(); }
      if (x == null || y == null) {
        if (x == null && y == null) continue;
        return x == null ? (k.nullsFirst ? -1 : 1) : (k.nullsFirst ? 1 : -1);
      }
      if (x < y) return k.desc ? 1 : -1;
      if (x > y) return k.desc ? -1 : 1;
    }
    return 0;
  };
}
export const DEFAULT_ORDER = [{ col: 'score', dir: 'desc', nullsFirst: false }, { col: 'id', dir: 'asc', nullsFirst: false }];
const sameOrder = (a, b) => a.length === b.length && a.every((k, i) => k.col === b[i].col && k.dir === b[i].dir && k.nullsFirst === b[i].nullsFirst);

// ── Column scans ───────────────────────────────────────────────────────────────────────────
// Testing 146k row objects one by one costs 40–70 ms a condition (each row's text lives somewhere else in memory).
// A text column kept as ONE lowercased string, rows separated by a NUL, is searched with the engine's native
// indexOf — a few milliseconds for the whole column. The scan only proposes rows (those containing the pattern's
// longest literal run); every proposed row is then tested by the exact predicate, so the answer is unchanged.

const BLOB_COLS = new Set(['title', 'company', 'location', 'search_query', 'type']);
const SEP = '\u0000';

/** The column as one string + where each row starts, built on first use per index build. */
function blobFor(index, col) {
  const cache = index.blobs || (index.blobs = {});
  if (cache[col]) return cache[col];
  const rows = index.rows;
  const starts = new Int32Array(rows.length + 1);
  const parts = new Array(rows.length);
  let pos = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]._lc ? rows[i]._lc[col] : (rows[i][col] == null ? null : String(rows[i][col]).toLowerCase());
    const t = v == null ? '' : v.indexOf(SEP) >= 0 ? v.split(SEP).join(' ') : v;
    starts[i] = pos;
    parts[i] = t;
    pos += t.length + 1;
  }
  starts[rows.length] = pos;
  const b = { text: parts.join(SEP) + SEP, starts };
  cache[col] = b;
  return b;
}

/** Build the column strings of a fresh index ahead of the first search (each a few tens of ms, one per tick). */
export function warmColumns(index, cols = ['title', 'search_query', 'company', 'location']) {
  let i = 0;
  const next = () => { if (i >= cols.length || index.dead) return; try { blobFor(index, cols[i++]); } catch { return; } setImmediate(next); };
  setImmediate(next);
}

/** Row ordinals whose column text contains `needle` (lowercase), ascending. */
function scanBlob(b, needle) {
  const out = [];
  const { text, starts } = b;
  const n = starts.length - 1;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    // the row holding position `at`: the last start <= at
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1; }
    out.push(lo);
    from = starts[lo + 1];
    if (from >= text.length) break;
  }
  return out;
}

function unionSorted(lists) {
  if (lists.length === 1) return lists[0];
  const seen = new Uint8Array(lists.reduce((m, l) => Math.max(m, l.length ? l[l.length - 1] + 1 : 0), 0));
  const out = [];
  for (const l of lists) for (const o of l) if (!seen[o]) { seen[o] = 1; out.push(o); }
  return out.sort((a, b) => a - b);
}

/** Ordinals that may match `cond` (a superset; the caller tests each), or null when a column scan cannot narrow it. */
function candidates(index, cond) {
  if (cond.negate) return null;
  if (cond.kind === 'col') {
    if ((cond.op !== 'ilike' && cond.op !== 'like') || !BLOB_COLS.has(cond.col)) return null;
    const lits = likeLiterals(unquote(cond.value));
    if (!lits.length) return null;
    const needle = lits.reduce((a, b) => (b.length > a.length ? b : a));
    return scanBlob(blobFor(index, cond.col), needle);
  }
  if (cond.kind === 'or') {
    const parts = [];
    for (const it of cond.items) { const c = candidates(index, it); if (!c) return null; parts.push(c); }
    return unionSorted(parts);
  }
  for (const it of cond.items) { const c = candidates(index, it); if (c) return c; } // and: any one narrows it
  return null;
}

// ── The read ───────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ rows: object[], cols: Set<string>, missing?: Set<string>, memo?: Map }} index
 *   rows    every row, sorted by DEFAULT_ORDER (score desc nulls last, id asc)
 *   cols    the columns each row holds
 *   missing columns the database itself lacks (a read selecting one gets PostgREST's 400)
 *   memo    per-index memo: condition key → Uint8Array membership over row ordinals (row._o) + the matching rows
 */
export function queryIndex(index, qs, { uncapped = false } = {}) {
  if (!index || !Array.isArray(index.rows)) return null;
  const q = parseQuery(qs);
  if (!q || !q.select) return null;
  if (index.missing && q.select.some((c) => index.missing.has(c))) return { status: 400 };
  if (q.select.some((c) => !index.cols.has(c))) return null;
  const used = new Set();
  for (const c of q.conds) condCols(c, used);
  for (const o of q.order || []) used.add(o.col);
  for (const c of used) if (!index.cols.has(c)) return null;

  const compiled = [];
  for (const c of q.conds) {
    const fn = compile(c, index.cols);
    if (!fn) return null;
    compiled.push({ cond: c, fn, key: memoable(c) ? condKey(c) : null });
  }

  const order = q.order && q.order.length ? q.order : null;
  const indexOrder = !order || sameOrder(order, DEFAULT_ORDER);
  let cap = q.limit == null ? Infinity : q.limit;
  if (!uncapped) cap = Math.min(cap, MAX_ROWS);
  const want = indexOrder && Number.isFinite(cap) ? q.offset + cap : Infinity;
  const fresh = index.fresh || [];
  const shadow = index.shadow && index.shadow.size ? index.shadow : null;

  // Rows by id: `id=eq.` / `id=in.(…)` are looked up, never scanned (the postings and area pages read by id).
  const idCond = compiled.find((c) => c.cond.kind === 'col' && c.cond.col === 'id' && !c.cond.negate && (c.cond.op === 'eq' || c.cond.op === 'in'));
  let source = null, rest = compiled;
  if (idCond) {
    const byId = index.byId || (index.byId = new Map(index.rows.map((r) => [String(r.id).toLowerCase(), r])));
    const wantIds = idCond.cond.op === 'eq' ? [unquote(idCond.cond.value)] : (splitTop(unquote(idCond.cond.value).slice(1, -1)) || []).map((v) => unquote(v).trim());
    const got = new Set();
    source = [];
    for (const raw of wantIds) { const r = byId.get(String(raw).toLowerCase()); if (r && !got.has(r)) { got.add(r); source.push(r); } }
    source.sort((a, b) => a._o - b._o);
    rest = compiled.filter((c) => c !== idCond).map((c) => c.fn);
    // (rows in `fresh` are tested below like any other read)
  }

  // Otherwise start from the most selective condition matched over the whole base (memoised per index build), then
  // test the rest on its rows only. Its rows keep the index order (DEFAULT_ORDER).
  const memo = index.memo || (index.memo = new Map());
  const n = index.rows.length;
  const whole = (c) => {
    let m = memo.get(c.key);
    if (!m) {
      const bits = new Uint8Array(n);
      const list = [];
      const cand = candidates(index, c.cond);
      if (cand) { for (const o of cand) { const r = index.rows[o]; if (c.fn(r)) { bits[o] = 1; list.push(r); } } }
      else for (const r of index.rows) if (c.fn(r)) { bits[r._o] = 1; list.push(r); }
      m = { bits, list };
      if (memo.size > 4000) memo.delete(memo.keys().next().value);
      memo.set(c.key, m);
    }
    return m;
  };
  if (!source) {
    let driver = null;
    const memoed = compiled.filter((c) => c.key && memo.has(c.key));
    if (memoed.length) driver = memoed.map((c) => ({ c, m: memo.get(c.key) })).sort((a, b) => a.m.list.length - b.m.list.length)[0];
    if (!driver) {
      const cand = compiled.filter((c) => c.key).sort((a, b) => driverRank(a.cond) - driverRank(b.cond))[0];
      if (cand) driver = { c: cand, m: whole(cand) };
    }
    source = driver ? driver.m.list : index.rows;
    rest = compiled.filter((c) => !driver || c !== driver.c).map((c) => (c.key && memo.has(c.key) ? ((bits) => (r) => bits[r._o] === 1)(memo.get(c.key).bits) : c.fn));
  }
  const freshTests = compiled.map((c) => c.fn);

  const hits = [];
  outer: for (const r of source) {
    if (shadow && shadow.has(r.id)) continue; // a newer copy is in `fresh`
    for (const f of rest) if (!f(r)) continue outer;
    hits.push(r);
    if (hits.length >= want) break;
  }
  // Listings added since the base was built (a short list, kept in index order): tested directly, merged in order.
  if (fresh.length) {
    const extra = [];
    outer2: for (const r of fresh) { for (const f of freshTests) if (!f(r)) continue outer2; extra.push(r); }
    if (extra.length) {
      const cmp = comparator(DEFAULT_ORDER);
      const merged = [];
      let i = 0, j = 0;
      while ((i < hits.length || j < extra.length) && merged.length < want) {
        if (j >= extra.length || (i < hits.length && cmp(hits[i], extra[j]) <= 0)) merged.push(hits[i++]);
        else merged.push(extra[j++]);
      }
      hits.length = 0;
      hits.push(...merged);
    }
  }
  if (!indexOrder) hits.sort(comparator(order));
  const page = hits.slice(q.offset, Number.isFinite(cap) ? q.offset + cap : undefined);
  const sel = q.select;
  return { rows: page.map((r) => { const o = {}; for (const c of sel) o[c] = TIME.has(c) && typeof r[c] === 'number' ? new Date(r[c]).toISOString() : (r[c] === undefined ? null : r[c]); return o; }) };
}
