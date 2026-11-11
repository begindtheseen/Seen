// The full posting behind a teaser row, fetched once and kept for everyone.
//
// Owner 2026-10-27, from a phone screenshot: "This listing only has a summary. Paste the full posting to
// optimize for it." on a saved Marriott job — "This is far too common." It is: every Adzuna row is a ~500-char
// teaser, and 4 of the 7 saved jobs on the site were one. The person was being asked to go find the posting
// that Seen already had a link to. So before any résumé-vs-job tool says "paste it", Seen follows the row's own
// link through the listing importer (lib/server/listingResolve.js: the page, the ATS's JSON API, then the
// reader rungs the employer import already uses) and, when it comes back with the posting, stores it on the
// row and carries on. The paste box is the fallback, not the first answer.
import { resolveListing } from './listingResolve.js';
import { validateListingUrl } from './listingImport.js';
import { cleanDescription } from './jobSources.js';
import { isDescriptionPreview } from '../jobs/descriptionText.js';
import { recordGone, logSafe } from './listingLiveness.js';

/** Shorter than this is not a posting, whatever the fetch returned. */
export const MIN_FULL_POSTING = 700;

/**
 * Where an Adzuna row's posting can be read, best first. Adzuna's own job page (/details/<id>) carries
 * the whole posting as schema.org JobPosting JSON-LD (4,718 chars for a SpaceX electrician on
 * 2026-11-08, against the 500-char API teaser); a /land/ad/<id> link redirects to the employer's site,
 * which may be a wall. Both share the ad id, so the details page is tried first and the row's own link
 * second. The partner tag rides along (validateListingUrl keeps it — Adzuna answers 405 without it).
 * Any other row: just its own link.
 * @param {string|null} applyUrl
 * @returns {string[]}
 */
export function postingUrls(applyUrl) {
  const raw = String(applyUrl || '').trim();
  if (!raw) return [];
  let u;
  try { u = new URL(raw); } catch { return [raw]; }
  const host = u.hostname.toLowerCase();
  const m = /(^|\.)adzuna\.[a-z.]+$/.test(host) && u.pathname.match(/\/(?:land\/ad|details)\/(\d{5,})/);
  if (!m) return [raw];
  const tag = new URLSearchParams();
  for (const k of ['utm_medium', 'utm_source']) if (u.searchParams.get(k)) tag.set(k, u.searchParams.get(k));
  const q = tag.toString();
  const details = `https://${host}/details/${m[1]}${q ? `?${q}` : ''}`;
  return details === raw ? [raw] : [details, raw];
}

/** resolveListing answers { fields, rungs, blocked }; a test double may answer the fields alone. */
function fieldsOf(out) {
  if (out && typeof out === 'object' && out.fields && typeof out.fields === 'object') return out.fields;
  return out || {};
}

/**
 * The resolver says the job is gone: an ATS JSON API answered 404/410 (Greenhouse/Lever/Ashby/SmartRecruiters/
 * Workable/Workday; Oracle's empty answer is reported as 410), or its closed rung fired (a page whose text says
 * the job is no longer available — at 200 or 404/410 — or a redirect to an error page). A 'direct' 404/410 with
 * no such text is not gone: Adzuna answered 410 to a sandbox burst for ads that were live two days later.
 */
export function closedRung(out) {
  return (out?.rungs || []).some((r) => (r.rung === 'ats-api' || r.rung === 'closed') && [404, 410].includes(r.status));
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
}

// Two calls for one row in the same moment (the Optimize sheet sends the free diagnosis and the cache
// probe together) share one fetch instead of reading the employer's page twice.
const inFlight = new Map();

/**
 * @param {{ jobId: string, db: (path: string, opts?: object) => Promise<Response>, resolve?: Function, timeoutMs?: number }} args
 * @returns {Promise<{ ok: true, description: string, source: string|null, fetched: boolean, via?: string } | { ok: false, reason: string, apply_url: string|null }>}
 */
export async function fetchFullPosting({ jobId, db, resolve = resolveListing, timeoutMs = 9000, refresh = false }) {
  const id = String(jobId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!id) return { ok: false, reason: 'no_job', apply_url: null };
  const k = `${refresh ? 'r' : 'p'}:${id}`;
  if (inFlight.has(k)) return inFlight.get(k);
  const p = fetchOnce({ id, db, resolve, timeoutMs, refresh }).finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
}

/** A re-read only replaces stored text that it clearly extends (an ATS row stored as its intro alone). */
export const REFRESH_GAIN = 300;

async function fetchOnce({ id, db, resolve, timeoutMs, refresh }) {
  const r = await db(`jobs?id=eq.${encodeURIComponent(id)}&select=id,title,company,source,description,apply_url,is_employer_posted&limit=1`).catch(() => null);
  const row = r && r.ok ? (await r.json().catch(() => null))?.[0] : null;
  if (!row) return { ok: false, reason: 'no_row', apply_url: null };
  const stored = String(row.description || '');
  // the row already holds the posting (a board row, or a teaser someone upgraded earlier)
  // `refresh`: the stored text is a full-length row that still reads as no requirements (a Lever row
  // stored as its intro before 2026-11-08) — read the page again and keep it only when it is longer.
  if (!refresh && stored.length >= MIN_FULL_POSTING && !isDescriptionPreview(row)) return { ok: true, description: stored, source: row.source || null, fetched: false };
  const applyUrl = row.apply_url || null;
  const urls = postingUrls(applyUrl).map((u) => validateListingUrl(u)).filter((v) => v.ok);
  if (!urls.length) return { ok: false, reason: 'no_url', apply_url: applyUrl };
  let reason = 'thin';
  let unreachable = 0;
  let tried = 0;
  let gone = 0;
  const deadline = Date.now() + timeoutMs;
  for (const [i, v] of urls.entries()) {
    const left = Math.max(1, deadline - Date.now());
    // the second address only when there is time to read it
    if (i > 0 && left < 1500) break;
    let fields;
    tried++;
    try {
      const out = await withTimeout(resolve(v), left);
      // the source says the job is gone (404/410 on the page itself) — a closed listing, not a wall
      // (the page itself, or the ATS's own API for the job: a Workday page loads its shell for a closed job, its API says 404)
      // a bare 404/410 on the page is NOT enough (it can be a refusal): the closed rung needs the page to say so
      if (closedRung(out)) gone++;
      fields = fieldsOf(out);
    } catch {
      unreachable++;
      continue;
    }
    // the importer's own cleaning (HTML → text, entity decoding, the ingest cap)
    const text = String(cleanDescription(String(fields.description || '')) || '').trim();
    if (text.length < MIN_FULL_POSTING || isDescriptionPreview({ source: null, description: text })) continue;
    if (refresh && text.length < stored.length + REFRESH_GAIN) { reason = 'no_more'; continue; }
    // keep it for everyone who opens this row next; the source stays (it is still an Adzuna row — one with its posting)
    // best effort (the posting is returned either way), but a failed store is logged, not swallowed
    const saved = await db(`jobs?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ description: text }) }).catch((e) => ({ ok: false, status: e?.message || 'error' }));
    if (!saved || saved.ok === false) console.error('[full-posting] description store failed: job %s status %s', logSafe(id), logSafe(saved ? saved.status : 'no answer'));
    return { ok: true, description: text, source: row.source || null, fetched: true, via: fields.via || null };
  }
  if (unreachable && unreachable === tried) reason = 'unreachable';
  // Adzuna's own page answers 410 for an ad taken down (2026-11-08: 24 of the 25 teasers it could not read
  // were gone there; their /land/ad link forwarded to an employer page that refused the fetch). When the source
  // itself says the job is gone, that is the answer, whatever the second address did.
  else if (gone) reason = 'gone';
  // the source said the job is gone: the row stops being offered as open (lib/server/listingLiveness.js) —
  // one write, the same dead-listing write the liveness check makes; never on an employer post
  if (reason === 'gone' && row.is_employer_posted !== true) await recordGone({ id, db, via: 'full-posting' });
  return { ok: false, reason, apply_url: applyUrl };
}

// ── A pasted LINK is a posting too ────────────────────────────────────────────────────────────────────
// Owner 2026-11-08: "it must be able to parse any and every application." The paste box asked for the
// posting's text; a person who has the listing open pastes its address. Any job link — an ATS page, a
// career site, a board — goes through the same resolver the saved rows use (lib/server/listingResolve.js,
// SSRF-guarded on every hop), and its posting is read as if pasted.

/** The one URL a pasted text is, or null ("https://…", "jobs.lever.co/acme/…", a URL with a few words around it). */
export function postingLink(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 600) return null;
  const urls = t.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}\/[^\s<>"']+/gi) || [];
  if (urls.length !== 1) return null;
  // a link with a short note ("here's the job: …") is a link; a paragraph that cites a URL is a posting
  const rest = t.replace(urls[0], ' ').trim();
  if (rest.split(/\s+/).filter(Boolean).length > 12) return null;
  const v = validateListingUrl(urls[0].replace(/[).,;]+$/, ''));
  return v.ok ? v.url : null;
}

const LINK_TTL_MS = 30 * 60 * 1000;
const linkCache = new Map(); // url → { at, result }
const linkInFlight = new Map();

/**
 * Read the posting behind a pasted link.
 * @returns {Promise<{ ok: true, url: string, description: string, title: string, company: string } | { ok: false, url: string, reason: 'gone'|'unreachable'|'thin' }>}
 */
export async function readPostingLink(url, { resolve = resolveListing, timeoutMs = 20000 } = {}) {
  const hit = linkCache.get(url);
  if (hit && Date.now() - hit.at < LINK_TTL_MS) return hit.result;
  if (linkInFlight.has(url)) return linkInFlight.get(url);
  const p = (async () => {
    const v = validateListingUrl(url);
    if (!v.ok) return { ok: false, url, reason: 'unreachable' };
    const urls = postingUrls(v.url).map((u) => validateListingUrl(u)).filter((x) => x.ok);
    let gone = false, unreachable = 0, best = null;
    for (const cand of urls) {
      let out;
      try { out = await withTimeout(resolve(cand), timeoutMs); } catch { unreachable++; continue; }
      const f = fieldsOf(out);
      if (closedRung(out)) gone = true;
      const text = String(cleanDescription(String(f.description || '')) || '').trim();
      if (text.length >= MIN_FULL_POSTING && !isDescriptionPreview({ source: null, description: text })) { best = { ok: true, url, description: text, title: String(f.title || ''), company: String(f.company || '') }; break; }
    }
    const result = best || { ok: false, url, reason: gone ? 'gone' : unreachable === urls.length ? 'unreachable' : 'thin' };
    linkCache.set(url, { at: Date.now(), result });
    if (linkCache.size > 300) linkCache.delete(linkCache.keys().next().value);
    return result;
  })().finally(() => linkInFlight.delete(url));
  linkInFlight.set(url, p);
  return p;
}
