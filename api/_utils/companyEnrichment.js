// Pure helpers for SELF-FILLING company pages (the company-enrichment queue).
//
// WHY: a company with zero first-party reports used to show "be the first to report" forever unless
// someone reported. When a real visitor looks one up, the score path enqueues it
// (lib/server/enrichmentQueue.js → migration 20261017140000); a 15-minute cron
// (api/enrich-companies.js → lib/server/companyEnrichmentWorker.js) finds public Reddit hiring
// threads about it, keeps the FIRST-HAND applicant accounts with the strict rule-based classifier
// every free collector uses (lib/reports/applicantRules.js — no model is called), and writes them as
// attributed, down-weighted reports in the exact Reddit shape the app already labels "Sourced from
// public discussion" (lib/reportSource.ts).
//
// Everything here is pure (no I/O; the politeness gate takes injected fetch/sleep/now) so the
// parse / select / extract / row-shape / throttle logic is unit-tested offline
// (api/_utils/companyEnrichment.test.mjs).
//
// PROVENANCE: the comment-feed parsing, HTML cleanup and PII redaction are PORTED from the one-time
// backfill (scripts/credit/lib/reddit.mjs), not imported — production must not depend on those offline
// scripts. Search parsing and relevance ranking are REUSED (imported) from the live company-page
// search (./companyReddit.js); the first-hand rules are REUSED from lib/reports/applicantRules.js.

import { normalizeCompanyKey, isSearchableCompany, rankAndFilter, isReadWorthy } from './companyReddit.js';
import { isValidCompanyName } from './reportWrite.js';
import { storableAccount, oneAccountPerVoice, isCompanySubreddit, REPORT_OUTCOME } from '../../lib/reports/applicantRules.js';
import { pacificDate } from '../../lib/time/pacific.js';
import { redditPlatform } from '../../lib/reports/platformLabel.js';
import { displayCompanyName } from '../../lib/companyNames.js';

// ── Tunables (env-overridable in the worker) ──────────────────────────────────────────────────
// The rules run in-process at no cost, so the only budgets are the sources' politeness and the run's
// clock: a batch per 15-minute run (vercel.json), sequential Reddit/archive requests.
export const ENRICH_DEFAULTS = {
  batch: 3,                 // companies claimed per cron run
  threads: 8,               // threads kept per company
  commentsPerThread: 25,
  charsPerComment: 1000,
  charsOp: 1500,
  intervalMs: 1100,         // ≥1s between ANY two Reddit requests (sequential)
  max429: 2,                // two Reddit 429s → stop the whole run
  backoff429Ms: 10_000,     // after the first 429, wait before the next request
  runBudgetMs: 240_000,     // whole-run budget (vercel.json maxDuration 300)
  companyBudgetMs: 100_000, // one company's budget; past it the company is requeued
  cooldownDays: 30,         // re-enrichment cooldown (next_eligible_at) after done/empty
  maxAttempts: 3,
  // Where threads come from. 'auto' = Reddit first; once Reddit refuses us (429 / 403 / no answer)
  // the rest of the run reads the Arctic Shift archive (api/_utils/arcticShift.js). 'reddit' and
  // 'arctic' pin one source (ENRICH_SOURCE env).
  source: 'auto',
};
export const ENRICH_SOURCES = ['auto', 'reddit', 'arctic'];

/** Run-stop reasons → how long the stopped companies wait before they are claimable again. */
export const RUN_STOP_DELAYS_MS = { reddit_429: 30 * 60_000, arctic_429: 30 * 60_000, sources_unavailable: 30 * 60_000 };

export const REDDIT_UA = 'SeenJobs/1.0 RSS reader (+https://seenjobs.io)'; // same UA as api/company-reddit.js
export const REDDIT_HOSTS = ['https://www.reddit.com', 'https://old.reddit.com'];
export const REDDIT_WEIGHT = 0.3;
// Accepted by the strict rules WITH the thread's context — the same reason the archive collectors
// write (lib/reports/feedFilter.js CONTEXT_VERIFIED_TRUST_REASONS). Older rows of this pipeline carry
// 'auto_enrich_reddit'.
export const TRUST_REASON = 'reddit_rule_match';
export const QUEUE_STATUSES = ['queued', 'running', 'done', 'empty', 'error'];

// ── Queue key + enqueue guard ────────────────────────────────────────────────────────────────

/** Queue primary key: the repo's company cache key (lowercased, legal suffix stripped). */
export function enrichmentKey(name) {
  return normalizeCompanyKey(name);
}

/**
 * Should a score lookup for `name` enqueue enrichment? Only real, searchable names whose score has
 * ZERO first-party reports. Returns { ok, key, name } (name = the lowercase write name) or { ok:false }.
 */
export function enqueueDecision(name, firstPartyCount) {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (!raw || !isValidCompanyName(raw) || !isSearchableCompany(raw)) return { ok: false, reason: 'invalid_name' };
  if ((Number(firstPartyCount) || 0) > 0) return { ok: false, reason: 'has_reports' };
  const key = enrichmentKey(raw);
  if (key.length < 2 || key.length > 120) return { ok: false, reason: 'invalid_key' };
  return { ok: true, key, name: raw.toLowerCase().slice(0, 200) };
}

/** The status shape the company page may show. Anything unexpected → null (show nothing). */
export function publicEnrichmentStatus(row) {
  const status = row && typeof row.status === 'string' ? row.status : null;
  if (!status || !QUEUE_STATUSES.includes(status)) return null;
  return { status, requested_at: row.requested_at || null, done_at: row.done_at || null };
}

/**
 * Split claim_enrichment_batch rows into workable companies and keys to retire. A claimed row whose
 * name fails the guards is never searched (it goes straight to 'error'); a row with no usable key at
 * all is dropped (nothing to patch — the 30-minute stuck-run reclaim retires it).
 * @returns {{ valid: {key: string, name: string, attempts: number}[], invalid: string[] }}
 */
export function normalizeClaimRows(rows) {
  const valid = [];
  const invalid = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.company_key !== 'string' || !r.company_key) continue;
    const name = typeof r.company_name === 'string' ? r.company_name.trim().toLowerCase() : '';
    if (!isValidCompanyName(name) || !isSearchableCompany(name)) { invalid.push(r.company_key); continue; }
    const a = Number(r.attempts);
    valid.push({ key: r.company_key, name, attempts: Number.isFinite(a) && a > 0 ? Math.floor(a) : 1 });
  }
  return { valid, invalid };
}

// ── Text cleanup + PII redaction (ported from scripts/credit/lib/reddit.mjs) ───────────────────

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Already-unescaped Reddit HTML → plain text without the "submitted by /u/x [link] [comments]" footer.
export function cleanRedditHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<\s*(br|\/p|\/li|\/blockquote|\/h\d|\/pre)\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/\s*submitted by\s+\/?u\/[\w-]+[\s\S]*$/i, '');
  s = s.replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RX = /\b(?:https?:\/\/|www\.)\S+/gi;
const PHONE_RX = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const USER_RX = /(^|[^a-z0-9])\/?u\/[A-Za-z0-9_-]{2,}/gi;

/** Scrub contact details + usernames from source text before any of it can be stored. */
export function redactPII(text) {
  return String(text ?? '')
    .replace(EMAIL_RX, '[email]')
    .replace(URL_RX, '[link]')
    .replace(PHONE_RX, '[phone]')
    .replace(USER_RX, (_, pre) => `${pre}[user]`);
}

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const cleanText = (rawHtml, max) => clip(redactPII(cleanRedditHtml(rawHtml)), max);

// ── Thread comment feed (/r/<sub>/comments/<id>/.rss) ─────────────────────────────────────────

export function threadFeedUrl(subreddit, threadId, host = REDDIT_HOSTS[0], limit = 40) {
  return `${host}/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(threadId)}/.rss?sort=top&limit=${limit}`;
}

const xmlUnescape = (s) => decodeEntities(String(s ?? '').replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ''));
const BOT_AUTHORS = new Set(['automoderator', 'reddit', '[deleted]']);
const DEAD_BODIES = new Set(['[deleted]', '[removed]', '']);

/**
 * Parse a thread comment feed. Atom shape: the post entry (<id>t3_…</id>) then comments
 * (<id>t1_…</id>). Authors are used only to drop bots and flag OP replies — never stored or sent.
 * Returns { post: {id, title, subreddit, body, created} | null, comments: [{id, is_op, body}] }.
 */
export function parseThreadFeed(xml, { maxComments = ENRICH_DEFAULTS.commentsPerThread, maxChars = ENRICH_DEFAULTS.charsPerComment, opMaxChars = ENRICH_DEFAULTS.charsOp } = {}) {
  const entries = [];
  for (const m of String(xml ?? '').matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const b = m[1];
    const link = xmlUnescape(/<link[^>]+href="([^"]+)"/.exec(b)?.[1] || '');
    entries.push({
      fullname: (/<id>([^<]+)<\/id>/.exec(b)?.[1] || '').trim(),
      link,
      author: xmlUnescape(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(b)?.[1] || '').replace(/^\/?u\//, '').trim(),
      title: xmlUnescape(/<title[^>]*>([\s\S]*?)<\/title>/.exec(b)?.[1] || '').trim(),
      html: xmlUnescape(/<content[^>]*>([\s\S]*?)<\/content>/i.exec(b)?.[1] || ''),
      created: (/<updated>([^<]+)<\/updated>/.exec(b)?.[1] || /<published>([^<]+)<\/published>/.exec(b)?.[1] || '').trim(),
      subreddit: /<category[^>]*\bterm="([^"]+)"/.exec(b)?.[1] || /\/r\/([^/]+)\//.exec(link)?.[1] || '',
    });
  }
  if (!entries.length) return { post: null, comments: [] };
  let pi = entries.findIndex((e) => e.fullname.startsWith('t3_'));
  if (pi < 0) pi = 0;
  const p = entries[pi];
  const tid = /\/comments\/([a-z0-9]+)/i.exec(p.link)?.[1] || p.fullname.replace(/^t3_/, '');
  const post = { id: tid, title: clip(redactPII(p.title), 300), subreddit: p.subreddit.replace(/^r\//, ''), body: cleanText(p.html, opMaxChars), created: p.created };
  const comments = [];
  for (let i = 0; i < entries.length && comments.length < maxComments; i++) {
    if (i === pi) continue;
    const e = entries[i];
    if (e.fullname && !e.fullname.startsWith('t1_')) continue;
    if (BOT_AUTHORS.has(e.author.toLowerCase())) continue;
    const body = cleanText(e.html, maxChars);
    if (DEAD_BODIES.has(body) || body.length < 15 || /\bI am a bot\b/i.test(body)) continue;
    const cid = e.fullname.replace(/^t1_/, '') || `c${i}`;
    comments.push({ id: cid, is_op: !!p.author && e.author === p.author, body });
  }
  return { post, comments };
}

// ── Thread selection ──────────────────────────────────────────────────────────────────────────

const flat = (s) => ` ${String(s ?? '').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ')} `;

/** Full-phrase mention of any term (punctuation/case-insensitive, word-bounded). */
export function mentionsAnyTerm(text, terms) {
  const hay = flat(text);
  return terms.some((t) => { const n = flat(t).trim(); return n && hay.includes(` ${n} `); });
}

/** The phrases a kept thread must contain in FULL: the write name and its legal-suffix-free key. */
export function mentionTerms(name) {
  return [...new Set([String(name || '').toLowerCase().trim(), enrichmentKey(name)].filter((t) => t && t.length >= 2))];
}

/**
 * Rank parsed search items with the production relevance gate (rankAndFilter: company named +
 * employment context), then require a FULL-PHRASE mention — isRelevant alone accepts a ≥4-char
 * first token ("Robert" for Robert Half), too loose for SCORED data. Drops threads already in
 * reddit_imports (`importedIds`, bare ids). Returns ≤cap { id, subreddit, title, permalink, created, snippet }.
 */
export function selectThreads(items, name, { cap = ENRICH_DEFAULTS.threads, importedIds = new Set() } = {}) {
  const list = Array.isArray(items) ? items : [];
  const bodies = new Map(list.filter((it) => it && it.id).map((it) => [it.id, it._body || '']));
  const terms = mentionTerms(name);
  // Threads to READ (isReadWorthy: named as the employer, not news) — the display list's stricter
  // "opening post is a first-hand account" gate (isRelevant) would starve the worker of the comment
  // threads it extracts accounts from.
  const ranked = rankAndFilter(list, name, list.length || 1, { relevance: isReadWorthy });
  const out = [];
  for (const it of ranked) {
    if (out.length >= cap) break;
    if (!it.id || importedIds.has(it.id)) continue;
    if (!/^[a-z0-9]{2,12}$/i.test(it.id) || !it.subreddit) continue;
    const snippet = bodies.get(it.id) || '';
    if (!mentionsAnyTerm(`${it.title} ${snippet}`, terms)) continue;
    out.push({ id: it.id, subreddit: it.subreddit, title: it.title, permalink: it.permalink, created: it.created, snippet });
  }
  return out;
}

/** An ISO timestamp / date → "YYYY-MM-DD" (California date), or null when missing, invalid or in the future. */
export function postedDay(iso, now = Date.now()) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t) || t > now + 86_400_000 || t < Date.UTC(2005, 0, 1)) return null;
  return pacificDate(new Date(t));
}

/**
 * Canonical, safe thread link appended to report_text (lib/reportSource.ts renders it as attribution);
 * with a comment id, the comment's own link (one report per Reddit post/comment across pipelines —
 * lib/server/companyIntelImport.js redditPermalinkKey).
 */
export function canonicalPermalink(subreddit, threadId, commentId = null) {
  const sub = String(subreddit || '').replace(/^r\//, '');
  if (!/^[A-Za-z0-9_]{2,32}$/.test(sub) || !/^[a-z0-9]{2,12}$/i.test(String(threadId || ''))) return null;
  const base = `https://www.reddit.com/r/${sub}/comments/${threadId}/`;
  // "_" stands in for the title slug, so the comment id is always the path's last segment and
  // redditPermalinkKey reads it as a comment whatever its length.
  return commentId && /^[a-z0-9]{2,12}$/i.test(String(commentId)) ? `${base}_/${commentId}/` : base;
}

// ── Extraction: the strict first-hand rules (lib/reports/applicantRules.js) ──────────────────────

/**
 * Keep the first-hand applicant accounts in `threads` ([{ id, subreddit, title, body, comments:
 * [{ id, is_op, body }] }]) with the same rules, and the same thread context, the archive collectors
 * use (lib/reports/archiveHarvest.js): the opening post is judged as title + body, every comment with
 * the thread's title and whether it is the company's own subreddit. One account per voice per thread
 * (the opening poster once, their most final outcome); the same words twice are one account.
 * Returns { kept: [{ thread_id, comment_id, outcome, excerpt }], dropped: { reason: n } }. Pure.
 */
export function extractAccounts(name, threads) {
  const names = [name];
  const kept = [];
  const dropped = {};
  const bump = (r) => { dropped[r] = (dropped[r] || 0) + 1; };
  const seenTexts = new Set();
  for (const t of Array.isArray(threads) ? threads : []) {
    if (!t || !t.id) continue;
    const inCompanySub = isCompanySubreddit(t.subreddit, names);
    const accounts = [];
    const add = (text, { isOp, voice, commentId }) => {
      const a = storableAccount(text, { names, title: t.title || '', isOp, inCompanySub });
      if (!a) { bump('not_an_applicant_account'); return; }
      accounts.push({ ...a, voice, commentId });
    };
    add(`${t.title || ''}. ${t.body || ''}`, { isOp: true, voice: `${t.id}:op`, commentId: null });
    for (const c of Array.isArray(t.comments) ? t.comments : []) {
      if (!c || typeof c.body !== 'string') continue;
      add(c.body, { isOp: !!c.is_op, voice: c.is_op ? `${t.id}:op` : `${t.id}:${c.id}`, commentId: c.id || null });
    }
    for (const a of oneAccountPerVoice(accounts)) {
      const outcome = REPORT_OUTCOME[a.outcome];
      if (!outcome) { bump('outcome_not_storable'); continue; }
      const key = String(a.excerpt).toLowerCase().replace(/\W+/g, ' ').trim();
      if (seenTexts.has(key)) { bump('duplicate'); continue; }
      seenTexts.add(key);
      kept.push({ thread_id: String(t.id), comment_id: a.commentId, outcome, excerpt: a.excerpt });
    }
  }
  return { kept, dropped };
}

// ── Row shapes ────────────────────────────────────────────────────────────────────────────────

/**
 * The reports row — the Reddit-tier shape every public-discussion pipeline writes (weight 0.3,
 * published, labelled public discussion), the person's own words (the rules' excerpt, PII-redacted)
 * with the post/comment permalink appended (lib/reportSource.ts reportSourceLink renders it as the
 * attribution link; it accepts only reddit hosts for Reddit rows). Every key always present so a
 * PostgREST bulk insert has uniform keys. No role or city is guessed: role is '' and location_id null.
 */
export function buildReportRow(acct, { companyName, subreddit, threadId, companyId = null, posted = null }) {
  const link = canonicalPermalink(subreddit, threadId, acct.comment_id);
  const words = redactPII(String(acct.excerpt)).replace(/\s+/g, ' ').trim().slice(0, 1800);
  // The thread's own date travels in the attribution (lib/reportSource.ts reportDate shows it) —
  // created_at is only the import time, so without this every auto-filled report reads "today".
  const day = postedDay(posted);
  return {
    company_name: String(companyName).toLowerCase().trim(),
    platform: redditPlatform(subreddit),
    outcome: acct.outcome,
    role: '', // reports.role is NOT NULL (prod); the rules never guess a title
    report_text: link ? `${words} [Public reddit.com post${day ? `, posted ${day}` : ''}: ${link}]` : words,
    source: 'reddit',
    outcome_weight: REDDIT_WEIGHT,
    trust_reason: TRUST_REASON,
    needs_review: false,
    rounds: 0,
    unpaid_work: 'na',
    experience_level: 'Unknown',
    company_id: companyId,
    location_id: null, // reports has NO city column; no city is guessed
  };
}

/** reddit_imports row (migration 012: reddit_post_id is the fullname "t3_<id>", UNIQUE). */
export function buildImportRow({ threadId, companyName, subreddit, reportId = null, kept }) {
  return {
    reddit_post_id: `t3_${threadId}`,
    company_name: String(companyName).toLowerCase().trim(),
    subreddit,
    report_id: reportId,
    skipped: kept === 0,
    skip_reason: kept === 0 ? 'no_applicant_accounts' : null,
  };
}

/** Thread ids (bare) present in reddit_imports rows — accepts fullnames and the legacy bare ids. */
export function importedIdSet(rows) {
  return new Set((Array.isArray(rows) ? rows : []).map((r) => String(r?.reddit_post_id || '').replace(/^t3_/, '')).filter(Boolean));
}

/** PostgREST in.() list for a dedupe lookup — both "t3_<id>" and bare ids. ids are [a-z0-9]. */
export function importLookupList(ids) {
  const safe = [...new Set(ids)].filter((id) => /^[a-z0-9]{2,12}$/i.test(id));
  return safe.flatMap((id) => [`t3_${id}`, id]);
}

// ── Final status + requeue decisions ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Terminal patch for a finished company. done = ≥1 report written; empty = nothing usable found. */
export function finishPatch({ threadsSeen, reportsAdded }, now = Date.now(), cooldownDays = ENRICH_DEFAULTS.cooldownDays) {
  const iso = new Date(now).toISOString();
  return {
    status: reportsAdded > 0 ? 'done' : 'empty',
    threads_seen: threadsSeen,
    reports_added: reportsAdded,
    done_at: iso,
    claimed_at: null,
    last_error: null,
    next_eligible_at: new Date(now + cooldownDays * DAY_MS).toISOString(),
  };
}

/**
 * Patch for a company that could not finish. kind:
 *   'throttled' — Reddit/archive rate limit or run deadline: NOT the company's fault → back to the
 *                 queue, attempt refunded, short delay.
 *   'failed'    — upstream / write error: retry with backoff until maxAttempts, then 'error'.
 */
export function requeuePatch({ kind, attempts, reason, delayMs }, now = Date.now(), maxAttempts = ENRICH_DEFAULTS.maxAttempts) {
  const err = String(reason || kind).slice(0, 300);
  if (kind === 'throttled') {
    return {
      status: 'queued', claimed_at: null, last_error: err,
      attempts: Math.max(0, (Number(attempts) || 1) - 1),
      next_eligible_at: new Date(now + (delayMs ?? 15 * 60_000)).toISOString(),
    };
  }
  if ((Number(attempts) || 0) >= maxAttempts) {
    return { status: 'error', claimed_at: null, last_error: err, done_at: new Date(now).toISOString(), next_eligible_at: new Date(now + DAY_MS).toISOString() };
  }
  return { status: 'queued', claimed_at: null, last_error: err, next_eligible_at: new Date(now + (Number(attempts) || 1) * 3_600_000).toISOString() };
}

// ── Politeness: one sequential gate for every Reddit request ──────────────────────────────────

export class RunStop extends Error {
  constructor(reason) { super(reason); this.name = 'RunStop'; this.reason = reason; }
}

/**
 * Sequential polite Reddit fetcher: ≥intervalMs between request starts, www → old.reddit fallback
 * on 403/5xx/network (NOT on 429), and a run-wide 429 counter — the second 429 throws RunStop
 * ('reddit_429') so the worker stops the run. After the first 429 the next request waits
 * backoff429Ms. `deadline()` → true aborts with RunStop('deadline') before a request starts.
 * get(urlFor(host)) → { ok, status, text }.
 */
export function createPoliteFetcher({
  fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(),
  intervalMs = ENRICH_DEFAULTS.intervalMs, max429 = ENRICH_DEFAULTS.max429, backoff429Ms = ENRICH_DEFAULTS.backoff429Ms,
  hosts = REDDIT_HOSTS, timeoutMs = 8000, deadline = () => false,
} = {}) {
  let nextAt = 0;
  const stats = { requests: 0, r429: 0, errors: 0 };
  async function gate() {
    const wait = nextAt - now();
    if (wait > 0) await sleep(wait);
    nextAt = now() + intervalMs;
  }
  async function get(urlFor) {
    let last = { ok: false, status: 0, text: '' };
    for (const host of hosts) {
      if (deadline()) throw new RunStop('deadline');
      await gate();
      stats.requests++;
      let res;
      try {
        res = await fetchImpl(urlFor(host), {
          headers: { 'User-Agent': REDDIT_UA, Accept: 'application/atom+xml, application/rss+xml, text/xml' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        stats.errors++; last = { ok: false, status: 0, text: '' };
        continue; // network/timeout → next host
      }
      if (res.status === 429) {
        stats.r429++;
        if (stats.r429 >= max429) throw new RunStop('reddit_429');
        nextAt = Math.max(nextAt, now() + backoff429Ms);
        return { ok: false, status: 429, text: '' }; // no same-request retry; the counter decides the run
      }
      if (res.ok) return { ok: true, status: res.status, text: await res.text() };
      stats.errors++; last = { ok: false, status: res.status, text: '' };
      if (res.status === 404) return last; // the thread is gone — another host won't have it
    }
    return last;
  }
  return { get, stats };
}

/** Display spelling for a created companies row ("lowe's" → "Lowe's") — the ONE map, lib/companyNames.js. */
export function displayName(name) {
  return displayCompanyName(name);
}

/** Read the subset of ENRICH_* env overrides that are positive integers. */
export function readEnrichConfig(env = process.env) {
  const n = (k, d) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : d; };
  return {
    ...ENRICH_DEFAULTS,
    batch: Math.min(n('ENRICH_BATCH', ENRICH_DEFAULTS.batch), 10),
    source: ENRICH_SOURCES.includes(String(env.ENRICH_SOURCE || '').toLowerCase()) ? String(env.ENRICH_SOURCE).toLowerCase() : ENRICH_DEFAULTS.source,
  };
}

