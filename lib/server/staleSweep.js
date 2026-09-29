// Stale-job protocol driver — the ONE path that ages, retires and deletes stale listings.
// Both the scheduled cron (api/refresh-jobs.js) and the admin "clear stale now" action
// (api/admin-stats.js › purge_stale_jobs) call runStaleSweep, so they can never drift.
//
// The work itself is the Postgres function public.sweep_stale_jobs (migration
// 20260929120000_stale_job_protocol.sql): set-based, index-driven, one round trip per batch.
// It replaced three REST paths that could not finish against prod's 8s statement_timeout
// (unbounded DELETE, unbounded PATCH, and a 2-round-trips-per-200-rows sweep), which let the
// stale/expired backlog reach 95,505 rows — 67% of the jobs table — by 2026-09-29.
//
// This loop only has to (a) call the function until it reports `more: false` or the time budget
// runs out, and (b) shrink the batch if a call is cancelled by the statement timeout (57014),
// so a slow database degrades throughput instead of failing the sweep.

export const SWEEP_DEFAULTS = { batch: 1000, minBatch: 100, budgetMs: 45_000 };

function isStatementTimeout(status, text) {
  return /57014|statement timeout/i.test(text || '') || status === 504;
}

// Runs the protocol. mode: 'scheduled' (age-based lifecycle) | 'all' (also delete every
// unreferenced stale row now). Never throws: failures come back as { ok:false, error }.
export async function runStaleSweep({
  url, key, mode = 'scheduled',
  batch = SWEEP_DEFAULTS.batch,
  minBatch = SWEEP_DEFAULTS.minBatch,
  deadline = Date.now() + SWEEP_DEFAULTS.budgetMs,
  fetchImpl = fetch,
} = {}) {
  const t0 = Date.now();
  const out = { ok: true, mode, staled: 0, deleted: 0, retained: 0, calls: 0, complete: false, ms: 0 };
  if (!url || !key) return { ...out, ok: false, error: 'missing url or key' };

  let size = batch;
  while (Date.now() < deadline) {
    let res, text = '';
    try {
      res = await fetchImpl(`${url}/rest/v1/rpc/sweep_stale_jobs`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_mode: mode, p_batch: size }),
      });
      out.calls += 1;
      if (!res.ok) text = await res.text().catch(() => '');
    } catch (e) {
      out.ok = false; out.error = e?.message || 'fetch failed';
      break;
    }
    if (!res.ok) {
      if (isStatementTimeout(res.status, text) && size > minBatch) {
        size = Math.max(minBatch, Math.floor(size / 2));
        continue;
      }
      out.ok = false; out.error = `sweep_stale_jobs HTTP ${res.status}: ${text.slice(0, 200)}`;
      break;
    }
    const r = await res.json().catch(() => null);
    if (!r || typeof r !== 'object') { out.ok = false; out.error = 'sweep_stale_jobs returned no result'; break; }
    out.staled += r.staled || 0;
    out.deleted += r.deleted || 0;
    out.retained += r.retained || 0;
    if (!r.more) { out.complete = true; break; }
  }
  out.batch = size;
  out.ms = Date.now() - t0;
  return out;
}
