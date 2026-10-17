// Enqueue side of the self-filling company pages (migration 20261017140000_company_enrichment_queue).
//
// Called from the company-score path (api/reports.js handleCompanyScore) when a lookup finds ZERO
// first-party reports. ONE small RPC round trip that both enqueues and returns the row's status,
// which the score response passes to the company page for its honest "we're gathering public
// discussion" line. Contract:
//   • never throws, never rejects — any failure (missing migration, timeout, DB down) → null, and the
//     page renders exactly as it did before this feature existed;
//   • hard timeout (default 1.5s; a healthy call is one indexed upsert, tens of ms);
//   • invalid / placeholder names never reach the DB (isValidCompanyName + isSearchableCompany);
//   • the RPC itself is a no-op for a company already queued/running or inside its 30-day cooldown.

import { enqueueDecision, publicEnrichmentStatus } from '../../api/_utils/companyEnrichment.js';

export const ENQUEUE_TIMEOUT_MS = 1500;

/**
 * @param {string} supabaseUrl
 * @param {string} serviceKey
 * @param {string} name               the lowercase name the lookup used (stored score name when known)
 * @param {{ firstPartyCount?: number, fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{status: string, requested_at: string|null, done_at: string|null} | null>}
 */
export async function enqueueCompanyEnrichment(supabaseUrl, serviceKey, name, { firstPartyCount = 0, fetchImpl = fetch, timeoutMs = ENQUEUE_TIMEOUT_MS } = {}) {
  try {
    if (!supabaseUrl || !serviceKey) return null;
    const d = enqueueDecision(name, firstPartyCount);
    if (!d.ok) return null;
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/enqueue_company_enrichment`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: d.key, p_name: d.name }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null; // 404 before the migration is applied → feature silently off
    const rows = await r.json();
    return publicEnrichmentStatus(Array.isArray(rows) ? rows[0] : rows);
  } catch {
    return null;
  }
}

/** Admin overview counts (enrichment_queue_stats RPC). { ready:false } when unavailable. */
export async function enrichmentQueueStats(supabaseUrl, serviceKey, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  try {
    if (!supabaseUrl || !serviceKey) return { ready: false };
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/enrichment_queue_stats`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { ready: false };
    const s = await r.json();
    if (!s || typeof s !== 'object') return { ready: false };
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
      ready: true,
      queued: n(s.queued), running: n(s.running), done: n(s.done), empty: n(s.empty), error: n(s.error),
      reports_added_24h: n(s.reports_added_24h), llm_calls_24h: n(s.llm_calls_24h),
    };
  } catch {
    return { ready: false };
  }
}
