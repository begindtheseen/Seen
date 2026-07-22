// Proxy all user data reads/writes through the service key so RLS never blocks them.
// The client sends its Supabase access token; we validate it here, then use the
// service key to talk to the DB. No RLS policies required on the client side.

import { createHmac, timingSafeEqual } from 'crypto';
import { rateLimit } from '../lib/server/ratelimit.js';
import { broadcastActivity } from '../lib/server/realtime.js';
import { buildOpportunities } from './_utils/opportunityEngine.js';
import { extractEmployment } from '../lib/server/resumeAnalysis.js';
import { buildResumeSurvey, RESUME_SURVEY_KEYS, mapAnswersToReport } from './_utils/resumeSurvey.js';
import { normalizeCompany, isValidCompanyName, resolveOrCreateCompany, assessSubmitTrust, writeReport, recomputeCompanyScoreFromReports } from './_utils/reportWrite.js';
import { WELCOME_CREDITS, FREE_DAILY_CREDITS, PRO_DAILY_CREDITS, RESUME_OPTIMIZE_COST, RESUME_SURVEY_AWARD, TRACK_APPLICATION_AWARD, MAX_DAILY_EARN, MAX_FREE_BALANCE, hasProAccess, creditBalance } from '../lib/server/creditRules.js';
import { normalizeClaimCompany } from '../lib/server/employerClaims.js';
import { buildNotificationRow } from '../lib/server/employerNotificationsStore.js';
import { isReadableResume } from '../lib/server/resumeReadability.js';

// Verify a Supabase JWT locally (HS256) — no network round-trip.
// Returns the payload (with .sub = user UUID) on success, null on failure.
// Requires SUPABASE_JWT_SECRET env var from Supabase Dashboard → Settings → API.
function verifyJWTLocal(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const mac = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    const sigBuf = Buffer.from(parts[2], 'base64url');
    const macBuf = Buffer.from(mac, 'base64url');
    if (sigBuf.length !== macBuf.length || !timingSafeEqual(sigBuf, macBuf)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export default async function handler(req, res) {
  const _o=req.headers.origin||'';
  const _devO=!_o||_o.includes('localhost')||_o.includes('127.0.0.1');
  res.setHeader('Access-Control-Allow-Origin',(_devO||['https://seenjobs.io','https://www.seenjobs.io'].includes(_o))?(_o||'*'):'https://seenjobs.io');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'DB not configured' });

  // ── Validate caller's Supabase JWT ──────────────────────────────────────────
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'No auth token' });

  // IP-level gate — blocks flood attempts before any DB or auth work
  const { allowed: ipOk } = await rateLimit(req, 'user-sync');
  if (!ipOk) return res.status(429).json({ error: 'Too many requests — slow down.' });

  let uid;
  const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
  // Fast path: verify the HS256 JWT locally (no round-trip). Supabase has migrated projects
  // to ASYMMETRIC signing keys (ES256/RS256), which this HS256 check can't verify — so when
  // local verification fails we MUST fall back to the Supabase auth API rather than 401.
  // (gateAI in lib/server/credits.js and api/stripe.js already do exactly this; user-sync was
  // the one endpoint missing the fallback, which 401'd every request once tokens went ES256.)
  const payload = JWT_SECRET ? verifyJWTLocal(token, JWT_SECRET) : null;
  if (payload) {
    uid = payload.sub;
  } else {
    // Validate via the Supabase auth API (works for any signing algorithm).
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const { id } = await userRes.json();
    if (!id) return res.status(401).json({ error: 'Could not identify user' });
    uid = id;
  }

  // ── All DB calls use service key — bypasses RLS ─────────────────────────────
  const db = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
  const { action } = body || {};
  console.log(`[user-sync] action=${action} uid=${uid}`);

  // Rate-limit mutating actions per user (not reads — those are cheap DB fetches)
  const WRITE_ACTIONS = new Set(['add_application','update_application','remove_application','save_job','unsave_job','save_profile','save_resume','delete_account','submit_resume_survey']);
  if (WRITE_ACTIONS.has(action)) {
    const windowHour = Math.floor(Date.now() / 3_600_000);
    const rlKey = `${uid}:user-sync:${windowHour}`;
    try {
      const rlRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_rate_limit`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: rlKey, p_ttl_seconds: 3600 }),
      });
      if (rlRes.ok) {
        const count = await rlRes.json();
        if (count > 300) return res.status(429).json({ error: 'Too many requests — slow down.' });
      }
    } catch(_) { /* fail open */ }
  }

  // ── LOAD — applications + saved jobs + recent cos + credits + feature flags ──
  if (action === 'load') {
    const appsLimit = Math.min(500, Math.max(1, parseInt(body.apps_limit) || 200));
    const appsOffset = Math.max(0, parseInt(body.apps_offset) || 0);
    const today = new Date().toISOString().split('T')[0];
    const [appsRes, savedRes, recentRes, credRes, flagsRes] = await Promise.all([
      db(`applications?user_id=eq.${uid}&select=id,job_id,company_name,role,city,platform,job_url,status,stage,score,waste_score,events,applied_at,employer_stage,created_at,updated_at&order=created_at.desc&limit=${appsLimit}&offset=${appsOffset}`, { headers: { Prefer: 'count=estimated' } }),
      db(`saved_jobs?user_id=eq.${uid}&order=saved_at.desc&limit=500`),
      db(`user_recent_cos?user_id=eq.${uid}&order=viewed_at.desc&limit=6`),
      db(`ai_credits?user_id=eq.${uid}&limit=1`),
      db(`feature_flags?select=flag_name,status,percentage`),
    ]);
    const apps   = appsRes.ok   ? await appsRes.json()   : [];
    const saved  = savedRes.ok  ? await savedRes.json()  : [];
    const recent = recentRes.ok ? await recentRes.json() : [];
    let cred = credRes.ok ? (await credRes.json())[0] : null;
    if (cred && cred.last_reset !== today) {
      const nb = hasProAccess(cred) ? PRO_DAILY_CREDITS : FREE_DAILY_CREDITS;
      db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: nb, daily_earned: 0, last_reset: today }), headers: { Prefer: 'return=minimal' } });
      cred = { ...cred, balance: nb, daily_earned: 0, last_reset: today };
    }
    // balance = daily + purchased (never-resetting) credits; pro = flag OR pro_until window.
    const credits = cred ? { balance: creditBalance(cred), pro: hasProAccess(cred), daily_earned: cred.daily_earned || 0 } : null;
    const flagRows = flagsRes.ok ? await flagsRes.json() : [];
    const flags = {};
    flagRows.forEach(f => { flags[f.flag_name] = { status: f.status, percentage: f.percentage || 0 }; });
    // Collect login signal for duplicate detection (fire-and-forget — never blocks response)
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 45) || 'unknown';
    const ua = (req.headers['user-agent'] || '').slice(0, 200);
    db('login_signals', { method: 'POST', body: JSON.stringify({ user_id: uid, ip_address: ip, user_agent: ua }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    const appsTotal = parseInt((appsRes.headers?.get('content-range') || '').split('/')[1]) || apps.length;
    return res.status(200).json({ applications: apps, saved_jobs: saved, apps_total: appsTotal, apps_offset: appsOffset, recent_cos: recent, credits, flags });
  }

  // ── ADD APPLICATION ─────────────────────────────────────────────────────────
  if (action === 'add_application') {
    const a = body.application || {};
    // Sanitize the client event history: array of small objects, capped, required fields only.
    const events = Array.isArray(a.events)
      ? a.events.slice(0, 50).map(e => ({
          id: String(e?.id || '').slice(0, 40),
          type: String(e?.type || '').slice(0, 40),
          date: Number(e?.date) || Date.now(),
          source: String(e?.source || 'user').slice(0, 20),
          confidence: e?.confidence ?? 'low',
        })).filter(e => e.type)
      : [];
    const row = {
      user_id:      uid,
      job_id:       a.jobId ? String(a.jobId).slice(0, 80) : null,
      company_name: a.company   || '',
      role:         a.role      || '',
      city:         a.location  || '',
      platform:     a.platform  || 'Seen',
      job_url:      a.jobUrl    || null,
      status:       a.status    || 'active',
      stage:        a.stage     || 'Applied',
      score:        a.score     || null,
      waste_score:  a.waste     || null,
      applied_at:   a.appliedAt ? new Date(a.appliedAt).toISOString() : new Date().toISOString(),
      events,
    };
    const r = await db('applications', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=representation' } });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('[user-sync] add_application failed:', r.status, errText);
      return res.status(400).json({ error: 'Insert failed' });
    }
    const data = await r.json();
    console.log('[user-sync] add_application ok, id:', data?.[0]?.id);
    return res.status(200).json({ id: data?.[0]?.id || null });
  }

  // ── REMOVE APPLICATION ──────────────────────────────────────────────────────
  if (action === 'remove_application') {
    const { id } = body;
    // Accept both real UUIDs and legacy app_ ids stored in the DB
    if (id) await db(`applications?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── SAVE JOB ────────────────────────────────────────────────────────────────
  if (action === 'save_job') {
    const j = body.job || {};
    const base = {
      user_id:  uid,
      job_id:   String(j.id || ''),
      company:  j.co    || '',
      role:     j.title || '',
      location: j.city  || '',
      score:    j.score || null,
    };
    // Persist the apply URL + full listing snapshot so a saved listing reopens to
    // the exact role even from another device / after DB cache expiry.
    const full = { ...base, apply_url: j.apply_url || null, snapshot: j.snapshot || null };
    // on_conflict must name the (user_id, job_id) unique index — without it PostgREST
    // resolves merge-duplicates against the PK, so re-saving from another device 409s.
    const opts = { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } };
    let r = await db('saved_jobs?on_conflict=user_id,job_id', { ...opts, body: JSON.stringify(full) });
    // Self-heal: if the apply_url/snapshot columns don't exist yet (migration 018
    // not applied), the insert 400s — retry with the base row so saving never breaks.
    if (!r.ok) r = await db('saved_jobs?on_conflict=user_id,job_id', { ...opts, body: JSON.stringify(base) });
    return res.status(200).json({ ok: r.ok });
  }

  // ── UNSAVE JOB ──────────────────────────────────────────────────────────────
  if (action === 'unsave_job') {
    const { jobId } = body;
    if (jobId) await db(`saved_jobs?user_id=eq.${uid}&job_id=eq.${encodeURIComponent(String(jobId))}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── UPDATE APPLICATION STAGE/STATUS ─────────────────────────────────────────
  if (action === 'update_application') {
    const { id, changes } = body;
    if (!id || !changes) return res.status(400).json({ error: 'id and changes required' });
    // The id column is uuid — a legacy client-local 'app_...' id can never match a DB row.
    // Report that honestly so the client knows the update did NOT persist (instead of the
    // old behavior: PostgREST 400s on the uuid cast and we still said ok:true).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
      return res.status(200).json({ ok: false, reason: 'not_synced' });
    }
    const allowed = {};
    if (changes.stage)  allowed.stage  = changes.stage;
    if (changes.status) allowed.status = changes.status;
    if (changes.events && Array.isArray(changes.events)) allowed.events = changes.events.slice(0, 50);
    if (Object.keys(allowed).length) {
      const r = await db(`applications?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, {
        method: 'PATCH', body: JSON.stringify({ ...allowed, updated_at: new Date().toISOString() }),
        headers: { Prefer: 'return=minimal' },
      });
      if (!r.ok) {
        const e = await r.text().catch(() => '');
        console.error('[user-sync] update_application failed:', r.status, e.slice(0, 200));
        return res.status(200).json({ ok: false, reason: 'patch_failed' });
      }
    }
    return res.status(200).json({ ok: true });
  }

  // ── CLEAR ALL APPLICATIONS (tracker "Clear all") ─────────────────────────────
  if (action === 'clear_applications') {
    const r = await db(`applications?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: r.ok });
  }

  // ── LOAD PROFILE ────────────────────────────────────────────────────────────
  if (action === 'load_profile') {
    const r = await db(`profiles?id=eq.${uid}&limit=1`);
    const rows = r.ok ? await r.json() : [];
    return res.status(200).json({ profile: rows[0] || null });
  }

  // ── SAVE PROFILE ────────────────────────────────────────────────────────────
  if (action === 'save_profile') {
    const p = body.profile || {};
    // Only include columns guaranteed to exist — survey fields saved separately
    const SAFE_FIELDS = ['email','name','type','city','industry','experience','survey_completed','onboarding_survey'];
    const row = { id: uid };
    SAFE_FIELDS.forEach(f => { if (p[f] !== undefined) row[f] = p[f]; });
    const r = await db('profiles?on_conflict=id', {
      method: 'POST',
      body: JSON.stringify(row),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('save_profile failed:', r.status, errText);
    }
    return res.status(r.ok ? 200 : 400).json({ ok: r.ok });
  }

  // ── SAVE RESUME — upsert so it works even if profile row doesn't exist yet ──
  if (action === 'save_resume') {
    const { text, fileName, wordCount } = body;
    // AUTHORITATIVE readability gate: unreadable text (glyph codes, binary spill) must NEVER
    // reach profiles.resume_text — the DB is the source of truth for signed-in users, so one
    // poisoned save corrupts the résumé on EVERY device (the 2026-07-03 cross-device incident).
    // Same canonical predicate as the upload + optimize gates (lib/server/resumeReadability.js).
    if (text && !isReadableResume(text)) {
      return res.status(400).json({ ok: false, error: 'RESUME_UNREADABLE' });
    }
    const r = await db('profiles?on_conflict=id', {
      method: 'POST',
      body: JSON.stringify({
        id: uid,
        resume_text: text || null,
        resume_file_name: fileName || null,
        resume_word_count: wordCount || null,
        resume_updated_at: new Date().toISOString(),
      }),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('save_resume failed:', r.status, errText);
    }
    return res.status(r.ok ? 200 : 400).json({ ok: r.ok });
  }

  // ── CLEAR RESUME ────────────────────────────────────────────────────────────
  if (action === 'clear_resume') {
    await db(`profiles?id=eq.${uid}`, {
      method: 'PATCH',
      body: JSON.stringify({ resume_text: null, resume_file_name: null, resume_word_count: null }),
      headers: { Prefer: 'return=minimal' },
    });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE ACCOUNT ──────────────────────────────────────────────────────────
  if (action === 'delete_account') {
    // GDPR Art.17 (right to erasure): remove every row keyed to this user before deleting
    // the auth record — previously only applications + profile were cleared, orphaning
    // credits, events, resume data, saved jobs, etc. Best-effort per table (a missing
    // table/column just no-ops) so one failure can't block the deletion.
    const userTables = [
      'applications', 'application_events', 'saved_jobs', 'ai_credits', 'credit_transactions',
      'user_recent_cos', 'login_signals', 'answered_questions', 'resume_employment',
      'resume_skills', 'job_availability_reports', 'search_events',
    ];
    await Promise.all(userTables.map(t =>
      db(`${t}?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {})
    ));
    // Best-effort: remove any resume files this user uploaded to the `resumes` Storage bucket.
    // Uploads are keyed under a `${uid}/` prefix; list then delete. No-ops if the bucket is
    // empty for this user or uses a different convention — never blocks the deletion.
    try {
      const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/resumes`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: `${uid}/`, limit: 100 }),
      });
      if (listRes.ok) {
        const objects = await listRes.json();
        const paths = (Array.isArray(objects) ? objects : []).map(o => `${uid}/${o.name}`);
        if (paths.length) {
          await fetch(`${SUPABASE_URL}/storage/v1/object/resumes`, {
            method: 'DELETE',
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefixes: paths }),
          }).catch(() => {});
        }
      }
    } catch { /* storage cleanup is best-effort */ }

    // Contributed company intel outlives the account: de-link the user from their public
    // reports AND résumé-survey answers (user_id → null) rather than deleting the signal.
    await db(`reports?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ user_id: null }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    await db(`resume_surveys?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ user_id: null }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    await db(`profiles?id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!delRes.ok && delRes.status !== 404) {
      await delRes.text().catch(() => {});
      return res.status(500).json({ error: 'Account deletion failed — contact support' });
    }
    return res.status(200).json({ ok: true });
  }

  // ── LOG SEARCH EVENT ──────────────────────────────────────────────────────────
  if (action === 'log_search_event') {
    const { query, result_count, match_confidence, confirmed, stale_click } = body;
    if (!query) return res.status(400).json({ error: 'query required' });
    db('search_events', {
      method: 'POST',
      body: JSON.stringify({
        user_id: uid,
        query: String(query).slice(0, 200),
        result_count: parseInt(result_count) || 0,
        match_confidence: parseInt(match_confidence) || 100,
        confirmed: !!confirmed,
        stale_click: !!stale_click,
      }),
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  // ── CREATE APPLICATION ────────────────────────────────────────────────────────
  if (action === 'create_application') {
    const { company_name, role } = body;
    if (!company_name || !role) return res.status(400).json({ error: 'company_name and role required' });
    const r = await db('applications', {
      method: 'POST',
      body: JSON.stringify({
        user_id: uid,
        company_name: String(company_name).slice(0, 200),
        role: String(role).slice(0, 200),
        stage: 'Applied',
        status: 'active',
      }),
      headers: { Prefer: 'return=minimal' },
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => r.status);
      console.error('create_application failed:', errText);
      return res.status(500).json({ error: 'Failed to create application' });
    }
    return res.status(200).json({ ok: true });
  }

  if (action === 'report_job_availability') {
    const { job_id, status: avStatus, snapshot } = body;
    if (!job_id || !['active','expired','unknown'].includes(avStatus)) {
      return res.status(400).json({ error: 'job_id and valid status required' });
    }
    // Snapshot of the listing at report time (client sends it). Lets the admin see what was
    // reported even for ephemeral search results with no jobs-table row. Trimmed + length-capped
    // so a bad client payload can't bloat the row; missing fields stay null (migration 046).
    const clip = (v) => {
      const s = (v == null ? '' : String(v)).trim();
      return s ? s.slice(0, 300) : null;
    };
    const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
    // Upsert report (one per user per job)
    const rr = await db('job_availability_reports?on_conflict=user_id,job_id', {
      method: 'POST',
      body: JSON.stringify({
        job_id: String(job_id), user_id: uid, status: avStatus, reported_at: new Date().toISOString(),
        company: clip(snap.company), title: clip(snap.title), city: clip(snap.city), apply_url: clip(snap.apply_url),
      }),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!rr.ok) {
      const errText = await rr.text().catch(() => rr.status);
      console.error('report_job_availability insert failed:', errText);
      return res.status(500).json({ error: 'Failed to save report' });
    }
    // Increment report count on the job itself (fire-and-forget). jobs.id is a uuid
    // column; live search results carry client-generated ephemeral ids (e.g. "j_1no2squ")
    // that PostgREST would 400 as invalid-uuid input. The report row (job_id is text)
    // is already saved above — only touch the jobs row when the id can actually match one.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(job_id))) {
      // Real increment (read-then-patch): this used to hardcode `1`, making the "counter" a
      // boolean — every listing showed "1 job-seeker reported it closed" no matter how many
      // actually had. Awaited (not fire-and-forget) because Vercel freezes after the response.
      try {
        const jr = await db(`jobs?id=eq.${encodeURIComponent(String(job_id))}&select=availability_report_count&limit=1`);
        const cur = jr.ok ? (((await jr.json())?.[0]?.availability_report_count) || 0) : 0;
        await db(`jobs?id=eq.${encodeURIComponent(String(job_id))}`, {
          method: 'PATCH',
          body: JSON.stringify({ availability_report_count: cur + 1, last_checked_at: new Date().toISOString() }),
          headers: { Prefer: 'return=minimal' },
        });
      } catch { /* best-effort — the report row above is already saved */ }
    }
    // Notify the company's employer that one of their listings was REPORTED inactive (migration
    // 057). Only on an 'expired' report (the "reported inactive" signal — 'active' is a
    // confirmation, 'unknown' is ambiguous). Scoped by company_key; best-effort, never fatal.
    if (avStatus === 'expired') {
      const reportedCompany = clip(snap.company);
      const companyKey = normalizeClaimCompany(reportedCompany);
      if (companyKey) {
        try {
          const notif = buildNotificationRow('listing_reported', {
            companyName: reportedCompany, companyKey, jobId: String(job_id),
            title: 'A listing was reported inactive',
            body: `A candidate reported “${clip(snap.title) || 'a listing'}” as no longer active. You can dispute this from your dashboard — an admin reviews every dispute.`,
            meta: { role: clip(snap.title) || null, city: clip(snap.city) || null },
          });
          if (notif) {
            await db('employer_notifications', { method: 'POST', body: JSON.stringify(notif), headers: { Prefer: 'return=minimal' } });
          }
        } catch (e) {
          console.error('[user-sync] listing_reported notify failed (non-fatal):', e?.message || e);
        }
      }
    }
    broadcastActivity('flag'); // instant Seen Live ping
    return res.status(200).json({ ok: true });
  }

  // ── GET CREDITS ──────────────────────────────────────────────────────────────
  if (action === 'get_credits') {
    const today = new Date().toISOString().split('T')[0];
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    let cred = cRes.ok ? (await cRes.json())[0] : null;
    if (!cred) {
      // No row means they haven't used AI yet — show welcome balance preview (don't create row here)
      return res.status(200).json({ balance: WELCOME_CREDITS, pro: false, daily_earned: 0, max_daily_earn: MAX_DAILY_EARN, welcome: true });
    } else if (cred.last_reset !== today) {
      const nb = hasProAccess(cred) ? PRO_DAILY_CREDITS : FREE_DAILY_CREDITS;
      await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: nb, daily_earned: 0, last_reset: today }), headers: { Prefer: 'return=minimal' } });
      cred = { ...cred, balance: nb, daily_earned: 0, last_reset: today };
    }
    return res.status(200).json({ balance: creditBalance(cred), pro: hasProAccess(cred), daily_earned: cred.daily_earned, max_daily_earn: MAX_DAILY_EARN });
  }

  // ── CONSUME CREDIT ────────────────────────────────────────────────────────────
  if (action === 'consume_credit') {
    // Atomic consume via SQL function (SELECT ... FOR UPDATE) — prevents two concurrent
    // requests from spending the same credit. Falls back to the inline path below if the
    // RPC isn't available (DB without migration 025_atomic_consume_credit).
    try {
      const rpc = await db('rpc/consume_credit', { method: 'POST', body: JSON.stringify({ p_uid: uid, p_reason: body.reason || 'ai_tool', p_pro_only: false }) });
      if (rpc.ok) {
        const row = (await rpc.json())?.[0];
        if (row && row.status) {
          if (row.status === 'no_credits') return res.status(200).json({ ok: false, error: 'no_credits', balance: 0 });
          return res.status(200).json({ ok: true, balance: row.balance, pro: row.pro });
        }
      }
    } catch { /* fall back to inline path */ }

    const today = new Date().toISOString().split('T')[0];
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    let cred = cRes.ok ? (await cRes.json())[0] : null;
    if (!cred) {
      // First use: welcome bonus, deduct one credit for this call.
      const welcomeBalance = WELCOME_CREDITS - RESUME_OPTIMIZE_COST;
      await db('ai_credits', { method: 'POST', body: JSON.stringify({ user_id: uid, balance: welcomeBalance, daily_earned: 0, last_reset: today, pro: false }), headers: { Prefer: 'return=minimal' } });
      await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: WELCOME_CREDITS, reason: 'welcome_bonus' }), headers: { Prefer: 'return=minimal' } });
      await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: -1, reason: body.reason || 'ai_tool' }), headers: { Prefer: 'return=minimal' } });
      return res.status(200).json({ ok: true, balance: welcomeBalance });
    }
    if (hasProAccess(cred)) return res.status(200).json({ ok: true, balance: PRO_DAILY_CREDITS, pro: true });
    const purchased = Math.max(0, cred.purchased_credits || 0);
    if (cred.last_reset !== today) {
      // Daily reset to FREE_DAILY_CREDITS (DB DEFAULT stays 1 per migration 031), then deduct this call.
      const afterReset = Math.max(0, FREE_DAILY_CREDITS - 1);
      await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: afterReset, daily_earned: 0, last_reset: today }), headers: { Prefer: 'return=minimal' } });
      await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: -1, reason: body.reason || 'ai_tool' }), headers: { Prefer: 'return=minimal' } });
      return res.status(200).json({ ok: true, balance: afterReset + purchased });
    }
    // Spend the daily balance first, then purchased (never-resetting) credits.
    if (cred.balance <= 0 && purchased <= 0) return res.status(200).json({ ok: false, error: 'no_credits', balance: 0 });
    let nb;
    if (cred.balance > 0) {
      nb = cred.balance - 1;
      await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: nb }), headers: { Prefer: 'return=minimal' } });
      nb += purchased;
    } else {
      nb = purchased - 1;
      await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ purchased_credits: nb }), headers: { Prefer: 'return=minimal' } });
    }
    await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: -1, reason: body.reason || 'ai_tool' }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, balance: nb });
  }

  // ── EARN CREDIT (track application) ──────────────────────────────────────────
  if (action === 'earn_credit') {
    const { jid } = body;
    const today = new Date().toISOString().split('T')[0];
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    let cred = cRes.ok ? (await cRes.json())[0] : null;
    if (hasProAccess(cred)) return res.status(200).json({ ok: false, reason: 'pro' });
    // A brand-new user has no ai_credits row yet — create one (like submit_answer does)
    // so their FIRST tracked application still earns. Refusing here was a silent dead end.
    if (!cred) {
      const ins = await db('ai_credits?on_conflict=user_id', {
        method: 'POST',
        body: JSON.stringify({ user_id: uid, balance: FREE_DAILY_CREDITS, pro: false, daily_earned: 0, last_reset: today }),
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      });
      cred = ins.ok ? (await ins.json())[0] : null;
      if (!cred) return res.status(200).json({ ok: false, reason: 'no_row' });
    }

    const resetToday = cred.last_reset !== today;
    const dailyEarned = resetToday ? 0 : (cred.daily_earned || 0);
    if (dailyEarned >= MAX_DAILY_EARN) return res.status(200).json({ ok: false, reason: 'daily_cap', balance: creditBalance(cred) });

    // Per-job dedupe FIRST, across all days — the same tracked job never earns twice.
    // (Previously this check was skipped entirely on the first earn of a new day.)
    if (jid) {
      const dupRes = await db(`credit_transactions?user_id=eq.${uid}&reason=eq.track_application&metadata->>jid=eq.${encodeURIComponent(String(jid))}&select=id&limit=1`);
      if (dupRes.ok && ((await dupRes.json()) || []).length) {
        return res.status(200).json({ ok: false, reason: 'already_earned', balance: creditBalance(cred) });
      }
    }

    // Max 3 tracking earns per DAY (prevent spam). The old query had no date filter, so
    // it counted LIFETIME earns and permanently killed the incentive after 3.
    const sinceMidnight = `${today}T00:00:00Z`;
    const trackRes = await db(`credit_transactions?user_id=eq.${uid}&reason=eq.track_application&created_at=gte.${sinceMidnight}&select=id&limit=4`);
    if (trackRes.ok && ((await trackRes.json()) || []).length >= 3) {
      return res.status(200).json({ ok: false, reason: 'track_cap', balance: creditBalance(cred) });
    }

    // Daily reset baseline is FREE_DAILY_CREDITS (code resets daily; DB DEFAULT stays 1 per migration 031).
    const baseBalance = resetToday ? FREE_DAILY_CREDITS : (cred.balance || 0);
    const newBalance = Math.min(baseBalance + TRACK_APPLICATION_AWARD, MAX_FREE_BALANCE);
    const newEarned = dailyEarned + TRACK_APPLICATION_AWARD;
    await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: newBalance, daily_earned: newEarned, ...(resetToday ? { last_reset: today } : {}) }), headers: { Prefer: 'return=minimal' } });
    await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: 1, reason: 'track_application', metadata: { jid: jid || null } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, balance: newBalance + Math.max(0, cred.purchased_credits || 0), earned: true });
  }

  // ── GET QUESTION (earn a credit) ──────────────────────────────────────────────
  if (action === 'get_question') {
    const today = new Date().toISOString().split('T')[0];
    // Check daily earn cap
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    const cred = cRes.ok ? (await cRes.json())[0] : null;
    if (hasProAccess(cred)) return res.status(200).json({ question: null, reason: 'pro_unlimited' });
    const dailyEarned = (cred?.last_reset === today ? cred?.daily_earned : 0) || 0;
    if (dailyEarned >= MAX_DAILY_EARN) return res.status(200).json({ question: null, reason: 'daily_cap', earned_today: dailyEarned });

    // Load answered question keys
    const aqRes = await db(`answered_questions?user_id=eq.${uid}&select=question_key&limit=200`);
    const answered = new Set(aqRes.ok ? (await aqRes.json()).map(r => r.question_key) : []);

    // Priority 1: Resume-based company questions
    const empRes = await db(`resume_employment?user_id=eq.${uid}&select=company,title&limit=10`);
    const employment = empRes.ok ? await empRes.json() : [];
    const Q_TYPES = [
      { type: 'ghost', q: (co) => `Did ${co} respond to your application?`, opts: ['Yes, they responded','No, was ghosted','Haven\'t applied there'] },
      { type: 'timeline', q: (co) => `How long did ${co} take to first contact you?`, opts: ['Same day','1–3 days','4–7 days','1–2 weeks','2–4 weeks','Never heard back'] },
      { type: 'rounds', q: (co) => `How many interview rounds did ${co} put you through?`, opts: ['None / auto-rejected','1 round','2 rounds','3 rounds','4+ rounds'] },
      { type: 'return', q: (co) => `Would you apply to ${co} again?`, opts: ['Definitely yes','Probably yes','Probably not','Never again'] },
    ];
    for (const emp of employment) {
      for (const qt of Q_TYPES) {
        const key = `${qt.type}|${emp.company.toLowerCase()}`;
        if (!answered.has(key)) {
          return res.status(200).json({ question: { key, company: emp.company, prompt: `We noticed ${emp.company} on your resume.`, text: qt.q(emp.company), options: qt.opts, credit_value: 1, source: 'resume' } });
        }
      }
    }

    // Priority 2: Tracker companies (apps without outcomes)
    const appsRes = await db(`applications?user_id=eq.${uid}&status=eq.active&select=company_name&limit=10`);
    const trackerApps = appsRes.ok ? await appsRes.json() : [];
    for (const app of trackerApps) {
      const co = app.company_name; if (!co) continue;
      const key = `tracker_outcome|${co.toLowerCase()}`;
      if (!answered.has(key)) {
        return res.status(200).json({ question: { key, company: co, prompt: `You applied to ${co}.`, text: `What happened with your application at ${co}?`, options: ['Hired 🎉','Got an interview','Rejected','Ghosted','Still waiting'], credit_value: 1, source: 'tracker' } });
      }
    }

    // Priority 3: Data verification (low-confidence companies). The column is
    // company_name — the bare `name` select 400'd and this tier never served a question.
    const coRes = await db(`company_scores?report_count=lt.5&ghost_rate=not.is.null&select=name:company_name,ghost_rate&order=report_count.asc&limit=10`);
    const lowCos = coRes.ok ? await coRes.json() : [];
    for (const co of lowCos) {
      const key = `verify_ghost|${co.name.toLowerCase()}`;
      if (!answered.has(key)) {
        const pct = Math.round((co.ghost_rate || 0) * 100);
        return res.status(200).json({ question: { key, company: co.name, prompt: `Our data shows ${co.name} has a ${pct}% ghost rate.`, text: `Did ${co.name} respond to your application?`, options: ['Yes, they responded','No, was ghosted','I haven\'t applied there'], credit_value: 1, source: 'verification' } });
      }
    }

    // Fallback: generic
    const generics = [
      { key: 'generic|response_time', text: 'On average, how long do companies take to respond to you?', options: ['Under a week','1–2 weeks','2–4 weeks','Over a month','They rarely respond'] },
      { key: 'generic|ghosting_stage', text: 'At what stage are you ghosted most often?', options: ['After applying','After phone screen','After interview','After final round','Rarely get ghosted'] },
      { key: 'generic|apps_per_week', text: 'How many applications do you send per week?', options: ['1–5','6–10','11–20','20+','I\'m between searches'] },
    ];
    for (const g of generics) {
      if (!answered.has(g.key)) return res.status(200).json({ question: { ...g, company: null, prompt: null, credit_value: 1, source: 'generic' } });
    }

    return res.status(200).json({ question: null, reason: 'no_questions' });
  }

  // ── SUBMIT ANSWER ─────────────────────────────────────────────────────────────
  if (action === 'submit_answer') {
    const { question_key, answer } = body;
    if (!question_key || !answer) return res.status(400).json({ error: 'question_key and answer required' });
    const today = new Date().toISOString().split('T')[0];

    // Check daily earn cap
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    let cred = cRes.ok ? (await cRes.json())[0] : null;
    if (!cred) { await db('ai_credits', { method: 'POST', body: JSON.stringify({ user_id: uid, balance: FREE_DAILY_CREDITS, daily_earned: 0, last_reset: today, pro: false }), headers: { Prefer: 'return=minimal' } }); cred = { balance: FREE_DAILY_CREDITS, daily_earned: 0, last_reset: today, pro: false }; }
    const isPro = hasProAccess(cred);
    const resetToday = cred.last_reset !== today;
    const dailyEarned = resetToday ? 0 : (cred.daily_earned || 0);
    if (dailyEarned >= MAX_DAILY_EARN && !isPro) return res.status(200).json({ ok: false, error: 'daily_cap', earned_today: dailyEarned });

    // Store answer (dedup via PK)
    const aqIns = await db('answered_questions', { method: 'POST', body: JSON.stringify({ user_id: uid, question_key, answer }), headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
    // If duplicate (already answered), don't grant credit
    if (aqIns.status === 409) return res.status(200).json({ ok: false, error: 'already_answered' });

    // Grant one credit. Daily reset baseline is FREE_DAILY_CREDITS (code resets daily; DB
    // DEFAULT stays 1 per migration 031). The response must report the SAME number we persist —
    // the old code PATCHed one balance but told the client another, so the modal and the Nav
    // chip showed different balances at the same time.
    const newBalance = isPro ? PRO_DAILY_CREDITS : Math.min((resetToday ? FREE_DAILY_CREDITS : (cred.balance || 0)) + TRACK_APPLICATION_AWARD, MAX_FREE_BALANCE);
    const newEarned = resetToday ? TRACK_APPLICATION_AWARD : dailyEarned + TRACK_APPLICATION_AWARD;
    const patch = isPro ? {} : { balance: newBalance, daily_earned: newEarned, ...(resetToday ? { last_reset: today } : {}) };
    if (Object.keys(patch).length) await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
    await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: 1, reason: 'earned_question', metadata: { question_key, answer } }), headers: { Prefer: 'return=minimal' } });

    // Feed answer back into company intelligence (best-effort)
    const [qtype, company] = question_key.split('|');
    if (company && (qtype === 'ghost' || qtype === 'verify_ghost' || qtype === 'tracker_outcome')) {
      const wasGhosted = answer.toLowerCase().includes('ghost') || answer.toLowerCase().includes('never');
      const responded = answer.toLowerCase().includes('respond') || answer.toLowerCase().includes('interview') || answer.toLowerCase().includes('hired') || answer.toLowerCase().includes('rejected');
      if (wasGhosted || responded) {
        const outcome = wasGhosted ? 'ghosted' : 'human';
        await db('reports', { method: 'POST', body: JSON.stringify({ company_name: company, outcome, experience_level: 'unspecified', platform: 'seen_intel', report_text: `[Intel] ${answer}` }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
      }
    }

    return res.status(200).json({ ok: true, balance: isPro ? newBalance : newBalance + Math.max(0, cred.purchased_credits || 0), earned_today: newEarned });
  }

  // ── CREDIT HISTORY ────────────────────────────────────────────────────────────
  if (action === 'credit_history') {
    const today = new Date().toISOString().split('T')[0];
    const [credRes, txRes] = await Promise.all([
      db(`ai_credits?user_id=eq.${uid}&limit=1`),
      db(`credit_transactions?user_id=eq.${uid}&order=created_at.desc&limit=30`),
    ]);
    let cred = credRes.ok ? (await credRes.json())[0] : null;
    if (cred && cred.last_reset !== today) {
      const nb = hasProAccess(cred) ? PRO_DAILY_CREDITS : FREE_DAILY_CREDITS;
      db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: nb, daily_earned: 0, last_reset: today }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
      cred = { ...cred, balance: nb, daily_earned: 0, last_reset: today };
    }
    const transactions = txRes.ok ? await txRes.json() : [];
    return res.status(200).json({
      balance: cred ? creditBalance(cred) : FREE_DAILY_CREDITS,
      pro: hasProAccess(cred),
      daily_earned: cred?.daily_earned ?? 0,
      transactions,
    });
  }

  // ── SAVE EMPLOYMENT HISTORY ────────────────────────────────────────────────────
  if (action === 'save_employment') {
    const { employment } = body;
    if (!Array.isArray(employment) || !employment.length) return res.status(200).json({ ok: true });
    // Clear old entries first
    await db(`resume_employment?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    // Insert new entries (max 15)
    const rows = employment.slice(0, 15).map(e => ({
      user_id: uid,
      company: (e.company || '').slice(0, 120),
      title: (e.title || '').slice(0, 120),
      start_date: (e.start_date || '').slice(0, 20),
      end_date: (e.end_date || '').slice(0, 20),
    })).filter(r => r.company);
    if (rows.length) await db('resume_employment', { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, count: rows.length });
  }

  // ── GET EMPLOYMENT HISTORY ────────────────────────────────────────────────────
  if (action === 'get_employment') {
    const r = await db(`resume_employment?user_id=eq.${uid}&order=id.desc&limit=15`);
    const rows = r.ok ? await r.json() : [];
    return res.status(200).json({ employment: rows });
  }

  // ── LOG RECENT COMPANY VIEW ───────────────────────────────────────────────────
  if (action === 'log_recent_co') {
    const { company, location } = body;
    if (!company) return res.status(400).json({ error: 'company required' });
    await db('user_recent_cos', {
      method: 'POST',
      body: JSON.stringify({ user_id: uid, company_name: company.slice(0, 100), location: (location || '').slice(0, 100), viewed_at: new Date().toISOString() }),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    return res.status(200).json({ ok: true });
  }

  // ── GET RECENT COMPANY VIEWS ──────────────────────────────────────────────────
  if (action === 'get_recent_cos') {
    const r = await db(`user_recent_cos?user_id=eq.${uid}&order=viewed_at.desc&limit=6`);
    const rows = r.ok ? await r.json() : [];
    return res.status(200).json({ recent: rows });
  }

  // ── COMPANY SURVEY — 5 focused questions about one application ───────────────
  if (action === 'company_survey') {
    const { company, role, status } = body;
    if (!company) return res.status(400).json({ error: 'company required' });
    const co = String(company).slice(0, 120).trim();
    const coKey = co.toLowerCase();

    // Check what's already been answered for this company
    const aqRes = await db(`answered_questions?user_id=eq.${uid}&question_key=like.survey_*%7C${encodeURIComponent(coKey)}&select=question_key&limit=20`);
    const answered = new Set(aqRes.ok ? (await aqRes.json()).map(r => r.question_key) : []);

    const roleStr = role ? ` for ${role}` : '';
    const isGhosted = status === 'ghosted';
    const isHired   = status === 'hired';

    const allQ = [];

    // Q1: Response/outcome
    const k1 = `survey_response|${coKey}`;
    if (!answered.has(k1)) allQ.push({
      key: k1, company: co,
      prompt: `${co}${role ? ` · ${role}` : ''}`,
      text: isGhosted
        ? `Did ${co} ever officially close your application?`
        : isHired
        ? `Congrats on ${co}! How quickly did they move you through the process?`
        : `Did ${co} respond to your application${roleStr}?`,
      options: isGhosted
        ? ['Sent a formal rejection', 'Complete silence', 'Got a vague follow-up']
        : isHired
        ? ['Very fast — under 2 weeks', '2–4 weeks', '1–2 months', 'Over 2 months']
        : ['Yes, they responded', 'No response yet (ghosted)', 'Still waiting'],
      credit_value: 1, source: 'survey',
    });

    // Q2: Timeline
    const k2 = `survey_timeline|${coKey}`;
    if (!answered.has(k2)) allQ.push({
      key: k2, company: co,
      prompt: `${co} — timing`,
      text: isGhosted
        ? `How long before ${co} went silent?`
        : `How long did ${co} take to first contact you?`,
      options: ['Under a week', '1–2 weeks', '2–4 weeks', '1–2 months', 'Over 2 months'],
      credit_value: 1, source: 'survey',
    });

    // Q3: Stage reached
    const k3 = `survey_stage|${coKey}`;
    if (!answered.has(k3)) allQ.push({
      key: k3, company: co,
      prompt: `${co} — process`,
      text: `What was the furthest stage you reached at ${co}?`,
      options: ['Application only — no contact', 'Recruiter / phone screen', 'Skills test or take-home', 'Panel or on-site interview', 'Final round or offer'],
      credit_value: 1, source: 'survey',
    });

    // Q4: Process transparency
    const k4 = `survey_process|${coKey}`;
    if (!answered.has(k4)) allQ.push({
      key: k4, company: co,
      prompt: `${co} — your take`,
      text: `How transparent was ${co}'s hiring process?`,
      options: ['Very clear — great communication', 'Mostly clear, minor gaps', 'Somewhat unclear', 'Poor communication throughout', 'Total black hole'],
      credit_value: 1, source: 'survey',
    });

    // Q5: Would apply again
    const k5 = `survey_return|${coKey}`;
    if (!answered.has(k5)) allQ.push({
      key: k5, company: co,
      prompt: `${co} — overall`,
      text: `Would you apply to ${co} again based on this experience?`,
      options: ['Definitely yes', 'Probably yes', 'Neutral', 'Probably not', 'Definitely not'],
      credit_value: 1, source: 'survey',
    });

    // Also check daily cap so UI knows if credits are still earnable
    const today = new Date().toISOString().split('T')[0];
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    const cred = cRes.ok ? (await cRes.json())[0] : null;
    const dailyEarned = (cred?.last_reset === today ? cred?.daily_earned : 0) || 0;
    const creditsLeft = Math.max(0, MAX_DAILY_EARN - dailyEarned);

    return res.status(200).json({
      ok: true,
      questions: allQ.slice(0, 5),
      credits_left: creditsLeft,
      balance: cred ? creditBalance(cred) : 3,
    });
  }

  // ── OPPORTUNITY ENGINE — personalized data-point questions for the survey ─────
  // Behind-the-scenes engine mines the user's apps/outcomes/profile to surface the
  // highest-value missing data points as survey-shaped questions. Answers flow
  // through the existing submit_answer pipeline (records + awards a credit).
  if (action === 'get_opportunities') {
    const today = new Date().toISOString().split('T')[0];
    const [appsRes, aqRes, cRes] = await Promise.all([
      db(`applications?user_id=eq.${uid}&select=company_name,role,status,stage,events,created_at,applied_at&order=created_at.desc&limit=100`),
      db(`answered_questions?user_id=eq.${uid}&select=question_key&limit=1000`),
      db(`ai_credits?user_id=eq.${uid}&limit=1`),
    ]);
    const appRows = appsRes.ok ? await appsRes.json() : [];
    const apps = appRows.map(r => ({
      company: r.company_name,
      role: r.role,
      status: r.status,
      stage: r.stage,
      appliedAt: Date.parse(r.applied_at || r.created_at) || Date.now(),
      events: Array.isArray(r.events) ? r.events : [],
    }));
    const answeredKeys = aqRes.ok ? (await aqRes.json()).map(r => r.question_key) : [];
    const cred = cRes.ok ? (await cRes.json())[0] : null;
    const dailyEarned = (cred?.last_reset === today ? cred?.daily_earned : 0) || 0;

    const questions = buildOpportunities({ apps, answeredKeys, dailyEarned, dailyCap: 5, maxQuestions: 6 });
    return res.status(200).json({
      ok: true,
      questions,
      credits_left: Math.max(0, 5 - dailyEarned),
      balance: cred ? creditBalance(cred) : 3,
    });
  }

  // ── RESUME SURVEY — load a survey about ONE random unsurveyed past employer ───
  // The data-currency engine: forces every signed-in user (especially free ones) to
  // contribute real company hiring data in exchange for AI credits. Reads the user's
  // résumé on file, parses employment history with the deterministic extractEmployment()
  // parser (NO AI), and picks a random past (company, role) the user hasn't been surveyed
  // about yet. Returns generic hiring-experience questions about THAT company.
  if (action === 'resume_survey') {
    const today = new Date().toISOString().split('T')[0];

    // Daily-earn cap (mirrors submit_answer / get_question): pro = unlimited, free = MAX_DAILY_EARN/day.
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    const cred = cRes.ok ? (await cRes.json())[0] : null;
    const isPro = hasProAccess(cred);
    const dailyEarned = (cred?.last_reset === today ? cred?.daily_earned : 0) || 0;
    const creditsLeft = isPro ? PRO_DAILY_CREDITS : Math.max(0, MAX_DAILY_EARN - dailyEarned);

    // Load the résumé on file (canonical store: profiles.resume_text — see ResumeStore/save_resume).
    const pRes = await db(`profiles?id=eq.${uid}&select=resume_text&limit=1`);
    const resumeText = pRes.ok ? ((await pRes.json())[0]?.resume_text || '') : '';
    if (!resumeText || resumeText.length < 50) {
      return res.status(200).json({ ok: true, survey: null, reason: 'no_resume', credits_left: creditsLeft, balance: creditBalance(cred) });
    }

    // Deterministic employment parse → past positions with company + title.
    let employment = [];
    try { employment = extractEmployment(resumeText); } catch { employment = []; }
    const positions = employment.filter(e => isValidCompanyName(e.company));
    if (!positions.length) {
      return res.status(200).json({ ok: true, survey: null, reason: 'no_employment', credits_left: creditsLeft, balance: creditBalance(cred) });
    }

    // Exclude positions this user already completed (anti-farming ledger).
    const surveyedRes = await db(`resume_surveys?user_id=eq.${uid}&select=company_norm&limit=200`);
    const surveyed = new Set(surveyedRes.ok ? (await surveyedRes.json()).map(r => r.company_norm) : []);
    const pool = positions.filter(p => !surveyed.has(normalizeCompany(p.company)));
    if (!pool.length) {
      return res.status(200).json({ ok: true, survey: null, reason: 'all_surveyed', credits_left: creditsLeft, balance: creditBalance(cred) });
    }
    if (!isPro && creditsLeft <= 0) {
      return res.status(200).json({ ok: true, survey: null, reason: 'daily_cap', credits_left: 0, balance: creditBalance(cred) });
    }

    // Pick a random unsurveyed position.
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const { questions } = buildResumeSurvey(pick.company, pick.title);

    return res.status(200).json({
      ok: true,
      survey: {
        company: pick.company,
        role: pick.title || '',
        company_norm: normalizeCompany(pick.company),
        questions,
      },
      credits_left: creditsLeft,
      balance: creditBalance(cred),
    });
  }

  // ── SUBMIT RESUME SURVEY — award credits + write a trust-weighted report ──────
  // On completion we (1) record the survey to resume_surveys (prevents re-farming the same
  // position), (2) award AI credits respecting the daily cap, and (3) write a first-party,
  // trust-weighted report to the corresponding company — creating the company/location
  // record if it doesn't exist — so the answers feed that company's score. source = 'resume_survey'.
  if (action === 'submit_resume_survey') {
    const { company, role, answers } = body;
    if (!company || !answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'company and answers required' });
    }
    if (!isValidCompanyName(company)) return res.status(400).json({ error: 'invalid company' });

    // Require at least the core outcome/response answer so we never write an empty report.
    const answeredKeys = RESUME_SURVEY_KEYS.filter(k => typeof answers[k] === 'string' && answers[k]);
    if (!answeredKeys.length) return res.status(400).json({ error: 'no answers provided' });

    const coNorm = normalizeCompany(company);
    const today = new Date().toISOString().split('T')[0];

    // ── Anti-farming: one completed survey per (user, company). Reserve the slot first via
    // a unique-constrained insert; a duplicate (unique violation → 409) means it was already
    // farmed → no credit. NOTE: we deliberately do NOT use resolution=ignore-duplicates here —
    // that would swallow the conflict into a 2xx and let the same position be re-farmed.
    const reserve = await db('resume_surveys', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: uid,
        company_norm: coNorm,
        company_name: String(company).slice(0, 200),
        role: role ? String(role).slice(0, 200) : null,
        answers,
      }),
    });
    if (reserve.status === 409) {
      return res.status(200).json({ ok: false, error: 'already_surveyed' });
    }
    if (!reserve.ok) {
      const e = await reserve.text().catch(() => '');
      console.error('[user-sync] resume_survey reserve failed:', reserve.status, e.slice(0, 200));
      // If the table is missing (migration not applied), fail loud rather than silently mis-awarding.
      return res.status(500).json({ error: 'Could not record survey' });
    }

    // ── Map answers → report schema (deterministic). ─────────────────────────────
    const mapped = mapAnswersToReport(answers);

    // ── Resolve / create the company (+ optional location) and write a trust-weighted report.
    const hdrs = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    let cid = null;
    let reportWritten = false;
    try {
      cid = await resolveOrCreateCompany(SUPABASE_URL, hdrs, company);
      if (cid) {
        const trust = await assessSubmitTrust(SUPABASE_URL, hdrs, uid, `company_id=eq.${cid}`);
        const reportBase = {
          company_id: cid,
          location_id: null,
          role: role ? String(role).trim().slice(0, 200) : '',
          platform: 'Seen Resume Survey',
          outcome: mapped.outcome,
          ghost_stage: mapped.ghost_stage,
          rounds: mapped.rounds,
          wait_days: mapped.wait_days,
          unpaid_work: mapped.unpaid_work,
          experience_level: '',
          report_text: null,
          source: 'resume_survey',
          needs_review: trust.review,
          outcome_weight: trust.weight,
          trust_reason: trust.reason,
          user_id: uid,
        };
        reportWritten = await writeReport(SUPABASE_URL, hdrs, reportBase, String(company).trim().slice(0, 200));
        // Refresh THIS company's cached score from its real reports right away, so the survey's
        // intel shows on the company page immediately (the score read is cache-first and would
        // otherwise keep serving a stale web-research grade until a cron/force_refresh). Skipped
        // when the report is held for review (it wouldn't count toward the grade anyway).
        if (reportWritten && !trust.review) {
          await recomputeCompanyScoreFromReports(SUPABASE_URL, hdrs, String(company).trim().slice(0, 200));
        }
      }
    } catch (err) {
      console.error('[user-sync] resume_survey report write failed:', err?.message);
    }

    // Record the resolved company_id + mapped outcome back onto the survey ledger row (best-effort).
    db(`resume_surveys?user_id=eq.${uid}&company_norm=eq.${encodeURIComponent(coNorm)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ company_id: cid, outcome: mapped.outcome }),
    }).catch(() => {});

    // ── Award AI credits (the freeloader incentive), respecting the daily earn cap. ──
    const AWARD = RESUME_SURVEY_AWARD;
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    let cr = cRes.ok ? (await cRes.json())[0] : null;
    if (!cr) {
      await db('ai_credits', { method: 'POST', body: JSON.stringify({ user_id: uid, balance: AWARD, daily_earned: AWARD, last_reset: today, pro: false }), headers: { Prefer: 'return=minimal' } });
      cr = { balance: AWARD, daily_earned: AWARD, last_reset: today, pro: false };
    }
    let awarded = 0;
    let balance = creditBalance(cr);
    if (hasProAccess(cr)) {
      balance = PRO_DAILY_CREDITS;
    } else {
      const resetToday = cr.last_reset !== today;
      const dailyEarned = resetToday ? 0 : (cr.daily_earned || 0);
      const room = Math.max(0, MAX_DAILY_EARN - dailyEarned);     // daily earn cap
      awarded = Math.min(AWARD, room);
      if (awarded > 0) {
        const baseBalance = resetToday ? FREE_DAILY_CREDITS : (cr.balance || 0); // daily reset baseline (code resets daily; DB DEFAULT 1 per migration 031)
        const newDaily = baseBalance + awarded;
        const patch = { balance: newDaily, daily_earned: dailyEarned + awarded };
        if (resetToday) patch.last_reset = today;
        await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
        await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: awarded, reason: 'resume_survey', metadata: { company: coNorm, outcome: mapped.outcome } }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
        balance = newDaily + Math.max(0, cr.purchased_credits || 0); // report daily + purchased
      }
    }
    // Update the ledger row with the credits actually awarded (best-effort).
    if (awarded > 0) {
      db(`resume_surveys?user_id=eq.${uid}&company_norm=eq.${encodeURIComponent(coNorm)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ credits_awarded: awarded }),
      }).catch(() => {});
    }

    return res.status(200).json({
      ok: true,
      awarded,
      balance,
      report_written: reportWritten,
      company_id: cid,
      outcome: mapped.outcome,
    });
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
}

