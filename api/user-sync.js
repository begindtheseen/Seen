// Proxy all user data reads/writes through the service key so RLS never blocks them.
// The client sends its Supabase access token; we validate it here, then use the
// service key to talk to the DB. No RLS policies required on the client side.

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

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
  const { id: uid } = await userRes.json();
  if (!uid) return res.status(401).json({ error: 'Could not identify user' });

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

  // ── LOAD — return all applications + saved jobs for this user ───────────────
  if (action === 'load') {
    const appsLimit = Math.min(500, Math.max(1, parseInt(body.apps_limit) || 200));
    const appsOffset = Math.max(0, parseInt(body.apps_offset) || 0);
    const [appsRes, savedRes] = await Promise.all([
      db(`applications?user_id=eq.${uid}&order=created_at.desc&limit=${appsLimit}&offset=${appsOffset}`, { headers: { Prefer: 'count=estimated' } }),
      db(`saved_jobs?user_id=eq.${uid}&order=saved_at.desc&limit=500`),
    ]);
    const apps  = appsRes.ok  ? await appsRes.json()  : [];
    const saved = savedRes.ok ? await savedRes.json() : [];
    const appsTotal = parseInt((appsRes.headers?.get('content-range') || '').split('/')[1]) || apps.length;
    return res.status(200).json({ applications: apps, saved_jobs: saved, apps_total: appsTotal, apps_offset: appsOffset });
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
    if (Object.keys(allowed).length) {
      await db(`applications?id=eq.${encodeURIComponent(id)}&user_id=eq.${uid}`, {
        method: 'PATCH', body: JSON.stringify({ ...allowed, updated_at: new Date().toISOString() }),
        headers: { Prefer: 'return=minimal' },
      });
    }
    return res.status(200).json({ ok: true });
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
      const err = await delRes.text();
      return res.status(500).json({ error: `Auth delete failed: ${err.slice(0, 100)}` });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action: ' + action });
}
