// "Is this job still open?" — one polite request to the listing's source, asked when a person opens it.
//
// Measured 2026-11-08: about a third of the live Adzuna rows sampled were already taken down at the source
// (Adzuna's own page answered 410) and still showed on /jobs with an Apply button. Seen exists to stop people
// wasting applications on dead jobs, so a listing the source says is gone must stop being offered as open.
//
// Policy (director decision 2026-11-10):
//   • On demand, never a crawl. The job page / drawer asks when it opens; a row checked in the last 24 h is
//     answered from the row. One request per check: the ATS's own job API when the link is an ATS link
//     (cheapest and the most exact answer), else the source page itself (Adzuna: its /details page). Never the
//     reader ladder, never the r.jina.ai rung.
//   • 'gone' only on the source's own word: an ATS JSON API's 404/410, Oracle's empty answer, an Ashby board
//     that no longer lists the job, a Workday 403 confirmed by the site's own search (req id → total 0), a
//     redirect to an error/not-found page (Jobvite ?error=404), or an HTML page whose TEXT says the job is no
//     longer available (at 200 or 404/410 — a bare 404/410 with no such text is 'unknown': round 2). A wall (401/403/405/429), a 5xx, a timeout or a
//     refused address is 'unknown' — never gone.
//   • Persist the way the existing protocol stores a dead listing (lib/server/staleRefresh.js, admin
//     delete_listing): availability_status 'expired', expires_at now (search reads expires_at > now, so it is
//     hidden at once), last_checked_at now. public.sweep_stale_jobs then deletes it unless a saved_jobs /
//     applications row references it, in which case it is kept as 'expired' for the person's permalink.
//     Employer-posted rows are never touched. 'open' bumps last_checked_at only (no revival of a stale row —
//     the age protocol keeps its own meaning). 'unknown' writes nothing.
//
// Lifecycle caveat, stated honestly: the dedupe trigger (migration 068) turns a re-seen 'expired' row back to
// 'active' (+14 d) when an ingest returns the same title/company/location again. Adzuna rows carry no
// external_id, so that only happens when the source's search lists the job again — which is itself the
// source saying it is listed. Prod check 2026-11-10: none of the 20 rows found gone on 2026-11-08 had been
// re-seen since. An 'expired' row is always re-checked when opened (the 24 h window applies to active rows
// only), so the closed state shown to a person always comes from a real answer, never from age alone.

import { safeFetch } from './safeFetch.js';
import { CLOSED_PAGE_RE } from './pageText.js';
import { postingUrls } from './fullPosting.js';
import { validateListingUrl, atsApiPlan, browserHeaders } from './listingImport.js';

export const LIVENESS_TTL_MS = 24 * 3600 * 1000;
export const LIVENESS_TIMEOUT_MS = 6000;
/** Same host from this instance: at least this far apart, and no more than HOST_MAX_PER_MIN a minute. */
export const HOST_GAP_MS = 1000;
export const HOST_MAX_PER_MIN = 20;
// A fresh answer is not asked again from this instance: a wall for an hour, a gone job for a day (an
// 'expired' row is re-checked on open, so without this every open of a closed job would be a request).
const MEMO_MS = { unknown: 60 * 60 * 1000, gone: 24 * 3600 * 1000 };

// A job page that redirects to an error or the jobs list is closed (the same rule as listingResolve.js's
// closed rung — kept in step with it; that file could import this one).
export const CLOSED_HOP_RE = /[?&](?:error|err|code)=40[34]\b|not[-_]?found|jobnotfound|job[-_]?(?:closed|expired)|no[-_]?longer[-_]?available|[?&]expired\b/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only stored rows (a uuid) can be checked; a live search result (j_<hash>) has no row. */
export function checkableId(jobId) {
  const id = String(jobId || '').trim();
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/**
 * Does this row need a request? An employer post never (Seen is its source). An 'expired' row always (its
 * closed state must come from the source, not from age). Anything else when it was not checked in 24 h.
 */
export function needsCheck(row, now = Date.now()) {
  if (!row || row.is_employer_posted === true) return false;
  if (row.availability_status === 'expired') return true;
  const t = Date.parse(row.last_checked_at || '');
  return !Number.isFinite(t) || now - t >= LIVENESS_TTL_MS;
}

// ── per-host pacing (this instance) ─────────────────────────────────────────────────────────────────
const hostLog = new Map(); // host → { last, times: number[] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits out the gap, or answers false when the host's minute budget is spent (the caller says 'unknown'). */
async function takeHostSlot(host, now = Date.now) {
  const t = now();
  const e = hostLog.get(host) || { last: 0, times: [] };
  e.times = e.times.filter((x) => t - x < 60_000);
  if (e.times.length >= HOST_MAX_PER_MIN) { hostLog.set(host, e); return false; }
  const wait = Math.max(0, e.last + HOST_GAP_MS - t);
  e.last = t + wait;
  e.times.push(t + wait);
  hostLog.set(host, e);
  if (hostLog.size > 500) hostLog.delete(hostLog.keys().next().value);
  if (wait) await sleep(wait);
  return true;
}
/** Tests only. */
export function _resetLiveness() { hostLog.clear(); inFlight.clear(); memo.clear(); }

// The page as plain words, ONLY for reading whether it says the job is closed — never to produce HTML.
// Script/style blocks go first (tolerant of "</script >" and attributes), then every tag, each repeated until
// the text stops changing so a tag split by a removed block cannot survive.
function untilStable(s, re, by) {
  let prev;
  do { prev = s; s = s.replace(re, by); } while (s !== prev);
  return s;
}
export function visibleText(html) {
  let s = String(html || '');
  s = untilStable(s, /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ');
  s = untilStable(s, /<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ');
  s = untilStable(s, /<[^<>]*>/g, ' ');
  return s.replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
}

/** A value made safe for one log line: no newlines, printable ASCII, at most 120 characters. */
export function logSafe(v) {
  return String(v == null ? '' : v).replace(/\n|\r/g, '').replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
}

/** A 2xx page says the job is gone: the closed sentence in its text, and no posting on it. */
export function pageSaysClosed(html) {
  const s = String(html || '');
  // a page that still carries the posting's structured data is the posting, whatever its footer says
  if (/"@type"\s*:\s*"JobPosting"/i.test(s)) return false;
  const text = visibleText(s).slice(0, 20000);
  // "open until the position is filled" is a live posting's own sentence (Adzuna, UniFirst, 2026-11-10):
  // a closed phrase right after until / till / once / before / when / unless does not count
  for (const m of text.matchAll(CLOSED_GLOBAL)) {
    if (!/\b(?:until|till|once|before|when|unless|if)\s*$/i.test(text.slice(Math.max(0, m.index - 20), m.index))) return true;
  }
  return false;
}
const CLOSED_GLOBAL = new RegExp(CLOSED_PAGE_RE.source, 'gi');

/** A redirect that left the job for a site's front door or its list of jobs. */
export function redirectedAway(fromUrl, toUrl) {
  try {
    const a = new URL(fromUrl), b = new URL(toUrl);
    const segs = b.pathname.split('/').filter(Boolean);
    if (a.hostname === b.hostname && a.pathname === b.pathname) return false;
    return segs.length <= 1 || /\/(?:jobs|careers|search|job-search|openings|positions)\/?$/i.test(b.pathname);
  } catch { return true; }
}

/** The start link is a list or a front door, not one job's page. */
export function notAJobPage(u) {
  try {
    const x = new URL(u);
    if (/(^|\.)adzuna\./.test(x.hostname)) return false;
    if (/[?&](?:gh_jid|lever-origin|ashby_jid)=/i.test(x.search)) return true;
    const segs = x.pathname.split('/').filter(Boolean);
    return segs.length === 0 || /\/(?:jobs|careers|search|job-search|openings|positions|open-roles|current-job-openings)\/?$/i.test(x.pathname);
  } catch { return true; }
}

const isTimeout = (e) => e?.name === 'AbortError' || /timeout|abort/i.test(String(e?.message));

const WALL = new Set([401, 403, 405, 407, 429, 451]);

/**
 * One request to where the listing lives. Never throws.
 * @returns {Promise<{ state: 'open'|'gone'|'unknown', via: string, status: number|null, url: string|null }>}
 */
export async function probeSource(applyUrl, { fetchImpl = safeFetch, timeoutMs = LIVENESS_TIMEOUT_MS, now = Date.now } = {}) {
  const first = postingUrls(applyUrl).map((u) => validateListingUrl(u)).find((v) => v.ok);
  if (!first) return { state: 'unknown', via: 'no_url', status: null, url: null };
  const plan = atsApiPlan(first.url);
  const target = plan ? validateListingUrl(plan.apiUrl) : first;
  if (!target.ok) return { state: 'unknown', via: 'no_url', status: null, url: null };
  if (!(await takeHostSlot(target.host, now))) return { state: 'unknown', via: 'rate_limited', status: null, url: target.url };
  const deadline = now() + timeoutMs;
  const left = () => Math.max(1, deadline - now());
  try {
    if (plan) {
      const r = await fetchImpl(target.url, { headers: { Accept: 'application/json', 'User-Agent': browserHeaders(target.url)['User-Agent'] || 'Mozilla/5.0' }, timeoutMs: left(), maxBytes: 2_000_000 });
      const via = `ats-api:${plan.kind}`;
      if (r.status === 404 || r.status === 410) return { state: 'gone', via, status: r.status, url: target.url };
      // Workday answers 403 (not 404) for a requisition that is no longer posted (verified 2026-11-10 on two
      // tenants; a listed job's same GET is 200). A 403 can also be a wall, so ask the site's own search for
      // the requisition id: total 0 = gone, anything else = no answer.
      if (plan.kind === 'workday' && r.status === 403) return workdayConfirm(target.url, { fetchImpl, left, now });
      if (r.status < 200 || r.status >= 300) return { state: 'unknown', via, status: r.status, url: target.url };
      let json = null;
      try { json = await r.json(); } catch { json = null; }
      if (plan.kind === 'oracle' && json && Array.isArray(json.items) && !json.items.length) return { state: 'gone', via, status: 410, url: target.url };
      if (plan.kind === 'ashby') {
        if (!json || !Array.isArray(json.jobs)) return { state: 'unknown', via, status: r.status, url: target.url };
        const listed = json.jobs.some((j) => String(j.id || '').toLowerCase() === plan.jobId || String(j.jobUrl || '').toLowerCase().includes(plan.jobId));
        return { state: listed ? 'open' : 'gone', via, status: r.status, url: target.url };
      }
      return { state: json && typeof json === 'object' ? 'open' : 'unknown', via, status: r.status, url: target.url };
    }
    // A link that is a site's job LIST with the job picked by a query (…/careers?gh_jid=123 — a Greenhouse
    // board embedded in a company site) answers 200 whether or not the job is still up: no answer from it.
    if (notAJobPage(target.url)) return { state: 'unknown', via: 'not_a_job_page', status: null, url: target.url };
    // The source page, redirects followed here so every hop is seen (a hop to ?error=404 is the answer).
    let url = target.url;
    for (let hop = 0; hop <= 5; hop++) {
      const r = await fetchImpl(url, { redirect: 'manual', headers: browserHeaders(url), timeoutMs: left(), maxBytes: 400_000 });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers?.get?.('location');
        if (!loc) return { state: 'unknown', via: 'page', status: r.status, url };
        url = new URL(loc, url).toString();
        if (CLOSED_HOP_RE.test(url)) return { state: 'gone', via: 'redirect', status: r.status, url };
        continue;
      }
      // 404/410 on an HTML page is gone only when the page SAYS so. 2026-11-08: Adzuna answered 410 to ~22 ads
      // during a burst from the sandbox that answered 200 with a live posting two days later — a bare status
      // can be a refusal, and a false 'gone' hides a live job.
      if (r.status === 404 || r.status === 410) {
        let body = '';
        try { body = await r.text(); } catch { body = ''; }
        return pageSaysClosed(body)
          ? { state: 'gone', via: 'page', status: r.status, url }
          : { state: 'unknown', via: 'bare_status', status: r.status, url };
      }
      if (WALL.has(r.status) || r.status >= 500 || r.status < 200 || r.status >= 300) return { state: 'unknown', via: 'page', status: r.status, url };
      let html = '';
      try { html = await r.text(); } catch { html = ''; }
      if (pageSaysClosed(html)) return { state: 'gone', via: 'closed-page', status: r.status, url };
      // sent somewhere that is not a job page (the careers home, the jobs list): no answer either way
      if (hop > 0 && redirectedAway(target.url, url)) return { state: 'unknown', via: 'redirect_away', status: r.status, url };
      return { state: 'open', via: 'page', status: r.status, url };
    }
    return { state: 'unknown', via: 'too_many_redirects', status: null, url };
  } catch (e) {
    return { state: 'unknown', via: isTimeout(e) ? 'timeout' : 'unreachable', status: null, url: target.url };
  }
}

/** Workday: the requisition id in a job path (…/Registered-Nurse_R-040536-1 → R-040536), or null. */
export function workdayReqId(apiUrl) {
  try {
    const last = new URL(apiUrl).pathname.split('/').filter(Boolean).pop() || '';
    const i = last.lastIndexOf('_');
    if (i < 0) return null;
    const id = decodeURIComponent(last.slice(i + 1)).replace(/-\d{1,2}$/, '');
    return /^[A-Za-z0-9-]{4,30}$/.test(id) && /\d/.test(id) ? id : null;
  } catch { return null; }
}

/** The site's own search (the request its job list page makes), by requisition id. */
async function workdayConfirm(apiUrl, { fetchImpl, left, now }) {
  const via = 'ats-api:workday-search';
  const reqId = workdayReqId(apiUrl);
  const at = apiUrl.indexOf('/job/');
  if (!reqId || at < 0) return { state: 'unknown', via: 'ats-api:workday', status: 403, url: apiUrl };
  const searchUrl = `${apiUrl.slice(0, at)}/jobs`;
  const v = validateListingUrl(searchUrl);
  if (!v.ok || !(await takeHostSlot(v.host, now))) return { state: 'unknown', via, status: 403, url: searchUrl };
  try {
    const r = await fetchImpl(v.url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': browserHeaders(v.url)['User-Agent'] || 'Mozilla/5.0' },
      body: JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0, searchText: reqId }),
      timeoutMs: left(),
      maxBytes: 500_000,
    });
    if (r.status < 200 || r.status >= 300) return { state: 'unknown', via, status: r.status, url: searchUrl };
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    const gone = json && json.total === 0 && Array.isArray(json.jobPostings) && json.jobPostings.length === 0;
    return { state: gone ? 'gone' : 'unknown', via, status: r.status, url: searchUrl };
  } catch (e) {
    return { state: 'unknown', via: isTimeout(e) ? 'timeout' : 'unreachable', status: null, url: searchUrl };
  }
}

/**
 * Store "the source says this job is gone" on a row — the dead-listing write the stale protocol expects.
 * One PATCH, never on an employer post; a failure is logged and reported, never swallowed.
 * @returns {Promise<boolean>} whether the row was written
 */
export async function recordGone({ id, db, at = new Date(), via = '' }) {
  const iso = at.toISOString();
  try {
    const r = await db(`jobs?id=eq.${encodeURIComponent(id)}&is_employer_posted=eq.false`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ availability_status: 'expired', expires_at: iso, last_checked_at: iso }),
    });
    if (r && r.ok) return true;
    console.error('[liveness] gone write failed: job %s via %s HTTP %s', logSafe(id), logSafe(via), logSafe(r ? r.status : 'none'));
  } catch (e) {
    console.error('[liveness] gone write failed: job %s via %s error %s', logSafe(id), logSafe(via), logSafe(e?.message || e));
  }
  return false;
}

async function recordOpen({ id, db, at }) {
  try {
    const r = await db(`jobs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_checked_at: at.toISOString() }),
    });
    if (r && r.ok) return true;
    console.error('[liveness] checked-at write failed: job %s HTTP %s', logSafe(id), logSafe(r ? r.status : 'none'));
  } catch (e) {
    console.error('[liveness] checked-at write failed: job %s error %s', logSafe(id), logSafe(e?.message || e));
  }
  return false;
}

const inFlight = new Map();
const memo = new Map(); // id → { at, result } (gone / unknown answers made from this instance)

/**
 * @param {{ jobId: string, db: (path: string, opts?: object) => Promise<Response>, fetchImpl?: Function, now?: () => number, timeoutMs?: number }} args
 * @returns {Promise<{ state: 'open'|'gone'|'unknown', checked_at: string|null, via: string, fresh: boolean, saved?: boolean }>}
 *   fresh = a request was made now (false: answered from the row's own recent check)
 */
export function checkLiveness({ jobId, db, fetchImpl = safeFetch, now = Date.now, timeoutMs = LIVENESS_TIMEOUT_MS }) {
  const id = checkableId(jobId);
  if (!id) return Promise.resolve({ state: 'unknown', checked_at: null, via: 'no_row', fresh: false });
  if (inFlight.has(id)) return inFlight.get(id);
  const p = checkOnce({ id, db, fetchImpl, now, timeoutMs }).finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

async function checkOnce({ id, db, fetchImpl, now, timeoutMs }) {
  let row = null;
  try {
    const r = await db(`jobs?id=eq.${encodeURIComponent(id)}&select=id,apply_url,availability_status,last_checked_at,expires_at,is_employer_posted&limit=1`);
    row = r && r.ok ? (await r.json())?.[0] || null : null;
  } catch { row = null; }
  if (!row) return { state: 'unknown', checked_at: null, via: 'no_row', fresh: false };
  if (row.is_employer_posted === true) return { state: 'unknown', checked_at: null, via: 'employer', fresh: false };
  if (!needsCheck(row, now())) return { state: 'open', checked_at: row.last_checked_at, via: 'recent', fresh: false };
  const hit = memo.get(id);
  if (hit && now() - hit.at < MEMO_MS[hit.result.state]) return { ...hit.result, fresh: false };

  // the request carries its own time cap; this one also bounds a transport that ignores it
  let timer;
  const probe = await Promise.race([
    probeSource(row.apply_url, { fetchImpl, timeoutMs, now }),
    new Promise((res) => { timer = setTimeout(() => res({ state: 'unknown', via: 'timeout', status: null, url: null }), timeoutMs + HOST_GAP_MS + 500); }),
  ]).finally(() => clearTimeout(timer));
  const at = new Date(now());
  if (probe.state === 'gone') {
    const saved = await recordGone({ id, db, at, via: probe.via });
    const result = { state: 'gone', checked_at: at.toISOString(), via: probe.via, fresh: true, saved };
    remember(id, result, now);
    return result;
  }
  if (probe.state === 'open') {
    const saved = await recordOpen({ id, db, at });
    return { state: 'open', checked_at: at.toISOString(), via: probe.via, fresh: true, saved };
  }
  const result = { state: 'unknown', checked_at: null, via: probe.via, fresh: true };
  remember(id, result, now);
  return result;
}

function remember(id, result, now) {
  memo.set(id, { at: now(), result });
  if (memo.size > 2000) memo.delete(memo.keys().next().value);
}
