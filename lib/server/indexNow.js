// IndexNow (2026-10-24): tell Bing, Yandex and the other IndexNow engines the moment a page Seen wants indexed
// changes, instead of waiting for a crawl. Free, no account: the key below is PUBLIC by design and is served at
// https://seenjobs.io/<key>.txt (public/<key>.txt) so the engines can check the submission came from the site.
//
// Verified against indexnow.org/documentation on 2026-10-24: POST https://api.indexnow.org/indexnow,
// Content-Type application/json; charset=utf-8, body { host, key, keyLocation, urlList } with up to 10,000 URLs
// per post; key 8–128 chars [a-zA-Z0-9-]; 200 = received, 202 = received (key check pending), 400 bad format,
// 403 key not valid, 422 URLs not on the host / key mismatch, 429 too many requests.
//
// Rules (Google's spam policies and IndexNow's own guidance): submit only URLs that changed and that Seen wants in
// an index. A company page is submitted only when it is GRADEABLE (lib/server/reportCounts.js isGradeable, the
// same gate lib/growth.ts and the page itself use), so a page with no verdict is never pushed. Nothing is ever
// sent outside production (VERCEL_ENV === 'production'): tests, previews and local dev are no-ops.

import { waitUntil } from '@vercel/functions';
import { isGradeable } from './reportCounts.js';

export const INDEXNOW_KEY = '5d0a9c0b02626061b52c859a02af54cc';
export const SITE = 'https://seenjobs.io';
export const HOST = 'seenjobs.io';
export const KEY_LOCATION = `${SITE}/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const MAX_URLS_PER_POST = 10_000;
export const RESUBMIT_AFTER_MS = 20 * 3600_000;   // one submission per URL per day is plenty

// Static pages Seen wants indexed (the sitemap's static routes). A path never submitted before is "new" and is
// sent once by the daily cron; the list hubs that show grades are re-sent on days company grades changed.
export const STATIC_PATHS = ['/', '/companies', '/jobs', '/feed', '/demand', '/resume', '/resume/studio', '/report',
  '/pricing', '/faq', '/compare', '/reddit', '/agencies', '/ghosted'];
export const HUB_PATHS = ['/companies', '/agencies', '/feed'];

/** Production only, and an emergency off switch (INDEXNOW_DISABLED=1). */
export const indexNowEnabled = (env = process.env) => env.VERCEL_ENV === 'production' && env.INDEXNOW_DISABLED !== '1';

// ONE slug scheme everywhere (CLAUDE.md; lib/growth.ts slugify, app/sitemap.ts).
export const companySlug = (name) => encodeURIComponent(String(name).toLowerCase().trim().replace(/\s+/g, '-'));
export const companyPageUrl = (name) => `${SITE}/company/${companySlug(name)}`;

/** Company page URLs for score rows that may be indexed (gradeable only). */
export function indexableCompanyUrls(rows) {
  const out = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.company_name ?? '').trim();
    if (name && isGradeable(row)) out.add(companyPageUrl(name));
  }
  return [...out];
}

/** Same-host https URLs, deduped, in batches of ≤ 10,000. */
export function buildBatches(urls, max = MAX_URLS_PER_POST) {
  const seen = new Set();
  for (const u of Array.isArray(urls) ? urls : []) {
    try {
      const p = new URL(String(u));
      if (p.protocol === 'https:' && p.hostname === HOST) seen.add(p.toString());
    } catch { /* not a URL */ }
  }
  const all = [...seen], batches = [];
  for (let i = 0; i < all.length; i += max) batches.push(all.slice(i, i + max));
  return batches;
}

export const submissionBody = (urlList) => ({ host: HOST, key: INDEXNOW_KEY, keyLocation: KEY_LOCATION, urlList });

const sbHeaders = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });

/** URLs among `urls` already submitted within RESUBMIT_AFTER_MS (empty Set when the log is missing). */
export async function recentlySubmitted({ url, key, urls, nowMs = Date.now(), fetchImpl = fetch }) {
  const done = new Set();
  if (!url || !key || !urls?.length) return done;
  const since = new Date(nowMs - RESUBMIT_AFTER_MS).toISOString();
  try {
    for (let offset = 0; offset < 50_000; offset += 1000) {
      const r = await fetchImpl(`${url}/rest/v1/search_indexnow_log?select=url&last_submitted_at=gte.${since}&order=url.asc&limit=1000&offset=${offset}`, { headers: sbHeaders(key), signal: AbortSignal.timeout(8000) });
      if (!r.ok) return done;
      const rows = await r.json();
      for (const row of rows) done.add(row.url);
      if (rows.length < 1000) break;
    }
  } catch { /* none known */ }
  const want = new Set(urls);
  return new Set([...done].filter((u) => want.has(u)));
}

/** Every URL ever submitted (for "new static page" detection). null when the log cannot be read. */
export async function everSubmitted({ url, key, urls, fetchImpl = fetch }) {
  if (!url || !key || !urls?.length) return null;
  try {
    const list = urls.map((u) => `"${String(u).replace(/"/g, '')}"`).join(',');
    const r = await fetchImpl(`${url}/rest/v1/search_indexnow_log?select=url&url=in.(${encodeURIComponent(list)})&limit=1000`, { headers: sbHeaders(key), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return new Set((await r.json()).map((row) => row.url));
  } catch { return null; }
}

async function logSubmitted({ url, key, urls, status, fetchImpl }) {
  if (!url || !key || !urls.length) return;
  const at = new Date().toISOString();
  for (let i = 0; i < urls.length; i += 1000) {
    await fetchImpl(`${url}/rest/v1/search_indexnow_log?on_conflict=url`, {
      method: 'POST', headers: sbHeaders(key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(urls.slice(i, i + 1000).map((u) => ({ url: u, last_submitted_at: at, last_status: status }))),
    }).catch(() => {});
  }
}

/**
 * Submit URLs to IndexNow. No-op (and no request) outside production.
 * @param {string[]} urls
 * @param {{ env?: object, fetchImpl?: Function, supabaseUrl?: string, supabaseKey?: string }} [opts]
 * @returns {Promise<{ ok: boolean, submitted: number, batches: number, statuses: number[], skipped?: string, error?: string }>}
 */
export async function submitUrls(urls, { env = process.env, fetchImpl = fetch, supabaseUrl = env.SUPABASE_URL, supabaseKey = env.SUPABASE_SERVICE_KEY } = {}) {
  const batches = buildBatches(urls);
  if (!indexNowEnabled(env)) return { ok: true, submitted: 0, batches: 0, statuses: [], skipped: 'not_production' };
  if (!batches.length) return { ok: true, submitted: 0, batches: 0, statuses: [] };
  const statuses = [];
  let submitted = 0, error;
  for (const list of batches) {
    try {
      const r = await fetchImpl(INDEXNOW_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(submissionBody(list)), signal: AbortSignal.timeout(20_000) });
      statuses.push(r.status);
      if (r.status === 200 || r.status === 202) {
        submitted += list.length;
        await logSubmitted({ url: supabaseUrl, key: supabaseKey, urls: list, status: r.status, fetchImpl });
      } else {
        error = `IndexNow HTTP ${r.status}`;
        if (r.status === 429 || r.status === 403) break; // slow down / fix the key; never hammer
      }
    } catch (e) {
      statuses.push(0);
      error = String(e?.message || e).slice(0, 120);
    }
  }
  return { ok: !error, submitted, batches: batches.length, statuses, ...(error ? { error } : {}) };
}

// ── After a company recompute (api/_utils/reportWrite.js) ─────────────────────────────────────────────────
// A recompute can run 200 times in one admin rescore, so URLs are queued and sent in ONE post a moment later,
// kept alive past the response by waitUntil. Fire-and-forget: it never throws and never delays the caller.
const queue = new Set();
let flushing = null;
export const FLUSH_DELAY_MS = 1500;

/**
 * Queue a recomputed score row's company page (gradeable rows only). Returns true when queued.
 * @param {{ company_name?: string } & object} row
 */
export function notifyCompanyRecomputed(row, { env = process.env } = {}) {
  try {
    if (!indexNowEnabled(env) || !row || !isGradeable(row)) return false;
    queue.add(companyPageUrl(row.company_name));
    if (!flushing) {
      flushing = new Promise((resolve) => setTimeout(resolve, FLUSH_DELAY_MS)).then(async () => {
        const urls = [...queue];
        queue.clear();
        flushing = null;
        const done = await recentlySubmitted({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY, urls });
        await submitUrls(urls.filter((u) => !done.has(u)), { env });
      }).catch(() => { flushing = null; });
      waitUntil(flushing);
    }
    return true;
  } catch { return false; }
}
