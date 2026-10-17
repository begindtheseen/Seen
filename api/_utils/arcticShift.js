// Arctic Shift — the public Reddit archive (https://arctic-shift.photon-reddit.com) — as the
// FALLBACK Reddit source for self-filling company pages (lib/server/companyEnrichmentWorker.js).
//
// WHY: Reddit rate-limits / blocks datacenter IPs. The first production enrichment run (Sheetz,
// 2026-10-17) got HTTP 429 from www.reddit.com on Vercel, and the one-time credit backfill gets 403
// from cloud runners. The archive serves the same posts and comments as JSON, so when Reddit refuses
// us the worker reads the archive instead and everything downstream (relevance gate, extraction,
// validation, report shape, permalink attribution) is unchanged — the content is still Reddit's.
//
// PROVENANCE: ported (not imported) from scripts/credit/lib/arcticShift.mjs — production must not
// depend on the offline credit scripts. Behaviour verified against the live API on 2026-10-17:
//   • posts/search REQUIRES `subreddit`; full-text `query` / `title` in very active subreddits need a
//     time window, and an overloaded server answers HTTP 422 {"data":null,"error":"Timeout. Maybe slow
//     down a bit"} (usually in < 1s); over the rate limit it answers {"error":"Too many requests"}.
//   • `permalink` is NOT an accepted `fields` value (postToItem rebuilds it from id + subreddit).
//   • comments/tree?link_id=t3_<id> answers {"data":[…]}; nodes are {kind:'t1', data:{…}} or bare.
//   • headers: x-ratelimit-remaining, x-ratelimit-reset (seconds until reset).
//
// Pure helpers + an injected-I/O fetcher, unit-tested offline in api/_utils/arcticShift.test.mjs.

import { RunStop, decodeEntities, redactPII } from './companyEnrichment.js';

export const ARCTIC_BASE = 'https://arctic-shift.photon-reddit.com';
export const ARCTIC_UA = 'SeenJobs/1.0 hiring-transparency (+https://seenjobs.io)';
// The four subreddits that carry most first-hand hiring stories (same as the backfill's --quick).
export const ARCTIC_SUBREDDITS = ['recruitinghell', 'jobs', 'cscareerquestions', 'antiwork'];
export const POST_FIELDS = 'id,subreddit,title,selftext,author,created_utc,num_comments';

export const ARCTIC_DEFAULTS = {
  searchLimit: 100,      // posts per search (API max)
  treeLimit: 100,        // comment nodes per thread (we keep ≤ commentsPerThread)
  windowDays: 365,       // full-text search window — unbounded searches time out in big subreddits
  intervalMs: 1500,      // ≥1.5s between any two archive requests (sequential; volunteer-run service)
  timeoutMs: 20_000,     // per request, further clamped to the company's remaining budget
  maxResetWaitMs: 20_000,// wait out a rate-limit window only when it is this short; else stop the run
};

const BOT_AUTHORS = new Set(['automoderator', 'reddit']);
const DEAD = new Set(['[deleted]', '[removed]', '']);
const isDead = (s) => DEAD.has(String(s ?? '').trim().toLowerCase());
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// ── Text ─────────────────────────────────────────────────────────────────────────

/**
 * Reddit JSON bodies are Markdown with &, <, > entity-escaped once. Returns plain text: entities
 * decoded, links/images reduced to their label, heading/quote/emphasis/spoiler markers dropped,
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

/** {"data":[…]} | {"data":{"children":[…]}} | bare array | {"error":…} → { items, error }. */
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

export const isRateLimitError = (status, error) => status === 429 || /too many requests|rate.?limit/i.test(String(error || ''));

/** Milliseconds until the advertised rate-limit window resets (seconds-until-reset, or an epoch). */
export function resetDelayMs(getHeader, nowMs = Date.now()) {
  const reset = Number(getHeader('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    if (reset > 1e12) return Math.max(0, reset - nowMs);
    if (reset > 1e9) return Math.max(0, reset * 1000 - nowMs);
    return reset * 1000;
  }
  const at = Number(getHeader('x-ratelimit-reset-at'));
  if (Number.isFinite(at) && at > 0) return Math.max(0, (at > 1e12 ? at : at * 1000) - nowMs);
  const ra = Number(getHeader('retry-after'));
  return Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
}

// ── Polite fetcher ───────────────────────────────────────────────────────────────

/**
 * One sequential gate for every archive request: ≥intervalMs between request starts; each request's
 * timeout is clamped to the time left before `deadlineAt()`. Rate limit (429 / "Too many requests")
 * → wait for the advertised reset ONCE when it is ≤ maxResetWaitMs and fits the budget, else throw
 * RunStop('arctic_429') so the worker stops the run and requeues (attempts refunded). A nearly
 * exhausted x-ratelimit-remaining pushes the next request past the reset the same way. No other
 * retries — a search that times out server-side is the caller's to fall back from (query → title).
 * get(path, params) → { ok, status, items, error }.
 */
export function createArcticFetcher({
  fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(),
  intervalMs = ARCTIC_DEFAULTS.intervalMs, timeoutMs = ARCTIC_DEFAULTS.timeoutMs,
  maxResetWaitMs = ARCTIC_DEFAULTS.maxResetWaitMs, base = ARCTIC_BASE, deadlineAt = () => Infinity,
} = {}) {
  let nextAt = 0;
  const stats = { requests: 0, r429: 0, errors: 0 };

  async function gate() {
    const wait = nextAt - now();
    if (wait > 0) {
      if (now() + wait >= deadlineAt()) throw new RunStop('deadline');
      await sleep(wait);
    }
    if (now() >= deadlineAt()) throw new RunStop('deadline');
    nextAt = now() + intervalMs;
  }

  async function get(path, params = {}) {
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    let waitedForReset = false;
    for (;;) {
      await gate();
      stats.requests++;
      const budget = Math.max(1000, Math.min(timeoutMs, deadlineAt() - now()));
      let res;
      try {
        res = await fetchImpl(url, { headers: { 'User-Agent': ARCTIC_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(budget) });
      } catch (e) {
        stats.errors++;
        return { ok: false, status: 0, items: [], error: e?.name === 'TimeoutError' ? 'client_timeout' : 'network' };
      }
      const hdr = (k) => res.headers?.get?.(k) ?? null;
      let text = '';
      try { text = await res.text(); } catch { /* treated as bad_json below */ }
      let parsed;
      try { parsed = parseArcticResponse(JSON.parse(text)); } catch { parsed = { items: [], error: 'bad_json' }; }

      if (isRateLimitError(res.status, parsed.error)) {
        stats.r429++;
        const wait = Math.max(resetDelayMs(hdr, now()), intervalMs);
        if (!waitedForReset && wait <= maxResetWaitMs && now() + wait < deadlineAt()) {
          waitedForReset = true;
          nextAt = Math.max(nextAt, now() + wait);
          continue;
        }
        throw new RunStop('arctic_429');
      }
      const remainingRaw = hdr('x-ratelimit-remaining');
      if (remainingRaw !== null && Number(remainingRaw) < 2) {
        const wait = resetDelayMs(hdr, now());
        if (wait > 0) nextAt = Math.max(nextAt, now() + wait);
      }
      if (res.ok && !parsed.error) return { ok: true, status: res.status, items: parsed.items, error: null };
      stats.errors++;
      return { ok: false, status: res.status, items: [], error: parsed.error || `http_${res.status}` };
    }
  }
  return { get, stats };
}

// ── Discovery ────────────────────────────────────────────────────────────────────

/** posts/search params per subreddit for `name`: one `windowDays` window ending now. */
export function arcticSearchQueries(name, { nowMs = Date.now(), subreddits = ARCTIC_SUBREDDITS, windowDays = ARCTIC_DEFAULTS.windowDays, limit = ARCTIC_DEFAULTS.searchLimit } = {}) {
  const term = String(name || '').replace(/["\\]/g, '').trim();
  const before = Math.floor(nowMs / 1000);
  const after = before - windowDays * 86_400;
  return subreddits.map((sub) => ({
    sub, term,
    params: { subreddit: sub, limit: String(limit), sort: 'desc', fields: POST_FIELDS, after: String(after), before: String(before) },
  }));
}

/**
 * Archive post → the search-item shape selectThreads / rankAndFilter read
 * ({ id, title, subreddit, permalink, created, _body }). The author is returned SEPARATELY (OP
 * detection only) and never put on the item.
 */
export function postToItem(p) {
  if (!p || typeof p !== 'object') return null;
  const id = String(p.id || '').replace(/^t3_/, '');
  const subreddit = String(p.subreddit || '').replace(/^r\//, '');
  if (!/^[a-z0-9]{2,12}$/i.test(id) || !/^[A-Za-z0-9_]{2,32}$/.test(subreddit)) return null;
  const ts = Number(p.created_utc);
  return {
    item: {
      id, subreddit,
      permalink: `https://www.reddit.com/r/${subreddit}/comments/${id}/`,
      title: decodeEntities(p.title || '').trim(),
      created: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : '',
      _body: cleanRedditMarkdown(p.selftext),
    },
    author: String(p.author || ''),
  };
}

// ── Comment trees ────────────────────────────────────────────────────────────────

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
 * Flatten a comments/tree response (depth-first, API order) into the worker's comment list — the
 * same shape parseThreadFeed returns: `more` stubs, bots, deleted and near-empty bodies dropped
 * (their replies still visited); Markdown cleaned, PII redacted, clipped; OP replies flagged.
 * Returns [{ id, is_op, body }] — authors never leave this function.
 */
export function flattenCommentTree(nodes, { postAuthor = '', maxComments = 25, maxChars = 1000 } = {}) {
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

/**
 * Discover candidate threads for `name` in the archive: per subreddit, full-text `query`, falling
 * back to `title` when the server times out. Returns { answered, items, authors, searches }
 * (`answered` = at least one search succeeded; `authors` = thread id → post author, OP flag only).
 * Throws RunStop('arctic_429' | 'deadline') from the fetcher.
 */
export async function discoverArctic(name, { fetcher, nowMs = Date.now(), subreddits } = {}) {
  const byId = new Map();
  const authors = new Map();
  const searches = [];
  let answered = false;
  for (const q of arcticSearchQueries(name, { nowMs, ...(subreddits ? { subreddits } : {}) })) {
    for (const p of ['query', 'title']) {
      const r = await fetcher.get('/api/posts/search', { ...q.params, [p]: q.term });
      searches.push({ sub: q.sub, param: p, ok: r.ok, n: r.items.length, ...(r.ok ? {} : { error: String(r.error).slice(0, 80) }) });
      if (!r.ok) continue;
      answered = true;
      for (const post of r.items) {
        const conv = postToItem(post);
        if (conv && !byId.has(conv.item.id)) { byId.set(conv.item.id, conv.item); authors.set(conv.item.id, conv.author); }
      }
      break;
    }
  }
  return { answered, items: [...byId.values()], authors, searches };
}
