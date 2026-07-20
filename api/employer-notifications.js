// Employer notifications API — login-scoped persisted feed + read/unread, merged with the live
// DERIVED staleness/applicant items (lib/server/employerNotifications.js).
//
// TWO actions, both requiring a Supabase Bearer JWT → an APPROVED company claim (migration 053):
//   • list       → the merged feed (persisted events newest-first by urgency + derived staleness),
//                  plus an unread count from the PERSISTED events only.
//   • mark_read  → mark this company's notifications read (all, or a given id list).
//
// Persisted rows (migration 057) are the real events an employer must not miss — someone applied, a
// listing was reported, an admin ruled on a dispute. They're written by api/apply.js,
// api/user-sync.js and api/admin-stats.js. The derived items stay transient (recomputed each load).
//
// NO DATA BLEED: everything keys off the caller's companyKey. Reads and the mark_read write are both
// filtered by company_key=eq, so an employer can only ever see/touch their own company's rows.

import { resolveEmployerUid, resolveApprovedClaim } from '../lib/server/employerAuth.js';
import { deriveEmployerNotifications } from '../lib/server/employerNotifications.js';
import { mergeFeed } from '../lib/server/employerNotificationsStore.js';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function ilikeContains(v) {
  return `*${String(v || '').replace(/[%,()*]/g, ' ').trim()}*`;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try { return await route(req, res); }
  catch (e) {
    console.error('[employer-notifications] Unhandled error:', e?.message || e);
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
  if (!uid) return res.status(401).json({ error: 'Sign in as an employer to see your notifications' });

  const claim = await resolveApprovedClaim(db, uid);
  if (!claim) return res.status(403).json({ error: 'Your company claim must be approved first', reason: 'no_approved_claim' });

  const action = req.method === 'GET' ? 'list' : (body.action || 'list');
  if (action === 'list') return listFeed(res, { db, claim });
  if (action === 'mark_read') return markRead(res, { db, body, claim });
  return res.status(400).json({ error: 'Unknown action' });
}

async function listFeed(res, { db, claim }) {
  const { companyKey, companyName } = claim;
  const nameFilter = ilikeContains(companyName);

  const [notifRes, jobsRes, appsRes] = await Promise.all([
    db(`employer_notifications?company_key=eq.${encodeURIComponent(companyKey)}` +
       `&select=id,kind,severity,title,body,job_id,meta,read_at,created_at&order=created_at.desc&limit=200`),
    db(`jobs?company=ilike.${encodeURIComponent(nameFilter)}` +
       `&select=id,title,company,city,availability_status,last_seen_at,created_at&order=last_seen_at.asc&limit=200`),
    db(`applications?company_name=ilike.${encodeURIComponent(nameFilter)}` +
       `&select=role,city,status,created_at&order=created_at.desc&limit=200`),
  ]);

  const persisted = notifRes.ok ? await notifRes.json() : [];
  const jobs = jobsRes.ok ? await jobsRes.json() : [];
  const applications = appsRes.ok ? await appsRes.json() : [];

  const derived = deriveEmployerNotifications({ jobs, applications, now: Date.now() });
  const feed = mergeFeed(persisted, derived.items);

  return res.status(200).json({
    ok: true,
    company: companyName,
    items: feed.items,
    unread: feed.unread,
    summary: { ...derived.summary, stored: feed.storedCount, unread: feed.unread },
    thresholds: derived.thresholds,
  });
}

async function markRead(res, { db, body, claim }) {
  const { companyKey } = claim;
  const nowISO = new Date().toISOString();

  // Scope EVERY write to this company_key. An explicit id list narrows it further; otherwise mark
  // all of this company's unread rows read.
  let filter = `company_key=eq.${encodeURIComponent(companyKey)}&read_at=is.null`;
  if (Array.isArray(body.ids) && body.ids.length) {
    const ids = body.ids.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.status(400).json({ error: 'No valid ids' });
    filter = `company_key=eq.${encodeURIComponent(companyKey)}&id=in.(${ids.join(',')})`;
  }

  const r = await db(`employer_notifications?${filter}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ read_at: nowISO }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.error('[employer-notifications] mark_read failed:', r.status, txt.slice(0, 200));
    return res.status(500).json({ error: 'Could not update notifications' });
  }
  return res.status(200).json({ ok: true });
}
