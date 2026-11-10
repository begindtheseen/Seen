// One line per cron handler (X, 2026-11-10): `export default withCronRecord('name', handler)` records every Vercel cron
// run in public.cron_runs through lib/server/cronRun.js — ok / partial / failed, a short count read off the handler's own
// JSON answer, and the run's start time (finished_at − started_at is its duration; `duration_ms` rides in the detail).
// Best effort: a recorder failure never fails the cron, and a call that is not Vercel's cron is never recorded.
import { recordCronRun } from './cronRun.js';
import { isVercelCron } from './cronAuth.js';

// the counts worth a line: numbers at the top level of the answer, a few of them
function shortCount(body) {
  if (!body || typeof body !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'number' && Number.isFinite(v) && !/^(?:ms|duration|status|code|price|cost)$/i.test(k)) parts.push(`${k} ${v}`);
    if (parts.length >= 6) break;
  }
  return parts.join(', ');
}

/** ok | partial | failed from the status code and the answer. */
export function cronResult(status, body) {
  if (status >= 400 || (body && (body.ok === false || body.error))) return 'failed';
  if (body && (body.partial === true || body.status === 'partial' || body.out_of_time === true)) return 'partial';
  return 'ok';
}

/**
 * Wrap a handler. `name` is a string, or a function of the request that returns the cron's name or null (a path that
 * serves other actions too: "stripe:reconcile_all" only for ?action=reconcile_all).
 */
export function withCronRecord(name, handler, { record = recordCronRun, isCron = isVercelCron } = {}) {
  return async function cronRecorded(req, res, ...rest) {
    let cronName = null;
    try { cronName = isCron(req) ? (typeof name === 'function' ? name(req) : name) : null; } catch { cronName = null; }
    if (!cronName) return handler(req, res, ...rest);
    const startedAt = Date.now();
    let code = 200, body = null, thrown = null;
    const origStatus = res.status && res.status.bind(res);
    const origJson = res.json && res.json.bind(res);
    try {
      if (origStatus) res.status = (c) => { code = c; return origStatus(c); };
      if (origJson) res.json = (b) => { body = b; return origJson(b); };
    } catch { /* a frozen response: record without the answer */ }
    try {
      return await handler(req, res, ...rest);
    } catch (e) {
      thrown = e;
      throw e;
    } finally {
      try {
        const result = thrown ? 'failed' : cronResult(code, body);
        const detail = thrown ? String(thrown.message || thrown).slice(0, 200)
          : [shortCount(body), body && typeof body.error === 'string' ? body.error : '', `duration_ms ${Date.now() - startedAt}`].filter(Boolean).join(', ');
        await record(cronName, result, detail, { startedAt });
      } catch { /* never fail the cron */ }
    }
  };
}
