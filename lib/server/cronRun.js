// Best-effort record of one cron run, for Admin → System → cron health (lib/server/admin/system.js reads
// public.cron_runs, migration 20261111100000_admin_core.sql). Never throws and never slows a cron down:
// before the migration (or on any error) the write is simply skipped, and the admin shows "unknown".
//
//   await recordCronRun('refresh-jobs', 'ok', 'upserted 1,240');
//   await recordCronRun('stripe:reconcile_all', 'failed', 'Stripe 500', { startedAt });
//
// `name` is the cron's path without /api/ (and `:<action>` when the path has ?action=) — the rule in
// lib/server/admin/system.js cronName(). `result` is 'ok' | 'partial' | 'failed'.

const RESULTS = new Set(['ok', 'partial', 'failed']);

export async function recordCronRun(name, result, detail = null, {
  startedAt = null, url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY,
  fetchImpl = (...a) => globalThis.fetch(...a),
} = {}) {
  try {
    if (!url || !key || !name) return false;
    const status = RESULTS.has(result) ? result : 'ok';
    const row = {
      name: String(name).slice(0, 80),
      status,
      started_at: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
      finished_at: new Date().toISOString(),
      detail: detail == null ? null : String(typeof detail === 'string' ? detail : JSON.stringify(detail)).replace(/\n|\r/g, ' ').slice(0, 500),
    };
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(1500) : undefined;
    const r = await fetchImpl(`${url}/rest/v1/cron_runs`, {
      method: 'POST', signal,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    return !!(r && r.ok);
  } catch {
    return false;
  }
}
