#!/usr/bin/env node
// One-time enrichment of every active, visible listing in public.jobs → public.job_enrichment
// (migration 20261017120000_job_enrichment.sql). One Message Batches request per listing on the
// cheap model; structured outputs guarantee the JSON shape, and the writer still validates every
// value against the same vocabularies the table's CHECK constraints enforce.
//
//   node scripts/credit/tag-jobs.mjs run   [--limit N] [--label L] [--dry-run] [--no-write]
//                                          [--desc-chars 3000] [--jobs-file jobs.json]
//   node scripts/credit/tag-jobs.mjs write --label L [--dry-run]     re-write from saved results
//   node scripts/credit/tag-jobs.mjs stats                          counts by posted_by / agency
//
// Order of operations for the credit run: dry-run → 200-job pilot with --no-write → read
// .credit-runs/<label>/review-sample.json + validation.json → `write --label <pilot label>` → full run.
// Only listings with no job_enrichment row are selected, so a re-run never pays twice for a row.
//
// Visibility, verified against the migrations: a listing is served when availability_status =
// 'active' AND expires_at > now() (20260929120000_stale_job_protocol.sql — stale rows are "hidden"
// by expires_at=now, there is no `hidden` column). Columns read: title/company/location/salary/
// description/type/level/source (api/jobs.js selects), source_type/ats_provider (066),
// is_employer_posted (055). `salary` is free text — salary_min/max are NOT persisted on jobs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SECURITY_PREAMBLE, fenceUntrusted } from '../../lib/server/promptGuard.js';
import { MODELS, RUNS_DIR, argValue, isDryRun, jsonFormat, resultJson, runBatch, sb } from './lib/batch.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// ---------- vocabularies (mirror the CHECK constraints in the migration) ----------

export const POSTED_BY = ['direct', 'staffing_agency', 'recruiter_unclear', 'unknown'];
export const IS_REMOTE = ['remote', 'hybrid', 'onsite', 'unknown'];
export const SENIORITY = ['entry', 'mid', 'senior', 'lead', 'unknown'];
export const SALARY_PERIOD = ['hour', 'year', 'unknown'];
export const CONFIDENCE = ['high', 'medium', 'low'];

// Signals that the listing may not be a real, currently-open seat (ghost-job risk).
export const GHOST_SIGNALS = [
  'evergreen_pipeline',        // "always accepting applications", talent pool, future openings
  'vague_duties',              // no concrete responsibilities for the actual role
  'no_salary',                 // no pay information anywhere in the listing
  'reposted_language',         // "reposted", "re-opened", "still looking"
  'unrealistic_requirements',  // requirements that contradict the level (10 yrs for entry, etc.)
  'generic_boilerplate',       // template text that could describe any job at any company
  'hidden_employer',           // an intermediary posting that never names who the hire works for
];
// Signals of a predatory or scam listing — distinct from "ghost" (the seat may exist, but the deal is bad).
export const RED_FLAGS = [
  'mlm_or_commission_only',    // multi-level marketing, or pay is commission only / "unlimited earning"
  'pay_to_apply',              // applicant pays for training, kit, certification, background check
  'requests_sensitive_info',   // SSN, bank details, ID scans before an offer
  'off_platform_contact',      // apply via Telegram/WhatsApp/text/personal email
  'too_good_to_be_true_pay',   // pay wildly out of line with the duties
  'unpaid_trial_work',         // unpaid "trial" shifts or test projects of real work
  'misleading_title',          // the title describes a different job than the duties
];

export const MODEL = MODELS.cheap; // claude-haiku-5-5
export const MAX_TOKENS = 600;
export const DEFAULT_DESC_CHARS = 3000;
export const SUMMARY_MAX = 200;
export const UPSERT_CHUNK = 500;

// ---------- the staffing-agency index (lib/agencies.ts, the /agencies Ghost Index) ----------

// lib/agencies.ts is TypeScript. Node ≥22.18 strips types on import; older Node falls back to
// parsing the literal list, which is plain data. Either way the source of truth stays that file.
export async function loadAgencies() {
  const path = resolve(here, '..', '..', 'lib', 'agencies.ts');
  try {
    const m = await import(pathToFileURL(path).href);
    if (Array.isArray(m.STAFFING_AGENCIES) && m.STAFFING_AGENCIES.length) return m.STAFFING_AGENCIES;
  } catch { /* fall through to the text parser */ }
  return parseAgenciesSource(readFileSync(path, 'utf8'));
}

export function parseAgenciesSource(src) {
  const out = [];
  const re = /\{\s*name:\s*'([^']+)'\s*,\s*aliases:\s*\[([^\]]*)\]\s*\}/g;
  for (const m of src.matchAll(re)) {
    out.push({ name: m[1], aliases: [...m[2].matchAll(/'([^']+)'/g)].map((a) => a[1]) });
  }
  if (!out.length) throw new Error('could not read STAFFING_AGENCIES from lib/agencies.ts');
  return out;
}

// Match key for agency names: lowercase, '&'→'and', punctuation → space, trailing legal suffixes
// dropped. Matching is EXACT on this key (the lib/agencies.ts rule: a wrong match would pin one
// agency's record on another; an unmatched variant is kept as written, which is safe).
export function agencyKey(name) {
  let s = String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  for (;;) {
    const next = s.replace(/\s+(inc|llc|l l c|ltd|corp|corporation|co|company|plc|usa|us)$/, '').trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/^the\s+/, '');
}

export function buildAgencyIndex(agencies) {
  const map = new Map();
  for (const a of agencies) {
    for (const n of [a.name, ...a.aliases]) {
      const k = agencyKey(n);
      if (k) map.set(k, a.name);
    }
  }
  return map;
}

// → { name, indexed } — the index display name when it matches, else the cleaned original.
export function normalizeAgencyName(raw, index) {
  const cleaned = cleanText(raw, 120);
  if (!cleaned) return { name: null, indexed: false };
  const hit = index.get(agencyKey(cleaned));
  return hit ? { name: hit, indexed: true } : { name: cleaned, indexed: false };
}

// ---------- prompt ----------

export function buildSystemPrompt(agencies) {
  const list = agencies.map((a) => `- ${a.name}`).join('\n');
  return `${SECURITY_PREAMBLE}

You classify job listings for Seen, a hiring-transparency job site. Each request contains ONE listing
inside an «UNTRUSTED LISTING» fence. Return the JSON object the response schema defines. Judge only
from what the listing says; when the text does not support a value, use "unknown", null, or an empty
list. Never guess, never infer facts about the company beyond this listing.

posted_by — who published this listing:
- "direct": the organization that will employ the hire (including its own in-house recruiters,
  careers page, or applicant tracking system). A staffing agency hiring for its OWN internal staff
  (e.g. a recruiter role at the agency's own office) is "direct".
- "staffing_agency": a staffing, temp, recruiting, or RPO firm posting on behalf of a client — e.g.
  "our client", "on behalf of a leading…", "contract via/through", "W2 contract with us", the company
  field is an agency listed below, or the agency is named as the poster.
- "recruiter_unclear": third-party recruiter language is present but it cannot be told whether an
  agency posted it.
- "unknown": not enough information.

agency_name — only for staffing_agency / recruiter_unclear, else null. If the agency is one of these,
use EXACTLY this display name:
${list}
Otherwise use the agency's name as written in the listing. null if no agency is named.

client_employer — the actual employer, ONLY when an agency listing names it explicitly. null for
descriptions like "a Fortune 500 company", and null for direct listings.

is_remote — "remote", "hybrid", "onsite", or "unknown" from the listing's stated work arrangement.
seniority — "entry" (entry level, junior, graduate, intern, associate), "mid", "senior", "lead"
(lead, principal, staff, manager of people, director and above), or "unknown".

Pay — only pay explicitly stated in the listing (the salary field or the description):
- salary_min / salary_max as plain numbers in the stated unit ("$25/hr" → 25 and 25, period "hour";
  "$80k–$100k" → 80000 and 100000, period "year"). One number → the same value in both.
- Pay stated per day, week, or month, or commission/bonus-only figures: salary_min and salary_max
  null, salary_period "unknown".
- salary_currency: ISO 4217 code ("USD", "GBP", "CAD"…). "$" with a US location means "USD". null
  when no pay is stated or the currency is not clear.

ghost_signals — include each only when the listing text clearly supports it:
- evergreen_pipeline: always accepting applications, talent pool / community, future openings.
- vague_duties: no concrete responsibilities for this specific role.
- no_salary: no pay information anywhere in the listing.
- reposted_language: says it was reposted, re-opened, or is "still" looking.
- unrealistic_requirements: requirements that contradict the level (e.g. 8+ years for entry level).
- generic_boilerplate: template text that could describe any job at any company.
- hidden_employer: an intermediary posting that never names who the hire would work for.

red_flags — include each only when the listing text clearly supports it:
- mlm_or_commission_only: multi-level marketing, or pay is commission-only / "unlimited earnings".
- pay_to_apply: the applicant must pay for training, a starter kit, certification, or a background check.
- requests_sensitive_info: asks for SSN, bank details, or ID documents before an offer.
- off_platform_contact: asks applicants to apply or talk via Telegram, WhatsApp, text, or a personal email.
- too_good_to_be_true_pay: pay wildly out of line with the stated duties or requirements.
- unpaid_trial_work: unpaid trial shifts or unpaid test projects that are real work.
- misleading_title: the title describes a different job than the duties do.

summary — one neutral, factual sentence of at most ${SUMMARY_MAX} characters describing the role
(what the person would do, level, and arrangement). No opinions, no judgments about the employer.

confidence — your confidence in posted_by: "high" (explicit in the text), "medium" (strong cues),
"low" (weak cues).`;
}

// Structured-output schema. No minLength/maxLength/minimum (unsupported by output_config.format);
// those bounds are enforced in validateEnrichment and by the table's CHECK constraints instead.
const nullable = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });
export const ENRICHMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posted_by', 'agency_name', 'client_employer', 'is_remote', 'seniority', 'salary_min', 'salary_max',
    'salary_period', 'salary_currency', 'ghost_signals', 'red_flags', 'summary', 'confidence'],
  properties: {
    posted_by: { type: 'string', enum: POSTED_BY },
    agency_name: nullable('string'),
    client_employer: nullable('string'),
    is_remote: { type: 'string', enum: IS_REMOTE },
    seniority: { type: 'string', enum: SENIORITY },
    salary_min: nullable('number'),
    salary_max: nullable('number'),
    salary_period: { type: 'string', enum: SALARY_PERIOD },
    salary_currency: nullable('string'),
    ghost_signals: { type: 'array', items: { type: 'string', enum: GHOST_SIGNALS } },
    red_flags: { type: 'array', items: { type: 'string', enum: RED_FLAGS } },
    summary: { type: 'string' },
    confidence: { type: 'string', enum: CONFIDENCE },
  },
};

// ---------- request building ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// custom_id is REVERSIBLE (tj_ + the uuid's 32 hex digits = 35 chars, inside the API's
// [a-zA-Z0-9_-]{1,64}), so `write` maps results back to job ids from results.jsonl alone.
export function jobCustomId(jobId) {
  if (!UUID_RE.test(String(jobId))) throw new Error(`job id is not a uuid: ${jobId}`);
  return `tj_${String(jobId).toLowerCase().replace(/-/g, '')}`;
}
export function jobIdFromCustomId(cid) {
  const m = /^tj_([0-9a-f]{32})$/.exec(String(cid));
  if (!m) return null;
  const h = m[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
// ATS descriptions often arrive as HTML; tags are tokens the model doesn't need.
export function plainText(s) {
  return String(s || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_m, e) => ENTITIES[e])
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function listingText(job, { descChars = DEFAULT_DESC_CHARS } = {}) {
  const desc = plainText(job.description).slice(0, descChars);
  return [
    `Title: ${plainText(job.title) || 'not provided'}`,
    `Company: ${plainText(job.company) || 'not provided'}`,
    `Location: ${plainText(job.location) || 'not provided'}`,
    `Salary field: ${plainText(job.salary) || 'not provided'}`,
    `Employment type: ${plainText(job.type) || 'not provided'}`,
    `Level (from source): ${plainText(job.level) || 'not provided'}`,
    'Description:',
    desc || 'not provided',
  ].join('\n');
}

// Trusted metadata from Seen's own pipeline goes OUTSIDE the fence; everything scraped goes inside.
export function buildUserContent(job, opts) {
  const meta = [
    `source: ${job.source || 'unknown'}`,
    job.source_type ? `source_type: ${job.source_type}` : null,
    job.ats_provider ? `ats_provider: ${job.ats_provider}` : null,
    `posted from a verified employer account on Seen: ${job.is_employer_posted ? 'yes' : 'no'}`,
  ].filter(Boolean).join('\n');
  return `Classify this job listing.\n\nListing metadata (from Seen's database, trusted):\n${meta}\n\n${fenceUntrusted(listingText(job, opts), 'LISTING')}`;
}

export function buildRequests(jobs, { system, descChars = DEFAULT_DESC_CHARS } = {}) {
  if (!system) throw new Error('buildRequests needs the system prompt');
  return jobs.map((job) => ({
    custom_id: jobCustomId(job.id),
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Haiku 5.5 accepts disabled thinking at effort low/medium/high; a fixed-schema classification
      // doesn't need it, and thinking tokens would be billed as output.
      thinking: { type: 'disabled' },
      // Identical across all requests → cacheable prefix (Haiku 5.5 minimum is 512 tokens).
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { ...jsonFormat(ENRICHMENT_SCHEMA), effort: 'low' },
      messages: [{ role: 'user', content: buildUserContent(job, { descChars }) }],
    },
  }));
}

// ---------- validation (never coerce silently: every drop/null is counted) ----------

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || /^(null|none|n\/a|unknown)$/i.test(s)) return null;
  return s.length > max ? null : s;
}
const bump = (counts, k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

const SALARY_BOUNDS = { hour: [5, 1000], year: [5000, 5_000_000], unknown: [1, 10_000_000] };

export function newCounts() { return {}; }

/**
 * Validate one model output → a job_enrichment row, or null when unusable.
 * `counts` accumulates every value that was dropped/nulled, keyed by reason.
 */
export function validateEnrichment(json, { jobId, model = MODEL, agencyIndex, now = new Date().toISOString(), counts = {} }) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) { bump(counts, 'not_an_object'); return null; }
  const pick = (field, allowed) => {
    const v = json[field];
    if (allowed.includes(v)) return v;
    bump(counts, `invalid_${field}`);
    return null;
  };
  const posted_by = pick('posted_by', POSTED_BY);
  const is_remote = pick('is_remote', IS_REMOTE);
  const seniority = pick('seniority', SENIORITY);
  let salary_period = pick('salary_period', SALARY_PERIOD);
  const confidence = pick('confidence', CONFIDENCE);

  // Agency + client: only meaningful on an intermediary listing.
  const intermediary = posted_by === 'staffing_agency' || posted_by === 'recruiter_unclear';
  let agency_name = null;
  if (typeof json.agency_name === 'string' ? json.agency_name.trim() : json.agency_name != null) {
    if (!intermediary) bump(counts, 'agency_name_on_non_agency_listing');
    else {
      const n = normalizeAgencyName(json.agency_name, agencyIndex || new Map());
      if (!n.name) bump(counts, 'invalid_agency_name');
      agency_name = n.name;
      if (n.indexed) bump(counts, 'agency_matched_index');
    }
  }
  let client_employer = null;
  if (typeof json.client_employer === 'string' ? json.client_employer.trim() : json.client_employer != null) {
    if (!intermediary) bump(counts, 'client_employer_on_non_agency_listing');
    else {
      client_employer = cleanText(json.client_employer, 160);
      if (!client_employer) bump(counts, 'invalid_client_employer');
      else if (agency_name && agencyKey(client_employer) === agencyKey(agency_name)) { bump(counts, 'client_employer_equals_agency'); client_employer = null; }
    }
  }

  // Pay.
  const num = (field) => {
    const v = json[field];
    if (v == null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) { bump(counts, `invalid_${field}`); return null; }
    return v;
  };
  let salary_min = num('salary_min'), salary_max = num('salary_max');
  if (salary_min != null && salary_max != null && salary_min > salary_max) {
    bump(counts, 'salary_min_gt_max'); salary_min = salary_max = null;
  }
  const [lo, hi] = SALARY_BOUNDS[salary_period || 'unknown'];
  if ([salary_min, salary_max].some((v) => v != null && (v < lo || v > hi))) {
    bump(counts, 'salary_out_of_range'); salary_min = salary_max = null;
  }
  let salary_currency = null;
  if (json.salary_currency != null) {
    const c = typeof json.salary_currency === 'string' ? json.salary_currency.trim().toUpperCase() : '';
    if (/^[A-Z]{3}$/.test(c)) salary_currency = c; else bump(counts, 'invalid_salary_currency');
  }
  const hasPay = salary_min != null || salary_max != null;
  if (!hasPay && salary_period && salary_period !== 'unknown') { bump(counts, 'salary_period_without_pay'); salary_period = 'unknown'; }

  // Vocab lists: drop unknown items, dedupe, and drop self-contradictions.
  const vocab = (field, allowed) => {
    const raw = Array.isArray(json[field]) ? json[field] : (bump(counts, `invalid_${field}`), []);
    const out = [];
    for (const s of raw) {
      if (!allowed.includes(s)) { bump(counts, `dropped_${field}_item`); continue; }
      if (!out.includes(s)) out.push(s);
    }
    return out;
  };
  let ghost_signals = vocab('ghost_signals', GHOST_SIGNALS);
  const red_flags = vocab('red_flags', RED_FLAGS);
  if (hasPay && ghost_signals.includes('no_salary')) { bump(counts, 'no_salary_with_pay'); ghost_signals = ghost_signals.filter((g) => g !== 'no_salary'); }

  // Summary: ≤200 chars. Over-long summaries are cut at a word boundary — counted, not silent.
  let summary = typeof json.summary === 'string' ? json.summary.replace(/\s+/g, ' ').trim() : null;
  if (summary == null) bump(counts, 'invalid_summary');
  else if (!summary) summary = null;
  else if (summary.length > SUMMARY_MAX) {
    bump(counts, 'summary_truncated');
    const cut = summary.slice(0, SUMMARY_MAX - 1);
    summary = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), SUMMARY_MAX - 40)).trimEnd()}…`;
  }

  return {
    job_id: jobId, posted_by, agency_name, client_employer, is_remote, seniority,
    salary_min, salary_max, salary_period, salary_currency, ghost_signals, red_flags,
    summary, model, enriched_at: now, confidence,
  };
}

// Results (Map or iterable of [custom_id, result]) → rows + a validation report.
export function rowsFromResults(results, { agencyIndex, now = new Date().toISOString() } = {}) {
  const counts = newCounts();
  const errors = {};
  const rows = [];
  for (const [cid, result] of results) {
    const jobId = jobIdFromCustomId(cid);
    if (!jobId) { bump(errors, 'foreign_custom_id'); continue; }
    const r = resultJson(result);
    if (r.error) { bump(errors, r.error); continue; }
    const row = validateEnrichment(r.json, { jobId, model: result.message?.model || MODEL, agencyIndex, now, counts });
    if (row) rows.push(row); else bump(errors, 'unusable_output');
  }
  return { rows, report: { results: rows.length + Object.values(errors).reduce((a, b) => a + b, 0), rows: rows.length, errors, fieldIssues: counts } };
}

// Agency named in the company field vs the model's posted_by — reported, never overridden: an
// agency's own internal job (a recruiter at Robert Half's office) is legitimately "direct".
export function companyAgencyDisagreements(rows, jobsById, agencyIndex) {
  let n = 0;
  for (const r of rows) {
    const job = jobsById.get(r.job_id);
    if (job && agencyIndex.has(agencyKey(job.company)) && r.posted_by === 'direct') n++;
  }
  return n;
}

// ---------- Supabase I/O ----------

const JOB_COLS = 'id,title,company,location,salary,description,type,level,source,source_type,ats_provider,is_employer_posted';

// Keyset pagination by primary key (offset paging re-walks every earlier row each page).
export async function keysetAll(table, { select, key, filter = '', pageSize = 1000, max = Infinity, sbFn = sb }) {
  const out = [];
  let last = null;
  while (out.length < max) {
    const after = last ? `&${key}=gt.${encodeURIComponent(last)}` : '';
    const rows = await sbFn(`${table}?select=${select}${filter}${after}&order=${key}.asc&limit=${pageSize}`);
    out.push(...rows);
    if (rows.length < pageSize) break;
    last = rows[rows.length - 1][key];
  }
  return out.slice(0, max);
}

export async function fetchUntaggedJobs({ limit = Infinity, sbFn = sb, now = new Date().toISOString(), log = console.log } = {}) {
  const done = new Set((await keysetAll('job_enrichment', { select: 'job_id', key: 'job_id', sbFn })).map((r) => r.job_id));
  log(`[tag-jobs] ${done.size} listings already enriched`);
  const visible = `&availability_status=eq.active&expires_at=gt.${encodeURIComponent(now)}`;
  const out = [];
  let last = null;
  while (out.length < limit) {
    const after = last ? `&id=gt.${last}` : '';
    const rows = await sbFn(`jobs?select=${JOB_COLS}${visible}${after}&order=id.asc&limit=1000`);
    for (const j of rows) if (!done.has(j.id) && out.length < limit) out.push(j);
    if (rows.length < 1000) break;
    last = rows[rows.length - 1].id;
  }
  return out;
}

// Upsert in chunks. A listing can be deleted by the stale sweep between selection and write; that
// FK violation would sink its whole chunk, so on 23503 the chunk is re-filtered to surviving jobs
// and retried once (the dropped rows are counted, not silently lost).
export async function upsertRows(rows, { sbFn = sb, chunk = UPSERT_CHUNK, log = console.log } = {}) {
  let written = 0, droppedDeleted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    let part = rows.slice(i, i + chunk);
    const post = (body) => sbFn('job_enrichment?on_conflict=job_id', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=minimal' });
    try {
      await post(part);
    } catch (e) {
      if (!/23503|foreign key/i.test(String(e.message))) throw e;
      const alive = new Set();
      for (let k = 0; k < part.length; k += 100) {
        const ids = part.slice(k, k + 100).map((r) => r.job_id).join(',');
        for (const j of await sbFn(`jobs?select=id&id=in.(${ids})`)) alive.add(j.id);
      }
      const kept = part.filter((r) => alive.has(r.job_id));
      droppedDeleted += part.length - kept.length;
      part = kept;
      if (part.length) await post(part);
    }
    written += part.length;
    log(`[tag-jobs] wrote ${written}/${rows.length}`);
  }
  return { written, droppedDeleted };
}

export function statsOf(rows) {
  const tally = (f) => rows.reduce((m, r) => { const k = r[f] ?? 'null'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const agencies = {};
  const signals = {};
  for (const r of rows) {
    if (r.agency_name) agencies[r.agency_name] = (agencies[r.agency_name] || 0) + 1;
    for (const g of r.ghost_signals || []) signals[g] = (signals[g] || 0) + 1;
    for (const f of r.red_flags || []) signals[`red:${f}`] = (signals[`red:${f}`] || 0) + 1;
  }
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
  return {
    total: rows.length,
    posted_by: sorted(tally('posted_by')),
    agencies: sorted(agencies),
    is_remote: sorted(tally('is_remote')),
    seniority: sorted(tally('seniority')),
    with_pay: rows.filter((r) => r.salary_min != null || r.salary_max != null).length,
    signals: sorted(signals),
  };
}

// ---------- CLI ----------

function readResultsJsonl(label) {
  const path = join(RUNS_DIR, label, 'results.jsonl');
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') throw new Error(`no saved results at ${path}`); throw e; }
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const { custom_id, result } = JSON.parse(line);
    map.set(custom_id, result);
  }
  return map;
}

async function writePhase({ label, results, jobsById, agencyIndex, dryRun }) {
  const dir = join(RUNS_DIR, label);
  mkdirSync(dir, { recursive: true });
  const { rows, report } = rowsFromResults(results, { agencyIndex });
  if (jobsById) report.companyIsAgencyButDirect = companyAgencyDisagreements(rows, jobsById, agencyIndex);
  writeFileSync(join(dir, 'validation.json'), JSON.stringify(report, null, 2));
  if (jobsById) {
    // A side-by-side sample for a human spot-check before the full run.
    const sample = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 30)) === 0).slice(0, 30)
      .map((r) => ({ id: r.job_id, company: jobsById.get(r.job_id)?.company, source: listingText(jobsById.get(r.job_id) || {}), extraction: r }));
    writeFileSync(join(dir, 'review-sample.json'), JSON.stringify(sample, null, 2));
  }
  console.log(`[${label}] ${report.rows} valid rows from ${report.results} results · errors ${JSON.stringify(report.errors)} · field issues ${JSON.stringify(report.fieldIssues)}`);
  console.log(`[${label}] ${JSON.stringify(statsOf(rows).posted_by)}`);
  if (dryRun) { console.log(`[${label}] not written (--dry-run / --no-write). Review, then: node scripts/credit/tag-jobs.mjs write --label ${label}`); return; }
  const { written, droppedDeleted } = await upsertRows(rows);
  console.log(`[${label}] upserted ${written} job_enrichment rows${droppedDeleted ? ` (${droppedDeleted} skipped: listing deleted since selection)` : ''}`);
}

async function main() {
  const cmd = process.argv[2];
  const agencies = await loadAgencies();
  const agencyIndex = buildAgencyIndex(agencies);
  const dryRun = isDryRun();

  if (cmd === 'run') {
    const limitArg = argValue('limit');
    const limit = limitArg ? Number(limitArg) : Infinity;
    if (limitArg && !(limit > 0)) throw new Error('--limit must be a positive number');
    const descChars = Number(argValue('desc-chars', DEFAULT_DESC_CHARS));
    const label = argValue('label', `tag-jobs-${new Date().toISOString().slice(0, 10)}${Number.isFinite(limit) ? `-n${limit}` : '-all'}`);
    const jobsFile = argValue('jobs-file');
    const jobs = jobsFile ? JSON.parse(readFileSync(jobsFile, 'utf8')).slice(0, limit) : await fetchUntaggedJobs({ limit });
    if (!jobs.length) { console.log('[tag-jobs] nothing to tag — every visible listing already has a job_enrichment row'); return; }
    const system = buildSystemPrompt(agencies);
    const requests = buildRequests(jobs, { system, descChars });
    const { results, dryRun: dr } = await runBatch({ label, requests, estimate: { expectedOutTokens: 220 } });
    if (dr) {
      console.log(`\n[${label}] system prompt (${system.length} chars, identical on every request, cache_control set):\n${system}\n`);
      for (const r of requests.slice(0, 3)) {
        const { system: _s, ...rest } = r.params;
        console.log(JSON.stringify({ custom_id: r.custom_id, params: { ...rest, system: '<as above>' } }, null, 2));
      }
      return;
    }
    const jobsById = new Map(jobs.map((j) => [j.id, j]));
    await writePhase({ label, results, jobsById, agencyIndex, dryRun: process.argv.includes('--no-write') });
    return;
  }

  if (cmd === 'write') {
    const label = argValue('label');
    if (!label) throw new Error('write needs --label <the run label>');
    await writePhase({ label, results: readResultsJsonl(label), jobsById: null, agencyIndex, dryRun });
    return;
  }

  if (cmd === 'stats') {
    const rows = await keysetAll('job_enrichment', { select: 'job_id,posted_by,agency_name,is_remote,seniority,salary_min,salary_max,ghost_signals,red_flags', key: 'job_id' });
    console.log(JSON.stringify(statsOf(rows), null, 2));
    return;
  }

  console.log('usage: node scripts/credit/tag-jobs.mjs run [--limit N] [--label L] [--dry-run] [--no-write] [--desc-chars N] [--jobs-file f.json]\n' +
    '       node scripts/credit/tag-jobs.mjs write --label L [--dry-run]\n' +
    '       node scripts/credit/tag-jobs.mjs stats');
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
