#!/usr/bin/env node
// jobs-health — read-only, credential-free health probe of LIVE job listings, for the weekly
// jobs-steward skill. Runs a fixed basket of real searches against the public /api/jobs contract
// (POST {query, location, radius}) and reports per-query result counts, freshness (posted_at age),
// missing permalinks (id:null), duplicate rows, and degraded responses. Exits 1 if any HARD check fails.
//
//   node scripts/jobs-health.mjs [--base https://seenjobs.io] [--json]
//
// It never writes anything. Thresholds are deliberately loose: a fail means "look now", not "page someone".

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BASE = (flag('--base') || 'https://seenjobs.io').replace(/\/+$/, '');
const AS_JSON = args.includes('--json');

// Spread across industries, levels, and regions so one healthy source can't mask a dead one.
const BASKET = [
  { query: 'registered nurse', location: 'Austin, TX', radius: 25 },
  { query: 'software engineer', location: 'Seattle, WA', radius: 25 },
  { query: 'warehouse associate', location: 'Columbus, OH', radius: 25 },
  { query: 'accountant', location: 'Chicago, IL', radius: 25 },
  { query: 'customer service', location: 'Phoenix, AZ', radius: 25 },
  { query: 'data analyst', location: 'Remote', radius: 0 },
];

const MIN_RESULTS = 5;          // fewer than this on a broad query = a source likely died
const FRESH_DAYS = 14;          // a listing older than this is "old" for freshness stats
const MAX_OLD_SHARE = 0.6;      // >60% old listings in a basket query = ingestion likely stalled

const daysAgo = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? (Date.now() - t) / 86400000 : null; };

async function probe(q) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q),
      signal: AbortSignal.timeout(45000),
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ...q, ok: false, status: res.status, ms, problems: [`HTTP ${res.status}`] };
    const body = await res.json();
    const jobs = Array.isArray(body.jobs) ? body.jobs : [];
    const ages = jobs.map((j) => daysAgo(j.posted_at)).filter((d) => d != null);
    const old = ages.filter((d) => d > FRESH_DAYS).length;
    const noId = jobs.filter((j) => !j.id).length;
    const keys = jobs.map((j) => `${(j.title || '').toLowerCase()}|${(j.company || '').toLowerCase()}|${(j.location || '').toLowerCase()}`);
    const dupes = keys.length - new Set(keys).size;
    const sources = [...new Set(jobs.map((j) => j.source).filter(Boolean))];
    const problems = [];
    if (jobs.length < MIN_RESULTS) problems.push(`only ${jobs.length} results`);
    if (ages.length && old / ages.length > MAX_OLD_SHARE) problems.push(`${Math.round((100 * old) / ages.length)}% older than ${FRESH_DAYS}d`);
    if (noId) problems.push(`${noId} results with id:null (broken permalinks)`);
    if (body.degraded) problems.push('degraded response');
    return {
      ...q, ok: problems.length === 0, status: res.status, ms, results: jobs.length,
      median_age_days: ages.length ? +ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)].toFixed(1) : null,
      undated: jobs.length - ages.length, old, no_id: noId, dupes, sources, src: body._src || null, problems,
    };
  } catch (e) {
    return { ...q, ok: false, ms: Date.now() - started, problems: [`request failed: ${e.message}`] };
  }
}

const results = [];
for (const q of BASKET) results.push(await probe(q)); // sequential: don't burst the prod API
const failed = results.filter((r) => !r.ok);
const summary = { base: BASE, at: new Date().toISOString(), queries: results.length, failed: failed.length, results };

if (AS_JSON) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`jobs-health ${BASE} — ${results.length - failed.length}/${results.length} queries healthy`);
  for (const r of results) {
    const head = `${r.ok ? '✓' : '✗'} ${r.query} @ ${r.location}`;
    const stats = r.results != null
      ? `${r.results} results · median age ${r.median_age_days ?? '?'}d · ${r.dupes} dupes · ${r.ms}ms · sources: ${r.sources.join(', ') || '—'}`
      : `${r.ms}ms`;
    console.log(`${head} — ${stats}${r.problems.length ? `\n    ! ${r.problems.join('; ')}` : ''}`);
  }
}
process.exit(failed.length ? 1 : 0);
