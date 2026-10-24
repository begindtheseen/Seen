// Google Search Console → Seen (2026-10-24). What people typed into Google before a seenjobs.io page showed
// up, pulled once a day by api/cron-search-data.js and stored in public.search_daily.
//
// Auth is a Google service account (env GSC_SERVICE_ACCOUNT_JSON = the JSON key file's contents) that the owner
// added as a user on the Search Console property (env GSC_SITE_URL = 'sc-domain:seenjobs.io' or
// 'https://seenjobs.io/'). No SDK: the OAuth 2.0 service-account flow is one RS256-signed JWT exchanged for an
// access token, done with Node's own crypto.
//
// Verified against Google's docs on 2026-10-24:
//   developers.google.com/identity/protocols/oauth2/service-account (HTTP/REST):
//     JWT header {"alg":"RS256","typ":"JWT"[,"kid"]}; claims iss (service account email), scope (space
//     separated), aud "https://oauth2.googleapis.com/token", iat, exp (at most one hour after iat); signature =
//     SHA256withRSA over base64url(header) + "." + base64url(claims). Token request: POST
//     https://oauth2.googleapis.com/token, application/x-www-form-urlencoded,
//     grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt> → {access_token, expires_in, token_type}.
//   developers.google.com/webmaster-tools/v1/searchanalytics/query:
//     POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query (siteUrl URL-encoded),
//     body {startDate, endDate (YYYY-MM-DD, PACIFIC time, inclusive), dimensions, type:'web', rowLimit 1–25,000,
//     startRow (zero-based), dataState 'final' default}; response rows[] {keys[] in dimension order, clicks,
//     impressions, ctr (0–1), position}. A startRow past the end answers 200 with no rows. Data lags ~2 days.
//
// Search Console reports Pacific dates, which is also Seen's calendar (lib/time/pacific.js), so a stored date is
// the same day everywhere on the site.

import { createSign } from 'node:crypto';
import { pacificDate, pacificDayStart } from '../time/pacific.js';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GSC_ROW_LIMIT = 25_000;          // the API maximum per request
export const GSC_LAG_DAYS = 2;                // newest day Search Console has finished
export const GSC_DAYS = 3;                    // re-pull the last 3 finished days each run (late data settles)
export const GSC_MAX_ROWS = 200_000;          // a safety cap per run

const b64url = (input) => Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * The service-account key from env (the whole JSON file). null when it is missing or unusable.
 * @param {string|undefined|null} raw
 * @returns {{ client_email: string, private_key: string, private_key_id?: string } | null}
 */
export function parseServiceAccount(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let j;
  try { j = JSON.parse(raw); } catch {
    // Some dashboards store the key base64-encoded to keep newlines intact.
    try { j = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { return null; }
  }
  if (!j || typeof j.client_email !== 'string' || typeof j.private_key !== 'string') return null;
  // A key pasted through a single-line env field arrives with literal "\n" sequences.
  const private_key = j.private_key.includes('\\n') ? j.private_key.replace(/\\n/g, '\n') : j.private_key;
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(private_key)) return null;
  return { client_email: j.client_email, private_key, ...(j.private_key_id ? { private_key_id: String(j.private_key_id) } : {}) };
}

/**
 * The signed JWT assertion for Google's token endpoint.
 * @param {{ clientEmail: string, privateKey: string, keyId?: string, scope?: string, nowMs?: number }} p
 */
export function signServiceAccountJwt({ clientEmail, privateKey, keyId, scope = GSC_SCOPE, nowMs = Date.now() }) {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: 'RS256', typ: 'JWT', ...(keyId ? { kid: keyId } : {}) };
  const claims = { iss: clientEmail, scope, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(input).end().sign(privateKey);
  return `${input}.${b64url(signature)}`;
}

/**
 * Exchange the JWT for an access token.
 * @returns {Promise<{ ok: true, token: string } | { ok: false, error: string }>}
 */
export async function fetchAccessToken(sa, { fetchImpl = fetch, nowMs = Date.now(), timeoutMs = 15_000 } = {}) {
  try {
    const assertion = signServiceAccountJwt({ clientEmail: sa.client_email, privateKey: sa.private_key, keyId: sa.private_key_id, nowMs });
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
    const r = await fetchImpl(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.access_token) return { ok: false, error: `token: HTTP ${r.status}${j?.error ? ` ${String(j.error).slice(0, 60)}` : ''}` };
    return { ok: true, token: j.access_token };
  } catch (e) {
    return { ok: false, error: `token: ${String(e?.message || e).slice(0, 120)}` };
  }
}

/**
 * The Pacific dates to pull: the last `days` days Search Console has finished (it lags ~2 days).
 * @returns {{ startDate: string, endDate: string }}
 */
export function gscDateWindow(now = new Date(), { lagDays = GSC_LAG_DAYS, days = GSC_DAYS } = {}) {
  const n = Math.max(1, Math.min(480, Math.floor(Number(days) || GSC_DAYS)));
  return { startDate: pacificDate(pacificDayStart(now, -(lagDays + n - 1))), endDate: pacificDate(pacificDayStart(now, -lagDays)) };
}

export const searchAnalyticsUrl = (siteUrl) => `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

/**
 * Every row for [startDate, endDate] by query + page + date, page by page (startRow).
 * @returns {Promise<{ ok: boolean, rows: Array<object>, requests: number, error?: string, capped?: boolean }>}
 */
export async function fetchSearchAnalytics({ token, siteUrl, startDate, endDate, fetchImpl = fetch, rowLimit = GSC_ROW_LIMIT, maxRows = GSC_MAX_ROWS, timeoutMs = 30_000, deadlineAt = Infinity }) {
  const rows = [];
  let requests = 0;
  for (let startRow = 0; startRow < maxRows; startRow += rowLimit) {
    if (Date.now() > deadlineAt) return { ok: rows.length > 0, rows, requests, error: 'out of time', capped: true };
    let r;
    try {
      requests++;
      r = await fetchImpl(searchAnalyticsUrl(siteUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, dimensions: ['query', 'page', 'date'], type: 'web', rowLimit, startRow, dataState: 'final' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { ok: false, rows, requests, error: `searchAnalytics: ${String(e?.message || e).slice(0, 120)}` };
    }
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, rows, requests, error: `searchAnalytics: HTTP ${r.status}${j?.error?.message ? ` ${String(j.error.message).slice(0, 120)}` : ''}` };
    const page = Array.isArray(j?.rows) ? j.rows : [];
    rows.push(...page);
    if (page.length < rowLimit) return { ok: true, rows, requests };
  }
  return { ok: true, rows, requests, capped: true };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

/**
 * Search Analytics rows (keys = [query, page, date]) → search_daily records.
 * @param {Array<{keys?: string[], clicks?: number, impressions?: number, ctr?: number, position?: number}>} rows
 */
export function gscRowsToRecords(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const [query, page, date] = Array.isArray(row?.keys) ? row.keys : [];
    if (!query || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) continue;
    const impressions = Math.round(num(row.impressions)), clicks = Math.min(Math.round(num(row.clicks)), impressions);
    if (!impressions) continue;
    const pos = Number(row.position);
    out.push({ date, source: 'google', query: String(query).trim().slice(0, 500), page: String(page || '').slice(0, 1000),
      clicks, impressions, ctr: Math.min(1, clicks / impressions), position: Number.isFinite(pos) && pos > 0 ? Math.round(pos * 100) / 100 : null });
  }
  return out;
}

/**
 * One full pull: token → rows → records. Without credentials: { skipped: 'no_credentials' } and no request.
 * @returns {Promise<{ ok: boolean, skipped?: string, records?: object[], window?: object, requests?: number, error?: string }>}
 */
export async function pullSearchConsole({ env = process.env, now = new Date(), days = GSC_DAYS, fetchImpl = fetch, deadlineAt = Infinity } = {}) {
  const sa = parseServiceAccount(env.GSC_SERVICE_ACCOUNT_JSON);
  const siteUrl = String(env.GSC_SITE_URL || '').trim();
  if (!sa || !siteUrl) return { ok: true, skipped: 'no_credentials' };
  const t = await fetchAccessToken(sa, { fetchImpl, nowMs: now.getTime() });
  if (!t.ok) return { ok: false, error: t.error };
  const window = gscDateWindow(now, { days });
  const r = await fetchSearchAnalytics({ token: t.token, siteUrl, ...window, fetchImpl, deadlineAt });
  return { ok: r.ok, records: gscRowsToRecords(r.rows), window, requests: r.requests, ...(r.error ? { error: r.error } : {}), ...(r.capped ? { capped: true } : {}) };
}
