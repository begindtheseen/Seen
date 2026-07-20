// LIVE, CACHED per-company Reddit search + a good-faith dispute/correction path.
//
// WHY: the company page's Reddit section used to fill ONLY for companies the slow batch
// cron (api/reports.js ?reddit_cron=…) reached, so most companies showed nothing. This
// endpoint searches Reddit's PUBLIC search RSS for a company on demand, caches the result
// per company (migration 054, 24h TTL; empties cached briefly), and serves the cache on
// repeat views. The page never blocks on it — the client fetches this asynchronously and
// shows a skeleton while the first (cache-miss) view resolves.
//
// DEFAMATION-SAFE: every item returned is an ATTRIBUTED LINK to a real public thread
// (title, subreddit, permalink, date). The UI frames the whole block as public third-party
// discussion (PUBLIC_DISCUSSION_LABEL), never Seen's assertion. Nothing here touches a
// company's score — the scored, Anthropic-classified Reddit-ingest path stays in
// api/reports.js and is not imported or modified. This endpoint is display + intake only.
//
// Service key is server-only (bypasses the RLS-on/no-policy tables); it is never exposed.

import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { broadcastActivity } from '../lib/server/realtime.js';
import {
  normalizeCompanyKey, isSearchableCompany, parseRedditSearchAtom, rankAndFilter,
  buildSearchUrl, needsBroadFallback, emptyStateDecision, ttlForStatus, cacheFresh,
  sanitizeDispute, MAX_ITEMS,
} from './_utils/companyReddit.js';

const REDDIT_UA = 'SeenJobs/1.0 RSS reader (+https://seenjobs.io)';
const REDDIT_HOSTS = ['https://www.reddit.com', 'https://old.reddit.com'];
const FETCH_TIMEOUT_MS = 6500;  // per Reddit request — keep the whole call inside the platform budget

// ── One Reddit search RSS request (single host), with a hard timeout ──────────────
// Returns { items, degraded } — degraded=true means the request failed/was throttled, so
// its empty result is NOT authoritative (must not be cached as a genuine "no discussion").
async function fetchOne(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': REDDIT_UA, Accept: 'application/rss+xml, application/atom+xml, text/xml' },
      signal: abort.signal,
    });
    if (r.status === 429 || !r.ok) return { items: [], degraded: true };  // throttled / error → not authoritative
    return { items: parseRedditSearchAtom(await r.text()), degraded: false };
  } catch {
    return { items: [], degraded: true };  // network error / timeout / abort → transient
  } finally {
    clearTimeout(timer);
  }
}

// Run one search query across the host fallbacks (www → old.reddit) until one answers with
// items. degraded=true only if EVERY host we tried failed/throttled (no authoritative reply).
async function searchQuery(companyName, broad) {
  let allDegraded = true;
  for (const host of REDDIT_HOSTS) {
    const { items, degraded } = await fetchOne(buildSearchUrl(companyName, { broad, host }));
    if (items.length) return { items, degraded: false };
    if (!degraded) allDegraded = false;   // an authoritative empty from at least one host
  }
  return { items: [], degraded: allDegraded };
}

// Live search: biased (job-context) query first; widen to a company-only query only if the
// biased pass came back thin. Returns { items, degraded }: items is the ranked/attributed/
// capped list; degraded=true means an empty result is untrustworthy (throttled/blocked) and
// the caller should serve stale / "checking" rather than cache it as a genuine empty.
async function liveSearch(companyName) {
  const biased = await searchQuery(companyName, false);
  let all = [...biased.items];
  let degraded = biased.degraded;
  let ranked = rankAndFilter(all, companyName, MAX_ITEMS);
  if (needsBroadFallback(ranked.length)) {
    const broad = await searchQuery(companyName, true);
    all = [...all, ...broad.items];
    degraded = biased.degraded && broad.degraded;   // authoritative if EITHER pass answered
    ranked = rankAndFilter(all, companyName, MAX_ITEMS);
  }
  return { items: ranked, degraded: ranked.length === 0 && degraded };
}

// ── Supabase cache I/O (service key; no-ops cleanly when DB is unconfigured) ───────
function dbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function readCache(url, key) {
  try {
    const r = await fetch(
      `${url}/rest/v1/company_reddit_cache?company_key=eq.${encodeURIComponent(key)}&select=company_key,company_name,items,item_count,status,fetched_at,expires_at&limit=1`,
      { headers: dbHeaders() },
    );
    return r.ok ? ((await r.json())?.[0] || null) : null;
  } catch { return null; }
}

async function writeCache(url, key, companyName, items, status) {
  try {
    const now = Date.now();
    await fetch(`${url}/rest/v1/company_reddit_cache?on_conflict=company_key`, {
      method: 'POST',
      headers: { ...dbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        company_key: key,
        company_name: String(companyName).slice(0, 200),
        items,
        item_count: items.length,
        status,
        fetched_at: new Date(now).toISOString(),
        expires_at: new Date(now + ttlForStatus(status)).toISOString(),
      }),
    });
  } catch { /* cache write is best-effort — a miss just re-fetches next time */ }
}

// ── Lookup: cache-first, live on miss/stale, stale-while-revalidate on Reddit failure ──
async function handleLookup(req, res, body) {
  const companyName = String(body.company ?? req.query?.company ?? '').trim();
  if (!isSearchableCompany(companyName)) {
    return res.status(400).json({ ok: false, error: 'A valid company name is required.' });
  }
  const dryRun = !!(body.dry_run || req.query?.dry_run);
  const key = normalizeCompanyKey(companyName);
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const hasDb = !!(SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

  // 1) Serve a fresh cache hit immediately (no Reddit call, no rate-limit charge).
  let stale = null;
  if (hasDb && !dryRun) {
    const row = await readCache(SUPABASE_URL, key);
    if (row && cacheFresh(row)) {
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      return res.status(200).json({
        ok: true, company: row.company_name, items: row.items || [],
        status: row.status || emptyStateDecision(row.items), cached: true, fetched_at: row.fetched_at,
      });
    }
    stale = row;   // keep any stale row to fall back on if the live fetch fails
  }

  // 2) Cache miss/stale → live fetch. Rate-limit ONLY this path (protects Reddit's anon quota).
  if (await applyRateLimit(req, res, 'company-reddit')) return;

  let result;
  try {
    result = await liveSearch(companyName);
  } catch (e) {
    logError('company-reddit/live', e, { company: key });
    result = null;
  }

  // 3) Reddit unreachable OR an untrustworthy (throttled) empty → serve stale cache if we
  //    have it (stale-while-revalidate), else a graceful "checking" (never an error card).
  //    We do NOT persist this — only an AUTHORITATIVE result may be cached, so a transient
  //    429 can't poison a real company with a false "no discussion".
  if (result === null || (result.items.length === 0 && result.degraded)) {
    if (stale) {
      return res.status(200).json({
        ok: true, company: stale.company_name, items: stale.items || [],
        status: stale.status || 'ok', cached: true, stale: true, fetched_at: stale.fetched_at,
      });
    }
    return res.status(200).json({ ok: true, company: companyName, items: [], status: 'checking', cached: false });
  }

  // 4) Authoritative result → cache it (unless dry-run) and return it.
  const items = result.items;
  const status = emptyStateDecision(items);
  if (hasDb && !dryRun) await writeCache(SUPABASE_URL, key, companyName, items, status);
  return res.status(200).json({
    ok: true, company: companyName, items, status,
    cached: false, dry_run: dryRun || undefined, fetched_at: new Date().toISOString(),
  });
}

// ── Dispute: good-faith correction intake (no auth; rate-limited; hard-capped fields) ──
async function handleDispute(req, res, body) {
  if (await applyRateLimit(req, res, 'company-reddit-dispute')) return;
  const shaped = sanitizeDispute(body);
  if (!shaped.valid) return res.status(400).json({ ok: false, error: shaped.error });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  if (!SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ ok: false, error: 'Disputes are temporarily unavailable — please try again later.' });
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/company_reddit_disputes`, {
      method: 'POST',
      headers: { ...dbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(shaped.row),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      logError('company-reddit/dispute', `DB ${r.status}`, { detail: detail.slice(0, 200) });
      return res.status(500).json({ ok: false, error: 'Could not record your correction. Please try again.' });
    }
    broadcastActivity('reddit_dispute'); // instant admin bell ping (fail-safe; fallback poll backs it up)
    return res.status(200).json({ ok: true, recorded: true });
  } catch (e) {
    logError('company-reddit/dispute', e);
    return res.status(500).json({ ok: false, error: 'Could not record your correction. Please try again.' });
  }
}

export default async function handler(req, res) {
  // CORS (same posture as api/reports.js): allow the site + local dev, echo otherwise-deny.
  const o = req.headers.origin || '';
  const devO = !o || o.includes('localhost') || o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin', (devO || ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(o)) ? (o || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  try {
    if (body.action === 'dispute') return await handleDispute(req, res, body);
    if (req.method === 'GET' || req.method === 'POST') return await handleLookup(req, res, body);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    logError('company-reddit/handler', e);
    // Last-resort graceful shape — the section must never render an error to the visitor.
    return res.status(200).json({ ok: true, items: [], status: 'checking', cached: false });
  }
}
