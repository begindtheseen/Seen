// Which table answers a light read of listings: public.job_search (migration 20261126120000 — the slim copy of the
// columns search reads, kept exact by triggers, small enough to stay in the database's memory) once it exists and
// holds rows, else public.jobs as before. Whatever the table, the read and its answer are the same.
//
//   ensureSearchTable(url, headers)  probe (once per instance, again every 10 min), resolves to 'job_search' | 'jobs'
//   routeJobsPath(path)              'jobs?…' → 'job_search?…' when the mirror is live and the read only uses its
//                                    columns (a read of `description` or any other jobs-only column stays on jobs)

import { queryColumns } from './jobIndex/evaluate.js';
import { INDEX_COLUMNS } from './jobIndex/shard.js';

export const SEARCH_TABLE = 'job_search';
const MIRROR_COLUMNS = new Set(INDEX_COLUMNS); // the migration's columns are exactly the index's
const RECHECK_MS = 10 * 60_000;
let state = { live: false, at: 0, probing: null };

/** Probe once per instance (and every 10 minutes): the mirror counts once it answers with at least one row. */
export function ensureSearchTable(url, headers, { timeoutMs = 1500 } = {}) {
  if (process.env.SEARCH_TABLE === 'off' || !url) return Promise.resolve('jobs');
  if (state.at && Date.now() - state.at < RECHECK_MS) return Promise.resolve(state.live ? SEARCH_TABLE : 'jobs');
  if (!state.probing) {
    state.probing = fetch(`${url}/rest/v1/${SEARCH_TABLE}?select=id&limit=1`, { headers, signal: AbortSignal.timeout(timeoutMs) })
      .then(async (r) => {
        const rows = r.ok ? await r.json().catch(() => null) : null;
        state = { live: Array.isArray(rows) && rows.length > 0, at: Date.now(), probing: null };
      })
      .catch(() => { state = { live: state.live, at: Date.now() - RECHECK_MS + 30_000, probing: null }; }); // retry in 30 s
  }
  return state.probing.then(() => (state.live ? SEARCH_TABLE : 'jobs'));
}

export function searchTableLive() { return process.env.SEARCH_TABLE !== 'off' && state.live; }

/** A `jobs?…` path rewritten to the mirror when it can answer it; anything else unchanged. */
export function routeJobsPath(path) {
  if (!searchTableLive() || typeof path !== 'string' || !path.startsWith('jobs?')) return path;
  const cols = queryColumns(path.slice(5));
  if (!cols || cols.has('*')) return path;
  for (const c of cols) if (!MIRROR_COLUMNS.has(c)) return path;
  return `${SEARCH_TABLE}?${path.slice(5)}`;
}

/** Tests. */
export function _setSearchTableForTest(live) { state = { live: !!live, at: live === null ? 0 : Date.now(), probing: null }; }
