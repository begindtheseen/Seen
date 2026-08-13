// Seen Job Ingestion — SOURCE REGISTRY + provider health / circuit breaker.
//
// The registry (company_sources, migration 066) is what makes Seen self-growing: every employer ATS
// tenant Seen ever sees — from a user search, from a seed, from Common Crawl discovery — is recorded
// once here, so the scheduled refresh can ingest that employer DIRECTLY forever without a human
// adding it. Snowball discovery reads the apply URLs of jobs Seen already has and registers any ATS
// tenant they reveal. A per-source circuit breaker takes a repeatedly-failing source out of rotation
// so a dead board never wastes the crawl budget. Server-only (service key). Fail-open: any DB error
// degrades gracefully and never breaks search/ingestion.

import { detectAts, INGESTABLE_PROVIDERS } from './atsDetect.js';
import { normalizeCompany } from '../server/jobSources.js';

function headers(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
}
const DEGRADE_AT = 3; // consecutive failures → degraded (deprioritized)
const DISABLE_AT = 8;  // consecutive failures → disabled (skipped until manually revived)

// Register (idempotent upsert on provider+tenant) one employer source. Returns true on success.
export async function registerSource(entry, supabaseUrl, serviceKey) {
  if (!supabaseUrl || !serviceKey) return false;
  const provider = String(entry.provider || '').toLowerCase().trim();
  const tenant = String(entry.tenant || '').toLowerCase().trim();
  if (!provider || !tenant) return false;
  const row = {
    company_name: normalizeCompany(entry.companyName || tenant) || tenant,
    provider,
    tenant,
    careers_url: entry.careersUrl || null,
    source_type: entry.sourceType || 'ATS_DIRECT',
    ingestable: entry.ingestable != null ? !!entry.ingestable : INGESTABLE_PROVIDERS.has(provider),
    confidence: entry.confidence != null ? entry.confidence : 0.7,
    discovered_via: entry.discoveredVia || 'search',
  };
  try {
    // merge-duplicates: re-seeing a known tenant refreshes metadata but never resets its history
    // (first_discovered_at + sync stats keep their DB defaults / prior values on conflict).
    const r = await fetch(`${supabaseUrl}/rest/v1/company_sources?on_conflict=provider,tenant`, {
      method: 'POST',
      headers: { ...headers(serviceKey), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// SNOWBALL: scan the apply/canonical URLs of jobs Seen already has and register any employer ATS
// tenant they reveal. Deduped within the batch. Returns the list of newly-seen {provider, tenant}.
export async function discoverSourcesFromJobs(jobs, supabaseUrl, serviceKey) {
  if (!Array.isArray(jobs) || !jobs.length || !supabaseUrl || !serviceKey) return [];
  const seen = new Map(); // provider|tenant → entry
  for (const j of jobs) {
    for (const url of [j?.canonical_url, j?.apply_url, j?.url]) {
      const hit = detectAts(url);
      if (!hit) continue;
      const key = `${hit.provider}|${hit.tenant}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        provider: hit.provider, tenant: hit.tenant, careersUrl: hit.careersUrl,
        ingestable: hit.ingestable, sourceType: hit.sourceType,
        companyName: j.company || hit.tenant, discoveredVia: 'search',
      });
    }
  }
  const entries = [...seen.values()];
  // Register concurrently (bounded) — best-effort; a failure to register never fails the search.
  await Promise.all(entries.map((e) => registerSource(e, supabaseUrl, serviceKey).catch(() => false)));
  return entries.map((e) => ({ provider: e.provider, tenant: e.tenant }));
}

// Ingestable, non-disabled sources whose company matches a query — the employer-direct tier the
// search tries FIRST (before aggregators). Matches company_name ILIKE the query tokens.
export async function matchSourcesForQuery(query, supabaseUrl, serviceKey, limit = 8) {
  if (!supabaseUrl || !serviceKey) return [];
  const q = String(query || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
  if (!q || q.length < 3) return [];
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/company_sources?ingestable=eq.true&status=neq.disabled&company_name=ilike.*${encodeURIComponent(q)}*&select=id,company_name,provider,tenant&order=confidence.desc&limit=${limit}`,
      { headers: headers(serviceKey) }
    );
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

// The set of provider|tenant keys already in the registry. registerSource upserts with
// merge-duplicates and returns ok for a row that already existed, so "registered" alone cannot tell
// a genuinely NEW board from one re-seen for the hundredth time — which is exactly the number that
// says whether discovery is still growing the index. Callers diff against this first.
// Fail-open: on any error return null (unknown), never an empty set — an empty set would report
// every re-seen board as new.
export async function existingSourceKeys(supabaseUrl, serviceKey, limit = 100000) {
  if (!supabaseUrl || !serviceKey) return null;
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/company_sources?select=provider,tenant&limit=${limit}`,
      { headers: headers(serviceKey) }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows)) return null;
    return new Set(rows.map(x => `${String(x.provider || '').toLowerCase()}|${String(x.tenant || '').toLowerCase()}`));
  } catch {
    return null;
  }
}

// The next batch of ingestable sources for the scheduled crawl. Skips disabled (circuit-broken) ones.
//
// TWO POOLS, NOT ONE ORDERING. This used to be a single `last_successful_sync.asc.nullsfirst` query,
// which is correct only while the registry is small and hand-curated. It becomes a live outage the
// first time discovery succeeds:
//
//   • Every newly-discovered board has last_successful_sync = NULL, so ALL of them sort ahead of every
//     proven board.
//   • recordSourceSync does NOT set last_successful_sync on failure — only consecutive_failures — so a
//     DEAD tenant stays NULL and returns to the front of the queue for all 8 runs it takes the breaker
//     to disable it. A Common Crawl URL is not a promise of a live board, so many will be dead.
//   • Capacity is limit x 6 runs/day (144 at limit=24) while one sweep may register up to 300.
//
// The null pool therefore grows faster than it drains, the proven boards (which produce the large
// majority of ingested jobs) stop being refreshed entirely, and their listings age past the 7-day
// stale window and get hidden. Discovery WORKING would have collapsed served inventory.
//
// So: reserve a share of every batch for boards that have synced before. Unused slots in either pool
// backfill from the other, so a small registry behaves exactly as the single query did. Within the
// fresh pool, order by consecutive_failures first — that also makes the breaker's middle tier
// ('degraded' at 3 failures) actually mean something, which the old ordering never did despite
// DEGRADE_AT existing.
export async function dueSources(supabaseUrl, serviceKey, limit = 40, { provenShare = 1 / 3, fetchImpl = fetch } = {}) {
  if (!supabaseUrl || !serviceKey) return [];
  const cap = Math.max(1, Math.trunc(limit));
  const provenSlots = Math.min(cap - 1, Math.max(1, Math.round(cap * provenShare)));
  const freshSlots = cap - provenSlots;

  const SELECT = 'select=id,company_name,provider,tenant,consecutive_failures';
  const BASE = `${supabaseUrl}/rest/v1/company_sources?ingestable=eq.true&status=neq.disabled&${SELECT}`;
  const pull = async (filter, order, n) => {
    if (n <= 0) return [];
    try {
      const r = await fetchImpl(`${BASE}&${filter}&order=${order}&limit=${n}`, { headers: headers(serviceKey) });
      if (!r.ok) return [];
      const rows = await r.json();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  // Over-request by the other pool's size so a short pool can be backfilled without a second round trip.
  const [fresh, proven] = await Promise.all([
    pull('last_successful_sync=is.null', 'consecutive_failures.asc,first_discovered_at.asc', freshSlots + provenSlots),
    pull('last_successful_sync=not.is.null', 'last_successful_sync.asc', provenSlots + freshSlots),
  ]);

  const out = [];
  const seen = new Set();
  const take = (rows, n) => {
    for (const row of rows) {
      if (out.length >= cap || n <= 0) return;
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id); out.push(row); n--;
    }
  };
  take(fresh, freshSlots);
  take(proven, provenSlots);
  // Backfill whichever pool came up short, so slots are never wasted.
  take(fresh, cap - out.length);
  take(proven, cap - out.length);
  return out;
}

// Record a sync outcome → drives the circuit breaker. Success resets failures + stamps sync time;
// failure increments and, past thresholds, degrades then disables the source. Fire-and-forget.
export async function recordSourceSync({ id, provider, tenant, ok, jobCount = 0, prevFailures = 0 }, supabaseUrl, serviceKey) {
  if (!supabaseUrl || !serviceKey || (!id && !(provider && tenant))) return;
  const now = new Date().toISOString();
  let patch;
  if (ok) {
    patch = { status: 'active', consecutive_failures: 0, last_successful_sync: now, last_verified_at: now, job_count: Number(jobCount) || 0 };
  } else {
    const fails = (Number(prevFailures) || 0) + 1;
    patch = { consecutive_failures: fails, last_verified_at: now, status: fails >= DISABLE_AT ? 'disabled' : fails >= DEGRADE_AT ? 'degraded' : 'active' };
  }
  const sel = id ? `id=eq.${encodeURIComponent(id)}` : `provider=eq.${encodeURIComponent(provider)}&tenant=eq.${encodeURIComponent(tenant)}`;
  try {
    await fetch(`${supabaseUrl}/rest/v1/company_sources?${sel}`, {
      method: 'PATCH', headers: { ...headers(serviceKey), Prefer: 'return=minimal' }, body: JSON.stringify(patch),
    });
  } catch { /* fire-and-forget */ }
}

// Bulk-seed the registry from a curated starter list (idempotent). Used once to bootstrap employer-
// direct inventory so the registry isn't cold on day one. Returns the number attempted.
export async function seedSources(entries, supabaseUrl, serviceKey) {
  if (!Array.isArray(entries) || !supabaseUrl || !serviceKey) return 0;
  const rows = entries.map((e) => ({
    company_name: normalizeCompany(e.companyName || e.tenant) || e.tenant,
    provider: String(e.provider || '').toLowerCase(),
    tenant: String(e.tenant || '').toLowerCase(),
    source_type: 'ATS_DIRECT',
    ingestable: INGESTABLE_PROVIDERS.has(String(e.provider || '').toLowerCase()),
    confidence: 0.85,
    discovered_via: 'seed',
  })).filter((r) => r.provider && r.tenant);
  if (!rows.length) return 0;
  try {
    await fetch(`${supabaseUrl}/rest/v1/company_sources?on_conflict=provider,tenant`, {
      method: 'POST', headers: { ...headers(serviceKey), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    });
    return rows.length;
  } catch {
    return 0;
  }
}

export { DEGRADE_AT, DISABLE_AT };
