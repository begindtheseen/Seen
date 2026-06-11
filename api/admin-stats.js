// Internal Admin API — username/password auth + all platform operations.
// ALL endpoints except admin_login require X-Admin-Token session header.
// Passwords hashed with scrypt (Node built-in). No plaintext credentials stored.

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const ALLOWED = ['https://seenjobs.io', 'https://www.seenjobs.io'];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = !o || o.includes('localhost') || o.includes('127.0.0.1') || ALLOWED.includes(o);
  res.setHeader('Access-Control-Allow-Origin', ok ? (o || '*') : ALLOWED[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}

function hashPw(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}
function verifyPw(password, salt, hash) {
  try {
    const derived = scryptSync(password, salt, 64).toString('hex');
    return timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SB = process.env.SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !SK) return res.status(500).json({ error: 'Not configured' });

  const db = (path, opts = {}) => fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SK, Authorization: `Bearer ${SK}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // ── ADMIN LOGIN (unauthenticated) ────────────────────────────────────────────
  if (req.method === 'POST' && body.action === 'admin_login') {
    const { username, password } = body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';

    // Bootstrap: if no admin accounts exist, create one from env vars
    const listRes = await db('admin_accounts?select=id&limit=1');
    const list = listRes.ok ? await listRes.json() : [];
    if (!list.length) {
      const EU = process.env.ADMIN_USERNAME, EP = process.env.ADMIN_PASSWORD;
      if (!EU || !EP) return res.status(503).json({ error: 'No admin accounts. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars.' });
      if (username !== EU || password !== EP) return res.status(401).json({ error: 'Invalid credentials' });
      const salt = randomBytes(16).toString('hex');
      await db('admin_accounts', {
        method: 'POST',
        body: JSON.stringify({ username: EU, password_hash: hashPw(EP, salt), salt, role: 'super_admin' }),
        headers: { Prefer: 'return=minimal' },
      });
    }

    const acctRes = await db(`admin_accounts?username=eq.${encodeURIComponent(username)}&limit=1`);
    const acct = acctRes.ok ? (await acctRes.json())[0] : null;
    if (!acct) return res.status(401).json({ error: 'Invalid credentials' });
    if (!acct.is_active) return res.status(401).json({ error: 'Account disabled' });
    if (acct.locked_until && new Date(acct.locked_until) > new Date()) return res.status(429).json({ error: 'Too many failed attempts — try again in 15 minutes' });

    if (!verifyPw(password, acct.salt, acct.password_hash)) {
      const attempts = (acct.login_attempts || 0) + 1;
      const patch = { login_attempts: attempts };
      if (attempts >= 5) patch.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await db(`admin_accounts?id=eq.${acct.id}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = randomBytes(32).toString('hex');
    await db('admin_sessions', {
      method: 'POST',
      body: JSON.stringify({ token, admin_id: acct.id, role: acct.role, expires_at: new Date(Date.now() + 8 * 3600000).toISOString(), ip_address: ip }),
      headers: { Prefer: 'return=minimal' },
    });
    await db(`admin_accounts?id=eq.${acct.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ login_attempts: 0, locked_until: null, last_login: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: acct.id, username: acct.username, action: 'login', metadata: { ip } }), headers: { Prefer: 'return=minimal' } });

    return res.status(200).json({ token, role: acct.role, username: acct.username });
  }

  // ── VERIFY SESSION (all other requests) ──────────────────────────────────────
  const adminToken = (req.headers['x-admin-token'] || body.admin_token || '').trim();
  if (!adminToken) return res.status(401).json({ error: 'Admin token required' });

  const sessRes = await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}&limit=1`);
  const sess = sessRes.ok ? (await sessRes.json())[0] : null;
  if (!sess || new Date(sess.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired — log in again' });
  const adminRole = sess.role;

  // ── GET: dashboard stats ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const now = new Date();
    const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekISO  = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();

    const ct = r => parseInt((r?.headers?.get('content-range') || '').split('/')[1]) || 0;

    const [
      usersAuthRes,
      usersTodayRes, usersWeekRes,
      reportsAllRes, reportsTodayRes, reportsWeekRes,
      appsAllRes, appsGhostedRes, appsHiredRes,
      coScoredRes, issuesRes, creditListRes,
      searchLogRes, errLogRes,
    ] = await Promise.all([
      fetch(`${SB}/auth/v1/admin/users?per_page=1`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } }),
      db(`profiles?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`profiles?created_at=gte.${weekISO}&select=id`,  { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`reports?select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`reports?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`reports?created_at=gte.${weekISO}&select=id`,  { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`applications?select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`applications?status=eq.ghosted&updated_at=gte.${monthISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`applications?status=eq.hired&updated_at=gte.${monthISO}&select=id`,   { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`company_scores?select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`user_issues?status=eq.open&order=created_at.desc&limit=20`),
      db(`ai_credits?select=balance,pro&limit=2000`),
      db(`search_logs?select=id&limit=1`),
      db(`api_errors?select=id&limit=1`),
    ]);

    const usersTotal = usersAuthRes.ok ? (await usersAuthRes.json())?.total || 0 : 0;
    const issues = issuesRes.ok ? await issuesRes.json() : [];
    const creditRows = creditListRes.ok ? await creditListRes.json() : [];
    const proCount = creditRows.filter(r => r.pro).length;
    const ghosted = ct(appsGhostedRes);
    const totalApps = ct(appsAllRes);

    return res.status(200).json({
      users: { total: usersTotal, new_today: ct(usersTodayRes), new_this_week: ct(usersWeekRes) },
      reports: { total: ct(reportsAllRes), today: ct(reportsTodayRes), this_week: ct(reportsWeekRes) },
      applications: { total: totalApps, ghosted_30d: ghosted, hired_30d: ct(appsHiredRes), ghost_rate_pct: totalApps > 0 ? Math.round(ghosted / totalApps * 100) : null },
      companies: { with_scores: ct(coScoredRes) },
      credits: { total_users: creditRows.length, pro_users: proCount },
      company_lookups: { ready: searchLogRes.ok },
      errors: { ready: errLogRes.ok },
      issues: { ready: issuesRes.ok, open: issues.length, items: issues },
    });
  }

  // ── POST: admin actions ──────────────────────────────────────────────────────
  const { action } = body;

  if (action === 'admin_logout') {
    await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'find_duplicates') {
    const r = await db('company_scores?select=id,name,report_count,overall_score&order=report_count.desc&limit=500');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const rows = await r.json();
    const norm = n => n ? n.toLowerCase().trim().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
    const groups = {};
    rows.forEach(r => { const k = norm(r.name); (groups[k] = groups[k] || []).push(r); });
    return res.status(200).json({ duplicates: Object.values(groups).filter(g => g.length > 1) });
  }

  if (action === 'merge') {
    const { primary_id, secondary_id } = body;
    if (!primary_id || !secondary_id) return res.status(400).json({ error: 'primary_id and secondary_id required' });
    const [pArr, sArr] = await Promise.all([
      db(`company_scores?id=eq.${primary_id}&limit=1`).then(r => r.json()),
      db(`company_scores?id=eq.${secondary_id}&limit=1`).then(r => r.json()),
    ]);
    const p = pArr[0]; const s = sArr[0];
    if (!p || !s) return res.status(404).json({ error: 'Company not found' });
    const pC = p.report_count || 1, sC = s.report_count || 1, total = pC + sC;
    const wa = (a, b) => Math.round(((a || 50) * pC + (b || 50) * sC) / total);
    await db(`company_scores?id=eq.${primary_id}`, { method: 'PATCH', body: JSON.stringify({ report_count: total, overall_score: wa(p.overall_score, s.overall_score), ghost_rate: wa(p.ghost_rate, s.ghost_rate), response_rate: wa(p.response_rate, s.response_rate), aliases: [...(p.aliases||[]), s.name, ...(s.aliases||[])].filter((v,i,a)=>v&&a.indexOf(v)===i) }), headers: { Prefer: 'return=minimal' } });
    await db(`reports?company_name=eq.${encodeURIComponent(s.name)}`, { method: 'PATCH', body: JSON.stringify({ company_name: p.name }), headers: { Prefer: 'return=minimal' } });
    await db(`company_aliases?on_conflict=alias`, { method: 'POST', body: JSON.stringify({ canonical: p.name, alias: s.name.toLowerCase() }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    await db(`company_scores?id=eq.${secondary_id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'merge_companies', target_type: 'company', target_id: String(primary_id), metadata: { secondary_id } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'auto_merge') {
    const r = await db('company_scores?select=id,name,report_count,overall_score,ghost_rate,response_rate&order=report_count.desc&limit=500');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const rows = await r.json();
    const norm = n => n ? n.toLowerCase().trim().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
    const groups = {};
    rows.forEach(row => { const k = norm(row.name); (groups[k] = groups[k] || []).push(row); });
    let merged = 0;
    for (const group of Object.values(groups).filter(g => g.length > 1)) {
      const primary = group.reduce((b, r) => (r.report_count||0) > (b.report_count||0) ? r : b);
      for (const sec of group.filter(r => r.id !== primary.id)) {
        const pC = primary.report_count||1, sC = sec.report_count||1, total = pC+sC;
        const wa = (a,b) => Math.round(((a||50)*pC + (b||50)*sC)/total);
        await db(`company_scores?id=eq.${primary.id}`, { method: 'PATCH', body: JSON.stringify({ report_count: total, overall_score: wa(primary.overall_score,sec.overall_score), ghost_rate: wa(primary.ghost_rate,sec.ghost_rate) }), headers: { Prefer: 'return=minimal' } });
        await db(`company_scores?id=eq.${sec.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        merged++;
      }
    }
    return res.status(200).json({ ok: true, merged });
  }

  if (action === 'resolve_issue' || action === 'dismiss_issue') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db(`user_issues?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: action === 'resolve_issue' ? 'resolved' : 'dismissed', resolved_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action, target_type: 'issue', target_id: String(id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'set_pro') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { user_id, pro } = body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    await db(`ai_credits?on_conflict=user_id`, { method: 'POST', body: JSON.stringify({ user_id, pro: !!pro, balance: pro ? 999 : 3, daily_earned: 0, last_reset: new Date().toISOString().split('T')[0] }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'set_pro', target_type: 'user', target_id: user_id, metadata: { pro } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
