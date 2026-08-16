// Reddit JSON transport — free, unauthenticated, on our own terms.
//
// WHY THIS EXISTS: the previous ingest scraped RSS/Atom and regex-parsed XML out of it
// (api/reports.js parseRedditAtom). That transport gives a title and a truncated,
// tag-stripped body and nothing else — no score, no comment count, no timestamp, no author,
// no permalink — so downstream aggregation had almost nothing to weigh. Reddit serves the
// same content as plain JSON on any listing URL by appending `.json`, with no auth and no
// API registration. This module is that transport.
//
// DESIGN RULES, each one a reaction to a measured failure in the RSS pipeline:
//   1. NEVER return a bare [] on failure. Every function returns a result envelope carrying
//      { ok, status, items, error }. The old code did `if (!r.ok) return []`, which made a
//      blocked fetch indistinguishable from an empty subreddit and wrote 630 posts to the DB
//      as "no_experiences_extracted" over two months. A zero must always say why it is zero.
//   2. `raw_json=1` on every request. Without it Reddit HTML-escapes &, < and > inside
//      selftext, so text arrives as "AT&amp;T" and company matching silently misses.
//   3. Host fallback www → old. Different edge caches rate-limit independently; old.reddit
//      frequently answers when www is throttling.
//   4. 429 is retried with real backoff; 403 is NOT retried (it is an IP-level block and
//      hammering it makes the block worse). They are different failures and are reported as
//      different statuses.
//
// Parsing is deliberately split from fetching (normalizeListing / normalizePost are pure) so
// the shape logic is unit-testable without a network — the classification half is exactly
// where the previous probes went wrong.

const HOSTS = ['https://www.reddit.com', 'https://old.reddit.com'];

// Reddit throttles generic user-agents hard and asks for a descriptive one. This identifies
// the app and gives them a contact surface, which is the difference between "unknown bot"
// (aggressively limited) and a recognisable client.
const USER_AGENT = 'web:io.seenjobs.aggregator:v1.0 (+https://seenjobs.io)';

const BACKOFF_MS = [1000, 4000, 12000];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetch one Reddit JSON URL path across hosts, with honest failure reporting.
 * @param {string} path  path beginning with '/', WITHOUT the .json suffix or query
 * @param {object} query query params (raw_json is forced on)
 * @returns {Promise<{ok:boolean,status:number|null,data:any,host:string|null,error:string|null,attempts:number}>}
 */
export async function fetchRedditJson(path, query = {}, opts = {}) {
  const { timeoutMs = 10000, retries = BACKOFF_MS.length } = opts;
  const qs = new URLSearchParams({ ...query, raw_json: '1' }).toString();
  let attempts = 0;
  let last = { ok: false, status: null, data: null, host: null, error: 'not attempted', attempts: 0 };

  for (const host of HOSTS) {
    for (let retry = 0; retry <= retries; retry++) {
      attempts++;
      const url = `${host}${path}.json?${qs}`;
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (r.status === 429) {
          last = { ok: false, status: 429, data: null, host, error: 'rate limited', attempts };
          if (retry < retries) { await sleep(BACKOFF_MS[retry]); continue; }
          break; // exhausted retries on this host → try the next host
        }
        // 403/451 are IP- or policy-level blocks. Retrying deepens the block and burns the
        // invocation budget, so fail over to the next host immediately instead.
        if (r.status === 403 || r.status === 451) {
          last = { ok: false, status: r.status, data: null, host, error: 'blocked', attempts };
          break;
        }
        if (!r.ok) {
          last = { ok: false, status: r.status, data: null, host, error: `HTTP ${r.status}`, attempts };
          if (r.status >= 500 && retry < retries) { await sleep(BACKOFF_MS[retry]); continue; }
          break;
        }

        const text = await r.text();
        let data;
        try { data = JSON.parse(text); }
        catch {
          // A 200 carrying HTML is Reddit's interstitial / block page, not data. Reporting it
          // as a parse error rather than an empty result keeps the silent-zero away.
          last = { ok: false, status: 200, data: null, host, error: 'non-json body (interstitial?)', attempts };
          break;
        }
        return { ok: true, status: 200, data, host, error: null, attempts };
      } catch (e) {
        const msg = e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'network error');
        last = { ok: false, status: null, data: null, host, error: msg, attempts };
        break; // network-level problem with this host → next host
      }
    }
  }
  return last;
}

/** Reddit wraps every post in {kind:'t3', data:{…}}. Flatten to the fields aggregation needs. */
export function normalizePost(child) {
  const d = child?.data;
  if (!d || !d.id) return null;
  return {
    id:          d.name || `t3_${d.id}`,      // fullname, matches reddit_imports.reddit_post_id
    kind:        child.kind === 't1' ? 'comment' : 'post',
    subreddit:   d.subreddit || null,
    title:       (d.title || '').slice(0, 400),
    body:        (d.selftext || d.body || '').slice(0, 8000),
    author:      d.author && d.author !== '[deleted]' ? d.author : null,
    created_utc: d.created_utc ? Math.floor(d.created_utc) : null,
    score:       Number.isFinite(d.score) ? d.score : null,
    num_comments: Number.isFinite(d.num_comments) ? d.num_comments : null,
    upvote_ratio: Number.isFinite(d.upvote_ratio) ? d.upvote_ratio : null,
    permalink:   d.permalink ? `https://www.reddit.com${d.permalink}` : null,
    flair:       d.link_flair_text || null,
    over_18:     !!d.over_18,
    // Removed/deleted content still appears in listings with a tombstone body. Marking it
    // lets the harvester drop it instead of feeding "[removed]" to the classifier.
    removed:     d.removed_by_category != null || d.selftext === '[removed]' || d.selftext === '[deleted]',
  };
}

/** Flatten a Reddit Listing envelope → { items, after }. Tolerates the array form used by
 *  comment pages, where element 0 is the post listing and element 1 is the comment listing. */
export function normalizeListing(data) {
  if (Array.isArray(data)) {
    const out = [];
    for (const part of data) out.push(...normalizeListing(part).items);
    return { items: out, after: null };
  }
  const children = data?.data?.children;
  if (!Array.isArray(children)) return { items: [], after: null };
  const items = [];
  for (const c of children) {
    if (c?.kind === 'more') continue;          // "load more comments" stub, not content
    const p = normalizePost(c);
    if (p) items.push(p);
  }
  return { items, after: data?.data?.after || null };
}

/**
 * Newest posts in a subreddit. This is the firehose the harvester runs on: one call returns
 * up to 100 posts that are candidates for EVERY tracked company, which is why it yields where
 * per-company search does not.
 */
export async function listNew(sub, { limit = 100, after = null } = {}) {
  const q = { limit: String(Math.min(limit, 100)) };
  if (after) q.after = after;
  const res = await fetchRedditJson(`/r/${encodeURIComponent(sub)}/new`, q);
  if (!res.ok) return { ...res, items: [], after: null };
  const { items, after: next } = normalizeListing(res.data);
  return { ...res, items, after: next };
}

/** Top posts over a window — backfills the corpus with high-signal history, not just the last hour. */
export async function listTop(sub, { t = 'week', limit = 100, after = null } = {}) {
  const q = { limit: String(Math.min(limit, 100)), t };
  if (after) q.after = after;
  const res = await fetchRedditJson(`/r/${encodeURIComponent(sub)}/top`, q);
  if (!res.ok) return { ...res, items: [], after: null };
  const { items, after: next } = normalizeListing(res.data);
  return { ...res, items, after: next };
}

/** Targeted search. Kept for on-demand company lookups (company pages), NOT for bulk ingest —
 *  bulk ingest uses the firehose above, because searching 37,791 company names one at a time
 *  is what produced 0.09% coverage. */
export async function search({ q, sub = null, sort = 'new', t = 'year', limit = 100 } = {}) {
  const path  = sub ? `/r/${encodeURIComponent(sub)}/search` : '/search';
  const query = { q, sort, t, limit: String(Math.min(limit, 100)) };
  if (sub) query.restrict_sr = 'on';
  const res = await fetchRedditJson(path, query);
  if (!res.ok) return { ...res, items: [], after: null };
  const { items, after } = normalizeListing(res.data);
  return { ...res, items, after };
}

/** A single post plus its comment tree. Comments carry most of the hiring detail — the OP
 *  asks, the replies describe outcomes — so they are worth a second request per kept post. */
export async function postWithComments(sub, postId, { limit = 50 } = {}) {
  const base = String(postId).replace(/^t3_/, '');
  const res = await fetchRedditJson(
    `/r/${encodeURIComponent(sub)}/comments/${encodeURIComponent(base)}`,
    { limit: String(limit), depth: '2', sort: 'top' },
  );
  if (!res.ok) return { ...res, post: null, comments: [] };
  const all = normalizeListing(res.data).items;
  const post = all.find(i => i.kind === 'post') || null;
  const comments = all.filter(i => i.kind === 'comment' && !i.removed && i.body.trim());
  return { ...res, post, comments };
}

export const _internals = { HOSTS, USER_AGENT, BACKOFF_MS };
