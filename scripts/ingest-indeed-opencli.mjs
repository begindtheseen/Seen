#!/usr/bin/env node
// Run manually on the Mac that has OpenCLI's Browser Bridge connected to Chrome.
// OpenCLI talks to Indeed through that browser session; this script only forwards
// extracted JSON to Seen's protected ingestion endpoint.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const endpoint = process.env.SEEN_LOCAL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-indeed';
const token = process.env.SEEN_LOCAL_INGEST_TOKEN;
const limit = Math.max(1, Math.min(Number(process.env.INDEED_RESULTS_PER_SEARCH) || 20, 25));

if (!token) throw new Error('Set SEEN_LOCAL_INGEST_TOKEN to the Vercel LOCAL_INDEED_INGEST_SECRET.');
if (!process.env.INDEED_SEARCHES_JSON) {
  throw new Error('Set INDEED_SEARCHES_JSON, e.g. [{"query":"software engineer","location":"Remote"}].');
}

let searches;
try { searches = JSON.parse(process.env.INDEED_SEARCHES_JSON); } catch { throw new Error('INDEED_SEARCHES_JSON must be valid JSON.'); }
if (!Array.isArray(searches) || !searches.length) throw new Error('INDEED_SEARCHES_JSON must be a non-empty array.');

async function opencliJson(args) {
  const { stdout } = await exec('opencli', args, { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
  let parsed;
  try { parsed = JSON.parse(stdout); }
  catch { throw new Error(`OpenCLI returned non-JSON output for: opencli ${args.join(' ')}`); }
  // OpenCLI 2 wraps JSON responses in { ok, data } while 1.x returns the
  // result directly. Supporting both keeps the Mac importer upgrade-safe.
  if (parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean') {
    if (!parsed.ok) throw new Error(parsed.error?.message || 'OpenCLI command failed');
    return parsed.data;
  }
  return parsed;
}

const asArray = value => Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);
const dedupe = new Map();

for (const search of searches.slice(0, 12)) {
  const query = String(search?.query || '').trim();
  const location = String(search?.location || 'Remote').trim();
  if (!query) continue;
  const args = ['indeed', 'search', query, '--location', location, '--limit', String(limit), '-f', 'json'];
  const results = asArray(await opencliJson(args));
  for (const hit of results) {
    const id = String(hit?.id || hit?.jobKey || '').trim();
    if (!/^[a-f0-9]{16}$/i.test(id) || dedupe.has(id)) continue;
    let detail;
    try {
      detail = await opencliJson(['indeed', 'job', id, '-f', 'json']);
    } catch (error) {
      console.warn(`Skipping Indeed job ${id}: ${error.message}`);
      continue;
    }
    const job = Array.isArray(detail) ? detail[0] : detail;
    if (job && typeof job === 'object') dedupe.set(id, { ...hit, ...job, search_query: query });
  }
}

const jobs = [...dedupe.values()];
let accepted = 0;
for (let i = 0; i < jobs.length; i += 50) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: jobs.slice(i, i + 50) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Seen ingest failed (${response.status}): ${payload.error || 'unknown error'}`);
  accepted += Number(payload.upserted || 0);
}

console.log(JSON.stringify({ ok: true, searches: searches.length, detailed: jobs.length, upserted: accepted }, null, 2));
