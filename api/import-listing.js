// Paste-a-link listing import — POST { url, title?, company?, location? }
//
// Takes a job-listing URL from ANY site (Indeed, LinkedIn, Greenhouse, a company's own
// careers page, …), resolves the listing server-side, saves it into the same jobs corpus
// the search uses (creating the company via upsertJobs), and returns the listing in the
// UI shape — so an imported job flows through the exact same Apply & Optimize pipeline
// as a searched one, with apply_url pointing back at the original listing.
//
// RESOLUTION LADDER (all $0/keyless — owner decision: no paid APIs):
//   1. Direct page fetch → JSON-LD JobPosting → og/meta+title heuristics → URL slug,
//      plus Indeed's embedded JSON fields (they don't publish JSON-LD).
//   2. Public keyless ATS JSON APIs (Greenhouse/Lever/Ashby/SmartRecruiters/Workday).
//   3. Bot-wall recovery (Indeed/LinkedIn/Glassdoor block datacenter fetches):
//      Indeed mobile page → r.jina.ai reader (real-browser fetcher) → Indeed
//      rpc/jobdescs. See lib/server/listingImport.js alternateFetchPlans().
// Only if EVERY rung fails do we return needs_details and ask the user — never guess.
//
// GET ?url=…&dry=1 is a WRITE-FREE diagnostic: runs the same ladder and reports what
// each rung produced (no DB writes, same rate limit) — how walled-host extraction is
// verified against the real deployment and debugged from the Vercel logs.
//
// No LLM, no credits — deterministic scraping only. Rate limited per IP.

import dns from 'node:dns/promises';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { upsertJobs, inferLevel } from '../lib/server/jobSources.js';
import { recomputeCompanyScoreFromReports } from './_utils/reportWrite.js';
import {
  validateListingUrl,
  isPrivateIp,
  extractListingFromHtml,
  buildImportedJobRow,
  atsApiPlan,
  mapAtsJson,
  companyFromUrl,
  titleFromUrl,
  indeedJobKey,
  indeedEmbeddedFields,
  alternateFetchPlans,
  parseJinaReader,
  browserHeaders,
} from '../lib/server/listingImport.js';

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 9000;
const JINA_TIMEOUT_MS = 25000; // the reader renders with a real browser — give it room
const BODY_CAP_BYTES = 3_000_000;

// A default UA string for the sub-fetches that don't build a full browser profile
// (ATS JSON APIs, which want a plain client, not a navigation).
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ── Per-host politeness cooldown ─────────────────────────────────────────────────
// The surest way to get flagged as a bot is a burst of requests to one host. We keep a
// module-scoped last-hit timestamp per host (warm across invocations on a reused
// instance) and, if we hit the same host within the window, wait out the remainder
// before firing. Low-volume by nature (one paste = a few fetches), so this just spaces
// the rare same-host bursts — it never meaningfully delays a normal import.
const HOST_COOLDOWN_MS = 1500;
const _lastHostHit = new Map();
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function hostCooldown(host) {
  const now = Date.now();
  const last = _lastHostHit.get(host) || 0;
  const wait = HOST_COOLDOWN_MS - (now - last);
  if (wait > 0 && wait <= HOST_COOLDOWN_MS) await _sleep(wait);
  _lastHostHit.set(host, Date.now());
  // Bound the map so a long-lived instance can't grow it without limit.
  if (_lastHostHit.size > 500) _lastHostHit.delete(_lastHostHit.keys().next().value);
}

// Every host we connect to (including each redirect hop) must resolve to public
// addresses only — the hostname-level checks in validateListingUrl can't see DNS.
async function assertResolvesPublic(host) {
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) {
    if (isPrivateIp(bare)) throw new Error('unreachable');
    return;
  }
  let addrs;
  try { addrs = await dns.lookup(bare, { all: true, verbatim: true }); }
  catch { throw new Error('unresolvable'); }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('unreachable');
}

async function readBodyCapped(res) {
  const reader = res.body?.getReader ? res.body.getReader() : null;
  if (!reader) return (await res.text()).slice(0, BODY_CAP_BYTES);
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.byteLength;
    if (total >= BODY_CAP_BYTES) { try { await reader.cancel(); } catch { /* already done */ } break; }
  }
  return Buffer.concat(chunks).toString('utf8');
}

// One redirect-following fetch with a given header set. Returns {html, finalUrl,
// blocked, status}. Every hop is re-validated (a public host 302-ing to an internal
// address is the classic SSRF bypass) and paced by the per-host cooldown.
async function fetchOnce(startUrl, headers, timeoutMs) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const v = validateListingUrl(url);
    if (!v.ok) return { html: '', finalUrl: startUrl, blocked: true, status: 0 };
    await assertResolvesPublic(v.host);
    await hostCooldown(v.host);

    const ctrl = new AbortController();
    const tmo = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(v.url, { headers, redirect: 'manual', signal: ctrl.signal });
    } finally { clearTimeout(tmo); }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { html: '', finalUrl: v.url, blocked: true, status: res.status };
      url = new URL(loc, v.url).toString();
      continue;
    }
    if (!res.ok) return { html: '', finalUrl: v.url, blocked: true, status: res.status };

    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype && !/(text\/html|application\/xhtml|text\/plain|application\/xml|application\/json|text\/markdown)/.test(ctype)) {
      return { html: '', finalUrl: v.url, blocked: true, status: res.status };
    }
    return { html: await readBodyCapped(res), finalUrl: v.url, blocked: false, status: res.status };
  }
  return { html: '', finalUrl: startUrl, blocked: true, status: 0 };
}

// Fetch a listing page as a real browser would: a complete, self-consistent header set
// (see browserHeaders), rotated per attempt, plus a polite per-host cooldown. If a host
// answers with a block/challenge status (403/429/503), we don't hammer — we back off
// briefly and retry ONCE with a different browser profile, which clears the common
// "one identical fingerprint repeated" heuristic without pretending to be something
// we're not. `seed` varies the profile; `mobile`/`accept` are passed through.
// A blocked result still flows to the next recovery rung, so this only ever helps.
let _reqSeed = 0;
async function fetchListingPage(startUrl, { timeoutMs = FETCH_TIMEOUT_MS, headers = null, mobile = false, accept } = {}) {
  const seed = _reqSeed++;
  const hdrs = headers || browserHeaders(startUrl, { seed, mobile, accept });
  let out = await fetchOnce(startUrl, hdrs, timeoutMs);
  // Retry once on an explicit block/challenge with a fresh profile + short backoff.
  if (out.blocked && [403, 429, 503].includes(out.status) && !headers) {
    await _sleep(700 + (seed % 3) * 400);
    const retryHdrs = browserHeaders(startUrl, { seed: seed + 1, mobile, accept });
    const retry = await fetchOnce(startUrl, retryHdrs, timeoutMs);
    if (!retry.blocked) return retry;
    out = retry.status ? retry : out;
  }
  return out;
}

const sanitizeField = (val, max) => String(val || '').replace(/[<>`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// Extract from raw HTML: the generic ladder + Indeed's embedded JSON (merged in — Indeed
// doesn't publish JSON-LD, its data lives in window._initialData style script JSON).
function harvest(html, url) {
  const fields = extractListingFromHtml(html, url);
  if (indeedJobKey(url) || /(^|\.)indeed\.com/.test((() => { try { return new URL(url).hostname; } catch { return ''; } })())) {
    const emb = indeedEmbeddedFields(html);
    if (emb) {
      return {
        ...fields,
        title: fields.title || emb.title,
        company: fields.company || emb.company,
        location: fields.location || emb.location,
        description: (fields.description && fields.description.length > 200) ? fields.description : (emb.description || fields.description),
        via: fields.via === 'none' && (emb.title || emb.description) ? 'indeed-embedded' : fields.via,
      };
    }
  }
  return fields;
}

const fieldsComplete = (f) => !!(f.title && f.company && f.description && f.description.length >= 80);
const mergeMissing = (base, extra, via) => ({
  ...base,
  title: base.title || extra.title || '',
  company: base.company || extra.company || '',
  location: base.location || extra.location || '',
  salary: base.salary || extra.salary || null,
  salaryMin: base.salaryMin || extra.salaryMin || 0,
  description: base.description || extra.description || '',
  type: extra.type === 'Part-time' ? 'Part-time' : base.type,
  via: base.description || !extra.description ? base.via : via,
});

// ── Full resolution ladder for a validated URL. Returns { fields, rungs, blocked }. ──
// `rungs` records what actually happened per attempt — surfaced by the GET diagnostic
// and logged for every import so walled-host failures are visible in Vercel logs.
async function resolveListing(v) {
  const rungs = [];

  // Rung 1: direct page fetch
  let page = { html: '', finalUrl: v.url, blocked: true, status: 0 };
  try { page = await fetchListingPage(v.url); }
  catch (e) {
    if (e.message === 'unreachable' || e.message === 'unresolvable') throw e;
    rungs.push({ rung: 'direct', error: e.message });
  }
  let fields = harvest(page.html, v.url);
  rungs.push({ rung: 'direct', status: page.status, blocked: page.blocked, via: fields.via, got: { title: !!fields.title, company: !!fields.company, desc: fields.description.length } });

  // Rung 2: keyless ATS JSON APIs (Greenhouse/Lever/Ashby/SmartRecruiters/Workday)
  if (!fieldsComplete(fields)) {
    const plan = atsApiPlan(v.url);
    if (plan) {
      try {
        const pv = validateListingUrl(plan.apiUrl);
        if (pv.ok) {
          await assertResolvesPublic(pv.host);
          const ctrl = new AbortController();
          const tmo = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
          let json = null;
          try {
            const r = await fetch(pv.url, { headers: { Accept: 'application/json', 'User-Agent': DEFAULT_UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: ctrl.signal });
            if (r.ok) json = JSON.parse(await readBodyCapped(r));
          } finally { clearTimeout(tmo); }
          const mapped = mapAtsJson(plan, json);
          if (mapped) {
            // API values beat rung-3 URL-slug guesses ("Acme Corp" vs "Acmecorp").
            const pageTitle = fields.title && fields.title !== titleFromUrl(v.url) ? fields.title : '';
            const pageCompany = fields.company && fields.company !== companyFromUrl(v.url) ? fields.company : '';
            fields = mergeMissing({ ...fields, title: pageTitle, company: pageCompany }, mapped, 'ats-api');
            rungs.push({ rung: 'ats-api', kind: plan.kind, got: { title: !!fields.title, company: !!fields.company, desc: fields.description.length } });
          } else {
            rungs.push({ rung: 'ats-api', kind: plan.kind, empty: true });
          }
        }
      } catch (e) { rungs.push({ rung: 'ats-api', error: e.message }); }
    }
  }

  // Rung 3: bot-wall recovery (Indeed mobile → jina reader → Indeed rpc/jobdescs).
  if (!fieldsComplete(fields)) {
    for (const plan of alternateFetchPlans(v.url)) {
      if (fieldsComplete(fields)) break;
      try {
        if (plan.kind === 'html') {
          // Indeed's m/ page is a mobile surface — use the iPhone profile so the UA
          // matches what we're hitting (a desktop UA on a mobile URL is a tell).
          const alt = await fetchListingPage(plan.url, { mobile: /\/m\//.test(plan.url) });
          const got = harvest(alt.html, plan.url);
          fields = mergeMissing(fields, got, got.via);
          rungs.push({ rung: plan.label, status: alt.status, blocked: alt.blocked, got: { title: !!fields.title, company: !!fields.company, desc: fields.description.length } });
        } else if (plan.kind === 'jina') {
          // Ask for rendered HTML (both header spellings — the reader has used each);
          // fall back to parsing its markdown format if that's what comes back.
          const alt = await fetchListingPage(plan.url, {
            timeoutMs: JINA_TIMEOUT_MS,
            headers: { Accept: 'text/html,text/plain;q=0.9', 'X-Return-Format': 'html', 'X-Respond-With': 'html', 'User-Agent': DEFAULT_UA },
          });
          if (alt.html) {
            const looksHtml = /<html|<head|<body|<script|<meta/i.test(alt.html.slice(0, 2000));
            const got = looksHtml ? harvest(alt.html, v.url) : (parseJinaReader(alt.html, v.url) || {});
            fields = mergeMissing(fields, got, got.via || 'jina');
          }
          rungs.push({ rung: 'jina', status: alt.status, blocked: alt.blocked, got: { title: !!fields.title, company: !!fields.company, desc: fields.description.length } });
        } else if (plan.kind === 'indeed-rpc') {
          const alt = await fetchListingPage(plan.url);
          if (alt.html && !fields.description) {
            try {
              const json = JSON.parse(alt.html);
              const descHtml = json?.[plan.jk] || Object.values(json || {})[0] || '';
              if (typeof descHtml === 'string' && descHtml.length > 80) {
                fields = mergeMissing(fields, { description: descHtml }, 'indeed-rpc');
              }
            } catch { /* not JSON — wall page */ }
          }
          rungs.push({ rung: 'indeed-rpc', status: alt.status, blocked: alt.blocked, got: { title: !!fields.title, company: !!fields.company, desc: fields.description.length } });
        }
      } catch (e) { rungs.push({ rung: plan.label, error: e.message }); }
    }
  }

  // Rung 4: the URL itself already ran inside extractListingFromHtml; nothing left.
  return { fields, rungs, blocked: page.blocked };
}

const toUi = (row) => ({
  id: row.id || null,
  title: row.title,
  company: row.company,
  location: row.location || '',
  salary: row.salary || null,
  url: row.apply_url,
  apply_url: row.apply_url,
  description: row.description || '',
  type: row.type || 'Full-time',
  level: row.level || inferLevel(row.title || ''),
  source: row.source || 'Imported',
  // Honest nulls — an unrated import renders as "unrated", never a fabricated number.
  score: row.score ?? null,
  waste_score: row.waste_score ?? null,
  posted_at: row.created_at || null,
});

export default async function handler(req, res) {
  if (await applyRateLimit(req, res, 'import-listing')) return;

  // Write-free diagnostic: GET ?url=…&dry=1 → run the ladder, report the rungs, write
  // NOTHING. (POST remains the only path that persists anything.)
  const isDry = req.method === 'GET';
  if (isDry) {
    const qs = new URL(req.url, 'https://x').searchParams;
    if (qs.get('dry') !== '1') return res.status(405).json({ error: 'Method not allowed' });
    const v = validateListingUrl(qs.get('url'));
    if (!v.ok) return res.status(400).json({ error: v.error });
    try {
      const { fields, rungs, blocked } = await resolveListing(v);
      return res.status(200).json({
        ok: true, dry: true, blocked,
        fields: { title: fields.title, company: fields.company, location: fields.location, salary: fields.salary, via: fields.via, description_length: fields.description.length, description_head: fields.description.slice(0, 300) },
        rungs,
      });
    } catch (err) {
      if (err.message === 'unreachable' || err.message === 'unresolvable') return res.status(400).json({ error: 'That link isn’t reachable from here.' });
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};

  const v = validateListingUrl(body.url);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Service unavailable — try again shortly.' });
  const dbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Admin-confirmed dead posting? An import must not resurrect a listing a user
    // reported and an admin verified as gone (suppressed_listings) — tell the user
    // the truth instead of re-adding a zombie.
    const suppressed = await fetch(
      `${SUPABASE_URL}/rest/v1/suppressed_listings?apply_url=eq.${encodeURIComponent(v.url)}&select=apply_url&limit=1`,
      { headers: dbHeaders }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (Array.isArray(suppressed) && suppressed[0]) {
      return res.status(410).json({ error: 'This listing was reported by applicants and confirmed no longer active.' });
    }

    // Already imported (same canonical URL) → return the existing listing. EXCEPT when
    // that row is description-less (early imports saved before the recovery ladder
    // existed — the optimizer had nothing to work from): re-run the ladder and backfill
    // the description + salary + earned score onto the row, so re-pasting a hollow
    // listing self-heals it.
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/jobs?apply_url=eq.${encodeURIComponent(v.url)}&select=id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,created_at&limit=1`,
      { headers: dbHeaders }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (Array.isArray(existing) && existing[0]) {
      const ex = existing[0];
      if ((ex.description || '').length < 80) {
        try {
          const { fields } = await resolveListing(v);
          if (fields.description && fields.description.length >= 80) {
            const enriched = buildImportedJobRow({
              title: ex.title,
              company: ex.company,
              location: fields.location || ex.location,
              salary: fields.salary || ex.salary,
              salaryMin: fields.salaryMin,
              description: fields.description,
              type: ex.type,
            }, v.url);
            if (enriched) {
              const patch = { description: enriched.description, salary: enriched.salary ?? ex.salary, score: enriched.score, waste_score: enriched.waste_score, last_checked_at: new Date().toISOString() };
              await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(ex.id)}`, {
                method: 'PATCH', headers: { ...dbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
              }).catch(() => {});
              console.log(`IMPORT ENRICHED: "${ex.title}" @ "${ex.company}" — backfilled ${enriched.description.length}-char description (via ${fields.via})`);
              return res.status(200).json({ ok: true, job: toUi({ ...ex, ...patch }), existing: true, stored: true, enriched: true });
            }
          }
        } catch { /* keep the existing row as-is */ }
      }
      return res.status(200).json({ ok: true, job: toUi(ex), existing: true, stored: true });
    }

    // Run the full resolution ladder.
    let fields = { title: '', company: '', location: '', salary: null, salaryMin: 0, description: '', type: 'Full-time', via: 'none' };
    let rungs = [];
    try {
      ({ fields, rungs } = await resolveListing(v));
    } catch (e) {
      if (e.message === 'unreachable' || e.message === 'unresolvable') {
        return res.status(400).json({ error: 'That link isn’t reachable from here.' });
      }
      rungs = [{ rung: 'direct', error: e.message }];
    }

    // User-supplied fields (second call after needs_details) always win.
    const manual = {
      title: sanitizeField(body.title, 200),
      company: sanitizeField(body.company, 120),
      location: sanitizeField(body.location, 120),
    };
    const fieldsMerged = {
      ...fields,
      title: manual.title || fields.title,
      company: manual.company || fields.company,
      location: manual.location || fields.location,
    };

    if (!fieldsMerged.title || !fieldsMerged.company) {
      // Visible in Vercel logs: which rungs ran and what each produced — the trail for
      // any future "site can't read X listings" report.
      console.warn(`IMPORT UNRESOLVED: ${v.host} — ${JSON.stringify(rungs)}`);
      return res.status(200).json({
        ok: true,
        needs_details: true,
        draft: {
          title: fieldsMerged.title || '',
          company: fieldsMerged.company || '',
          location: fieldsMerged.location || '',
        },
        page_fetched: rungs.some(r => r.blocked === false),
      });
    }

    const row = buildImportedJobRow(fieldsMerged, v.url);
    if (!row) return res.status(422).json({ error: 'Couldn’t build a listing from that link.' });

    // upsertJobs creates the company (companies table) and inserts the job. A zero-row
    // result means the exact (title, company, location) already exists from aggregation
    // (jobs_uniq) — surface THAT row so the import still lands on a real listing.
    const stitch = (rows) => (Array.isArray(rows) && rows[0] ? { ...row, id: rows[0].id, created_at: rows[0].created_at } : null);
    let saved = stitch((await upsertJobs([row], SUPABASE_URL, SUPABASE_SERVICE_KEY)).rows);

    if (!saved) {
      const dupe = await fetch(
        `${SUPABASE_URL}/rest/v1/jobs?title=eq.${encodeURIComponent(row.title)}&company=eq.${encodeURIComponent(row.company)}&location=eq.${encodeURIComponent(row.location)}&select=id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,created_at&limit=1`,
        { headers: dbHeaders }
      ).then(r => (r.ok ? r.json() : [])).catch(() => []);
      if (Array.isArray(dupe) && dupe[0]) {
        return res.status(200).json({ ok: true, job: toUi(dupe[0]), existing: true, stored: true });
      }
      // Not a duplicate — the insert itself failed (transient DB hiccup). Every import
      // is a user-contributed listing feeding the corpus, so persisting it is part of
      // the feature, not a nice-to-have: retry once, and if it still won't land, log it
      // and say so in the response rather than reporting silent success.
      saved = stitch((await upsertJobs([row], SUPABASE_URL, SUPABASE_SERVICE_KEY)).rows);
      if (!saved) {
        logError('import-listing', 'listing not persisted after retry', { url: v.url, title: row.title, company: row.company });
        return res.status(200).json({ ok: true, job: toUi(row), stored: false, via: fields.via });
      }
    }

    // Every import feeds the company graph too (owner decision 2026-07-10): the company
    // row was created by upsertJobs; now refresh its stored score from all evidence we
    // hold (reports corpus + confirmed-stale registry — deterministic, $0, no LLM).
    // Companies with zero evidence stay honestly unscored ("no data yet"), never invented.
    // Awaited (not fire-and-forget): Vercel freezes the function right after the response.
    try { await recomputeCompanyScoreFromReports(SUPABASE_URL, dbHeaders, saved.company); } catch { /* best-effort */ }

    console.log(`IMPORTED: "${row.title}" @ "${row.company}" from ${v.host} (via ${fields.via}${manual.title || manual.company ? ' + manual' : ''}) rungs=${JSON.stringify(rungs)}`);
    return res.status(200).json({ ok: true, job: toUi(saved), stored: true, via: fields.via });
  } catch (err) {
    logError('import-listing', err.message, { url: v.url });
    return res.status(500).json({ error: 'Import failed — try again.' });
  }
}
