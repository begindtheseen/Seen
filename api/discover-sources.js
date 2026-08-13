// Seen — ATS SOURCE DISCOVERY, on its own execution path.
//
// WHY THIS IS A SEPARATE FUNCTION. Discovery used to live at the tail of api/refresh-jobs.js, after
// deleteExpired/deleteJunk/markStaleJobs and the whole Adzuna sweep, running on whatever budget was
// left. It never once registered a board: company_sources sat at 27 hand-typed seeds from 2026-08-07
// with ZERO discovered_via='crawl' rows. PR #273 fixed four real defects in the sweep itself (a
// once-daily 02:00Z gate, a CDX page that never rotated, a deadline the function did not accept, and a
// summary that could not say why a zero was a zero) — and the 08-13 02:00Z run still returned zero
// while NOT being starved, which proved the defects were not the whole story.
//
// The measurement that settled it (owner probe against CC-MAIN-2026-30, 2026-08-13): every pattern
// returns HTTP 200 with real tenant rows — Common Crawl is up, not blocking, and the CDX patterns are
// correct — but the seven of them cost 19.3s SEQUENTIALLY at limit=3, with careers.smartrecruiters.com
// at 9.0s and *.recruitee.com at 7.0s on their own. That is per-pattern index seek time, not row
// transfer, so it does not shrink at the real limit=300. A sweep that costs tens of seconds cannot be
// the last thing a handler does with its leftovers. It needs its own invocation. That is this file.
//
// Nothing here is destructive: it performs no deletes, no stale marking, and no job upserts. It reads
// the Common Crawl index and upserts rows into company_sources. The scheduled refresh then ingests
// whatever it registered on the next run, because dueSources() orders last_successful_sync
// asc.nullsfirst — newly discovered boards are picked up FIRST.

import { discoverFromCommonCrawl } from '../lib/jobs/discovery.js';
import { detectAts } from '../lib/jobs/atsDetect.js';
import { mapLimit } from '../lib/server/jobSources.js';
import { logError } from '../lib/server/errlog.js';

// Must stay under the maxDuration declared for this function in vercel.json (300s), with room to
// serialize the response. Discovery gets the WHOLE budget here — that is the entire point.
const BUDGET_MS = Number(process.env.DISCOVER_SOURCES_BUDGET_MS || 240_000);

// Rotation HINT only. discoverFromCommonCrawl clamps it to each pattern's real page count, because
// these host patterns have exactly one page ({"pages":1}) and a cursor past the end is a hard CDX 400,
// not an empty result. #273 rotated blind, reached page 36, and 400ed every request for hours. ?page=N
// overrides the hint for a targeted sweep; it is still clamped.
const PAGES = 40;
const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // this endpoint's cron cadence
export const pageFor = (now = Date.now(), intervalMs = DEFAULT_INTERVAL_MS) =>
  Math.floor(now / intervalMs) % PAGES;

// Fail CLOSED, matching api/refresh-jobs.js. Authorization must never be contingent on CRON_SECRET
// being set: if that env var is blank the cron-secret path is simply unavailable and callers fall
// through to 401, rather than the endpoint becoming an open trigger for outbound crawling.
async function authorize(req) {
  if (req.headers['x-vercel-cron'] === '1') return true;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  const querySecret = new URL(req.url, 'https://x').searchParams.get('secret') || '';
  if (cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret)) return true;

  const adminToken = req.headers['x-admin-token'] || '';
  const SB = process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
  if (adminToken && SB && SK) {
    try {
      const r = await fetch(
        `${SB}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`,
        { headers: { apikey: SK, Authorization: `Bearer ${SK}` } }
      );
      const sess = r.ok ? (await r.json())?.[0] : null;
      if (sess && new Date(sess.expires_at) >= new Date()) return true;
    } catch { /* fall through to 401 */ }
  }
  return false;
}

const UA = 'SeenJobs/1.0 (+https://seenjobs.io)';

// ── PROBES ─────────────────────────────────────────────────────────────────────
// Read-only diagnostics, run FROM VERCEL because that is the only place the answers mean anything.
// A residential Mac reaches Common Crawl fine while Vercel gets 503s escalating to "fetch failed",
// so every reachability question has to be asked from inside the deployment, not from a laptop.

// REACHABILITY IS "DID WE GET AN HTTP STATUS AT ALL". A 404 proves the host answered us; only a
// throw/timeout proves it did not. Conflating those is how "CC is down" and "CC won't serve us"
// became the same observation.
async function probeUrl(label, url, { timeoutMs = 12000, headers = {}, diagnostic = true, note = null } = {}) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    try { await res.body?.cancel(); } catch { /* body not needed */ }
    return { label, url, reachable: true, status: res.status, ms: Date.now() - t0, error: null, diagnostic, note };
  } catch (e) {
    clearTimeout(timer);
    return { label, url, reachable: false, status: null, ms: Date.now() - t0, error: `${(e && e.name) || 'error'}: ${((e && e.message) || '').slice(0, 120)}`, diagnostic, note };
  }
}

// Probes chosen to separate failure stories that look identical from a single endpoint: is the CDX
// API path refusing us, is the whole index HOST refusing us, is a DIFFERENT commoncrawl.org host fine
// (host-level policy → the S3-hosted cc-index is viable), or is nothing reachable at all
// (network-level → no host swap helps).
//
// `data_key` is the target that actually decides option 2: reading a REAL cc-index object is what
// that option depends on, and a bucket ROOT cannot tell you whether you could. Override the path with
// ?ccpath=<url> (or just the collection with ?crawl=CC-MAIN-YYYY-NN) — this environment cannot reach
// Common Crawl to confirm any specific key exists, so the default is a starting point, not a claim.
//
// `raw_s3_root` is deliberately marked NON-DIAGNOSTIC. A private-ACL bucket root returns 403 to
// EVERYONE — confirmed against a residential control on 2026-08-13, which also got 403 — so a 403
// there carries no information about whether Vercel specifically is being refused. It stays in the
// output as context and is excluded from the verdict. (Reachability throughout is "returned an HTTP
// status at all"; only a throw counts as unreachable, so a 403 was never going to read as a refusal
// in the verdict logic either — but a target whose most likely answer is uninformative is a bad
// target regardless of how carefully the verdict handles it.)
async function probeCommonCrawl({ crawl = 'CC-MAIN-2026-30', ccpath = null } = {}) {
  const dataKeyUrl = ccpath || `https://data.commoncrawl.org/cc-index/collections/${encodeURIComponent(crawl)}/indexes/cluster.idx`;
  const targets = [
    ['cdx_api', 'https://index.commoncrawl.org/collinfo.json', {}],
    ['cdx_host', 'https://index.commoncrawl.org/robots.txt', {}],
    ['data_host', 'https://data.commoncrawl.org/robots.txt', {}],
    ['data_key', dataKeyUrl, { headers: { Range: 'bytes=0-1023' }, note: 'the target option 2 depends on — a real cc-index object, not a bucket root' }],
    ['raw_s3_root', 'https://commoncrawl.s3.amazonaws.com/robots.txt', { diagnostic: false, note: '403 here is expected for everyone (private-ACL bucket root) — excluded from the verdict' }],
  ];
  const results = await mapLimit(targets, 4, ([label, url, opts]) => probeUrl(label, url, opts));
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));

  const diagnostic = results.filter((r) => r.diagnostic);
  const anyAnswered = diagnostic.some((r) => r.reachable);
  const indexHostRefusing = [byLabel.cdx_api, byLabel.cdx_host].every((r) => r && (!r.reachable || r.status >= 400));
  const dataUsable = !!(byLabel.data_host?.reachable && byLabel.data_key?.reachable && byLabel.data_key.status < 400);

  const verdict = !anyAnswered
    ? 'network_level_nothing_answers'
    : dataUsable && indexHostRefusing
      ? 'host_level_cdx_refused_but_data_usable'   // option 2 viable
      : dataUsable
        ? 'all_reachable'
        : byLabel.data_host?.reachable
          ? 'data_host_answers_but_key_unreadable'  // check ccpath before concluding
          : 'data_host_unreachable_option_2_dead';

  return { probe: 'cc', verdict, crawl, data_key_url: dataKeyUrl, results };
}

// Can the employer destination behind an Adzuna stub be recovered at all?
//
// THE INSTRUMENT MATTERS MORE THAN THE NUMBER HERE, because the obvious implementation produces a
// confident wrong answer. Following redirects and treating "no throw" as success counts an Adzuna
// bot-block (HTTP 403) as a successful resolution to adzuna.com — yielding a decisive-looking
// 0% ATS rate that is really "we were blocked and never saw a destination". The owner hit exactly
// that from a residential IP on 2026-08-13. "Yield is zero" and "we were refused" are opposite
// decision inputs and must never collapse into the same output.
//
// So: a non-2xx is UNRESOLVED, never "resolved, not ATS"; every status is reported in a histogram;
// and the ATS rate is computed over genuinely-resolved responses only, staying null when there are
// none rather than rounding to a persuasive zero.
//
// Redirect-following alone is also the wrong mechanism. An inspected interstitial had no HTTP
// redirect, no meta refresh, no JS location target, and no non-Adzuna host anywhere in 13.7KB of
// HTML. So this ALSO scans the returned body for any ATS host — testing that finding across a
// sample instead of one page. If bodies resolve 200 and still contain no ATS host, the destination
// is not in the HTML at all and no amount of fetching will produce it.
//
// Both stub shapes are sampled. The corpus is 8,598 /land/ad/ and 11,734 /details/; querying only
// one shape would measure a little over half the population and call it the population.
const ADZUNA_SHAPES = [['details', '*adzuna.com/details*'], ['land_ad', '*adzuna.com/land/ad*']];
const MAX_BODY_BYTES = 250_000;

async function probeAdzuna(supabaseUrl, serviceKey, n) {
  const perShape = Math.max(1, Math.floor(n / ADZUNA_SHAPES.length));
  const stubs = [];
  for (const [shape, pattern] of ADZUNA_SHAPES) {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/jobs?source=eq.Adzuna&apply_url=ilike.${encodeURIComponent(pattern)}&select=apply_url&limit=${perShape}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!r.ok) return { probe: 'adzuna', error: `stub query failed for ${shape}: ${r.status}`, sampled: 0 };
    for (const row of (await r.json()) || []) if (row.apply_url) stubs.push({ shape, stub: row.apply_url });
  }

  const results = await mapLimit(stubs, 5, async ({ shape, stub }) => {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(stub, { headers: { 'User-Agent': UA }, signal: controller.signal, redirect: 'follow' });
      clearTimeout(timer);
      const status = res.status;
      // NON-2xx IS UNRESOLVED. This single line is the difference between "yield is zero" and
      // "we were blocked" — the whole reason this probe exists.
      if (!res.ok) {
        try { await res.body?.cancel(); } catch { /* nothing to read */ }
        return { shape, resolved: false, blocked: true, status, ms: Date.now() - t0 };
      }
      const body = (await res.text()).slice(0, MAX_BODY_BYTES);
      const final = res.url || stub;
      let host = null;
      try { host = new URL(final).hostname.replace(/^www\./, ''); } catch { /* unparseable */ }

      // The destination may not be the final URL — look for an ATS host anywhere in the page too.
      const inBody = new Map();
      for (const m of body.matchAll(/https?:\/\/[^\s"'<>\\)]+/g)) {
        const hit = detectAts(m[0]);
        if (hit && hit.ingestable) inBody.set(`${hit.provider}|${hit.tenant}`, hit.provider);
      }
      const finalHit = detectAts(final);
      return {
        shape, resolved: true, blocked: false, status, host, bytes: body.length,
        final_provider: finalHit?.ingestable ? finalHit.provider : null,
        body_providers: [...new Set(inBody.values())],
        ms: Date.now() - t0,
      };
    } catch (e) {
      clearTimeout(timer);
      return { shape, resolved: false, blocked: false, status: null, error: `${(e && e.name) || 'error'}`, ms: Date.now() - t0 };
    }
  });

  return summarizeAdzunaProbe(results);
}

// PURE, and exported for tests, because THIS is where both independent implementations of this probe
// went wrong — not in the fetching. Mocking the network would only test the mock; this classification
// is the part that turned 50 HTTP 403s into "0% yield, all destinations adzuna.com". Naming the
// failure mode did not stop either of us from writing it, so it is pinned by assertions instead.
export function summarizeAdzunaProbe(results) {
  const sortDesc = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
  const bump = (o, k) => { if (k != null) o[k] = (o[k] || 0) + 1; };

  const statuses = {}, hosts = {}, providers = {}, byShape = {};
  let resolvedCount = 0, blockedCount = 0, threwCount = 0, atsHits = 0;
  for (const x of results) {
    if (!x) continue;
    byShape[x.shape] ||= { sampled: 0, resolved: 0, blocked: 0, ats_hits: 0 };
    byShape[x.shape].sampled++;
    bump(statuses, x.status == null ? 'threw' : String(x.status));
    if (!x.resolved) { x.blocked ? blockedCount++ : threwCount++; if (x.blocked) byShape[x.shape].blocked++; continue; }
    resolvedCount++; byShape[x.shape].resolved++;
    bump(hosts, x.host);
    const hit = x.final_provider || x.body_providers?.[0] || null;
    if (hit) { atsHits++; byShape[x.shape].ats_hits++; bump(providers, hit); }
  }

  // Say which question the data actually answers.
  const verdict = resolvedCount === 0
    ? (blockedCount ? 'blocked_yield_unknown' : 'unreachable_yield_unknown')
    : atsHits === 0
      ? 'resolved_but_no_ats_in_destination_or_body'
      : 'ats_recoverable';

  return {
    probe: 'adzuna', verdict,
    sampled: results.length, resolved: resolvedCount, blocked: blockedCount, threw: threwCount,
    http_status_histogram: sortDesc(statuses),
    // Rate over RESOLVED only, and null when nothing resolved — never a persuasive zero.
    ats_ingestable_hits: atsHits,
    ats_ingestable_rate: resolvedCount ? Number((atsHits / resolvedCount).toFixed(3)) : null,
    providers: sortDesc(providers),
    destination_hosts: sortDesc(hosts),
    by_shape: byShape,
  };
}

// Does the Adzuna API already hand us a destination URL we simply never read?
//
// If it does, the entire stub-resolution question is moot — no HTML fetching, no bot-block, no
// rendering. lib/server/jobSources.js consumes only `redirect_url`, but consuming one field is not
// evidence about what the response CONTAINS. This asks the API for a single result and reports its
// field names plus the HOST of every URL-shaped value, so an unused destination field would be
// immediately visible. Field names and hosts only — never values, and never the credentialed URL.
async function probeAdzunaApi() {
  const appId = process.env.ADZUNA_APP_ID, appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { probe: 'adzuna-api', error: 'ADZUNA_APP_ID / ADZUNA_APP_KEY not set' };
  const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${encodeURIComponent(appId)}&app_key=${encodeURIComponent(appKey)}&results_per_page=1&what=engineer`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { probe: 'adzuna-api', reachable: true, status: res.status, error: `http_${res.status}`, ms: Date.now() - t0 };
    const data = await res.json();
    const job = (data.results || [])[0];
    if (!job) return { probe: 'adzuna-api', reachable: true, status: res.status, error: 'no results', ms: Date.now() - t0 };

    const urlHosts = {};
    const walk = (obj, path = '') => {
      for (const [k, v] of Object.entries(obj || {})) {
        const p = path ? `${path}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, p); continue; }
        if (typeof v === 'string' && /^https?:\/\//.test(v)) {
          try { urlHosts[p] = new URL(v).hostname; } catch { urlHosts[p] = '(unparseable)'; }
        }
      }
    };
    walk(job);
    return {
      probe: 'adzuna-api', reachable: true, status: res.status, ms: Date.now() - t0,
      top_level_fields: Object.keys(job).sort(),
      // path -> host for every URL-valued field. A non-adzuna host here would moot the HTML path.
      url_fields: urlHosts,
      carries_non_adzuna_url: Object.values(urlHosts).some((h) => !/(^|\.)adzuna\./i.test(h)),
    };
  } catch (e) {
    return { probe: 'adzuna-api', reachable: false, error: `${(e && e.name) || 'error'}: ${((e && e.message) || '').slice(0, 120)}`, ms: Date.now() - t0 };
  }
}

// Vercel crons fire as GET, so GET must reach the work — a POST-only handler would make the schedule
// a silent no-op (the mistake api/demand.js and api/reports.js already had to correct).
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await authorize(req))) return res.status(401).json({ error: 'Unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
  }

  const params = new URL(req.url, 'https://x').searchParams;

  // ?probe=cc | adzuna — read-only diagnostics. No sweep, no registry writes.
  const probe = params.get('probe');
  if (probe) {
    const t0 = Date.now();
    try {
      let out;
      if (probe === 'cc') {
        out = await probeCommonCrawl({
          crawl: params.get('crawl') || undefined,
          ccpath: params.get('ccpath') || null,
        });
      } else if (probe === 'adzuna') {
        const nRaw = Number(params.get('n'));
        const n = Number.isFinite(nRaw) ? Math.min(200, Math.max(1, Math.trunc(nRaw))) : 50;
        out = await probeAdzuna(SUPABASE_URL, SUPABASE_SERVICE_KEY, n);
      } else if (probe === 'adzuna-api') {
        out = await probeAdzunaApi();
      } else {
        return res.status(400).json({ ok: false, error: `unknown probe: ${probe} (expected cc | adzuna | adzuna-api)` });
      }
      console.log(`discover-probe ${probe}: ${JSON.stringify(out).slice(0, 900)}`);
      return res.status(200).json({ ok: true, ms: Date.now() - t0, ...out });
    } catch (e) {
      try { logError('api/discover-sources', e, { probe }); } catch { /* best-effort */ }
      return res.status(500).json({ ok: false, probe, error: e.message, ms: Date.now() - t0 });
    }
  }

  const pageParam = params.get('page');
  const limitParam = params.get('limit');
  const page = pageParam !== null && Number.isFinite(Number(pageParam))
    ? Math.abs(Math.trunc(Number(pageParam))) % PAGES
    : pageFor();
  const perPatternLimit = limitParam !== null && Number.isFinite(Number(limitParam))
    ? Math.min(1000, Math.max(1, Math.trunc(Number(limitParam))))
    : 300;

  const startedAt = Date.now();
  try {
    const summary = await discoverFromCommonCrawl({
      supabaseUrl: SUPABASE_URL,
      serviceKey: SUPABASE_SERVICE_KEY,
      perPatternLimit,
      page,
      maxRegister: 200,
      deadline: startedAt + BUDGET_MS,
    });

    // One line that states the outcome outright. The absence of exactly this is why a sweep returning
    // nothing looked identical to a sweep that never ran, for three weeks.
    console.log(
      `discover-sources: crawl=${summary.crawl} page_hint=${summary.page} ` +
      `pages_used=${JSON.stringify(summary.pages_used || [])} ` +
      `patterns=${summary.patterns_swept}/${summary.patterns_total} tenants=${summary.discovered} ` +
      `registered=${summary.registered} new=${summary.new_boards} reason=${summary.reason}` +
      `${summary.detail ? ` detail=${summary.detail}` : ''} ms=${Date.now() - startedAt}`
    );

    return res.status(200).json({
      ok: true,
      date: new Date().toISOString(),
      ms: Date.now() - startedAt,
      per_pattern_limit: perPatternLimit,
      ...summary,
    });
  } catch (e) {
    try { logError('api/discover-sources', e, { page, perPatternLimit }); } catch { /* best-effort */ }
    return res.status(500).json({ ok: false, error: e.message, ms: Date.now() - startedAt });
  }
}
