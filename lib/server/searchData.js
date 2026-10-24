// public.search_daily storage (migration 20261024170000_search_data): idempotent upserts from the daily cron,
// the 28-day window the opportunity engine reads, freshness, and retention.
//
// Every function is best-effort and never throws. Before the migration is applied PostgREST answers 404 for the
// table (PGRST205 "Could not find the table") and each call reports { missingTable: true } instead of failing,
// so this code can ship before the schema (CLAUDE.md: deploy code before schema).

import { pacificDate, pacificDayStart } from '../time/pacific.js';

export const TABLE = 'search_daily';
export const UPSERT_CHUNK = 500;
export const KEEP_DAYS = 480;           // Search Console keeps 16 months; so do we
export const WINDOW_MAX_ROWS = 200_000;

const headersFor = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });

/** A PostgREST answer that means the table does not exist yet. */
export async function isMissingTable(r) {
  if (!r) return false;
  if (r.status === 404) return true;
  if (r.status !== 400) return false;
  const t = await r.text().catch(() => '');
  return /PGRST205|42P01|does not exist|Could not find the table/i.test(t);
}

export const recordKey = (r) => `${r.date}\u0000${r.source}\u0000${r.query}\u0000${r.page}`;

/**
 * The upsert payload: one row per (date, source, query, page). Postgres refuses an ON CONFLICT batch that touches
 * the same key twice ("cannot affect row a second time"), so repeats inside one pull are merged (the larger
 * impression count wins: both are the provider's own totals for that key, never added together).
 * @param {Array<object>} records
 */
export function buildUpsertPayload(records, fetchedAt = new Date().toISOString()) {
  const byKey = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || !r.date || !r.source || !r.query) continue;
    const row = { date: r.date, source: r.source, query: String(r.query), page: String(r.page ?? ''),
      clicks: Math.max(0, Math.round(Number(r.clicks) || 0)), impressions: Math.max(0, Math.round(Number(r.impressions) || 0)),
      ctr: Math.min(1, Math.max(0, Number(r.ctr) || 0)), position: r.position == null ? null : Number(r.position), fetched_at: fetchedAt };
    const k = recordKey(row), prev = byKey.get(k);
    if (!prev || row.impressions > prev.impressions) byKey.set(k, row);
  }
  return [...byKey.values()];
}

/**
 * Upsert records in chunks. Idempotent: the same pull run twice leaves the same rows.
 * @returns {Promise<{ ok: boolean, written: number, chunks: number, missingTable?: boolean, error?: string }>}
 */
export async function storeSearchRecords({ url, key, records, fetchImpl = fetch, chunk = UPSERT_CHUNK }) {
  const payload = buildUpsertPayload(records);
  let written = 0, chunks = 0;
  for (let i = 0; i < payload.length; i += chunk) {
    const part = payload.slice(i, i + chunk);
    let r;
    try {
      r = await fetchImpl(`${url}/rest/v1/${TABLE}?on_conflict=date,source,query,page`, {
        method: 'POST', headers: headersFor(key, { Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(part),
      });
    } catch (e) { return { ok: false, written, chunks, error: String(e?.message || e).slice(0, 120) }; }
    chunks++;
    if (!r.ok) {
      if (await isMissingTable(r)) return { ok: true, written: 0, chunks, missingTable: true };
      return { ok: false, written, chunks, error: `upsert: HTTP ${r.status}` };
    }
    written += part.length;
  }
  return { ok: true, written, chunks };
}

/** Delete rows older than KEEP_DAYS (Pacific days). */
export async function pruneSearchRows({ url, key, now = new Date(), fetchImpl = fetch, keepDays = KEEP_DAYS }) {
  const cutoff = pacificDate(pacificDayStart(now, -keepDays));
  try {
    const r = await fetchImpl(`${url}/rest/v1/${TABLE}?date=lt.${cutoff}`, { method: 'DELETE', headers: headersFor(key, { Prefer: 'return=minimal' }) });
    if (!r.ok) { const missing = await isMissingTable(r); return { ok: missing, ...(missing ? { missingTable: true } : {}) }; }
    return { ok: true };
  } catch { return { ok: false }; }
}

/**
 * Every row on or after `since` (a 'YYYY-MM-DD'), keyset paged on the id (PostgREST returns ≤ 1,000 rows).
 * `filter` is an extra PostgREST filter string (already encoded), e.g. `page=eq.<url>`.
 * @returns {Promise<{ ok: boolean, rows: object[], missingTable?: boolean, capped?: boolean }>}
 */
export async function readSearchRows({ url, key, since, filter = '', fetchImpl = fetch, maxRows = WINDOW_MAX_ROWS, timeoutMs = 10_000, select = 'id,date,source,query,page,clicks,impressions,position' }) {
  if (!url || !key) return { ok: false, rows: [] };
  const rows = [];
  let after = 0;
  for (;;) {
    let r;
    try {
      r = await fetchImpl(`${url}/rest/v1/${TABLE}?select=${select}&date=gte.${since}${filter ? `&${filter}` : ''}&id=gt.${after}&order=id.asc&limit=1000`,
        { headers: headersFor(key), signal: AbortSignal.timeout(timeoutMs) });
    } catch { return { ok: false, rows }; }
    if (!r.ok) {
      const missing = await isMissingTable(r);
      return { ok: missing, rows: [], ...(missing ? { missingTable: true } : {}) };
    }
    const page = await r.json().catch(() => null);
    if (!Array.isArray(page)) return { ok: false, rows };
    rows.push(...page);
    if (page.length < 1000) return { ok: true, rows };
    if (rows.length >= maxRows) return { ok: true, rows, capped: true };
    after = page[page.length - 1].id;
  }
}

/**
 * Newest stored date per source: { google: 'YYYY-MM-DD'|null, bing: …, missingTable? }.
 */
export async function searchFreshness({ url, key, fetchImpl = fetch }) {
  const out = { google: null, bing: null };
  for (const source of ['google', 'bing']) {
    try {
      const r = await fetchImpl(`${url}/rest/v1/${TABLE}?select=date&source=eq.${source}&order=date.desc&limit=1`, { headers: headersFor(key), signal: AbortSignal.timeout(8000) });
      if (!r.ok) { if (await isMissingTable(r)) return { ...out, missingTable: true }; continue; }
      const rows = await r.json().catch(() => []);
      out[source] = rows?.[0]?.date ?? null;
    } catch { /* leave null */ }
  }
  return out;
}
