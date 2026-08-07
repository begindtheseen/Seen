// Seen Job Ingestion — SEARCH EXPANSION (employer-direct first, aggregator as fallback).
//
// The multi-source expansion the search calls when the DB corpus is thin. Order = SOURCE AUTHORITY:
//   1. EMPLOYER-DIRECT ATS  — registered Greenhouse/Lever/Ashby/… boards matching the query's
//      company. Freshest + most authoritative + real apply URL.
//   2. AGGREGATOR (Adzuna)  — demoted to a gap-filler / long-tail via the existing aggregateForQuery.
// Then SNOWBALL: any ATS tenant revealed by ANY result is registered, so the next scheduled refresh
// ingests that employer directly forever. All discoveries persist to the SHARED corpus (upsert), so
// the next user benefits. Failure-isolated (allSettled); a dead provider never breaks search.
//
// Dedup prefers the EMPLOYER-DIRECT observation of a vacancy over the aggregator's redirect, and
// keeps distinct requisitions (different external_id) separate. Pure orchestration over the existing
// jobSources upsert + the ATS providers + the source registry.

import { aggregateForQuery, upsertJobs } from '../server/jobSources.js';
import { fetchSourceJobs } from './atsProviders.js';
import { matchSourcesForQuery, discoverSourcesFromJobs, recordSourceSync } from './sourceRegistry.js';

// Title|company|location fingerprint — the cross-source identity of a vacancy.
export function fingerprint(j) {
  return `${(j?.title || '').toLowerCase().trim()}|${(j?.company || '').toLowerCase().trim()}|${(j?.location || '').toLowerCase().trim()}`;
}

// Canonical multi-source dedup. Rows are given EMPLOYER-DIRECT FIRST. Two vacancies that share a
// fingerprint are the same opening UNLESS they carry different requisition ids (external_id) — so:
//   • Greenhouse + Adzuna of the same job  → ONE (the employer-direct row wins; the aggregator's
//     no-requisition duplicate is dropped).
//   • Software Engineer REQ-100 + REQ-101 at the same location → TWO (distinct requisitions).
//   • Two aggregator rows of the same job (no requisitions) → ONE.
export function dedupJobs(rows) {
  const byFp = new Map(); // fingerprint → { withExt: Map(extKey→row), noExt: row|null }
  for (const row of rows || []) {
    if (!row) continue;
    const fp = fingerprint(row);
    let g = byFp.get(fp);
    if (!g) { g = { withExt: new Map(), noExt: null }; byFp.set(fp, g); }
    if (row.external_id) {
      const k = `${row.ats_provider || ''}:${row.external_id}`;
      if (!g.withExt.has(k)) g.withExt.set(k, row); // first (employer-direct) wins
    } else if (!g.noExt) {
      g.noExt = row;
    }
  }
  const out = [];
  for (const g of byFp.values()) {
    for (const r of g.withExt.values()) out.push(r);
    // a no-requisition (aggregator) row is only kept when NO requisitioned row shares its
    // fingerprint — otherwise it's the aggregator's duplicate of the employer-direct listing.
    if (g.noExt && g.withExt.size === 0) out.push(g.noExt);
  }
  return out;
}

// Fetch employer-direct jobs from the registered ATS sources that match the query's company.
// Health-tracked (each source's success/failure updates its circuit-breaker state). Returns rows[].
export async function fetchEmployerDirect({ query, supabaseUrl, serviceKey, fetchImpl, maxSources = 6, timeoutMs }) {
  const sources = await matchSourcesForQuery(query, supabaseUrl, serviceKey, maxSources).catch(() => []);
  if (!sources.length) return [];
  const settled = await Promise.allSettled(sources.map((s) =>
    fetchSourceJobs({ provider: s.provider, tenant: s.tenant, companyName: s.company_name }, { fetchImpl, timeoutMs })
  ));
  const rows = [];
  await Promise.all(settled.map((r, i) => {
    const s = sources[i];
    if (r.status === 'fulfilled' && r.value?.ok) {
      rows.push(...r.value.rows);
      return recordSourceSync({ id: s.id, ok: true, jobCount: r.value.rows.length }, supabaseUrl, serviceKey);
    }
    return recordSourceSync({ id: s.id, ok: false, prevFailures: s.consecutive_failures || 0 }, supabaseUrl, serviceKey);
  }));
  return rows;
}

// The expansion entry the search uses. Same call shape as aggregateForQuery (drop-in), but adds the
// employer-direct tier + snowball. Returns { jobs, upserted, employerDirect }.
export async function aggregateWithSources(params) {
  const { supabaseUrl, serviceKey } = params; // query/fetchImpl are read by the callees from `params`

  // Tier 2 first (Adzuna via the existing aggregation — it does its own upsert of aggregator rows).
  const adz = await aggregateForQuery(params).catch(() => ({ jobs: [], upserted: 0 }));

  // Tier 1: employer-direct ATS. Upsert AFTER Adzuna so an employer-direct observation OVERWRITES an
  // aggregator row for the same vacancy (merge-duplicates: last writer wins on the dedup key) —
  // canonical-source preference, in the DB.
  const atsRows = await fetchEmployerDirect(params).catch(() => []);
  let atsUpserted = 0, atsSaved = [];
  if (atsRows.length) {
    const u = await upsertJobs(atsRows, supabaseUrl, serviceKey).catch(() => ({ upserted: 0, rows: [] }));
    atsUpserted = u.upserted; atsSaved = u.rows || [];
    // stitch DB ids/created_at back so employer-direct results carry resolvable /jobs/<id> permalinks
    const byKey = new Map(atsSaved.map((r) => [`${(r.title || '').toLowerCase()}|${(r.company || '').toLowerCase()}|${(r.location || '').toLowerCase()}`, r]));
    for (const j of atsRows) {
      const m = byKey.get(`${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}|${(j.location || '').toLowerCase()}`);
      if (m) { j.id = m.id; j.created_at = m.created_at; }
    }
  }

  // SNOWBALL: register every ATS tenant any result reveals — the source index grows with the search.
  if (supabaseUrl && serviceKey) discoverSourcesFromJobs([...(adz.jobs || []), ...atsRows], supabaseUrl, serviceKey).catch(() => {});

  // Merge employer-direct FIRST (source authority), then canonical-dedup across sources.
  const merged = dedupJobs([...atsRows, ...(adz.jobs || [])]);
  return { jobs: merged, upserted: atsUpserted + (adz.upserted || 0), employerDirect: atsRows.length };
}
