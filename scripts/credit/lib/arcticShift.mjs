// Arctic Shift source for the Reddit backfill's `fetch` phase (scripts/credit/reddit-backfill.mjs).
//
// Why: www/old.reddit.com answer HTTP 403 to our cloud runner (Reddit blocks the IP range), while
// Arctic Shift — a public Reddit archive, https://arctic-shift.photon-reddit.com — answers 200. This
// module discovers threads per target via /api/posts/search, pulls each kept thread's comments via
// /api/comments/tree, and produces EXACTLY the cache document the RSS path (fetchTarget in
// reddit.mjs) produces, so the extract / sample / write phases are unchanged:
//   { target, complete, fetchedAt, searches, skippedImported, threads[], chars } where each thread is
//   { id, subreddit, title, permalink, created, body, comments[{id, is_op, body}], comments_fetched, feed_status }.
//
// Relevance is decided by the SAME gate as the RSS path (selectThreads: production isRelevant /
// scoreRelevance for every spelling + a full-phrase mention + cap). Usernames are read only to drop
// bots and flag OP replies; they never enter the cache or anything sent to the model.
//
// Response details NOT verifiable from the sandbox that wrote this (see the README's Arctic Shift
// notes; the pilot `fetch --companies 0 --only "insight global"` verifies them): the {"data":[…]} /
// {"error":"…"} envelope, the comments/tree node shape, epoch-second after/before, the `fields`
// filter on posts/search, and X-RateLimit-Reset being seconds-until-reset. Each is handled
// defensively (bare arrays, Listing-wrapped replies, epoch/ISO reset headers) so a mismatch shows up
// as counted errors in the per-target log, not as silently wrong data.

import { DEFAULTS, JOB_SUBREDDITS, decodeEntities, redactPII, selectThreads } from './reddit.mjs';

export const ARCTIC_BASE = 'https://arctic-shift.photon-reddit.com';
export const ARCTIC_UA = 'SeenJobs/1.0 hiring-transparency research backfill (+https://seenjobs.io)';

// Full-text `query`/`title` filters are "not supported for very active subreddits" and time out
// there, so these get narrowed 1-year windows; the rest of JOB_SUBREDDITS are searched all-time.
export const ACTIVE_SUBREDDITS = ['recruitinghell', 'jobs', 'antiwork', 'cscareerquestions', 'WorkReform', 'ExperiencedDevs'];
export const QUIET_SUBREDDITS = JOB_SUBREDDITS.filter((s) => !ACTIVE_SUBREDDITS.includes(s));
// --quick (breadth runs): only the four subreddits that carry most first-hand hiring stories, one
// 1-year window each, no quieter subreddits — 4 searches per target instead of 10 + 6 × windows.
export const QUICK_SUBREDDITS = ['recruitinghell', 'jobs', 'cscareerquestions', 'antiwork'];

/** Discovery scope for a run: { quietSubs, activeSubs, windows }. quick forces 1 window. */
export function discoveryScope({ quick = false, windows = ARCTIC_DEFAULTS.activeWindows } = {}) {
  return quick
    ? { quietSubs: [], activeSubs: [...QUICK_SUBREDDITS], windows: 1 }
    : { quietSubs: [...QUIET_SUBREDDITS], activeSubs: [...ACTIVE_SUBREDDITS], windows };
}

export const ARCTIC_DEFAULTS = {
  searchLimit: 100,     // posts per search (API max)
  treeLimit: 200,       // comment nodes per thread tree request (we keep ≤ DEFAULTS.commentsPerThread)
  activeWindows: 1,     // 1-year windows, newest first, per very active subreddit (was 3; 1 for breadth — --windows 3 for depth)
  intervalMs: 1000,     // minimum gap between ANY two Arctic Shift requests (shared by all workers)
  concurrency: 2,
  retryDelayMs: 5000,   // pause before the single retry of a timed-out / failed query
  timeoutMs: 60_000,    // client-side; server-side "Query timed out" usually comes back sooner
  breakerAfter: 3,      // consecutive failed `query` searches in one scope → use `title` there
};

// Only what selection + caching need (keeps responses small for a volunteer-run service).
// `permalink` is NOT an accepted field (live API: "invalid field"); postToItem rebuilds it from id + subreddit.
export const POST_FIELDS = 'id,subreddit,title,selftext,author,created_utc,num_comments';

const YEAR_S = 365 * 86_400;
const BOT_AUTHORS = new Set(['automoderator', 'reddit']);
const DEAD = new Set(['[deleted]', '[removed]', '']);
const isDead = (s) => DEAD.has(String(s ?? '').trim().toLowerCase());
function clip(s, n) { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }

// ── Text ─────────────────────────────────────────────────────────────────────────

/**
 * Reddit JSON bodies are Markdown with &, <, > entity-escaped once. Returns plain text: entities
 * decoded once, links/images reduced to their label, heading/quote/emphasis/spoiler markers dropped,
 * zero-width spaces removed. "[deleted]" / "[removed]" → ''.
 */
export function cleanRedditMarkdown(md) {
  if (isDead(md)) return '';
  let s = decodeEntities(md).replace(/\u200b/g, '');
  s = s.replace(/!?\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1');
  s = s.replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|(?:>[ \t]?)+)/gm, '');
  s = s.replace(/\*\*|__|~~|>!|!</g, '');
  s = s.replace(/^[ \t]*[*+][ \t]+/gm, '- ');
  s = s.replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ── Responses ────────────────────────────────────────────────────────────────────

/**
 * Normalize an Arctic Shift JSON body. Accepts {"data":[…]}, {"data":{"children":[…]}}, a bare
 * array, and {"error": "…"} (string or object). Returns { items, error }.
 */
export function parseArcticResponse(json) {
  if (Array.isArray(json)) return { items: json, error: null };
  if (!json || typeof json !== 'object') return { items: [], error: 'bad_shape' };
  if (json.error) {
    const e = json.error;
    return { items: [], error: typeof e === 'string' ? e : String(e.message || e.detail || JSON.stringify(e)) };
  }
  const d = json.data;
  if (Array.isArray(d)) return { items: d, error: null };
  if (d && Array.isArray(d.children)) return { items: d.children, error: null };
  if (d === null) return { items: [], error: null };
  return { items: [], error: 'bad_shape' };
}

// Is a failed request worth one retry? Timeouts, 5xx, network errors and unparseable bodies are
// usually transient ("retry once the DB warms up"); a plain 4xx is not.
export function isRetryable(status, error) {
  if (status === 0 || status >= 500) return true;
  return /time[sd]?[\s_-]*out|timeout|try again|bad_json|^network/i.test(String(error || ''));
}

// Milliseconds until the advertised rate-limit window resets, or 0 if no hint. X-RateLimit-Reset is
// read as seconds-until-reset, but an epoch (s or ms) is recognized too; X-RateLimit-Reset-At may be
// an epoch or an ISO date; Retry-After (seconds) is the last fallback.
export function resetDelayMs(getHeader, nowMs = Date.now()) {
  const reset = Number(getHeader('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    if (reset > 1e12) return Math.max(0, reset - nowMs);
    if (reset > 1e9) return Math.max(0, reset * 1000 - nowMs);
    return reset * 1000;
  }
  const at = getHeader('x-ratelimit-reset-at');
  if (at) {
    const n = Number(at);
    const t = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : Date.parse(at);
    if (Number.isFinite(t)) return Math.max(0, t - nowMs);
  }
  const ra = Number(getHeader('retry-after'));
  return Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
}

// ── Polite fetcher ───────────────────────────────────────────────────────────────

/**
 * One shared gate for every Arctic Shift request: ≥intervalMs between request starts (across all
 * workers); 429 → wait for the advertised reset (else 10s/30s/60s), up to 3 times; nearly-exhausted
 * budget → wait for the reset; a retryable failure (timeout / 5xx / network / bad JSON / an
 * {"error":"Query timed out"} body) is retried ONCE after retryDelayMs, then given up and counted.
 * get(path, params) → { ok, status, items, error, retried }.
 */
export function createArcticFetcher({
  fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(),
  intervalMs = ARCTIC_DEFAULTS.intervalMs, base = ARCTIC_BASE, retryDelayMs = ARCTIC_DEFAULTS.retryDelayMs,
  timeoutMs = ARCTIC_DEFAULTS.timeoutMs, log = () => {},
} = {}) {
  let nextAt = 0;
  const stats = { requests: 0, r429: 0, errors: 0, retries: 0, failed: 0 };
  async function gate() {
    for (;;) {
      const wait = nextAt - now();
      if (wait <= 0) break;
      await sleep(wait);
    }
    nextAt = now() + intervalMs;
  }
  const BACKOFF = [10_000, 30_000, 60_000];
  const urlFor = (path, params = {}) => `${base}${path}?${new URLSearchParams(params)}`;

  async function get(path, params) {
    const url = urlFor(path, params);
    let n429 = 0, retried = false;
    for (;;) {
      await gate();
      stats.requests++;
      let status = 0, error, items = [];
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': ARCTIC_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
        status = res.status;
        const hdr = (k) => res.headers?.get?.(k) ?? null;
        if (status === 429) {
          stats.r429++;
          if (n429 < BACKOFF.length) {
            const wait = Math.max(resetDelayMs(hdr, now()), BACKOFF[n429]);
            n429++;
            log(`  429 from Arctic Shift — backing off ${Math.round(wait / 1000)}s`);
            nextAt = Math.max(nextAt, now() + wait);
            continue;
          }
          error = 'rate_limited';
        } else {
          const remaining = Number(hdr('x-ratelimit-remaining'));
          if (hdr('x-ratelimit-remaining') !== null && Number.isFinite(remaining) && remaining < 2) {
            const wait = resetDelayMs(hdr, now());
            if (wait > 0) nextAt = Math.max(nextAt, now() + wait);
          }
          const text = await res.text();
          let json;
          try { json = JSON.parse(text); } catch { json = undefined; }
          const env = json === undefined ? { items: [], error: 'bad_json' } : parseArcticResponse(json);
          if (res.ok && !env.error) return { ok: true, status, items: env.items, error: null, retried };
          // A non-2xx without a real {"error"} message is described by its status, not its body shape.
          const realError = env.error && env.error !== 'bad_shape' && env.error !== 'bad_json';
          error = res.ok || realError ? env.error : `http_${status}`;
          items = [];
        }
      } catch (e) {
        error = e?.name === 'TimeoutError' ? 'client_timeout' : `network: ${e?.message || e}`;
      }
      stats.errors++;
      if (!retried && error !== 'rate_limited' && isRetryable(status, error)) {
        retried = true;
        stats.retries++;
        log(`  Arctic Shift ${path} failed (${error}) — retrying once in ${Math.round(retryDelayMs / 1000)}s`);
        nextAt = Math.max(nextAt, now() + retryDelayMs);
        continue;
      }
      stats.failed++;
      return { ok: false, status, items, error, retried };
    }
  }
  return { get, stats, urlFor };
}

// ── Discovery ────────────────────────────────────────────────────────────────────

/**
 * The posts/search queries for one target, in order: global (no subreddit) all-time; each quieter
 * job subreddit all-time; each very active job subreddit in `windows` 1-year windows, newest first.
 * The text filter (`query`, falling back to `title`) is added at call time by searchWithFallback.
 * Returns [{ name, scope, term, params }].
 */
export function discoveryQueries(target, {
  nowSec = Math.floor(Date.now() / 1000), limit = ARCTIC_DEFAULTS.searchLimit, windows = ARCTIC_DEFAULTS.activeWindows,
  quietSubs = QUIET_SUBREDDITS, activeSubs = ACTIVE_SUBREDDITS, includeGlobal = false,
} = {}) {
  const term = String(target.searchTerm).replace(/["\\]/g, '').trim();
  const base = { limit: String(limit), sort: 'desc', fields: POST_FIELDS };
  // The live API rejects posts/search without a subreddit ("global search needs a subreddit"), so the
  // global query is opt-in only (kept for an API that allows it later).
  const qs = includeGlobal ? [{ name: 'global', scope: 'global', term, params: { ...base } }] : [];
  for (const sub of quietSubs) qs.push({ name: `r/${sub}`, scope: sub, term, params: { ...base, subreddit: sub } });
  for (const sub of activeSubs) {
    for (let w = 0; w < windows; w++) {
      const before = nowSec - w * YEAR_S;
      qs.push({ name: `r/${sub}@${w}-${w + 1}y`, scope: sub, term, params: { ...base, subreddit: sub, after: String(before - YEAR_S), before: String(before) } });
    }
  }
  return qs;
}

/**
 * Cross-target memory of which scopes reject full-text `query`. After `breakerAfter` consecutive
 * failed `query` searches in one scope (subreddit or 'global'), that scope goes straight to `title`
 * for the rest of the run instead of paying a doomed request (+ retry) per target.
 */
export function createDiscoveryState({ breakerAfter = ARCTIC_DEFAULTS.breakerAfter, log = () => {} } = {}) {
  const fails = new Map();
  return {
    titleOnly: (scope) => (fails.get(scope) || 0) >= breakerAfter,
    queryOk: (scope) => { fails.set(scope, 0); },
    queryFailed: (scope) => {
      const n = (fails.get(scope) || 0) + 1;
      fails.set(scope, n);
      if (n === breakerAfter) log(`  Arctic Shift: \`query\` failed ${n}× in a row for ${scope} — using \`title\` there from now on`);
    },
  };
}

// One discovery query: `query` (title + body), falling back to `title` when it fails.
export async function searchWithFallback(q, { fetcher, state }) {
  const params = state.titleOnly(q.scope) ? ['title'] : ['query', 'title'];
  const errors = [];
  for (const p of params) {
    const r = await fetcher.get('/api/posts/search', { ...q.params, [p]: q.term });
    if (p === 'query') (r.ok ? state.queryOk : state.queryFailed)(q.scope);
    if (r.ok) return { ok: true, status: r.status, param: p, items: r.items, errors };
    errors.push(`${p}: ${r.error}`);
  }
  return { ok: false, status: 0, param: null, items: [], errors };
}

// Arctic Shift post → the search-item shape selectThreads / isRelevant read
// ({ id, title, subreddit, permalink, created, _body }). The author is returned SEPARATELY (OP
// detection only) and never put on the item.
export function postToItem(p) {
  if (!p || typeof p !== 'object') return null;
  const id = String(p.id || '').replace(/^t3_/, '');
  const subreddit = String(p.subreddit || '').replace(/^r\//, '');
  if (!/^[a-z0-9]+$/i.test(id) || !subreddit) return null;
  const perm = String(p.permalink || '');
  const permalink = /^https?:\/\//i.test(perm) ? perm
    : perm.startsWith('/') ? `https://www.reddit.com${perm}`
      : `https://www.reddit.com/r/${subreddit}/comments/${id}/`;
  const ts = Number(p.created_utc);
  return {
    item: {
      id, subreddit, permalink,
      title: decodeEntities(p.title || '').trim(),
      created: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : '',
      _body: cleanRedditMarkdown(p.selftext),
    },
    author: String(p.author || ''),
  };
}

// ── Comment trees ────────────────────────────────────────────────────────────────

// A tree node is {kind:'t1', data:{…}} (Reddit listing style) or a bare comment object; collapsed
// branches are {kind:'more', …}. Replies may be an array, a Listing {data:{children}}, or ''.
function unwrapComment(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.kind === 'more') return null;
  if (node.kind && node.data && typeof node.data === 'object') return node.kind === 't1' ? node.data : null;
  return 'body' in node ? node : null;
}
function repliesOf(c) {
  const r = c.replies;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.data?.children)) return r.data.children;
  if (r && Array.isArray(r.children)) return r.children;
  if (Array.isArray(c.children) && c.children.some((x) => x && typeof x === 'object')) return c.children;
  return [];
}

/**
 * Flatten a comments/tree response (depth-first, API order) into the cache's comment list:
 * `more` stubs, bots, "[deleted]"/"[removed]" bodies and near-empty bodies dropped (their replies
 * are still visited); Markdown cleaned, PII redacted, each body clipped; OP replies flagged; capped.
 * Returns [{ id, is_op, body }] — no author field.
 */
export function flattenCommentTree(nodes, { postAuthor = '', maxComments = DEFAULTS.commentsPerThread, maxChars = DEFAULTS.charsPerComment } = {}) {
  const op = isDead(postAuthor) ? '' : String(postAuthor);
  const out = [];
  const visit = (list) => {
    for (const node of Array.isArray(list) ? list : []) {
      if (out.length >= maxComments) return;
      const c = unwrapComment(node);
      if (!c) continue;
      const author = String(c.author || '');
      if (!BOT_AUTHORS.has(author.toLowerCase()) && !isDead(c.body)) {
        const body = clip(redactPII(cleanRedditMarkdown(c.body)), maxChars);
        if (body.length >= 15 && !/\bI am a bot\b/i.test(body)) {
          out.push({ id: String(c.id || '').replace(/^t1_/, '') || `c${out.length}`, is_op: !!op && author === op, body });
        }
      }
      visit(repliesOf(c));
    }
  };
  visit(nodes);
  return out.slice(0, maxComments);
}

// ── Fetch one target (discover → select → comment trees) ─────────────────────────

/**
 * Returns the cache document for the target — same shape as fetchTarget (reddit.mjs) plus
 * `source: 'arctic'` and `skippedQueries` (queries that failed even after retry + title fallback).
 * Shortcut: when the global `query` search answers with fewer than `limit` posts, that IS the
 * all-time result set and every per-subreddit query would be a subset of it, so they're skipped
 * (fullDiscovery: true disables this).
 */
export async function fetchArcticTarget(target, {
  fetcher, state = createDiscoveryState(), importedIds = new Set(), threadsCap = DEFAULTS.threadsPerTarget,
  limits = {}, nowSec = Math.floor(Date.now() / 1000), windows = ARCTIC_DEFAULTS.activeWindows,
  limit = ARCTIC_DEFAULTS.searchLimit, treeLimit = ARCTIC_DEFAULTS.treeLimit, fullDiscovery = false, includeGlobal = false, log = () => {},
  quietSubs = QUIET_SUBREDDITS, activeSubs = ACTIVE_SUBREDDITS,
}) {
  const { maxComments = DEFAULTS.commentsPerThread, maxChars = DEFAULTS.charsPerComment, opMaxChars = DEFAULTS.charsOp } = limits;
  const byId = new Map();
  const authors = new Map(); // thread id → post author, in memory only (OP flag)
  const searches = {};
  let skippedQueries = 0, rawItems = 0, shortcut = false;
  for (const q of discoveryQueries(target, { nowSec, limit, windows, includeGlobal, quietSubs, activeSubs })) {
    const r = await searchWithFallback(q, { fetcher, state });
    searches[q.name] = { ok: r.ok, param: r.param, items: r.items.length, ...(r.errors.length ? { errors: r.errors } : {}) };
    if (!r.ok) skippedQueries++;
    for (const p of r.items) {
      const conv = postToItem(p);
      if (!conv) continue;
      rawItems++;
      if (!byId.has(conv.item.id)) { byId.set(conv.item.id, conv.item); authors.set(conv.item.id, conv.author); }
    }
    if (q.scope === 'global' && r.ok && r.param === 'query' && r.items.length < limit && !fullDiscovery) { shortcut = true; break; }
  }
  const items = [...byId.values()];
  const selected = selectThreads(items, target, threadsCap + importedIds.size);
  const skippedImported = selected.filter((t) => importedIds.has(t.id)).map((t) => t.id);
  const fresh = selected.filter((t) => !importedIds.has(t.id)).slice(0, threadsCap);
  const threads = [];
  for (const t of fresh) {
    const r = await fetcher.get('/api/comments/tree', { link_id: `t3_${t.id}`, limit: String(treeLimit) });
    const comments = r.ok ? flattenCommentTree(r.items, { postAuthor: authors.get(t.id), maxComments, maxChars }) : [];
    threads.push({
      id: t.id, subreddit: t.subreddit, title: redactPII(t.title), permalink: t.permalink, created: t.created,
      body: clip(redactPII(t.snippet), opMaxChars), comments, comments_fetched: r.ok, feed_status: r.status,
    });
  }
  const chars = threads.reduce((n, t) => n + t.title.length + t.body.length + t.comments.reduce((m, c) => m + c.body.length, 0), 0);
  const nq = Object.keys(searches).length;
  log(`  ${target.displayName}: ${nq} searches${shortcut ? ' (global result complete — per-subreddit searches skipped)' : ''}${skippedQueries ? ` · ${skippedQueries} failed+skipped` : ''} · ${rawItems} posts → ${items.length} unique → ${threads.length} threads (${skippedImported.length} already imported) · ${chars.toLocaleString()} chars`);
  // Only a target whose searches actually answered is "done"; an all-failed target is retried next run.
  const complete = Object.values(searches).some((s) => s.ok);
  return { target, source: 'arctic', complete, fetchedAt: new Date().toISOString(), searches, skippedQueries, skippedImported, threads, chars };
}
