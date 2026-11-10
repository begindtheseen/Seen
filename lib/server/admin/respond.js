// The admin contract on the server (components/admin2/contract.ts is the client half; SHAPES.md the
// catalogue). Every handler answers through these helpers, so an answer can never miss `ok`, `changed`,
// `skipped`, `message` or `touched`, and an error always says whether a retry can help.

export const CODES = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'bad_request',
  409: 'conflict', 429: 'rate_limited', 500: 'upstream', 501: 'not_available', 502: 'upstream', 503: 'upstream', 504: 'timeout',
};

/** Thrown by a handler to answer with an AdminErr. `extra` may carry changed / remaining / any field. */
export class AdminError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const isRetryable = (status) => status >= 500 || status === 429;

/** AdminErr. Partial work (`changed`, `remaining`) rides in `extra`. */
export function fail(res, status, error, extra = {}) {
  const code = extra.code || CODES[status] || (status >= 500 ? 'upstream' : 'bad_request');
  const retryable = typeof extra.retryable === 'boolean' ? extra.retryable : isRetryable(status);
  return res.status(status).json({ ...extra, ok: false, error: String(error || 'Something went wrong'), code, retryable });
}

/** AdminOk. Defaults keep the shape whole; a handler always passes its own `message` and `changed`. */
export function ok(res, payload = {}) {
  const out = { changed: 0, skipped: [], message: 'Done.', touched: [], ...payload, ok: true };
  if (!Array.isArray(out.skipped)) out.skipped = [];
  if (!Array.isArray(out.touched)) out.touched = [];
  return res.status(200).json(out);
}

/** AdminList. `rows` is always an array; `next` only when there is another page. */
export function list(res, rows, extra = {}) {
  const out = { ...extra, ok: true, rows: Array.isArray(rows) ? rows : [] };
  if (out.next == null) delete out.next;
  return res.status(200).json(out);
}

/** Skipped entries with a zero count are dropped, so the UI only ever shows real reasons. */
export function skips(...entries) {
  return entries.filter((e) => e && e.count > 0).map((e) => (e.ids && e.ids.length ? { reason: e.reason, count: e.count, ids: e.ids.slice(0, 200) } : { reason: e.reason, count: e.count }));
}

/** One line for a server log: printable, newline-free, short. Constant format strings + logSafe(value). */
export function logSafe(v) {
  return String(v ?? '').replace(/\n|\r/g, ' ').replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
}

export const plural = (n, one, many = `${one}s`) => `${Number(n || 0).toLocaleString('en-US')} ${n === 1 ? one : many}`;
export const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** An undo offer for an audit row. */
export function undoOffer(auditId, label = 'Undo') {
  if (auditId == null) return undefined;
  return { action: 'undo', args: { audit_id: String(auditId) }, label, expires_at: new Date(Date.now() + 7 * 86400e3).toISOString() };
}
