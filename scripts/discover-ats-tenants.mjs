#!/usr/bin/env node
// Discover first-party ATS job boards for companies we already have listings for.
//
// The problem this solves: `company_sources` held 27 hand-typed seeds (8 of them wrong slugs that
// 404) against 11,743 companies present in `jobs`. Meanwhile every ATS_DIRECT source stays 100%
// fresh while aggregator rows decay — 38% of the corpus had gone a week without re-verification.
// More first-party tenants is therefore both a volume AND a freshness fix.
//
// Safety posture, in order of importance:
//   • DRY RUN BY DEFAULT. Nothing is written unless ATS_DISCOVERY_APPLY=1, matching staleRefresh.
//   • Ownership is verified, never assumed. A board is only attributed to a company when the slug is
//     the company's full name, or the provider confirms the board's own name. This is what stops
//     "Capital One" being filed against lever/capital — a real board owned by someone else.
//   • Read-only against third parties: public JSON board endpoints, one at a time per host, with a
//     delay, a timeout, and a descriptive user-agent.
//
// Usage:
//   node scripts/discover-ats-tenants.mjs                     # dry run, 200 companies
//   ATS_DISCOVERY_LIMIT=1000 node scripts/discover-ats-tenants.mjs
//   ATS_DISCOVERY_APPLY=1 node scripts/discover-ats-tenants.mjs   # persist accepted tenants
//   ATS_DISCOVERY_COMPANIES="Figma,Notion" node scripts/discover-ats-tenants.mjs   # ad-hoc probe

import {
  probePlan, PROVIDERS, canVerifyName, verdictFor, sourceRow, PROVIDER_NAMES,
} from '../lib/server/atsDiscovery.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.env.ATS_DISCOVERY_APPLY === '1';
const LIMIT = Math.max(1, parseInt(process.env.ATS_DISCOVERY_LIMIT || '200', 10));
const DELAY_MS = Math.max(0, parseInt(process.env.ATS_DISCOVERY_DELAY_MS || '150', 10));
const CONCURRENCY = Math.max(1, Math.min(6, parseInt(process.env.ATS_DISCOVERY_CONCURRENCY || '4', 10)));
const TIMEOUT_MS = 10000;
const UA = 'SeenJobs-ats-discovery/1.0 (+https://seenjobs.io)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** Companies with listings that have no ATS source registered yet, busiest first. */
async function companiesToScan() {
  const manual = process.env.ATS_DISCOVERY_COMPANIES;
  if (manual) return manual.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name, jobs: 0 }));

  const known = new Set(
    (await rest('company_sources?select=company_name,tenant')).flatMap((r) => [r.company_name, r.tenant].filter(Boolean).map((s) => s.toLowerCase())),
  );
  // Pull a generous window, then rank by how many listings each company has — the busiest employers
  // are the ones whose freshness matters most to users.
  const rows = await rest(`jobs?select=company&company=not.is.null&limit=20000`);
  const counts = new Map();
  for (const r of rows) {
    const name = String(r.company || '').trim();
    if (!name || known.has(name.toLowerCase())) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, jobs]) => ({ name, jobs }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, LIMIT);
}

async function getJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { ok: false, status: 'ERR', error: String(e?.name || e?.message || e).slice(0, 40) };
  }
}

/** Probe one candidate and return a verdict. Only fetches the name endpoint when it can change the answer. */
async function evaluate(companyName, { provider, tenant, strength, via }) {
  const p = PROVIDERS[provider];
  const jobsRes = await getJson(p.jobsUrl(tenant));
  await sleep(DELAY_MS);
  if (!jobsRes.ok) return { accept: false, reason: `http-${jobsRes.status}` };

  const jobCount = p.countJobs(jobsRes.body);
  let boardName = p.nameFromJobs(jobsRes.body);
  // Verify whenever the provider CAN, not just for weak slugs. One extra request per live board buys
  // certainty, and it catches a case slug-strength alone cannot: a corrupted company name in our own
  // jobs table ("84674Th44Metrea9999") that happens to resolve to a real board ("Metrea"). Attributing
  // postings to a mangled employer name would silently split that company's score across two records.
  if (!boardName && p.boardUrl && jobCount > 0) {
    const meta = await getJson(p.boardUrl(tenant));
    await sleep(DELAY_MS);
    if (meta.ok) boardName = p.boardName(meta.body);
  }
  const v = verdictFor({ companyName, strength, jobCount, boardName, nameEndpointSupported: canVerifyName(provider) });
  return { ...v, provider, tenant, jobCount, via, boardName };
}

async function discoverOne(company) {
  for (const cand of probePlan(company.name)) {
    const r = await evaluate(company.name, cand);
    if (r.accept) return r;
  }
  return null;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(1);
  }
  console.log(`ATS discovery — ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'} · providers: ${PROVIDER_NAMES.join(', ')}`);

  const companies = await companiesToScan();
  console.log(`Scanning ${companies.length} companies with no registered ATS source…\n`);

  const found = [];
  let done = 0;
  const queue = [...companies];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const hit = await discoverOne(c).catch(() => null);
      done++;
      if (hit) {
        found.push({ company: c.name, ...hit });
        console.log(`  HIT   ${c.name.slice(0, 30).padEnd(30)} -> ${hit.provider}/${hit.tenant} (${hit.jobCount} jobs, ${hit.confidence}, ${hit.reason})`);
      }
      if (done % 25 === 0) console.log(`  … ${done}/${companies.length} scanned, ${found.length} boards found`);
    }
  }));

  const totalJobs = found.reduce((a, f) => a + (f.jobCount || 0), 0);
  console.log(`\n${found.length}/${companies.length} companies resolved to a verified board`);
  console.log(`${totalJobs} first-party jobs reachable (avg ${found.length ? Math.round(totalJobs / found.length) : 0}/tenant)`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with ATS_DISCOVERY_APPLY=1 to register these sources.');
    return;
  }
  const rows = found.map((f) => sourceRow({
    companyName: f.company, provider: f.provider, tenant: f.tenant,
    jobCount: f.jobCount, confidence: f.confidence, discoveredVia: f.via,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await rest('company_sources', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
  }
  console.log(`\nRegistered ${rows.length} ATS sources.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
