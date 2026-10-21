// Admin job manager: browse EVERY listing (search, filters, keyset pages — a PostgREST read is capped at
// 1,000 rows, so paging is by key, never offset), read one in full with who holds it, edit it, take it
// off the site, and put it back. Used by api/admin-stats.js (actions jobs_browse / job_detail /
// job_update / job_restore) — Seen Command's Jobs tab and the Seen admin call the same actions.
//
// Rules:
// - Only the fields in EDITABLE can change; each value is checked against the column's type and its
//   CHECK constraint (availability_status, status, apply_mode).
// - Taking a listing down is the existing delete_listing action (expire + suppress, reversible). This
//   module never hard-deletes: saved_jobs/applications point at jobs, and seen_applications CASCADES.
// - Every change is audited by the caller with the prior values, so it can be undone.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isJobId = (v) => UUID.test(String(v || ''));

export const LIST_SELECT = 'id,title,company,location,source,availability_status,status,created_at,last_seen_at,expires_at,salary_min,salary_max,salary,apply_url,is_employer_posted,score,remote';
export const STATUSES = ['active', 'stale', 'expired', 'unknown'];
export const SORTS = { newest: { col: 'created_at', dir: 'desc' }, oldest: { col: 'created_at', dir: 'asc' }, seen: { col: 'last_seen_at', dir: 'desc' } };
// "Recently added" windows — California days are the caller's job (pacificDayStart); these are rolling.
export const SINCE = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

// PostgREST filter values are spliced into the URL: keep letters, digits, spaces and a few harmless
// marks. Commas, parentheses, quotes, '*' and ':' would change the filter's meaning.
export function cleanTerm(v, max = 80) {
  return String(v || '').normalize('NFKC').replace(/[^\p{L}\p{N} .&'\-+#/]/gu, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const enc = (s) => encodeURIComponent(s);
const like = (s) => `*${s.replace(/\s+/g, '*')}*`;

// The cursor is the last row's sort value + id (both from our own response). Anything else is ignored.
export function parseCursor(c) {
  if (!c || typeof c !== 'object') return null;
  // Kept exactly as the database wrote it: created_at has MICROseconds, and rounding it to a JS Date
  // (milliseconds) repeats or skips every row inserted in the same millisecond (one batch insert).
  const at = String(c.at || ''); const id = String(c.id || '');
  if (!isJobId(id) || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(at)) return null;
  return { at, id };
}

// Build the PostgREST path for one page. Returns { path, sort, limit } or { error }.
export function browsePath(input = {}, nowMs = Date.now()) {
  const sort = SORTS[input.sort] ? input.sort : 'newest';
  const { col, dir } = SORTS[sort];
  const limit = Math.min(100, Math.max(1, Number.parseInt(input.limit, 10) || 50));
  const parts = [`select=${LIST_SELECT}`];
  const ands = [];
  const q = cleanTerm(input.q);
  // Values inside and=(…)/or=(…) are double-quoted (PostgREST's rule for '.', ':', ',' in a logic tree).
  if (q) ands.push(`or(title.ilike."${like(q)}",company.ilike."${like(q)}")`);
  const company = cleanTerm(input.company);
  if (company) parts.push(`company=ilike.${enc(like(company))}`);
  const location = cleanTerm(input.location);
  if (location) parts.push(`location=ilike.${enc(like(location))}`);
  const source = cleanTerm(input.source, 40);
  if (source) parts.push(`source=ilike.${enc(source)}`);
  if (input.status && input.status !== 'all') {
    if (!STATUSES.includes(input.status)) return { error: `status must be one of ${STATUSES.join(', ')} or all` };
    parts.push(`availability_status=eq.${input.status}`);
  }
  // On the site = what search shows (expires_at in the future); off = taken down or lapsed.
  if (input.visible === 'on') parts.push(`expires_at=gt.${enc(new Date(nowMs).toISOString())}`);
  if (input.visible === 'off') parts.push(`expires_at=lte.${enc(new Date(nowMs).toISOString())}`);
  if (input.employer === 'only') parts.push('is_employer_posted=eq.true');
  if (input.employer === 'exclude') parts.push('is_employer_posted=is.false');
  if (input.since && SINCE[input.since]) parts.push(`created_at=gte.${enc(new Date(nowMs - SINCE[input.since]).toISOString())}`);
  const cur = parseCursor(input.cursor);
  if (cur) {
    const op = dir === 'desc' ? 'lt' : 'gt';
    ands.push(`or(${col}.${op}."${cur.at}",and(${col}.eq."${cur.at}",id.${op}.${cur.id}))`);
  }
  if (sort === 'seen') parts.push('last_seen_at=not.is.null');
  if (ands.length) parts.push(`and=${enc(`(${ands.join(',')})`)}`);
  parts.push(`order=${col}.${dir},id.${dir}`, `limit=${limit}`);
  return { path: `jobs?${parts.join('&')}`, sort, limit };
}

// The next page's cursor from a page of rows, or null when this was the last page.
export function nextCursor(rows, { sort, limit }) {
  if (!Array.isArray(rows) || rows.length < limit) return null;
  const last = rows[rows.length - 1];
  const at = last?.[SORTS[sort].col];
  return at && last.id ? { at, id: last.id } : null;
}

// Fields an admin may change, with how each is checked. `null` clears a nullable field.
const text = (max, required = false) => (v) => {
  if (v === null) return required ? { error: 'is required' } : { value: null };
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (required && !s) return { error: 'is required' };
  if (s.length > max) return { error: `is longer than ${max} characters` };
  return { value: s || null };
};
const longText = (max) => (v) => {
  if (v === null) return { value: null };
  const s = String(v).replace(/\r\n/g, '\n').trim();
  return s.length > max ? { error: `is longer than ${max} characters` } : { value: s || null };
};
const int = (v) => {
  if (v === null || v === '') return { value: null };
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? { value: Math.round(n) } : { error: 'must be a whole number from 0 to 10,000,000' };
};
const oneOf = (list) => (v) => (list.includes(v) ? { value: v } : { error: `must be one of ${list.join(', ')}` });
const url = (v) => {
  if (v === null) return { value: null };
  try { const u = new URL(String(v).trim()); return u.protocol === 'https:' || u.protocol === 'http:' ? { value: u.toString() } : { error: 'must be an http(s) address' }; }
  catch { return { error: 'must be a full web address' }; }
};
const bool = (v) => (typeof v === 'boolean' ? { value: v } : { error: 'must be true or false' });
const date = (v) => {
  if (v === null) return { value: null };
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? { error: 'must be a date' } : { value: new Date(t).toISOString() };
};

export const EDITABLE = {
  title: text(300, true), company: text(200, true), location: text(200), salary: text(120),
  salary_min: int, salary_max: int, apply_url: url, description: longText(60_000),
  availability_status: oneOf(STATUSES), status: oneOf(['active', 'closed', 'filled']),
  remote: bool, job_type: text(60), level: text(60), expires_at: date,
};

// Check a patch. Returns { patch, errors } — patch holds only allowed, valid, changed-on-request fields.
export function validatePatch(input = {}) {
  const patch = {}; const errors = [];
  for (const [k, v] of Object.entries(input || {})) {
    if (!EDITABLE[k]) { errors.push(`${k} cannot be edited here`); continue; }
    const r = EDITABLE[k](v);
    if (r.error) errors.push(`${k} ${r.error}`); else patch[k] = r.value;
  }
  if (patch.salary_min != null && patch.salary_max != null && patch.salary_min > patch.salary_max) errors.push('salary_min is more than salary_max');
  return { patch, errors };
}

// Put a taken-down or lapsed listing back on the site for the normal listing lifetime (14 days,
// the same as every ingest path in jobSources.js).
export const RESTORE_DAYS = 14;
export function restorePatch(nowMs = Date.now()) {
  const at = new Date(nowMs).toISOString();
  return { availability_status: 'active', expires_at: new Date(nowMs + RESTORE_DAYS * 86_400_000).toISOString(), last_checked_at: at };
}

// Who holds this listing — the reasons it must never be hard-deleted, shown in the detail view.
export const HOLDERS = [['saved_jobs', 'job_id', 'saved'], ['applications', 'job_id', 'tracked'], ['seen_applications', 'job_id', 'applied on Seen'], ['job_availability_reports', 'job_id', 'reported closed']];
