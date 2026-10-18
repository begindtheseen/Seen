// Employer listings API — login-scoped to the caller's APPROVED company claim (migration 053).
//
// FOUR actions, all requiring a Supabase Bearer JWT that resolves to an approved claim:
//   • list      → every listing attached to your company (aggregated + imported + your own),
//                 annotated with origin, availability, apply count (deduped clicks + self-reports),
//                 and any OPEN dispute you've filed. This is what "heavily populated" means.
//   • create    → post your OWN listing with a click-through apply_url (jobs row, source 'Employer',
//                 migration 055 ownership stamped).
//   • dispute   → contest ANY listing on your company (inactive/delete/edit/not_ours/other). Employers
//                 never directly edit/delete an existing listing — every change is a dispute an ADMIN
//                 approves/denies (api/admin-stats.js). Filing one notifies nobody until an admin acts.
//   • disputes  → your filed disputes + their verdicts.
//   • import_preview → { url } of a listing on ANY site (your ATS, Indeed, LinkedIn, …). Runs the
//                 same resolution ladder + SSRF guards as the seeker import (lib/server/listingResolve.js)
//                 and returns the parsed fields to PREFILL the create form. Writes nothing — the
//                 employer reviews, edits and posts through `create`, so it is employer-posted and
//                 gets the same search priority as a typed-in listing.
//   • applications       → Apply-on-Seen inbox: applications candidates sent to THIS company's
//                 listings through Seen (name, email, phone, note, status). Optional { job_id }.
//   • application_status → { id, status } — move an application through new/reviewed/
//                 interviewing/rejected/hired.
//   • application_resume → { id } — a 10-minute signed URL for the résumé file (private bucket),
//                 or the résumé text when the applicant sent their saved Seen résumé.
//   • application_message → { id, text } — write to one applicant (shown on their tracker, emailed).
//                 Applicants never write back (no DMs — owner rule 2026-10-18).
//   • update      → edit your OWN posted listing in place; dated via jobs.edited_at.
//   • fill_listing → { job_id, hired_ids, message?, confirm_hired } — mark the hires, send everyone
//                 still waiting one decline message, close the listing (not delete).
//   • delete      → remove your OWN posted listing (and with it every application on it).
//   Apply-on-Seen actions answer { available:false } until migration 20261017150000 is applied.
//
// NO DATA BLEED: every action is scoped to the caller's companyKey. `list`/`disputes` only ever read
// this company's rows; `dispute` verifies the target listing's company matches before accepting it;
// applicant activity is returned ONLY as aggregate counts (never an identity) — EXCEPT Apply-on-Seen
// applications, where the candidate explicitly consented to share their name, email, résumé and
// note with this company; those are scoped by company_key on every read and write. All DB work uses the
// service key (RLS bypassed); the approved-claim check is the authz that matters operationally.

import { resolveEmployerUid, resolveApprovedClaim } from '../lib/server/employerAuth.js';
import { normalizeClaimCompany } from '../lib/server/employerClaims.js';
import {
  validateNewListing, buildEmployerListingRow, applyCounts, annotateListings, isRemoteLocation, buildImportPreview,
} from '../lib/server/employerPostings.js';
import { validateDisputeInput } from '../lib/server/listingDisputes.js';
import { broadcastActivity } from '../lib/server/realtime.js';
import { geocodeLocation } from '../lib/server/geo.js';
import { rateLimit } from '../lib/server/ratelimit.js';
import { validateListingUrl } from '../lib/server/listingImport.js';
import { resolveListing } from '../lib/server/listingResolve.js';
import {
  APPLICATION_STATUSES, inboxItem, EMPLOYER_STATUS_TRACKER, trackerUpdateForEmployerStatus,
  planFill, defaultDeclineMessage, buildListingEditPatch, DECLINE_MESSAGE_MAX, OPEN_APPLICATION_STATUSES,
} from '../lib/server/seenApply.js';
import { seenApplyAvailable, signResumeUrl, sendApplicationUpdateEmail, threadAvailable, sendEmployerMessageEmail, lifecycleAvailable } from '../lib/server/seenApplyStore.js';
import { appendThreadEntry, cleanMessage } from '../lib/server/applicationThread.js';
import { daysUntilCleared, RETENTION_DAYS } from '../lib/server/applicationRetention.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];
const LISTING_TTL_DAYS = 60; // employer-posted listings live 60 days, matching paste-a-link imports.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// A PostgREST ilike substring that's safe against the query metacharacters.
function ilikeContains(v) {
  return `*${String(v || '').replace(/[%,()*]/g, ' ').trim()}*`;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try { return await route(req, res); }
  catch (e) {
    console.error('[employer-listings] Unhandled error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function route(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'DB not configured' });

  const db = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const uid = await resolveEmployerUid(req, { SUPABASE_URL, SERVICE_KEY });
  if (!uid) return res.status(401).json({ error: 'Sign in as an employer to manage your listings' });

  const claim = await resolveApprovedClaim(db, uid);
  if (!claim) {
    return res.status(403).json({ error: 'Your company claim must be approved before you can manage listings', reason: 'no_approved_claim' });
  }

  const action = req.method === 'GET' ? 'list' : (body.action || 'list');
  const ctx = { db, body, uid, claim };

  if (action === 'list') return listListings(res, ctx);
  if (action === 'create') return createListing(res, ctx);
  if (action === 'delete') return deleteOwnListing(res, ctx);
  if (action === 'update') return updateListing(res, ctx);
  if (action === 'fill_listing') return fillListing(res, ctx);
  if (action === 'dispute') return fileDispute(res, ctx);
  if (action === 'disputes') return listDisputes(res, ctx);
  if (action === 'import_preview') return importPreview(req, res, ctx);
  if (action === 'applications') return listApplications(res, ctx);
  if (action === 'application_status') return setApplicationStatus(res, ctx);
  if (action === 'application_resume') return applicationResume(res, ctx);
  if (action === 'application_message') return applicationMessage(res, ctx);
  return res.status(400).json({ error: 'Unknown action' });
}

// ── list: every listing on this company, annotated ────────────────────────────
async function listListings(res, { db, uid, claim }) {
  const { companyKey, companyName } = claim;
  const nameFilter = ilikeContains(companyName);
  // jobs.apply_mode only exists once the Apply-on-Seen migration is applied — selecting it before
  // that would 400 the whole list, so it is added only when the probe says the feature is live.
  const seenApply = await seenApplyAvailable(db);
  const life = await lifecycleAvailable(db);

  // All of this company's listings (active + stale + expired so inactive ones can be disputed),
  // newest first. NOT gated on expires_at — the employer manages the whole set.
  const [jobsRes, dispRes, evRes, appRes] = await Promise.all([
    db(`jobs?company=ilike.${encodeURIComponent(nameFilter)}` +
       `&select=id,title,company,location,city,apply_url,source,availability_status,expires_at,created_at,is_employer_posted,employer_user_id${seenApply ? ',apply_mode' : ''}${life ? ',edited_at,status' : ''}` +
       `&order=created_at.desc&limit=300`),
    db(`listing_disputes?employer_user_id=eq.${encodeURIComponent(uid)}&status=eq.open` +
       `&select=id,job_id,kind,status,created_at&order=created_at.desc&limit=300`),
    db(`apply_events?company_key=eq.${encodeURIComponent(companyKey)}&select=job_id,user_id,role&limit=5000`),
    db(`applications?company_name=ilike.${encodeURIComponent(nameFilter)}&select=job_id,user_id,role&limit=5000`),
  ]);

  const jobs = jobsRes.ok ? await jobsRes.json() : [];
  const openDisputes = dispRes.ok ? await dispRes.json() : [];
  const applyEvents = evRes.ok ? await evRes.json() : [];
  const applications = appRes.ok ? await appRes.json() : [];

  const counts = applyCounts({ applyEvents, applications });
  const openByJob = {};
  for (const d of openDisputes) openByJob[String(d.job_id)] = d;

  // DELETED-BY-ADMIN surface: a listing an admin took down is EXPIRED + its apply_url is in
  // suppressed_listings (the reason lives there). Look those up, plus any resolved dispute that
  // explains WHY, so the employer sees "Deleted by admin" + a reason instead of a silent expiry.
  const removedByJob = {};
  try {
    const applyUrls = [...new Set(jobs.map(j => j.apply_url).filter(Boolean))].slice(0, 300);
    const jobIdList = [...new Set(jobs.map(j => j.id).filter(Boolean))].slice(0, 300);
    const [supRes, resolvedRes] = await Promise.all([
      applyUrls.length
        ? db(`suppressed_listings?apply_url=in.(${applyUrls.map(encodeURIComponent).join(',')})&select=apply_url,reason,created_at&limit=400`)
        : Promise.resolve({ ok: true, json: async () => [] }),
      jobIdList.length
        ? db(`listing_disputes?job_id=in.(${jobIdList.map(encodeURIComponent).join(',')})&status=in.(approved,denied)&select=id,job_id,kind,status,admin_note,reviewed_at&order=reviewed_at.desc&limit=300`)
        : Promise.resolve({ ok: true, json: async () => [] }),
    ]);
    const suppressed = supRes.ok ? await supRes.json() : [];
    const supByUrl = Object.fromEntries(suppressed.map(s => [s.apply_url, s]));
    const resolved = resolvedRes.ok ? await resolvedRes.json() : [];
    const resolvedByJob = {};
    for (const d of resolved) if (!resolvedByJob[d.job_id]) resolvedByJob[d.job_id] = d; // newest wins (ordered desc)
    const REASON_LABEL = { admin_removed: 'Removed by an admin', employer_dispute: 'Removed via an approved dispute', employer_closed: 'Closed at the employer’s request' };
    for (const j of jobs) {
      const sup = j.apply_url ? supByUrl[j.apply_url] : null;
      if (!sup) continue;
      const rd = resolvedByJob[j.id] || null;
      removedByJob[String(j.id)] = {
        by: 'admin',
        reason: sup.reason || 'admin_removed',
        reasonLabel: REASON_LABEL[sup.reason] || 'Removed by an admin',
        at: sup.created_at || null,
        disputeId: rd ? rd.id : null,
        note: rd ? rd.admin_note : null,
        disputeKind: rd ? rd.kind : null,
      };
    }
  } catch { /* best-effort — the list must load even if the removal lookup fails */ }

  // Apply-on-Seen applications per listing (count of new ones too) — company-scoped.
  const seenByJob = {};
  if (seenApply) {
    try {
      const sr = await db(`seen_applications?company_key=eq.${encodeURIComponent(companyKey)}${life ? '&purged_at=is.null' : ''}&select=job_id,status&limit=5000`);
      for (const r of (sr.ok ? await sr.json() : [])) {
        const k = String(r.job_id);
        seenByJob[k] = seenByJob[k] || { total: 0, new: 0 };
        seenByJob[k].total += 1;
        if (r.status === 'new') seenByJob[k].new += 1;
      }
    } catch { /* counts are best-effort */ }
  }

  const listings = annotateListings(jobs, { openDisputesByJob: openByJob, applyCountsByJob: counts.perJob })
    .map(l => ({ ...l, removed: removedByJob[String(l.id)] || null, seen_applications: seenByJob[String(l.id)] || { total: 0, new: 0 } }));

  return res.status(200).json({
    ok: true,
    company: companyName,
    listings,
    seen_apply_available: seenApply,
    listing_edits_available: life,
    summary: {
      total: listings.length,
      active: listings.filter((l) => l.availability_status === 'active').length,
      employerPosted: listings.filter((l) => l.is_employer_posted).length,
      applications: counts.total,
      openDisputes: openDisputes.length,
    },
  });
}

// ── create: post an employer-owned listing ────────────────────────────────────
async function createListing(res, { db, body, uid, claim }) {
  const v = validateNewListing(body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const { companyKey, companyName } = claim;
  if (v.listing.apply_mode !== 'external' && !(await seenApplyAvailable(db))) {
    return res.status(400).json({ error: 'Applying on Seen isn’t switched on yet — choose “On your website” for now', reason: 'seen_apply_unavailable' });
  }

  const now = new Date();
  const expires = new Date(now.getTime() + LISTING_TTL_DAYS * 86400000);
  const row = buildEmployerListingRow(v.listing, {
    uid, company: companyName, companyKey,
    nowISO: now.toISOString(), expiresISO: expires.toISOString(),
  });

  // GEO: geocode a real place to lat/lng so the listing shows in seeker radius/distance searches
  // (api/jobs.js filters by great-circle distance when coords exist). Remote listings aren't a
  // place — they surface via their "remote" location text on a Remote search, no coords needed.
  // Best-effort: geocodeLocation is cached + never throws; a miss just falls back to text matching.
  if (!isRemoteLocation(v.listing.location)) {
    try {
      const center = await geocodeLocation(v.listing.location, process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      if (center && center.lat != null && center.lng != null) { row.lat = center.lat; row.lng = center.lng; }
    } catch { /* text-match fallback */ }
  }

  const insRes = await db('jobs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!insRes.ok) {
    const txt = await insRes.text().catch(() => '');
    console.error('[employer-listings] create insert failed:', insRes.status, txt.slice(0, 200));
    return res.status(500).json({ error: 'Could not post your listing — please try again' });
  }
  const listing = (await insRes.json())[0] || null;
  return res.status(200).json({ ok: true, listing });
}

// ── import_preview: parse a listing link into the create form (writes nothing) ─
async function importPreview(req, res, { body, uid, claim }) {
  const v = validateListingUrl(body.url);
  if (!v.ok) return res.status(400).json({ error: v.error });

  // Each preview fetches an external page — per-employer hourly cap (fails open on a limiter blip).
  const rl = await rateLimit(req, 'employer-import', { bucketKey: `user:${uid}` });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many imports this hour — try again later.' });

  let resolved;
  try {
    resolved = await resolveListing(v);
  } catch (e) {
    if (e.message === 'unreachable' || e.message === 'unresolvable') {
      return res.status(400).json({ error: 'That link isn’t reachable from here.' });
    }
    console.error('[employer-listings] import_preview failed:', e?.message || e);
    resolved = { fields: {}, rungs: [{ rung: 'direct', error: e?.message || 'failed' }], blocked: true };
  }
  const preview = buildImportPreview(resolved.fields, { url: v.url, claimCompanyName: claim.companyName });
  if (preview.needs_details) {
    console.warn(`[employer-listings] import_preview needs input (${preview.missing.join(',')}): ${v.host} — ${JSON.stringify(resolved.rungs)}`);
  }
  return res.status(200).json({
    ok: true,
    ...preview,
    your_company: claim.companyName,
    page_fetched: (resolved.rungs || []).some((r) => r.blocked === false),
  });
}

// ── applications: the Apply-on-Seen inbox for this company ────────────────────
// NO BLEED: every read filters on the caller's companyKey (stamped from the listing at apply time).
async function listApplications(res, { db, body, claim }) {
  if (!(await seenApplyAvailable(db))) return res.status(200).json({ ok: true, available: false, applications: [] });
  const jid = String(body.job_id == null ? '' : body.job_id).trim();
  if (jid && !UUID.test(jid)) return res.status(400).json({ error: 'A valid listing id is required' });
  const life = await lifecycleAvailable(db);
  const [r, jr] = await Promise.all([
    db(
      `seen_applications?company_key=eq.${encodeURIComponent(claim.companyKey)}` +
      (jid ? `&job_id=eq.${encodeURIComponent(jid)}` : '') +
      (life ? '&purged_at=is.null' : '') + // cleared declined applications leave the inbox
      `&select=id,job_id,job_title,applicant_name,applicant_email,applicant_phone,note,status,created_at,resume_path,resume_file_name,resume_text${(await threadAvailable(db)) ? ',thread' : ''}${life ? ',decided_at' : ''}` +
      `&order=created_at.desc&limit=500`,
    ),
    // The listing's last edit, so the inbox can show which applications came in before it.
    jid && life ? db(`jobs?id=eq.${encodeURIComponent(jid)}&select=edited_at,title&limit=1`) : Promise.resolve(null),
  ]);
  if (!r.ok) {
    console.error('[employer-listings] applications read failed:', r.status, (await r.text().catch(() => '')).slice(0, 200));
    return res.status(500).json({ error: 'Could not load applications — please try again' });
  }
  const rows = await r.json();
  const job = jr && jr.ok ? (await jr.json())[0] : null;
  const now = Date.now();
  return res.status(200).json({
    ok: true, available: true,
    listing_edited_at: job?.edited_at || null,
    retention_days: RETENTION_DAYS,
    applications: rows.map((row) => ({ ...inboxItem(row), decided_at: row.decided_at || null, clears_in_days: daysUntilCleared(row, now) })),
  });
}

// { id, status, message? } — `message` only with 'rejected': an optional decline note (a recommended
// one or the employer's own) added to the application's conversation and to the decline email.
async function setApplicationStatus(res, { db, body, claim }) {
  if (!(await seenApplyAvailable(db))) return res.status(400).json({ error: 'Applying on Seen isn’t switched on yet' });
  const id = String(body.id == null ? '' : body.id).trim();
  const status = String(body.status == null ? '' : body.status).trim();
  if (!UUID.test(id)) return res.status(400).json({ error: 'A valid application id is required' });
  if (!APPLICATION_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
  const withThread = await threadAvailable(db);
  const message = status === 'rejected' && withThread ? cleanMessage(body.message, DECLINE_MESSAGE_MAX) : '';
  const life = await lifecycleAvailable(db);
  // The company_key filter IS the ownership check: another company's application matches 0 rows.
  const own = `seen_applications?id=eq.${encodeURIComponent(id)}&company_key=eq.${encodeURIComponent(claim.companyKey)}`;
  // With a message, the PATCH only lands if the row is unchanged since it was read (updated_at), so
  // a message written at the same moment is never dropped; one re-read on a lost race.
  for (let attempt = 0; attempt < 2; attempt++) {
    const prevRes = await db(`${own}&select=status,updated_at${message ? ',thread' : ''}&limit=1`);
    const prev = prevRes.ok ? (await prevRes.json())[0] : null;
    if (!prev) return res.status(404).json({ error: 'That application isn’t on your company’s listings' });
    if (prev.status === 'withdrawn') return res.status(409).json({ error: 'The applicant withdrew this application', reason: 'withdrawn' });
    const nowISO = new Date().toISOString();
    let thread = null;
    if (message) {
      const next = appendThreadEntry(prev.thread, { from: 'e', text: message, nowMs: Date.now() });
      if (!next.ok) return res.status(400).json({ error: next.error });
      thread = next.thread;
    }
    const r = await db(`${own}${message ? `&updated_at=eq.${encodeURIComponent(prev.updated_at)}` : ''}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status, updated_at: nowISO,
        ...(thread ? { thread } : {}),
        // The retention clock (lib/server/applicationRetention.js) starts at a final decision.
        ...(life ? { decided_at: status === 'hired' || status === 'rejected' ? nowISO : null } : {}),
      }),
    });
    if (!r.ok) return res.status(500).json({ error: 'Could not update the application — please try again' });
    const rows = await r.json();
    if (!rows.length) { if (message) continue; return res.status(404).json({ error: 'That application isn’t on your company’s listings' }); }
    // The applicant's tracker follows the employer's decision (best-effort — never fails this update).
    const tracker = status !== prev.status ? await syncApplicantTracker(db, rows[0], status, message || null) : { synced: false, reason: 'unchanged' };
    return res.status(200).json({ ok: true, application: inboxItem(rows[0]), tracker });
  }
  return res.status(409).json({ error: 'The application changed while you were updating it — please try again' });
}

// Mirror an employer status change onto the applicant's own tracker row (created at apply time by
// api/apply.js) and, for decisions worth an email (interviewing / not selected / hired), tell them.
// Matches the row by the applicant's user id + job id, so only that applicant's own row for that
// listing is touched. If they deleted it from their tracker, it is not recreated.
async function syncApplicantTracker(db, application, status, text = null) {
  try {
    const m = EMPLOYER_STATUS_TRACKER[status];
    if (!m || !application?.applicant_user_id || !application?.job_id) return { synced: false, reason: 'no_mapping' };
    const q = `applications?user_id=eq.${encodeURIComponent(application.applicant_user_id)}&job_id=eq.${encodeURIComponent(String(application.job_id))}`;
    const cur = await db(`${q}&select=id,status,stage,events&limit=1`);
    const apps = cur.ok ? await cur.json() : [];
    const app = Array.isArray(apps) ? apps[0] : null;
    let synced = false;
    if (app) {
      const patch = trackerUpdateForEmployerStatus(app, status, Date.now());
      if (patch) {
        const up = await db(`applications?id=eq.${encodeURIComponent(app.id)}&user_id=eq.${encodeURIComponent(application.applicant_user_id)}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
        });
        synced = up.ok;
      }
    }
    if (m.email) {
      await sendApplicationUpdateEmail({ to: application.applicant_email, company: application.company_name, role: application.job_title, label: m.label, text });
    }
    return { synced, reason: app ? (synced ? 'updated' : 'write_failed') : 'not_in_tracker' };
  } catch { return { synced: false, reason: 'error' }; }
}

// ── application_message: write to one applicant on their application ───────────
// Interview time, a number to call, anything they should know. Stored on the application row
// (lib/server/applicationThread.js), shown on the applicant's tracker, and emailed to them.
async function applicationMessage(res, { db, body, claim }) {
  if (!(await seenApplyAvailable(db)) || !(await threadAvailable(db))) return res.status(400).json({ error: 'Messaging applicants isn’t switched on yet', reason: 'unavailable' });
  const id = String(body.id == null ? '' : body.id).trim();
  if (!UUID.test(id)) return res.status(400).json({ error: 'A valid application id is required' });
  // The company_key filter IS the ownership check: another company's application matches 0 rows.
  const own = `seen_applications?id=eq.${encodeURIComponent(id)}&company_key=eq.${encodeURIComponent(claim.companyKey)}`;
  // Two writes racing on one row would drop a message, so the PATCH only lands if the row is
  // unchanged since it was read (updated_at), with one re-read on a lost race.
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await db(`${own}&select=id,thread,updated_at,applicant_email,company_name,job_title&limit=1`);
    const row = cur.ok ? (await cur.json())[0] : null;
    if (!row) return res.status(404).json({ error: 'That application isn’t on your company’s listings' });
    const next = appendThreadEntry(row.thread, { from: 'e', text: body.text, nowMs: Date.now() });
    if (!next.ok) return res.status(400).json({ error: next.error });
    const up = await db(`${own}&updated_at=eq.${encodeURIComponent(row.updated_at)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ thread: next.thread, updated_at: new Date().toISOString() }),
    });
    if (!up.ok) return res.status(500).json({ error: 'Could not send the message — please try again' });
    const rows = await up.json();
    if (!rows.length) continue; // someone else wrote first — re-read and append again
    const text = next.thread[next.thread.length - 1][2];
    const mail = await sendEmployerMessageEmail({ to: row.applicant_email, company: row.company_name, role: row.job_title, text });
    return res.status(200).json({ ok: true, application: inboxItem(rows[0]), emailed: !!mail.ok });
  }
  return res.status(409).json({ error: 'The application changed while you were writing — please send again' });
}

async function applicationResume(res, { db, body, claim }) {
  if (!(await seenApplyAvailable(db))) return res.status(400).json({ error: 'Applying on Seen isn’t switched on yet' });
  const id = String(body.id == null ? '' : body.id).trim();
  if (!UUID.test(id)) return res.status(400).json({ error: 'A valid application id is required' });
  const r = await db(`seen_applications?id=eq.${encodeURIComponent(id)}&company_key=eq.${encodeURIComponent(claim.companyKey)}&select=resume_path,resume_file_name,resume_text&limit=1`);
  const row = r.ok ? (await r.json())[0] : null;
  if (!row) return res.status(404).json({ error: 'That application isn’t on your company’s listings' });
  if (row.resume_path) {
    const url = await signResumeUrl({
      SUPABASE_URL: process.env.SUPABASE_URL, SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
      path: row.resume_path, expiresIn: 600,
    });
    if (url) return res.status(200).json({ ok: true, url, file_name: row.resume_file_name || null, expires_in: 600 });
  }
  if (row.resume_text) return res.status(200).json({ ok: true, text: row.resume_text });
  return res.status(404).json({ error: 'No résumé is attached to this application' });
}

// Your OWN posted listing, or a reason it isn't. Shared by update / fill_listing / delete.
async function loadOwnListing(db, jid, uid, claim, extra = '') {
  if (!UUID.test(jid)) return { error: [400, 'A valid listing id is required'] };
  const jr = await db(`jobs?id=eq.${encodeURIComponent(jid)}&select=id,title,company,is_employer_posted,employer_user_id,expires_at,location${extra}&limit=1`);
  const job = jr.ok ? (await jr.json())[0] : null;
  if (!job) return { error: [404, 'That listing no longer exists'] };
  if (!job.is_employer_posted || job.employer_user_id !== uid) return { error: [403, 'You can only change listings you posted — dispute other listings instead'] };
  if (normalizeClaimCompany(job.company) !== claim.companyKey) return { error: [403, 'That listing is not attached to your company'] };
  return { job };
}
const ownScope = (jid, uid) => `jobs?id=eq.${encodeURIComponent(jid)}&is_employer_posted=eq.true&employer_user_id=eq.${encodeURIComponent(uid)}`;

// ── update: edit your own posted listing in place (owner request 2026-10-18) ──
// Same fields and rules as `create`. Stamps jobs.edited_at so the edit is dated on the listing and on
// every application sent before it; the original post date and expiry are kept.
async function updateListing(res, { db, body, uid, claim }) {
  if (!(await lifecycleAvailable(db))) return res.status(400).json({ error: 'Editing listings isn’t switched on yet', reason: 'unavailable' });
  const jid = String(body.job_id == null ? '' : body.job_id).trim();
  const own = await loadOwnListing(db, jid, uid, claim);
  if (own.error) return res.status(own.error[0]).json({ error: own.error[1] });
  if (own.job.expires_at && Date.parse(own.job.expires_at) <= Date.now()) {
    return res.status(400).json({ error: 'This listing has closed — post a new one instead', reason: 'closed' });
  }
  const v = validateNewListing(body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const seen = await seenApplyAvailable(db);
  if (v.listing.apply_mode !== 'external' && !seen) return res.status(400).json({ error: 'Applying on Seen isn’t switched on yet — choose “On your website” for now', reason: 'seen_apply_unavailable' });
  const patch = buildListingEditPatch(v.listing, { nowISO: new Date().toISOString(), withApplyMode: seen });
  // A new place is re-geocoded so radius searches keep finding it; remote has no coordinates.
  if (patch.location !== own.job.location) {
    patch.lat = null; patch.lng = null;
    if (!patch.remote) {
      try {
        const c = await geocodeLocation(patch.location, process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        if (c && c.lat != null && c.lng != null) { patch.lat = c.lat; patch.lng = c.lng; }
      } catch { /* text-match fallback */ }
    }
  }
  const up = await db(ownScope(jid, uid), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok) {
    console.error('[employer-listings] update failed:', up.status, (await up.text().catch(() => '')).slice(0, 200));
    return res.status(500).json({ error: 'Could not save your changes — please try again' });
  }
  const rows = await up.json();
  if (!rows.length) return res.status(404).json({ error: 'That listing no longer exists' });
  return res.status(200).json({ ok: true, listing: rows[0] });
}

// ── fill_listing: "We hired — close this listing" (owner request 2026-10-18) ─
// { job_id, hired_ids:[application ids], message?, confirm_hired:true }. One manual step: the employer
// has confirmed everyone they hired (the inbox makes them tick a box saying so). Then:
//   hired_ids            → marked hired (tracker updated, they are emailed the good news)
//   everyone still open  → one decline message (default or the employer's edit) + marked not selected
//   already hired / already declined / withdrawn → left alone, never messaged twice
//   the listing          → closed (leaves search; jobs.status 'filled'). NOT deleted: deleting a
//                          listing would erase its applications and break every applicant's tracker link.
// Safe to re-run: a second run finds nobody still open and the listing already closed.
async function fillListing(res, { db, body, uid, claim }) {
  if (!(await seenApplyAvailable(db)) || !(await threadAvailable(db)) || !(await lifecycleAvailable(db))) {
    return res.status(400).json({ error: 'Closing a filled listing isn’t switched on yet', reason: 'unavailable' });
  }
  const jid = String(body.job_id == null ? '' : body.job_id).trim();
  const own = await loadOwnListing(db, jid, uid, claim);
  if (own.error) return res.status(own.error[0]).json({ error: own.error[1] });
  if (body.confirm_hired !== true) return res.status(400).json({ error: 'Confirm you’ve selected everyone you hired', reason: 'confirm_required' });
  const job = own.job;
  const message = cleanMessage(body.message, DECLINE_MESSAGE_MAX) || defaultDeclineMessage({ title: job.title, company: claim.companyName });

  const scope = `seen_applications?job_id=eq.${encodeURIComponent(jid)}&company_key=eq.${encodeURIComponent(claim.companyKey)}&purged_at=is.null`;
  const lr = await db(`${scope}&select=id,job_id,status,thread,applicant_user_id,applicant_email,company_name,job_title&limit=2000`);
  if (!lr.ok) return res.status(500).json({ error: 'Could not load the applications — please try again' });
  const plan = planFill(await lr.json(), body.hired_ids);
  if (!plan.ok) return res.status(400).json({ error: plan.error });

  const nowMs = Date.now();
  const nowISO = new Date(nowMs).toISOString();
  const result = { hired: 0, declined: 0, skipped: 0, kept: plan.keep };
  const one = (id) => `seen_applications?id=eq.${encodeURIComponent(id)}&company_key=eq.${encodeURIComponent(claim.companyKey)}`;

  for (const row of plan.hire) {
    const up = await db(`${one(row.id)}&status=neq.withdrawn`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'hired', decided_at: nowISO, updated_at: nowISO }) });
    if (up.ok && (await up.json()).length) { result.hired += 1; await syncApplicantTracker(db, row, 'hired'); } else result.skipped += 1;
  }
  // Declines, a few at a time. The status filter means anyone who withdrew a moment ago is skipped.
  const queue = plan.decline.slice();
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      const next = appendThreadEntry(row.thread, { from: 'e', text: message, nowMs });
      const up = await db(`${one(row.id)}&status=in.(${OPEN_APPLICATION_STATUSES.join(',')})`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'rejected', decided_at: nowISO, updated_at: nowISO, ...(next.ok ? { thread: next.thread } : {}) }),
      });
      if (up.ok && (await up.json()).length) { result.declined += 1; await syncApplicantTracker(db, row, 'rejected', message); } else result.skipped += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));

  const close = await db(ownScope(jid, uid), {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ availability_status: 'expired', expires_at: nowISO, last_checked_at: nowISO, status: 'filled' }),
  });
  return res.status(200).json({ ok: true, ...result, closed: close.ok });
}

// ── delete: remove an employer's OWN posted listing (direct — no admin needed) ─
// Only a listing THIS employer posted (is_employer_posted + employer_user_id === uid) can be
// deleted directly. Aggregated / imported listings are third-party data and go through the
// admin-reviewed dispute path instead — this endpoint refuses them.
async function deleteOwnListing(res, { db, body, uid, claim }) {
  const jid = String(body.job_id == null ? '' : body.job_id).trim();
  if (!UUID.test(jid)) return res.status(400).json({ error: 'A valid listing id is required' });

  const jr = await db(`jobs?id=eq.${encodeURIComponent(jid)}&select=company,is_employer_posted,employer_user_id&limit=1`);
  const job = jr.ok ? (await jr.json())[0] : null;
  if (!job) return res.status(404).json({ error: 'That listing no longer exists' });
  if (!job.is_employer_posted || job.employer_user_id !== uid) {
    return res.status(403).json({ error: 'You can only delete listings you posted — dispute other listings instead' });
  }
  if (normalizeClaimCompany(job.company) !== claim.companyKey) {
    return res.status(403).json({ error: 'That listing is not attached to your company' });
  }

  // Hard-delete, but SCOPE the delete itself to this owner (defense in depth): even a TOCTOU race
  // can only ever remove a row that is is_employer_posted AND owned by this uid.
  const del = await db(
    `jobs?id=eq.${encodeURIComponent(jid)}&is_employer_posted=eq.true&employer_user_id=eq.${encodeURIComponent(uid)}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
  );
  if (!del.ok) {
    const txt = await del.text().catch(() => '');
    console.error('[employer-listings] delete failed:', del.status, txt.slice(0, 200));
    return res.status(500).json({ error: 'Could not delete the listing — please try again' });
  }
  return res.status(200).json({ ok: true, deleted: jid });
}

// ── dispute: contest a listing (admin approves/denies) ────────────────────────
async function fileDispute(res, { db, body, uid, claim }) {
  const v = validateDisputeInput(body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const { companyKey, companyName } = claim;

  // NO BLEED: the disputed listing must belong to THIS company. For a real jobs row we read its
  // company and compare canonical keys; an ephemeral/non-existent id can't be attributed, so refuse.
  const jid = v.dispute.job_id;
  if (UUID.test(jid)) {
    const jr = await db(`jobs?id=eq.${encodeURIComponent(jid)}&select=company&limit=1`);
    const job = jr.ok ? (await jr.json())[0] : null;
    if (!job) return res.status(404).json({ error: "That listing no longer exists" });
    if (normalizeClaimCompany(job.company) !== companyKey) {
      return res.status(403).json({ error: 'That listing is not attached to your company' });
    }
  } else {
    return res.status(400).json({ error: 'That listing can’t be disputed here — contact support' });
  }

  const insRes = await db('listing_disputes', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      job_id: jid,
      company_name: companyName,
      company_key: companyKey,
      employer_user_id: uid,
      kind: v.dispute.kind,
      reason: v.dispute.reason,
      detail: v.dispute.detail,
      proposed_changes: v.dispute.proposed_changes,
      status: 'open',
    }),
  });
  if (!insRes.ok) {
    const txt = await insRes.text().catch(() => '');
    if (insRes.status === 409 || /duplicate|unique/i.test(txt)) {
      return res.status(409).json({ error: 'You already have an open dispute of this kind for this listing', reason: 'duplicate_open' });
    }
    console.error('[employer-listings] dispute insert failed:', insRes.status, txt.slice(0, 200));
    return res.status(500).json({ error: 'Could not file your dispute — please try again' });
  }
  const dispute = (await insRes.json())[0] || null;
  broadcastActivity('listing_dispute'); // instant admin bell ping (fail-safe; fallback poll backs it up)
  return res.status(200).json({ ok: true, dispute });
}

// ── disputes: this employer's filed disputes + verdicts ───────────────────────
async function listDisputes(res, { db, uid }) {
  const r = await db(
    `listing_disputes?employer_user_id=eq.${encodeURIComponent(uid)}` +
    `&select=id,job_id,kind,reason,detail,proposed_changes,status,created_at,reviewed_at,admin_note` +
    `&order=created_at.desc&limit=200`,
  );
  const disputes = r.ok ? await r.json() : [];
  return res.status(200).json({ ok: true, disputes });
}
