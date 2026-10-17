// Shared runner for the one-time "API credit" data jobs (scripts/credit/*).
//
// Every job here is an OFFLINE batch: it reads Seen data, sends one Message Batches API request
// per item (50% of standard price), and writes structured results back. Nothing in this folder is
// imported by the live app — the product keeps running on its free backend (lib/server/llm.js).
//
// Safety rails, because the credit is finite and expiring:
//   • a shared spend ledger (.credit-runs/ledger.json) records the measured cost of every batch;
//   • runBatch refuses to submit when ledger spend + this batch's estimate > CREDIT_BUDGET_USD;
//   • --dry-run (or DRY_RUN=1) builds requests and prints the estimate without calling the API;
//   • runs are resumable: batch ids are saved before polling, so a crash re-attaches, never resubmits.

import Anthropic from '@anthropic-ai/sdk';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const RUNS_DIR = resolve(process.env.CREDIT_RUNS_DIR || join(here, '..', '..', '..', '.credit-runs'));

// USD per million tokens, standard (non-batch) list prices. Batch = 50% of these.
// Source: claude-api skill pricing table (cached 2026-10-06).
export const PRICES = {
  'claude-haiku-5-5':  { in: 0.10, out: 0.50 },
  'claude-sonnet-5-5': { in: 2.00, out: 10.00 },
  'claude-opus-5-5':   { in: 4.00, out: 20.00 },
};
export const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches
const BATCH_DISCOUNT = 0.5;
const MAX_PER_BATCH = 10_000; // well under the 100k / 256 MB API limit; keeps each batch quick

export const MODELS = {
  cheap: 'claude-haiku-5-5',
  quality: 'claude-sonnet-5-5',
  judge: 'claude-opus-5-5',
};

export function isDryRun(argv = process.argv) {
  return argv.includes('--dry-run') || process.env.DRY_RUN === '1';
}

export function argValue(name, fallback = null, argv = process.argv) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}

let _client = null;
export function client() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set (add it to the environment, never to a file)');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ---------- cost accounting ----------

// Rough pre-flight estimate: ~4 chars per token for input, caller supplies expected output tokens.
export function estimateCost(requests, { expectedOutTokens = 400, searchesPerRequest = 0 } = {}) {
  let usd = 0, inTok = 0, outTok = 0;
  for (const r of requests) {
    const p = PRICES[r.params.model];
    if (!p) throw new Error(`no price for model ${r.params.model}`);
    const chars = JSON.stringify(r.params.system || '').length + JSON.stringify(r.params.messages).length;
    const i = Math.ceil(chars / 4);
    inTok += i; outTok += expectedOutTokens;
    usd += BATCH_DISCOUNT * (i * p.in + expectedOutTokens * p.out) / 1e6 + searchesPerRequest * WEB_SEARCH_USD;
  }
  return { usd, inTok, outTok, n: requests.length };
}

// Measured cost of one finished message from its usage block (batch-discounted).
export function costOfUsage(model, usage = {}) {
  const p = PRICES[model];
  if (!p) return 0;
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  const searches = usage.server_tool_use?.web_search_requests || 0;
  return BATCH_DISCOUNT * (input * p.in + (usage.output_tokens || 0) * p.out) / 1e6 + searches * WEB_SEARCH_USD;
}

const ledgerPath = () => join(RUNS_DIR, 'ledger.json');
export function readLedger() {
  try { return JSON.parse(readFileSync(ledgerPath(), 'utf8')); } catch { return { spentUsd: 0, jobs: {} }; }
}
function writeLedger(l) { mkdirSync(RUNS_DIR, { recursive: true }); writeFileSync(ledgerPath(), JSON.stringify(l, null, 2)); }
export function budgetUsd() { return Number(process.env.CREDIT_BUDGET_USD || 190); }

// ---------- the batch runner ----------

/**
 * Submit (or resume) a batch job and return every result keyed by custom_id.
 *   label     — unique job name, e.g. "reddit-extract-2026-10-17"; also the run directory
 *   requests  — [{ custom_id, params }] (custom_id must be ≤64 chars, [a-zA-Z0-9_-])
 *   estimate  — options for estimateCost
 * Returns { results: Map<custom_id, {type, message?, error?}>, costUsd, dryRun }
 */
export async function runBatch({ label, requests, estimate = {}, pollMs = 30_000, log = console.log }) {
  const dir = join(RUNS_DIR, label);
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, 'batches.json');
  const est = estimateCost(requests, estimate);
  log(`[${label}] ${est.n} requests · est. ${(est.inTok / 1e6).toFixed(2)}M in / ${(est.outTok / 1e6).toFixed(2)}M out tokens · est. $${est.usd.toFixed(2)}`);

  if (isDryRun()) {
    writeFileSync(join(dir, 'dry-run-sample.json'), JSON.stringify(requests.slice(0, 3), null, 2));
    log(`[${label}] dry run — nothing submitted. Sample requests: ${join(dir, 'dry-run-sample.json')}`);
    return { results: new Map(), costUsd: 0, dryRun: true, estimate: est };
  }

  let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  if (!state) {
    const ledger = readLedger();
    if (ledger.spentUsd + est.usd > budgetUsd()) {
      throw new Error(`[${label}] refusing to submit: spent $${ledger.spentUsd.toFixed(2)} + est. $${est.usd.toFixed(2)} > budget $${budgetUsd()} (raise CREDIT_BUDGET_USD to override)`);
    }
    const ids = new Set();
    for (const r of requests) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(r.custom_id)) throw new Error(`bad custom_id: ${r.custom_id}`);
      if (ids.has(r.custom_id)) throw new Error(`duplicate custom_id: ${r.custom_id}`);
      ids.add(r.custom_id);
    }
    state = { label, createdAt: new Date().toISOString(), estimateUsd: est.usd, batches: [] };
    for (let i = 0; i < requests.length; i += MAX_PER_BATCH) {
      const chunk = requests.slice(i, i + MAX_PER_BATCH);
      const b = await client().messages.batches.create({ requests: chunk });
      state.batches.push({ id: b.id, n: chunk.length, done: false });
      writeFileSync(statePath, JSON.stringify(state, null, 2)); // persist BEFORE the next submit
      log(`[${label}] submitted ${b.id} (${chunk.length} requests)`);
    }
  } else {
    log(`[${label}] resuming ${state.batches.length} existing batch(es) — not resubmitting`);
  }

  // Poll until every batch has ended.
  for (;;) {
    let pending = 0;
    for (const b of state.batches) {
      if (b.done) continue;
      const cur = await client().messages.batches.retrieve(b.id);
      if (cur.processing_status === 'ended') { b.done = true; b.counts = cur.request_counts; }
      else { pending++; log(`[${label}] ${b.id}: ${cur.request_counts.processing} processing, ${cur.request_counts.succeeded} done`); }
    }
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    if (!pending) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  // Collect results and measure the real cost.
  const results = new Map();
  let costUsd = 0;
  const resultsPath = join(dir, 'results.jsonl');
  writeFileSync(resultsPath, '');
  for (const b of state.batches) {
    for await (const r of await client().messages.batches.results(b.id)) {
      results.set(r.custom_id, r.result);
      if (r.result.type === 'succeeded') costUsd += costOfUsage(r.result.message.model, r.result.message.usage);
      appendFileSync(resultsPath, JSON.stringify({ custom_id: r.custom_id, result: r.result }) + '\n');
    }
  }
  if (!state.costRecorded) {
    const ledger = readLedger();
    ledger.spentUsd = +(ledger.spentUsd + costUsd).toFixed(4);
    ledger.jobs[label] = { costUsd: +costUsd.toFixed(4), estimateUsd: +est.usd.toFixed(4), requests: requests.length, finishedAt: new Date().toISOString() };
    writeLedger(ledger);
    state.costRecorded = true; state.costUsd = costUsd;
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
  const ok = [...results.values()].filter((r) => r.type === 'succeeded').length;
  log(`[${label}] ${ok}/${results.size} succeeded · measured cost $${costUsd.toFixed(2)} · ledger total $${readLedger().spentUsd.toFixed(2)} of $${budgetUsd()}`);
  return { results, costUsd, dryRun: false, estimate: est };
}

// Text of a succeeded result; refusal / max_tokens are surfaced as errors, never parsed.
export function resultText(result) {
  if (!result || result.type !== 'succeeded') return { error: result?.type || 'missing' };
  const m = result.message;
  if (m.stop_reason === 'refusal') return { error: 'refusal' };
  if (m.stop_reason === 'max_tokens') return { error: 'max_tokens' };
  return { text: (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') };
}

// Parse the JSON produced under output_config.format (structured outputs guarantee validity,
// but we still guard — a parse failure is counted, never silently treated as "no data").
export function resultJson(result) {
  const t = resultText(result);
  if (t.error) return t;
  try { return { json: JSON.parse(t.text) }; } catch { return { error: 'bad_json' }; }
}

// Structured-output config for a JSON schema (raw JSON Schema form of output_config.format).
export function jsonFormat(schema) {
  return { format: { type: 'json_schema', schema } };
}

// ---------- Supabase (service role; scripts only, never shipped to the browser) ----------

export function sbEnv() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY are not set');
  return { url, key };
}

// PostgREST call with retries on 429/5xx. Returns parsed JSON (or null for empty bodies).
export async function sb(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const { url, key } = sbEnv();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }
}

// Page through a PostgREST select (Range-free: limit/offset with a stable order).
export async function sbAll(path, { pageSize = 1000, max = Infinity } = {}) {
  const out = [];
  for (let offset = 0; out.length < max; offset += pageSize) {
    const sep = path.includes('?') ? '&' : '?';
    const rows = await sb(`${path}${sep}limit=${pageSize}&offset=${offset}`);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out.slice(0, max);
}

// Safe custom_id from an arbitrary key (stable, ≤64 chars).
export function customId(prefix, key) {
  const slug = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  let h = 0; for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${prefix}_${slug}_${h.toString(36)}`.slice(0, 64);
}
