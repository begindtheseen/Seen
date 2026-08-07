// Stale-job pruning — the bounded, employer-safe, LOGGED hard-delete of long-dead listings.
// Shared pure engine behind the daily cron (api/prune-jobs.js). Mirrors the staleRefresh.js
// pattern (pure builders + an injectable-fetch orchestrator) so it unit-tests fully offline and
// the cron can never drift from the tested logic — the same shape as jobSources.js ↔ refresh-jobs.js.
//
// WHY THIS EXISTS (verified against prod 2026-08-07)
// The corpus already self-limits at the 14-day `expires_at` lease: api/refresh-jobs.js › deleteExpired()
// runs `DELETE … WHERE expires_at < now()` on every ingest (6×/day), so nothing normally survives past
// its lease (prod confirmed 0 rows past expiry, 0 rows unseen >30d). This prune is the BOUNDED,
// OBSERVABLE, EMPLOYER-SAFE backstop to that unbounded, unlogged delete:
//   • BOUNDED   — deletes at most `maxRows` per run in id-chunks, so if the past-expiry backlog ever
//                 balloons (deleteExpired silently fails / times out on an unbounded delete) it drains
//                 in capped batches instead of one giant statement.
//   • OBSERVABLE — returns and logs the exact deleted count every run (deleteExpired logs nothing).
//   • EMPLOYER-SAFE — NEVER selects is_employer_posted=true rows (deleteExpired does not exclude them).
//
// SAFETY INVARIANT: graceDays is clamped to ≥ 0, so the cutoff (now − graceDays) is always ≤ now — a
// row whose expires_at is in the FUTURE can never be selected for deletion. The default graceDays=30
// means a row must be ≥30 days PAST a 14-day lease (≈44 days since last seen) to be eligible: far
// beyond the daily stale-liveness re-check window, so a still-live long-tail listing is reactivated
// long before it could ever become prune-eligible.

const DAY_MS = 86400000;

export const PRUNE_DEFAULTS = { graceDays: 30, maxRows: 5000, chunkSize: 100 };

function authHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Clamp graceDays to a safe integer ≥ 0. Negative / NaN → the default. This is the guard that makes
// it impossible to prune a not-yet-expired row: cutoff = now − graceDays is therefore always ≤ now.
export function normalizeGraceDays(graceDays) {
  const n = Number(graceDays);
  if (!Number.isFinite(n)) return PRUNE_DEFAULTS.graceDays;
  return Math.max(0, Math.floor(n));
}

// Bound the per-run row cap to a sane range so one cron run stays inside its maxDuration.
export function normalizeMaxRows(maxRows) {
  const n = Number(maxRows);
  if (!Number.isFinite(n)) return PRUNE_DEFAULTS.maxRows;
  return Math.min(50000, Math.max(1, Math.floor(n)));
}

// The ISO cutoff. A row is prune-eligible only when its expires_at < this value (always ≤ now).
export function pruneCutoffISO(graceDays, nowMs = Date.now()) {
  return new Date(nowMs - normalizeGraceDays(graceDays) * DAY_MS).toISOString();
}

// Split ids into DELETE-sized chunks (keeps each request's URL length + statement size bounded).
export function chunkIds(ids, size = PRUNE_DEFAULTS.chunkSize) {
  const s = Math.max(1, Math.floor(Number(size)) || PRUNE_DEFAULTS.chunkSize);
  const out = [];
  for (let i = 0; i < ids.length; i += s) out.push(ids.slice(i, i + s));
  return out;
}

// The PostgREST select URL for prune candidates. EMPLOYER-POSTED rows are excluded HERE, so they are
// never even fetched as candidates. Oldest-dead first (expires_at asc) drains the worst backlog first.
export function buildCandidateUrl(url, { cutoffISO, limit }) {
  return `${url}/rest/v1/jobs?is_employer_posted=eq.false&expires_at=lt.${encodeURIComponent(cutoffISO)}` +
    `&select=id,company,title,expires_at&order=expires_at.asc&limit=${normalizeMaxRows(limit)}`;
}

// The PostgREST delete URL for one id-chunk.
export function buildDeleteUrl(url, ids) {
  const list = ids.map((id) => encodeURIComponent(String(id))).join(',');
  return `${url}/rest/v1/jobs?id=in.(${list})`;
}

// The sweep. apply:true (default) performs the bounded hard-delete; apply:false is a DRY-RUN preview
// (SELECT + count only, ZERO writes). Returns a summary with the exact deleted count. Throws on a
// failed select or delete so the handler logs a real error rather than silently under-deleting.
export async function pruneStaleJobs(opts = {}) {
  const {
    url, key,
    graceDays = PRUNE_DEFAULTS.graceDays,
    maxRows = PRUNE_DEFAULTS.maxRows,
    chunkSize = PRUNE_DEFAULTS.chunkSize,
    apply = true,
    fetchImpl = fetch,
    nowMs = Date.now(),
  } = opts;
  if (!url || !key) throw new Error('pruneStaleJobs: url and key are required');

  const grace = normalizeGraceDays(graceDays);
  const limit = normalizeMaxRows(maxRows);
  const cutoffISO = pruneCutoffISO(grace, nowMs);

  // 1) Select prune candidates (employer-posted already excluded, bounded to `limit`).
  const selRes = await fetchImpl(buildCandidateUrl(url, { cutoffISO, limit }), { headers: authHeaders(key) });
  if (!selRes.ok) throw new Error(`prune candidate select failed: HTTP ${selRes.status}`);
  const rows = await selRes.json();
  const candidates = Array.isArray(rows) ? rows : [];
  const ids = candidates.map((r) => r.id).filter((v) => v != null);

  const summary = {
    apply, graceDays: grace, cutoff: cutoffISO, limit,
    candidates: ids.length,
    deleted: 0,
    // A full page means more may remain — the next daily run continues draining.
    capped: ids.length >= limit,
    sample: candidates.slice(0, 10).map((r) => ({ id: r.id, company: r.company, title: r.title, expires_at: r.expires_at })),
  };

  if (!apply || ids.length === 0) return summary;

  // 2) Bounded hard-delete in id-chunks (mirrors staleRefresh.patchByIds — throws on !ok).
  let deleted = 0;
  for (const group of chunkIds(ids, chunkSize)) {
    const delRes = await fetchImpl(buildDeleteUrl(url, group), {
      method: 'DELETE',
      headers: { ...authHeaders(key), Prefer: 'return=minimal' },
    });
    if (!delRes.ok) throw new Error(`prune delete failed: HTTP ${delRes.status}`);
    deleted += group.length;
  }
  summary.deleted = deleted;
  return summary;
}
