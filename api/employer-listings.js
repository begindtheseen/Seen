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
//
// NO DATA BLEED: every action is scoped to the caller's companyKey. `list`/`disputes` only ever read
// this company's rows; `dispute` verifies the target listing's company matches before accepting it;
// applicant activity is returned ONLY as aggregate counts (never an identity). All DB work uses the
// service key (RLS bypassed); the approved-claim check is the authz that matters operationally.

import { resolveEmployerUid, resolveApprovedClaim } from '../lib/server/employerAuth.js';
import { normalizeClaimCompany } from '../lib/server/employerClaims.js';
import {
  validateNewListing, buildEmployerListingRow, applyCounts, annotateListings,
} from '../lib/server/employerPostings.js';
import { validateDisputeInput } from '../lib/server/listingDisputes.js';
import { broadcastActivity } from '../lib/server/realtime.js';

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
  if (action === 'dispute') return fileDispute(res, ctx);
  if (action === 'disputes') return listDisputes(res, ctx);
  return res.status(400).json({ error: 'Unknown action' });
}

// ── list: every listing on this company, annotated ────────────────────────────
async function listListings(res, { db, uid, claim }) {
  const { companyKey, companyName } = claim;
  const nameFilter = ilikeContains(companyName);

  // All of this company's listings (active + stale + expired so inactive ones can be disputed),
  // newest first. NOT gated on expires_at — the employer manages the whole set.
  const [jobsRes, dispRes, evRes, appRes] = await Promise.all([
    db(`jobs?company=ilike.${encodeURIComponent(nameFilter)}` +
       `&select=id,title,company,location,city,apply_url,url,source,availability_status,expires_at,created_at,is_employer_posted,employer_user_id` +
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

  const listings = annotateListings(jobs, { openDisputesByJob: openByJob, applyCountsByJob: counts.perJob });

  return res.status(200).json({
    ok: true,
    company: companyName,
    listings,
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

  const now = new Date();
  const expires = new Date(now.getTime() + LISTING_TTL_DAYS * 86400000);
  const row = buildEmployerListingRow(v.listing, {
    uid, company: companyName, companyKey,
    nowISO: now.toISOString(), expiresISO: expires.toISOString(),
  });

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
