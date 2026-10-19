#!/usr/bin/env node
// Manual Mac-only Indeed ingestion. Indeed is read through OpenCLI + Chrome; Vercel only stores rows.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ID_RE = /^[a-f0-9]{16}$/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function parsePositiveInt(value, name, { fallback, max = Infinity } = {}) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > max) throw new Error(`${name} must be a positive integer no greater than ${max}.`);
  return Number(value);
}

export function configFromEnv(env = process.env) {
  if (!env.SEEN_LOCAL_INGEST_TOKEN) throw new Error('Set SEEN_LOCAL_INGEST_TOKEN to the Vercel LOCAL_INDEED_INGEST_SECRET.');
  if (!env.INDEED_SEARCHES_JSON) throw new Error('Set INDEED_SEARCHES_JSON to a non-empty JSON array.');
  let searches;
  try { searches = JSON.parse(env.INDEED_SEARCHES_JSON); } catch { throw new Error('INDEED_SEARCHES_JSON must be valid JSON.'); }
  if (!Array.isArray(searches) || !searches.length) throw new Error('INDEED_SEARCHES_JSON must be a non-empty array.');
  // Installed OpenCLI adapter: one page, 1–25 rows, and --start offsets of 10.
  const limit = parsePositiveInt(env.INDEED_RESULTS_PER_SEARCH, 'INDEED_RESULTS_PER_SEARCH', { fallback: 20, max: 25 });
  const maxPages = parsePositiveInt(env.INDEED_MAX_PAGES, 'INDEED_MAX_PAGES', { fallback: 1, max: 100 });
  const maxSearches = env.INDEED_MAX_SEARCHES === undefined || env.INDEED_MAX_SEARCHES === '' ? Infinity : parsePositiveInt(env.INDEED_MAX_SEARCHES, 'INDEED_MAX_SEARCHES', { fallback: Infinity });
  // Browser commands share one Chrome bridge. Keep sequential until concurrent sessions are verified safe.
  const concurrency = parsePositiveInt(env.INDEED_DETAIL_CONCURRENCY, 'INDEED_DETAIL_CONCURRENCY', { fallback: 1, max: 1 });
  return { endpoint: env.SEEN_LOCAL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-indeed', token: env.SEEN_LOCAL_INGEST_TOKEN, searches, limit, maxPages, maxSearches, concurrency };
}

export function unwrapOpenCli(stdout, args = []) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { throw new Error(`OpenCLI returned non-JSON output for: opencli ${args.join(' ')}`); }
  // OpenCLI 1.x returns data directly; 2.x uses { ok, data }.
  if (parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean') {
    if (!parsed.ok) throw new Error(parsed.error?.message || 'OpenCLI command failed');
    return parsed.data;
  }
  return parsed;
}
const asArray = value => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);
const errorStage = (metrics, stage, error) => { metrics.errors[stage] = (metrics.errors[stage] || 0) + 1; metrics.lastErrors[stage] = String(error?.message || error).slice(0, 180); };

async function retry(task, { attempts = 2, delayMs = 750, random = Math.random } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await task(); } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await sleep(delayMs * (2 ** attempt) + Math.floor(random() * 250));
    }
  }
  throw last;
}

export async function runIndeedImport({ env = process.env, execFileImpl = exec, fetchImpl = fetch, log = console, random = Math.random } = {}) {
  const cfg = configFromEnv(env);
  const started = Date.now();
  const metrics = { ok: true, searches: 0, detailed: 0, upserted: 0, searches_requested: cfg.searches.length, searches_attempted: 0, searches_successful: 0, searches_failed: 0, raw_search_hits: 0, unique_indeed_ids: 0, duplicate_search_hits: 0, detail_requests_attempted: 0, detail_requests_successful: 0, detail_requests_failed: 0, jobs_submitted: 0, jobs_inserted: null, jobs_updated: null, jobs_rejected: 0, jobs_deduplicated: 0, errors: {}, lastErrors: {}, pagination_supported: true, detail_concurrency: cfg.concurrency };
  const opencli = async args => {
    const { stdout } = await execFileImpl('opencli', args, { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
    return unwrapOpenCli(stdout, args);
  };
  const hits = new Map();
  for (const search of cfg.searches.slice(0, cfg.maxSearches)) {
    const query = String(search?.query || '').trim();
    const location = String(search?.location || 'Remote').trim();
    if (!query) { metrics.searches_failed++; errorStage(metrics, 'search', 'Search query is empty'); continue; }
    metrics.searches_attempted++;
    try {
      for (let page = 0; page < cfg.maxPages; page++) {
        const results = asArray(await retry(() => opencli(['indeed', 'search', query, '--location', location, '--limit', String(cfg.limit), '--start', String(page * 10), '-f', 'json']), { random }));
        metrics.raw_search_hits += results.length;
        let newHits = 0;
        for (const hit of results) {
          const id = String(hit?.id || hit?.jobKey || '').trim();
          if (!ID_RE.test(id)) continue;
          if (hits.has(id)) { metrics.duplicate_search_hits++; continue; }
          hits.set(id, { ...hit, id, search_query: query, search_location: location }); newHits++;
        }
        if (results.length < cfg.limit || newHits === 0) break;
      }
      metrics.searches_successful++;
    } catch (error) { metrics.searches_failed++; errorStage(metrics, 'search', error); log.warn(`Skipping search "${query}": ${error.message}`); }
  }
  metrics.searches = metrics.searches_attempted;
  metrics.unique_indeed_ids = hits.size;
  const detailed = [];
  // Sequential by design: shared Browser Bridge concurrency is not verified safe.
  for (const hit of hits.values()) {
    metrics.detail_requests_attempted++;
    try {
      const response = await retry(() => opencli(['indeed', 'job', hit.id, '-f', 'json']), { random });
      const job = Array.isArray(response) ? response[0] : response;
      if (!job || typeof job !== 'object') throw new Error('OpenCLI returned no job detail.');
      detailed.push({ ...hit, ...job, id: hit.id, search_query: hit.search_query, search_location: hit.search_location });
      metrics.detail_requests_successful++;
    } catch (error) { metrics.detail_requests_failed++; errorStage(metrics, 'detail', error); log.warn(`Skipping Indeed job ${hit.id}: ${error.message}`); }
  }
  metrics.detailed = detailed.length;
  for (let i = 0; i < detailed.length; i += 50) {
    const response = await fetchImpl(cfg.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jobs: detailed.slice(i, i + 50) }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { errorStage(metrics, 'ingest', payload.error || `HTTP ${response.status}`); throw new Error(`Seen ingest failed (${response.status}): ${payload.error || 'unknown error'}`); }
    metrics.jobs_submitted += Number(payload.accepted || 0);
    metrics.upserted += Number(payload.upserted || 0);
    metrics.jobs_rejected += Number(payload.rejected || 0) + Number(payload.dropped || 0);
    metrics.jobs_deduplicated += Number(payload.deduplicated || 0);
  }
  metrics.duration_ms = Date.now() - started;
  return metrics;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) runIndeedImport().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
