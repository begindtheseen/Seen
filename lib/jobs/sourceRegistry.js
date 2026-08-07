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

// The next batch of ingestable sources for the scheduled crawl — freshest-need first (never synced,
// then oldest last_successful_sync). Skips disabled (circuit-broken) sources.
export async function dueSources(supabaseUrl, serviceKey, limit = 40) {
  if (!supabaseUrl || !serviceKey) return [];
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/company_sources?ingestable=eq.true&status=neq.disabled&select=id,company_name,provider,tenant,consecutive_failures&order=last_successful_sync.asc.nullsfirst&limit=${limit}`,
      { headers: headers(serviceKey) }
    );
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
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
