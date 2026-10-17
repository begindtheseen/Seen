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

import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { upsertJobs, inferLevel } from '../lib/server/jobSources.js';
import { recomputeCompanyScoreFromReports } from './_utils/reportWrite.js';
import { validateListingUrl, buildImportedJobRow } from '../lib/server/listingImport.js';
import { resolveListing } from '../lib/server/listingResolve.js';

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
        // Heal a hollow row: prefer a fresh auto-extraction, else the user's pasted JD.
        const pastedNow = String(body.description || '').trim().slice(0, 12000);
        let healDesc = '', healSalary = ex.salary, healSalaryMin = 0, healVia = '';
        try {
          const { fields } = await resolveListing(v);
          if (fields.description && fields.description.length >= 80) {
            healDesc = fields.description; healSalary = fields.salary || ex.salary; healSalaryMin = fields.salaryMin; healVia = fields.via;
          }
        } catch { /* fall through to pasted */ }
        if (!healDesc && pastedNow.length >= 80) { healDesc = pastedNow; healVia = 'user-paste'; }

        if (healDesc) {
          const enriched = buildImportedJobRow({
            title: ex.title, company: ex.company, location: ex.location,
            salary: healSalary, salaryMin: healSalaryMin, description: healDesc, type: ex.type,
          }, v.url);
          if (enriched) {
            const patch = { description: enriched.description, salary: enriched.salary ?? ex.salary, score: enriched.score, waste_score: enriched.waste_score, last_checked_at: new Date().toISOString() };
            await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(ex.id)}`, {
              method: 'PATCH', headers: { ...dbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
            }).catch(() => {});
            console.log(`IMPORT ENRICHED: "${ex.title}" @ "${ex.company}" — backfilled ${enriched.description.length}-char description (via ${healVia})`);
            return res.status(200).json({ ok: true, job: toUi({ ...ex, ...patch }), existing: true, stored: true, enriched: true });
          }
        }
        // Still no description and none pasted — ask for it instead of returning a hollow
        // row the optimizer can't use. Title/company are known, so only the JD is needed.
        return res.status(200).json({
          ok: true, needs_details: true, need_description: true,
          draft: { title: ex.title || '', company: ex.company || '', location: ex.location || '', description: '' },
          page_fetched: false,
        });
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

    // User-supplied fields (second call after needs_details) always win. A user-pasted
    // description is the guaranteed-reliable source for hard-walled sites (Indeed's
    // Cloudflare blocks every server-side rung from serverless IPs) — and it's the EXACT
    // JD the user is looking at, so the optimizer gets grounded, real text.
    const manualDesc = String(body.description || '').trim().slice(0, 12000);
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
      // A pasted description overrides only when the automatic one is thin/empty.
      description: (fields.description && fields.description.length >= 80) ? fields.description : (manualDesc || fields.description),
      via: manualDesc && (!fields.description || fields.description.length < 80) ? 'user-paste' : fields.via,
    };

    // Ask the user for whatever is still missing — INCLUDING the description. This is the
    // key change: we never save a hollow, description-less listing (which left the
    // optimizer with nothing). If title/company resolved automatically but the site walled
    // the description, we still surface the form so the user can paste the JD they see.
    const needTitleCo = !fieldsMerged.title || !fieldsMerged.company;
    const needDesc = !fieldsMerged.description || fieldsMerged.description.length < 80;
    if (needTitleCo || needDesc) {
      // Visible in Vercel logs: which rungs ran and what each produced — the trail for
      // any future "site can't read X listings" report.
      console.warn(`IMPORT NEEDS INPUT (${needTitleCo ? 'title/co' : ''}${needDesc ? ' desc' : ''}): ${v.host} — ${JSON.stringify(rungs)}`);
      return res.status(200).json({
        ok: true,
        needs_details: true,
        need_description: needDesc,
        draft: {
          title: fieldsMerged.title || '',
          company: fieldsMerged.company || '',
          location: fieldsMerged.location || '',
          description: fieldsMerged.description && fieldsMerged.description.length >= 80 ? fieldsMerged.description : '',
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
        return res.status(200).json({ ok: true, job: toUi(row), stored: false, via: fieldsMerged.via });
      }
    }

    // Every import feeds the company graph too (owner decision 2026-07-10): the company
    // row was created by upsertJobs; now refresh its stored score from all evidence we
    // hold (reports corpus + confirmed-stale registry — deterministic, $0, no LLM).
    // Companies with zero evidence stay honestly unscored ("no data yet"), never invented.
    // Awaited (not fire-and-forget): Vercel freezes the function right after the response.
    try { await recomputeCompanyScoreFromReports(SUPABASE_URL, dbHeaders, saved.company); } catch { /* best-effort */ }

    console.log(`IMPORTED: "${row.title}" @ "${row.company}" from ${v.host} (via ${fields.via}${manual.title || manual.company ? ' + manual' : ''}) rungs=${JSON.stringify(rungs)}`);
    return res.status(200).json({ ok: true, job: toUi(saved), stored: true, via: fieldsMerged.via });
  } catch (err) {
    logError('import-listing', err.message, { url: v.url });
    return res.status(500).json({ error: 'Import failed — try again.' });
  }
}
