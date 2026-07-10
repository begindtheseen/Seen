// Paste-a-link listing import — POST { url, title?, company?, location? }
//
// Takes a job-listing URL from ANY site (Indeed, LinkedIn, Greenhouse, a company's own
// careers page, …), fetches it server-side, extracts the listing (JSON-LD JobPosting →
// meta/title heuristics → URL slug), saves it into the same jobs corpus the search uses
// (creating the company via upsertJobs), and returns the listing in the UI shape — so an
// imported job flows through the exact same Apply & Optimize pipeline as a searched one,
// with apply_url pointing back at the original listing.
//
// Honesty contract: when the page is bot-walled or unstructured and we can't determine
// title/company, we return needs_details:true with whatever WAS extracted and let the
// user fill in the rest — never a guessed value. The optional title/company/location in
// the request body are those user-provided answers on the second call.
//
// No LLM, no credits — deterministic scraping only. Rate limited per IP.

import dns from 'node:dns/promises';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { upsertJobs, inferLevel } from '../lib/server/jobSources.js';
import {
  validateListingUrl,
  isPrivateIp,
  extractListingFromHtml,
  buildImportedJobRow,
} from '../lib/server/listingImport.js';

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 9000;
const BODY_CAP_BYTES = 3_000_000;

// Browser-like headers — many boards serve structured pages to browsers but a bare
// bot-wall to default fetch UAs. We identify honestly in Referer-free requests; if the
// site still blocks us the user just fills in title/company by hand.
const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

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

// Fetch the listing page with manual redirect handling so every hop is re-validated
// (a public host 302-ing to an internal address is the classic SSRF bypass).
// Returns { html, finalUrl, blocked, status }.
async function fetchListingPage(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const v = validateListingUrl(url);
    if (!v.ok) return { html: '', finalUrl: startUrl, blocked: true, status: 0 };
    await assertResolvesPublic(v.host);

    const ctrl = new AbortController();
    const tmo = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(v.url, { headers: PAGE_HEADERS, redirect: 'manual', signal: ctrl.signal });
    } finally { clearTimeout(tmo); }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { html: '', finalUrl: v.url, blocked: true, status: res.status };
      url = new URL(loc, v.url).toString();
      continue;
    }
    if (!res.ok) return { html: '', finalUrl: v.url, blocked: true, status: res.status };

    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype && !/(text\/html|application\/xhtml|text\/plain|application\/xml)/.test(ctype)) {
      return { html: '', finalUrl: v.url, blocked: true, status: res.status };
    }
    return { html: await readBodyCapped(res), finalUrl: v.url, blocked: false, status: res.status };
  }
  return { html: '', finalUrl: startUrl, blocked: true, status: 0 };
}

const sanitizeField = (val, max) => String(val || '').replace(/[<>`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

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
    // Already imported (same canonical URL) → return the existing listing. Also refreshes
    // nothing: the user's saved copy stays exactly what they imported.
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/jobs?apply_url=eq.${encodeURIComponent(v.url)}&select=id,title,company,location,salary,apply_url,description,type,level,source,score,waste_score,created_at&limit=1`,
      { headers: dbHeaders }
    ).then(r => (r.ok ? r.json() : [])).catch(() => []);
    if (Array.isArray(existing) && existing[0]) {
      return res.status(200).json({ ok: true, job: toUi(existing[0]), existing: true });
    }

    // Fetch + extract. A blocked/unreadable page is NOT a dead end — the URL itself and
    // the user's own answers can still complete the import.
    let page = { html: '', finalUrl: v.url, blocked: true, status: 0 };
    try { page = await fetchListingPage(v.url); }
    catch (e) {
      if (e.message === 'unreachable' || e.message === 'unresolvable') {
        return res.status(400).json({ error: 'That link isn’t reachable from here.' });
      }
      // timeout / network error — proceed with URL-only extraction
    }

    const extracted = extractListingFromHtml(page.html, v.url);

    // User-supplied fields (second call after needs_details) always win.
    const manual = {
      title: sanitizeField(body.title, 200),
      company: sanitizeField(body.company, 120),
      location: sanitizeField(body.location, 120),
    };
    const fieldsMerged = {
      ...extracted,
      title: manual.title || extracted.title,
      company: manual.company || extracted.company,
      location: manual.location || extracted.location,
    };

    if (!fieldsMerged.title || !fieldsMerged.company) {
      return res.status(200).json({
        ok: true,
        needs_details: true,
        draft: {
          title: fieldsMerged.title || '',
          company: fieldsMerged.company || '',
          location: fieldsMerged.location || '',
        },
        page_fetched: !page.blocked,
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
        return res.status(200).json({ ok: true, job: toUi(row), stored: false, via: extracted.via });
      }
    }

    console.log(`IMPORTED: "${row.title}" @ "${row.company}" from ${v.host} (via ${extracted.via}${manual.title || manual.company ? ' + manual' : ''})`);
    return res.status(200).json({ ok: true, job: toUi(saved), stored: true, via: extracted.via });
  } catch (err) {
    logError('import-listing', err.message, { url: v.url });
    return res.status(500).json({ error: 'Import failed — try again.' });
  }
}
