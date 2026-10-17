// Worker side of the self-filling company pages. Driven every 15 minutes by api/enrich-companies.js.
//
// One run: claim ≤ ENRICH_BATCH companies (claim_enrichment_batch — atomic, SKIP LOCKED, daily LLM
// cap enforced in SQL), then for each, SEQUENTIALLY:
//   1. Reddit discovery — the live company-page search (buildSearchUrl / parseRedditSearchAtom /
//      rankAndFilter from api/_utils/companyReddit.js), widened to the broad query when thin; ≤ 8
//      threads, full-phrase mention required, threads already in reddit_imports skipped.
//      FALLBACK (config.source 'auto', the default): Reddit rate-limits / blocks datacenter IPs
//      (HTTP 429 on Vercel for the very first production run). Once Reddit refuses a request
//      (429 / 403 / 5xx / no answer) the REST OF THE RUN reads the Arctic Shift archive instead
//      (api/_utils/arcticShift.js: posts/search in the four main job subreddits + comments/tree).
//      Same relevance gate, same extraction, same report shape — the content is still Reddit's.
//   2. Per-thread comments — Reddit comment RSS, or the archive's comment tree once Reddit is
//      blocked — ≤ 25 comments × 1,000 chars, cleaned + PII-redacted.
//   3. ONE extraction call through lib/server/llm.js chat({ json: true }) — the free Groq backend by
//      default; Anthropic only when the admin flag is on. Prompt budgeted (≈4.5k tokens), fenced.
//   4. Strict validation (first-hand, about the target, terminal outcome, medium+ confidence, PII /
//      injection checks). Invalid JSON is counted and the company retried later — never guessed.
//   5. Writes: reports in the existing Reddit shape (0.3 weight, trust_reason auto_enrich_reddit,
//      permalink attribution), city → company_locations (reports has NO city column), reddit_imports
//      rows for dedupe, then recomputeCompanyScoreFromReports so the page shows it immediately.
//   6. Queue row → done / empty / error (or back to queued when throttled / out of time).
//
// Politeness: every Reddit request goes through one sequential gate (≥1.1s apart, no parallelism);
// in 'reddit' mode a second Reddit 429 stops the run and requeues the rest; in 'auto' mode the first
// refusal switches the run to the archive, which has its own gate (≥1.5s apart) and stops the run on
// its own rate limit (arctic_429) or when it cannot answer at all (sources_unavailable). LLM calls respect a self-imposed tokens/min
// gate under Groq's free limit, and an LLM 429 also stops the run. The whole run stays inside
// runBudgetMs (maxDuration 300s); a company that runs out of time is requeued, never half-written.
//
// Egress: every Supabase read selects only the columns it needs (the project recently exceeded its
// free egress quota). A typical enrichment moves < 10 KB to/from Supabase.
//
// All I/O is injected so tests drive the whole run offline (lib/server/companyEnrichmentWorker.test.mjs).

import { buildSearchUrl, parseRedditSearchAtom } from '../../api/_utils/companyReddit.js';
import { createArcticFetcher, discoverArctic, flattenCommentTree } from '../../api/_utils/arcticShift.js';
import {
  EXTRACT_SYSTEM, RUN_STOP_DELAYS_MS, RunStop, buildExtractPrompt, buildImportRow, buildReportRow, classifyLlmError, cleanRedditHtml,
  createPoliteFetcher, displayName, estimateTokens, finishPatch, importLookupList, importedIdSet, normalizeCity,
  normalizeClaimRows, parseThreadFeed, readEnrichConfig, redactPII, requeuePatch, selectThreads, threadFeedUrl,
  tpmWaitMs, validateExtraction,
} from '../../api/_utils/companyEnrichment.js';
import { recomputeCompanyScoreFromReports, resolveOrCreateCompany, resolveOrCreateLocation } from '../../api/_utils/reportWrite.js';
import { chat, llmAvailable } from './llm.js';

const MIN_THREADS_BEFORE_BROAD = 3;

class CompanyFailure extends Error {
  constructor(reason, { llmCalled = false } = {}) { super(reason); this.reason = reason; this.llmCalled = llmCalled; }
}
class LlmStop extends Error {
  constructor(info) { super(info.reason); this.info = info; }
}

/**
 * @param {object} o
 * @param {string} o.url  SUPABASE_URL
 * @param {string} o.key  service key
 * @returns {Promise<object>} run summary (also the cron response body)
 */
export async function runEnrichment({
  url, key,
  fetchImpl = fetch,            // Supabase
  redditFetch = fetchImpl,      // Reddit
  arcticFetch = redditFetch,    // Arctic Shift archive (fallback source)
  chatImpl = chat,
  llmAvailableImpl = llmAvailable,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  config = readEnrichConfig(),
  resolveCompany = resolveOrCreateCompany,
  resolveLocation = resolveOrCreateLocation,
  recompute = recomputeCompanyScoreFromReports,
  log = () => {},
} = {}) {
  const startedAt = now();
  const runDeadline = startedAt + config.runBudgetMs;
  const summary = { ok: true, claimed: 0, companies: [], stopped: null, invalid_json: 0, reports_added: 0, reddit: null, arctic: null, source: config.source || 'auto', reddit_blocked: null };
  if (!url || !key) return { ...summary, ok: false, reason: 'db_not_configured' };
  // No LLM backend → don't claim (and don't spend Reddit requests on threads we can't read).
  if (!llmAvailableImpl()) return { ...summary, skipped: 'no_llm' };

  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const db = (path, opts = {}) => fetchImpl(`${url}/rest/v1/${path}`, {
    ...opts, headers: { ...hdrs, ...(opts.headers || {}) }, signal: AbortSignal.timeout(8000),
  });
  const patchRow = async (companyKey, patch) => {
    try {
      const r = await db(`company_enrichment_queue?company_key=eq.${encodeURIComponent(companyKey)}&status=eq.running`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
      });
      if (!r.ok) log(`[enrich] queue patch ${r.status} for ${companyKey}`);
    } catch (e) { log(`[enrich] queue patch failed for ${companyKey}: ${e?.message || e}`); }
  };

  // ── Claim ────────────────────────────────────────────────────────────────────────────────
  let claimRows;
  try {
    const r = await db('rpc/claim_enrichment_batch', { method: 'POST', body: JSON.stringify({ p_limit: config.batch, p_daily_max: config.dailyMax }) });
    if (!r.ok) return { ...summary, ok: false, reason: 'queue_unavailable', status: r.status };
    claimRows = await r.json();
  } catch (e) {
    return { ...summary, ok: false, reason: 'queue_unavailable', error: String(e?.message || e).slice(0, 160) };
  }
  const { valid, invalid } = normalizeClaimRows(claimRows);
  summary.claimed = valid.length + invalid.length;
  for (const k of invalid) await patchRow(k, requeuePatch({ kind: 'failed', attempts: Infinity, reason: 'invalid_name' }, now()));
  if (!valid.length) return summary;

  let companyDeadline = runDeadline;
  const fetcher = createPoliteFetcher({
    fetchImpl: redditFetch, sleep, now,
    intervalMs: config.intervalMs, max429: config.max429, backoff429Ms: config.backoff429Ms,
    deadline: () => now() > companyDeadline,
  });
  const arctic = createArcticFetcher({ fetchImpl: arcticFetch, sleep, now, deadlineAt: () => companyDeadline });
  const mode = summary.source;
  const canFallBack = mode !== 'reddit';
  // Reddit is "blocked" for the rest of the run after its first refusal (auto) — or from the start (arctic).
  let redditBlocked = mode === 'arctic';
  const refused = (r) => !r.ok && (r.status === 429 || r.status === 403 || r.status === 0 || r.status >= 500);
  const blockReddit = (status) => {
    if (redditBlocked) return;
    redditBlocked = true;
    summary.reddit_blocked = status;
    log(`[enrich] Reddit refused (${status}) — reading the Arctic Shift archive for the rest of this run`);
  };
  const tpmHistory = [];
  let stop = null; // { reason, delayMs }
  let stopAfterCompany = null; // the archive rate-limited us mid-company: finish it, then stop the run

  for (const c of valid) {
    if (!stop && stopAfterCompany) stop = stopAfterCompany;
    if (stop) {
      await patchRow(c.key, requeuePatch({ kind: 'throttled', attempts: c.attempts, reason: stop.reason, delayMs: stop.delayMs }, now()));
      summary.companies.push({ company: c.name, status: 'requeued', reason: stop.reason });
      continue;
    }
    companyDeadline = Math.min(runDeadline, now() + config.companyBudgetMs);
    try {
      const res = await enrichOne(c);
      await patchRow(c.key, finishPatch(res, now(), config.cooldownDays));
      summary.reports_added += res.reportsAdded;
      summary.companies.push({ company: c.name, status: res.reportsAdded > 0 ? 'done' : 'empty', source: res.source, threads: res.threadsSeen, reports: res.reportsAdded, dropped: res.dropped, note: res.note });
    } catch (e) {
      if (e instanceof RunStop) {
        if (e.reason === 'deadline' && now() <= runDeadline) {
          // This company alone overran its budget — counted as an attempt (it may just be huge).
          await patchRow(c.key, requeuePatch({ kind: 'failed', attempts: c.attempts, reason: 'company_budget' }, now()));
          summary.companies.push({ company: c.name, status: 'requeued', reason: 'company_budget' });
          continue;
        }
        stop = { reason: e.reason, delayMs: RUN_STOP_DELAYS_MS[e.reason] ?? 0 };
        await patchRow(c.key, requeuePatch({ kind: 'throttled', attempts: c.attempts, reason: e.reason, delayMs: stop.delayMs }, now()));
        summary.companies.push({ company: c.name, status: 'requeued', reason: e.reason });
      } else if (e instanceof LlmStop) {
        stop = { reason: e.info.reason, delayMs: e.info.delayMs };
        await patchRow(c.key, requeuePatch({ kind: 'throttled', attempts: c.attempts, reason: e.info.reason, delayMs: e.info.delayMs }, now()));
        summary.companies.push({ company: c.name, status: 'requeued', reason: e.info.reason });
      } else {
        const reason = e instanceof CompanyFailure ? e.reason : `error: ${String(e?.message || e).slice(0, 160)}`;
        if (reason === 'invalid_json') summary.invalid_json++;
        const patch = requeuePatch({ kind: 'failed', attempts: c.attempts, reason }, now());
        if (e?.llmCalled) patch.llm_called_at = new Date(now()).toISOString(); // tokens were spent
        await patchRow(c.key, patch);
        summary.companies.push({ company: c.name, status: patch.status === 'error' ? 'error' : 'retry', reason });
      }
    }
  }
  if (!stop && stopAfterCompany) stop = stopAfterCompany;
  summary.stopped = stop?.reason || null;
  summary.reddit = fetcher.stats;
  summary.arctic = arctic.stats.requests ? arctic.stats : null;
  summary.elapsed_ms = now() - startedAt;
  return summary;

  // ── One company ──────────────────────────────────────────────────────────────────────────
  async function enrichOne({ name }) {
    // 1. Discovery. Reddit: biased query, broad fallback when thin. Archive: once Reddit refused us.
    let items = [];
    let answered = false;
    let authors = new Map(); // archive only: thread id → post author (OP flag; never stored)
    // A Reddit request that came back refused → switch the run to the archive (auto/arctic modes).
    const redditGet = async (urlFor) => {
      try {
        const r = await fetcher.get(urlFor);
        if (canFallBack && refused(r)) { blockReddit(r.status); return null; }
        return r;
      } catch (e) {
        if (canFallBack && e instanceof RunStop && e.reason === 'reddit_429') { blockReddit(429); return null; }
        throw e;
      }
    };
    let source = 'reddit';
    if (!redditBlocked) {
      const search = async (broad) => {
        const r = await redditGet((host) => buildSearchUrl(name, { broad, host }));
        if (r?.ok) { answered = true; items.push(...parseRedditSearchAtom(r.text)); }
      };
      await search(false);
      if (!redditBlocked && selectThreads(items, name, { cap: MIN_THREADS_BEFORE_BROAD }).length < MIN_THREADS_BEFORE_BROAD) await search(true);
    }
    // Reddit refused before discovery finished (or never answered): the archive fills in. A thin
    // Reddit answer is topped up the same way, so a refusal never turns into a false "empty".
    if (redditBlocked && (!answered || selectThreads(items, name, { cap: MIN_THREADS_BEFORE_BROAD }).length < MIN_THREADS_BEFORE_BROAD)) {
      const found = await discoverArctic(name, { fetcher: arctic, nowMs: now() });
      // Neither source could answer one search: a source outage, not this company's fault.
      if (!answered && !found.answered) throw new RunStop('sources_unavailable');
      if (found.answered) {
        source = answered ? 'reddit+arctic' : 'arctic';
        answered = true;
        const have = new Set(items.map((it) => it.id));
        items = [...items, ...found.items.filter((it) => !have.has(it.id))];
        authors = found.authors;
      }
    }
    if (!answered) throw new CompanyFailure('reddit_unavailable');

    const candidates = selectThreads(items, name, { cap: config.threads + 8 });
    if (!candidates.length) return { threadsSeen: 0, reportsAdded: 0, llmCalled: false, note: 'no_threads', source };

    // 2. Dedupe against reddit_imports (any company — a thread is imported once, ever).
    let imported = new Set();
    const list = importLookupList(candidates.map((t) => t.id));
    if (list.length) {
      const r = await db(`reddit_imports?reddit_post_id=in.(${encodeURIComponent(list.join(','))})&select=reddit_post_id&limit=${list.length}`);
      if (!r.ok) throw new CompanyFailure(`imports_lookup_${r.status}`);
      imported = importedIdSet(await r.json());
    }
    const fresh = selectThreads(items, name, { cap: config.threads, importedIds: imported });
    if (!fresh.length) return { threadsSeen: 0, reportsAdded: 0, llmCalled: false, note: 'all_imported', source };

    // 3. Comments, one thread at a time through the polite gates: Reddit's comment RSS, or the
    //    archive's comment tree once Reddit is blocked. When the archive runs out of company budget
    //    mid-way, the remaining threads go in with just their title + post (never a wasted search).
    const threads = [];
    let treesStopped = false;
    for (const t of fresh) {
      let parsed = { post: null, comments: [] };
      if (!redditBlocked) {
        const r = await redditGet((host) => threadFeedUrl(t.subreddit, t.id, host));
        if (r?.ok) parsed = parseThreadFeed(r.text, { maxComments: config.commentsPerThread, maxChars: config.charsPerComment, opMaxChars: config.charsOp });
      }
      if (redditBlocked && !treesStopped) {
        try {
          const r = await arctic.get('/api/comments/tree', { link_id: `t3_${t.id}`, limit: '100' });
          if (r.ok) parsed = { post: null, comments: flattenCommentTree(r.items, { postAuthor: authors.get(t.id) || '', maxComments: config.commentsPerThread, maxChars: config.charsPerComment }) };
        } catch (e) {
          if (!(e instanceof RunStop && (e.reason === 'deadline' || e.reason === 'arctic_429'))) throw e;
          treesStopped = true;
          if (e.reason === 'arctic_429') stopAfterCompany = { reason: 'arctic_429', delayMs: RUN_STOP_DELAYS_MS.arctic_429 };
        }
      }
      const fallback = redactPII(cleanRedditHtml(t.snippet)).slice(0, config.charsOp);
      threads.push({ id: t.id, subreddit: t.subreddit, title: redactPII(t.title), body: parsed.post?.body || fallback, comments: parsed.comments });
    }

    // 4. One budgeted extraction call.
    const prompt = buildExtractPrompt(name, threads, { maxChars: config.promptChars });
    if (!prompt.included.length) return { threadsSeen: fresh.length, reportsAdded: 0, llmCalled: false, note: 'nothing_fit' };
    if (prompt.injection === 'high') log(`[enrich] possible prompt injection in threads for "${name}" — fenced + defused`);
    if (runDeadline - now() < config.llmReserveMs) throw new RunStop('deadline_run');
    const tokens = estimateTokens(prompt.chars, config.maxOutputTokens);
    const wait = tpmWaitMs(tpmHistory, tokens, now(), config.tpm);
    if (wait > 0) {
      if (now() + wait + config.llmReserveMs > runDeadline) throw new RunStop('deadline_run');
      await sleep(wait);
    }
    tpmHistory.push({ at: now(), tokens });
    let json;
    try {
      json = await chatImpl({ system: EXTRACT_SYSTEM, user: prompt.user, maxTokens: config.maxOutputTokens, timeoutMs: 25_000, json: true });
    } catch (e) {
      const info = classifyLlmError(e);
      if (info.stopRun) throw new LlmStop(info);
      throw new CompanyFailure(info.reason, { llmCalled: true });
    }
    const v = validateExtraction(json, prompt.included);
    if (!v.shapeOk) throw new CompanyFailure('invalid_json', { llmCalled: true });

    // 5. Writes.
    const bySub = new Map(threads.map((t) => [t.id, t.subreddit]));
    const postedBy = new Map(fresh.map((t) => [t.id, t.created || null]));
    let ids = [];
    if (v.kept.length) {
      const repHdrs = { ...hdrs, Prefer: 'return=representation' };
      const cid = await resolveCompany(url, repHdrs, displayName(name));
      const locCache = new Map();
      const locationFor = async (rawCity) => {
        const city = normalizeCity(rawCity);
        if (!cid || !city) return null;
        const k = city.toLowerCase();
        if (!locCache.has(k)) locCache.set(k, await Promise.resolve(resolveLocation(url, repHdrs, cid, city)).catch(() => null) || null);
        return locCache.get(k);
      };
      const rows = [];
      for (const e of v.kept) {
        rows.push(buildReportRow(e, { companyName: name, subreddit: bySub.get(e.thread_id), threadId: e.thread_id, companyId: cid || null, locationId: await locationFor(e.city), posted: postedBy.get(e.thread_id) }));
      }
      const ins = await db('reports?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows) });
      if (!ins.ok) throw new CompanyFailure(`reports_insert_${ins.status}`, { llmCalled: true });
      ids = await ins.json();
      if (!Array.isArray(ids) || ids.length !== rows.length) throw new CompanyFailure('reports_insert_shape', { llmCalled: true });
    }
    const firstReport = new Map();
    v.kept.forEach((e, i) => { if (!firstReport.has(e.thread_id)) firstReport.set(e.thread_id, ids[i]?.id || null); });
    const importRows = prompt.included.map((t) => buildImportRow({
      threadId: t.id, companyName: name, subreddit: bySub.get(t.id), reportId: firstReport.get(t.id) || null,
      kept: v.kept.filter((e) => e.thread_id === t.id).length,
    }));
    const imp = await db('reddit_imports?on_conflict=reddit_post_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(importRows) });
    if (!imp.ok) log(`[enrich] reddit_imports insert ${imp.status} for "${name}" (reports already written)`);
    if (ids.length) await recompute(url, hdrs, name);
    return { threadsSeen: fresh.length, reportsAdded: ids.length, llmCalled: true, dropped: v.dropped, source };
  }
}
