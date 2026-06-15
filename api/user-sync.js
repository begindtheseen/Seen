// Proxy all user data reads/writes through the service key so RLS never blocks them.
// The client sends its Supabase access token; we validate it here, then use the
// service key to talk to the DB. No RLS policies required on the client side.

import { createHmac, timingSafeEqual } from 'crypto';
// Foundation layer (see docs/ARCHITECTURE.md). Imported with explicit .ts
// extensions so they resolve both under Vercel's serverless bundler and Node's
// native TS loader (tests) — the same pattern already used by api/demand.js.
import { handlePreflight } from '../lib/security/cors.ts';
import { rateLimit } from '../lib/security/rateLimit.ts';
import { requireUser } from '../lib/auth/server.ts';
import { createServiceDb } from '../lib/supabase/admin.ts';
import { loadProfile, getEmployment } from '../lib/profile/service.ts';
import { getRecentCompanies } from '../lib/companies/service.ts';

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
  // CORS + preflight via the shared policy. Default options are identical to the
  // prior inline block (methods 'POST, OPTIONS', headers 'Content-Type,
  // Authorization', same seenjobs.io / localhost origin rules).
  if (handlePreflight(req, res)) return;
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
  if (JWT_SECRET) {
    // Fast path: verify locally — no Supabase round-trip, scales to any concurrency
    const payload = verifyJWTLocal(token, JWT_SECRET);
    if (!payload) return res.status(401).json({ error: 'Invalid token' });
    uid = payload.sub;
  } else {
    // Fallback: validate via Supabase auth API (slower, one extra network call per request)
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
  const WRITE_ACTIONS = new Set(['add_application','update_application','remove_application','save_job','unsave_job','save_profile','save_resume','delete_account']);
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
      db(`applications?user_id=eq.${uid}&select=id,company_name,role,city,platform,job_url,status,stage,score,waste_score,events,employer_stage,created_at,updated_at&order=created_at.desc&limit=${appsLimit}&offset=${appsOffset}`, { headers: { Prefer: 'count=estimated' } }),
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
      const nb = cred.pro ? 999 : 3;
      db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: nb, daily_earned: 0, last_reset: today }), headers: { Prefer: 'return=minimal' } });
      cred = { ...cred, balance: nb, daily_earned: 0, last_reset: today };
    }
    const credits = cred ? { balance: cred.balance, pro: cred.pro || false, daily_earned: cred.daily_earned || 0 } : null;
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
    const row = {
      user_id:      uid,
      company_name: a.company   || '',
      role:         a.role      || '',
      city:         a.location  || '',
      platform:     a.platform  || 'Seen',
      job_url:      a.jobUrl    || null,
      status:       a.status    || 'active',
      stage:        a.stage     || 'Applied',
      score:        a.score     || null,
      waste_score:  a.waste     || null,
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
    const row = {
      user_id:  uid,
      job_id:   String(j.id || ''),
      company:  j.co    || '',
      role:     j.title || '',
      location: j.city  || '',
      score:    j.score || null,
    };
    const r = await db('saved_jobs', {
      method: 'POST',
      body: JSON.stringify(row),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
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
    const allowed = {};
    if (changes.stage)  allowed.stage  = changes.stage;
    if (changes.status) allowed.status = changes.status;
    if (changes.events && Array.isArray(changes.events)) allowed.events = changes.events;
    if (Object.keys(allowed).length) {
      await db(`applications?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, {
        method: 'PATCH', body: JSON.stringify({ ...allowed, updated_at: new Date().toISOString() }),
        headers: { Prefer: 'return=minimal' },
      });
    }
    return res.status(200).json({ ok: true });
  }

  // ── LOAD PROFILE ────────────────────────────────────────────────────────────
  // First action migrated onto the foundation layer. Identity comes from
  // requireUser (the same local-HS256 / /auth/v1/user resolution the top-level
  // boundary performs — a pure local verify when SUPABASE_JWT_SECRET is set), and
  // the DB read goes through the shared service-role helper + profile service.
  // The response shape is unchanged: { profile: rows[0] || null }.
  if (action === 'load_profile') {
    const { uid: profileUid } = await requireUser(req);
    return res.status(200).json(await loadProfile(createServiceDb(), profileUid));
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
    await db(`applications?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
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
    const { job_id, status: avStatus } = body;
    if (!job_id || !['active','expired','unknown'].includes(avStatus)) {
      return res.status(400).json({ error: 'job_id and valid status required' });
    }
    // Upsert report (one per user per job)
    const rr = await db('job_availability_reports?on_conflict=user_id,job_id', {
      method: 'POST',
      body: JSON.stringify({ job_id: String(job_id), user_id: uid, status: avStatus, reported_at: new Date().toISOString() }),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!rr.ok) {
      const errText = await rr.text().catch(() => rr.status);
      console.error('report_job_availability insert failed:', errText);
      return res.status(500).json({ error: 'Failed to save report' });
    }
    // Increment report count on the job itself (fire-and-forget)
    db(`jobs?id=eq.${encodeURIComponent(String(job_id))}`, {
      method: 'PATCH',
      body: JSON.stringify({ availability_report_count: 1, last_checked_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  // ── GET CREDITS ──────────────────────────────────────────────────────────────
  if (action === 'get_credits') {
    const today = new Date().toISOString().split('T')[0];
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    let cred = cRes.ok ? (await cRes.json())[0] : null;
    if (!cred) {
      // No row means they haven't used AI yet — show welcome balance preview (don't create row here)
      return res.status(200).json({ balance: 10, pro: false, daily_earned: 0, max_daily_earn: 5, welcome: true });
    } else if (cred.last_reset !== today) {
      const nb = cred.pro ? 999 : 3;
      await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: nb, daily_earned: 0, last_reset: today }), headers: { Prefer: 'return=minimal' } });
      cred = { ...cred, balance: nb, daily_earned: 0, last_reset: today };
    }
    return res.status(200).json({ balance: cred.balance, pro: cred.pro, daily_earned: cred.daily_earned, max_daily_earn: 3 });
  }

  // ── CONSUME CREDIT ────────────────────────────────────────────────────────────
  if (action === 'consume_credit') {
    const today = new Date().toISOString().split('T')[0];
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    let cred = cRes.ok ? (await cRes.json())[0] : null;
    if (!cred) {
      // First use: welcome bonus 10, deduct 1 → 9
      await db('ai_credits', { method: 'POST', body: JSON.stringify({ user_id: uid, balance: 9, daily_earned: 0, last_reset: today, pro: false }), headers: { Prefer: 'return=minimal' } });
      await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: 10, reason: 'welcome_bonus' }), headers: { Prefer: 'return=minimal' } });
      await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: -1, reason: body.reason || 'ai_tool' }), headers: { Prefer: 'return=minimal' } });
      return res.status(200).json({ ok: true, balance: 9 });
    }
    if (cred.pro) return res.status(200).json({ ok: true, balance: 999, pro: true });
    if (cred.last_reset !== today) {
      // Daily reset: 3 credits, deduct 1 → 2
      await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: 2, daily_earned: 0, last_reset: today }), headers: { Prefer: 'return=minimal' } });
      await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: -1, reason: body.reason || 'ai_tool' }), headers: { Prefer: 'return=minimal' } });
      return res.status(200).json({ ok: true, balance: 2 });
    }
    if (cred.balance <= 0) return res.status(200).json({ ok: false, error: 'no_credits', balance: 0 });
    const nb = cred.balance - 1;
    await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: nb }), headers: { Prefer: 'return=minimal' } });
    await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: -1, reason: body.reason || 'ai_tool' }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, balance: nb });
  }

  // ── EARN CREDIT (track application) ──────────────────────────────────────────
  if (action === 'earn_credit') {
    const { jid } = body;
    const today = new Date().toISOString().split('T')[0];
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    const cred = cRes.ok ? (await cRes.json())[0] : null;
    if (!cred || cred.pro) return res.status(200).json({ ok: false, reason: cred?.pro ? 'pro' : 'no_row' });

    const resetToday = cred.last_reset !== today;
    const dailyEarned = resetToday ? 0 : (cred.daily_earned || 0);
    if (dailyEarned >= 5) return res.status(200).json({ ok: false, reason: 'daily_cap', balance: cred.balance });

    // Max 3 tracking earns per day (prevent spam)
    if (!resetToday) {
      const trackRes = await db(`credit_transactions?user_id=eq.${uid}&reason=eq.track_application&select=metadata&limit=20`);
      if (trackRes.ok) {
        const txns = await trackRes.json();
        // Filter to today's transactions (no created_at filter in REST, check length after assuming recent)
        if (txns.length >= 3) return res.status(200).json({ ok: false, reason: 'track_cap', balance: cred.balance });
        // Prevent double-earn for same job
        if (jid && txns.some(t => t.metadata?.jid === jid)) {
          return res.status(200).json({ ok: false, reason: 'already_earned', balance: cred.balance });
        }
      }
    }

    const baseBalance = resetToday ? 3 : cred.balance;
    const newBalance = Math.min(baseBalance + 1, 8); // cap: 3 daily + up to 5 earned = 8 max
    const newEarned = dailyEarned + 1;
    await db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: newBalance, daily_earned: newEarned, ...(resetToday ? { last_reset: today } : {}) }), headers: { Prefer: 'return=minimal' } });
    await db('credit_transactions', { method: 'POST', body: JSON.stringify({ user_id: uid, delta: 1, reason: 'track_application', metadata: { jid: jid || null } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true, balance: newBalance, earned: true });
  }

  // ── GET QUESTION (earn a credit) ──────────────────────────────────────────────
  if (action === 'get_question') {
    const today = new Date().toISOString().split('T')[0];
    // Check daily earn cap
    const cRes = await db(`ai_credits?user_id=eq.${uid}&limit=1`);
    const cred = cRes.ok ? (await cRes.json())[0] : null;
    if (cred?.pro) return res.status(200).json({ question: null, reason: 'pro_unlimited' });
    const dailyEarned = (cred?.last_reset === today ? cred?.daily_earned : 0) || 0;
    if (dailyEarned >= 5) return res.status(200).json({ question: null, reason: 'daily_cap', earned_today: dailyEarned });

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

    // Priority 3: Data verification (low-confidence companies)
    const coRes = await db(`company_scores?report_count=lt.5&ghost_rate=not.is.null&select=name,ghost_rate&order=report_count.asc&limit=10`);
    const lowCos = coRes.ok ? await coRes.json() : [];
    for (const co of lowCos) {
      const key = `verify_ghost|${co.name.toLowerCase()}`;
      if (!answered.has(key)) {
        const pct = Math.round(co.ghost_rate || 0);
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
    if (!cred) { await db('ai_credits', { method: 'POST', body: JSON.stringify({ user_id: uid, balance: 3, daily_earned: 0, last_reset: today, pro: false }), headers: { Prefer: 'return=minimal' } }); cred = { balance: 3, daily_earned: 0, last_reset: today, pro: false }; }
    const resetToday = cred.last_reset !== today;
    const dailyEarned = resetToday ? 0 : (cred.daily_earned || 0);
    if (dailyEarned >= 5 && !cred.pro) return res.status(200).json({ ok: false, error: 'daily_cap', earned_today: dailyEarned });

    // Store answer (dedup via PK)
    const aqIns = await db('answered_questions', { method: 'POST', body: JSON.stringify({ user_id: uid, question_key, answer }), headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' } });
    // If duplicate (already answered), don't grant credit
    if (aqIns.status === 409) return res.status(200).json({ ok: false, error: 'already_answered' });

    // Grant +1 credit
    const newBalance = resetToday ? 3 + 1 : (cred.pro ? 999 : Math.min((cred.balance || 0) + 1, 999));
    const newEarned = resetToday ? 1 : dailyEarned + 1;
    const patch = cred.pro ? {} : { balance: newBalance, daily_earned: newEarned };
    if (resetToday && !cred.pro) { patch.last_reset = today; patch.daily_earned = 1; patch.balance = 4; }
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

    return res.status(200).json({ ok: true, balance: cred.pro ? 999 : (resetToday ? 4 : newBalance), earned_today: newEarned });
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
      const nb = cred.pro ? 999 : 3;
      db(`ai_credits?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify({ balance: nb, daily_earned: 0, last_reset: today }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
      cred = { ...cred, balance: nb, daily_earned: 0, last_reset: today };
    }
    const transactions = txRes.ok ? await txRes.json() : [];
    return res.status(200).json({
      balance: cred?.balance ?? 3,
      pro: cred?.pro ?? false,
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
    return res.status(200).json(await getEmployment(db, uid));
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
    return res.status(200).json(await getRecentCompanies(db, uid));
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
    const creditsLeft = Math.max(0, 5 - dailyEarned);

    return res.status(200).json({
      ok: true,
      questions: allQ.slice(0, 5),
      credits_left: creditsLeft,
      balance: cred?.balance ?? 3,
    });
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
}

