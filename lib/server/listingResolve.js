// Network side of the employer listing-link preview: the full resolution ladder with its SSRF
// guards (every hop re-validated + DNS-checked to public addresses), polite per-host pacing,
// and bot-wall recovery. Public seeker URL imports were removed; local OpenCLI ingestion writes
// finished Indeed listings through api/ingest-local-indeed.js. The pure extraction helpers live
// in ./listingImport.js.
//
// resolveListing(v) takes a validateListingUrl() result and returns { fields, rungs, blocked }.
// It throws Error('unreachable' | 'unresolvable') when the host resolves to a private/invalid
// address — callers turn that into a 400.

import dns from 'node:dns/promises';
import {
  validateListingUrl,
  isPrivateIp,
  extractListingFromHtml,
  atsApiPlan,
  mapAtsJson,
  companyFromUrl,
  titleFromUrl,
  indeedJobKey,
  indeedEmbeddedFields,
  alternateFetchPlans,
  parseJinaReader,
  browserHeaders,
} from './listingImport.js';

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

const MIN_DESC = 80;
const fieldsComplete = (f) => !!(f.title && f.company && f.description && f.description.length >= MIN_DESC);
// A thin description (< MIN_DESC — e.g. a 22-char og:description that is just the location) must
// not block a full one from a later rung: keep the base only when it is already usable, else take
// the longer of the two. (It used to keep ANY non-empty base, so the Greenhouse API's full JD was
// thrown away whenever the page had a meta snippet.)
const pickDescription = (a = '', b = '') => (a.length >= MIN_DESC ? a : (b.length > a.length ? b : a));
const mergeMissing = (base, extra, via) => {
  const description = pickDescription(base.description || '', extra.description || '');
  return {
    ...base,
    title: base.title || extra.title || '',
    company: base.company || extra.company || '',
    location: base.location || extra.location || '',
    salary: base.salary || extra.salary || null,
    salaryMin: base.salaryMin || extra.salaryMin || 0,
    description,
    type: extra.type === 'Part-time' ? 'Part-time' : base.type,
    via: description && description !== (base.description || '') ? via : base.via,
  };
};

// ── Full resolution ladder for a validated URL. Returns { fields, rungs, blocked }. ──
// `rungs` records what actually happened per attempt — surfaced by the GET diagnostic
// and logged for every import so walled-host failures are visible in Vercel logs.
export async function resolveListing(v) {
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
