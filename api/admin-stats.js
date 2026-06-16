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
  try { return await _handler(req, res); }
  catch(e) {
    // SECURITY: Do not expose internal error details to clients.
    // Log the full error server-side but return only a generic message.
    console.error('[admin-stats] Unhandled error:', e?.message || e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function _handler(req, res) {

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

    // IP rate limit: 5 attempts per 15 minutes per IP
    const rlWindow = Math.floor(Date.now() / (15 * 60000));
    const rlKey = `${ip}:admin_login:${rlWindow}`;
    try {
      const rlRes = await fetch(`${SB}/rest/v1/rpc/increment_rate_limit`, {
        method: 'POST',
        headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: rlKey, p_ttl_seconds: 900 }),
      });
      if (rlRes.ok) {
        const count = await rlRes.json();
        if (count > 5) return res.status(429).json({ error: 'Too many login attempts — try again in 15 minutes' });
      }
    } catch(_) { /* fail open */ }

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
      usersTotalRes, usersTodayRes, usersWeekRes,
      reportsAllRes, reportsTodayRes, reportsWeekRes,
      appsAllRes, appsGhostedRes, appsHiredRes,
      coScoredRes, issuesRes, creditListRes,
      errTodayRes, errWeekRes,
      dauRes, dupClustersRes, flagsRes,
      staleJobsRes, zeroSearchesRes, jobReportsRes, searchLogsTodayRes,
      recentReportsRes, recentAppsRes, jobsTodayRes, inactiveReportsRes,
      jobsActiveRes, jobsNewTodayRes,
      reportsMonthRes, searchLogsWeekRes,
      jobsTotalRes,
    ] = await Promise.all([
      db(`profiles?select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
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
      db(`api_errors?created_at=gte.${todayISO}&select=endpoint,error_msg,created_at&order=created_at.desc&limit=50`),
      db(`api_errors?created_at=gte.${weekISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`login_signals?created_at=gte.${todayISO}&select=user_id`),
      db(`duplicate_clusters?status=eq.suspected&order=risk_score.desc&limit=10`),
      db(`feature_flags?select=flag_name,status,percentage,description,updated_by,updated_at&order=flag_name.asc`),
      db(`jobs?availability_status=in.(stale,expired)&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`search_events?result_count=eq.0&created_at=gte.${weekISO}&select=query&order=created_at.desc&limit=20`),
      db(`job_availability_reports?reported_at=gte.${weekISO}&select=job_id,status&limit=200`),
      db(`search_logs?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`reports?select=id,company_name,outcome,role,city,platform,created_at,report_text,outcome_weight,trust_reason,needs_review&order=created_at.desc&limit=25`),
      db(`applications?select=id,company_name,role,city,status,stage,platform,created_at&order=created_at.desc&limit=25`),
      db(`jobs?created_at=gte.${todayISO}&select=id`, { headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' } }),
      db(`job_availability_reports?status=eq.expired&select=id,job_id,reported_at&order=reported_at.desc&limit=50`),
      db(`jobs?select=count&availability_status=eq.active`),
      db(`jobs?select=count&created_at=gte.${encodeURIComponent(todayISO)}`),
      db(`reports?created_at=gte.${monthISO}&select=created_at,company_name,outcome&order=created_at.asc&limit=2000`),
      db(`search_logs?created_at=gte.${weekISO}&select=query&limit=500`),
      db(`jobs?select=count`),
    ]);

    const usersTotal = ct(usersTotalRes);
    const issues = issuesRes.ok ? await issuesRes.json() : [];
    const jobsActiveData  = jobsActiveRes.ok   ? await jobsActiveRes.json()   : [];
    const jobsNewTodayData = jobsNewTodayRes.ok ? await jobsNewTodayRes.json() : [];
    const jobsTotalData   = jobsTotalRes.ok    ? await jobsTotalRes.json()    : [];
    const jobsActive  = parseInt(jobsActiveData[0]?.count)   || 0;
    const jobsNewToday = parseInt(jobsNewTodayData[0]?.count) || 0;
    const jobsTotal   = parseInt(jobsTotalData[0]?.count)    || 0;
    const creditRows = creditListRes.ok ? await creditListRes.json() : [];
    const proCount = creditRows.filter(r => r.pro).length;
    const ghosted = ct(appsGhostedRes);
    const totalApps = ct(appsAllRes);
    const errToday = errTodayRes.ok ? await errTodayRes.json() : [];
    const dupClusters = dupClustersRes.ok ? await dupClustersRes.json() : [];
    const flags = flagsRes.ok ? await flagsRes.json() : [];
    const dauRows = dauRes.ok ? await dauRes.json() : [];
    const dau = new Set(dauRows.map(r => r.user_id)).size;
    const errByRoute = {};
    errToday.forEach(e => { errByRoute[e.endpoint] = (errByRoute[e.endpoint] || 0) + 1; });
    // Job trust signals
    const zeroSearchRows = zeroSearchesRes.ok ? await zeroSearchesRes.json() : [];
    const jobReportRows = jobReportsRes.ok ? await jobReportsRes.json() : [];
    const jobReportsByStatus = { active: 0, expired: 0, unknown: 0 };
    jobReportRows.forEach(r => { jobReportsByStatus[r.status] = (jobReportsByStatus[r.status] || 0) + 1; });

    const recentReports = recentReportsRes.ok ? await recentReportsRes.json() : [];
    const recentApps    = recentAppsRes.ok    ? await recentAppsRes.json()    : [];
    const inactiveReportRows = inactiveReportsRes.ok ? await inactiveReportsRes.json() : [];

    // Chart + top companies + outcome breakdown from 30d reports
    const reportsMonth = reportsMonthRes.ok ? await reportsMonthRes.json() : [];
    // Build 30-day daily chart
    const chartDays = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      chartDays.push(d.toISOString().slice(0, 10));
    }
    const chartMap = {};
    reportsMonth.forEach(r => { const d = r.created_at?.slice(0, 10); if (d) chartMap[d] = (chartMap[d] || 0) + 1; });
    const reportsChart = chartDays.map(date => ({ date, count: chartMap[date] || 0 }));
    // Top companies
    const companyCountMap = {};
    reportsMonth.forEach(r => { if (r.company_name) companyCountMap[r.company_name] = (companyCountMap[r.company_name] || 0) + 1; });
    const topCompanies = Object.entries(companyCountMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([company, count]) => ({ company, count }));
    // Outcome breakdown
    const outcomeMap = { ghosted: 0, rejected: 0, interview: 0, offer: 0, waiting: 0 };
    reportsMonth.forEach(r => {
      const o = r.outcome;
      if (o === 'ghosted') outcomeMap.ghosted++;
      else if (o === 'rejected' || o === 'autoreject') outcomeMap.rejected++;
      else if (o === 'interview' || o === 'human') outcomeMap.interview++;
      else if (o === 'offer' || o === 'hired') outcomeMap.offer++;
      else outcomeMap.waiting++;
    });

    // Most researched companies (7d) from search_logs
    const searchLogsWeek = searchLogsWeekRes.ok ? await searchLogsWeekRes.json() : [];
    const searchCountMap = {};
    searchLogsWeek.forEach(r => { if (r.query) searchCountMap[r.query] = (searchCountMap[r.query] || 0) + 1; });
    const topSearched = Object.entries(searchCountMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([company, count]) => ({ company, count }));

    // Enrich inactive reports with job details
    let inactiveReports = [];
    if (inactiveReportRows.length) {
      const jobIds = [...new Set(inactiveReportRows.map(r => r.job_id).filter(Boolean))];
      if (jobIds.length) {
        const jobsRes = await db(`jobs?id=in.(${jobIds.map(id => encodeURIComponent(id)).join(',')})&select=id,company,title,city,url,apply_url,availability_status&limit=50`);
        const jobRows = jobsRes.ok ? await jobsRes.json() : [];
        const jobMap = Object.fromEntries((jobRows || []).map(j => [j.id, j]));
        // Group reports by job_id, count them
        const grouped = {};
        inactiveReportRows.forEach(r => {
          if (!grouped[r.job_id]) grouped[r.job_id] = { job_id: r.job_id, report_count: 0, latest_reported_at: r.reported_at };
          grouped[r.job_id].report_count++;
          if (r.reported_at > grouped[r.job_id].latest_reported_at) grouped[r.job_id].latest_reported_at = r.reported_at;
        });
        inactiveReports = Object.values(grouped)
          .sort((a, b) => b.report_count - a.report_count)
          .map(g => ({ ...g, job: jobMap[g.job_id] || null }))
          .filter(g => g.job);
      }
    }

    return res.status(200).json({
      users: { total: usersTotal, new_today: ct(usersTodayRes), new_this_week: ct(usersWeekRes), dau },
      reports: { total: ct(reportsAllRes), today: ct(reportsTodayRes), this_week: ct(reportsWeekRes), recent: recentReports, chart: reportsChart, top_companies: topCompanies, outcome_breakdown: outcomeMap },
      applications: { total: totalApps, ghosted_30d: ghosted, hired_30d: ct(appsHiredRes), ghost_rate_pct: totalApps > 0 ? Math.round(ghosted / totalApps * 100) : null, recent: recentApps },
      companies: { with_scores: ct(coScoredRes) },
      credits: { total_users: creditRows.length, pro_users: proCount },
      errors: { today: errToday.length, this_week: ct(errWeekRes), by_route: errByRoute, recent: errToday.slice(0, 5) },
      issues: { open: issues.length, items: issues },
      duplicate_clusters: { suspected: dupClusters.length, items: dupClusters },
      feature_flags: flags,
      company_lookups: searchLogsTodayRes.ok
        ? { ready: true, today: ct(searchLogsTodayRes), top: topSearched }
        : { ready: false },
      jobs: {
        total: jobsTotal,
        active: jobsActive,
        new_today: jobsNewToday,
        added_today: ct(jobsTodayRes),
        stale_or_expired: ct(staleJobsRes),
        zero_result_searches_7d: zeroSearchRows.length,
        top_zero_queries: [...new Set(zeroSearchRows.map(r => r.query))].slice(0, 10),
        availability_reports_7d: jobReportRows.length,
        reports_by_status: jobReportsByStatus,
        inactive_reports: inactiveReports,
      },
    });
  }

  // ── POST: admin actions ──────────────────────────────────────────────────────
  const { action } = body;

  if (action === 'admin_logout') {
    await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'find_duplicates') {
    const r = await db('company_scores?select=id,name:company_name,report_count,overall_score&order=report_count.desc&limit=500');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const rows = await r.json();
    const norm = n => n ? n.toLowerCase().trim().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
    const groups = {};
    rows.forEach(row => { const k = norm(row.name); (groups[k] = groups[k] || []).push(row); });
    const duplicates = Object.entries(groups)
      .filter(([, g]) => g.length > 1)
      .map(([key, companies]) => ({ key, companies }));
    return res.status(200).json({ ok: true, duplicates });
  }

  if (action === 'merge') {
    // Accept either {primary_id, secondary_id} (from the scan list) or
    // {primary, secondary} names (from the manual-merge text form). Names are
    // resolved to IDs server-side — restores the old production manual-merge UX.
    let { primary_id, secondary_id } = body;
    const { primary, secondary } = body;
    if ((!primary_id || !secondary_id) && primary && secondary) {
      const [pLookup, sLookup] = await Promise.all([
        db(`company_scores?company_name=ilike.${encodeURIComponent(primary)}&select=id&limit=1`).then(r => r.json()),
        db(`company_scores?company_name=ilike.${encodeURIComponent(secondary)}&select=id&limit=1`).then(r => r.json()),
      ]);
      if (!pLookup[0]) return res.status(404).json({ error: `Company not found: ${primary}` });
      if (!sLookup[0]) return res.status(404).json({ error: `Company not found: ${secondary}` });
      primary_id = pLookup[0].id;
      secondary_id = sLookup[0].id;
    }
    if (!primary_id || !secondary_id) return res.status(400).json({ error: 'primary_id and secondary_id (or primary/secondary names) required' });
    if (String(primary_id) === String(secondary_id)) return res.status(400).json({ error: 'Cannot merge a company with itself' });
    const [pArr, sArr] = await Promise.all([
      db(`company_scores?id=eq.${primary_id}&select=id,name:company_name,report_count,overall_score,ghost_rate,response_rate,aliases&limit=1`).then(r => r.json()),
      db(`company_scores?id=eq.${secondary_id}&select=id,name:company_name,report_count,overall_score,ghost_rate,response_rate,aliases&limit=1`).then(r => r.json()),
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
    return res.status(200).json({ ok: true, merged_report_count: total });
  }

  if (action === 'auto_merge') {
    const r = await db('company_scores?select=id,name:company_name,report_count,overall_score,ghost_rate,response_rate&order=report_count.desc&limit=500');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const rows = await r.json();
    const norm = n => n ? n.toLowerCase().trim().replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '').trim() : '';
    const groups = {};
    rows.forEach(row => { const k = norm(row.name); (groups[k] = groups[k] || []).push(row); });
    let merged = 0;
    const groupSummaries = [];
    for (const group of Object.values(groups).filter(g => g.length > 1)) {
      const primary = group.reduce((b, r) => (r.report_count||0) > (b.report_count||0) ? r : b);
      const absorbed = [];
      for (const sec of group.filter(r => r.id !== primary.id)) {
        const pC = primary.report_count||1, sC = sec.report_count||1, total = pC+sC;
        const wa = (a,b) => Math.round(((a||50)*pC + (b||50)*sC)/total);
        await db(`company_scores?id=eq.${primary.id}`, { method: 'PATCH', body: JSON.stringify({ report_count: total, overall_score: wa(primary.overall_score,sec.overall_score), ghost_rate: wa(primary.ghost_rate,sec.ghost_rate) }), headers: { Prefer: 'return=minimal' } });
        await db(`company_scores?id=eq.${sec.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        absorbed.push(sec.name);
        merged++;
      }
      if (absorbed.length) groupSummaries.push({ canonical: primary.name, absorbed });
    }
    return res.status(200).json({ ok: true, merged, groups: groupSummaries });
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
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: sess.username || 'admin', action: 'set_pro', target_type: 'user', target_id: user_id, metadata: { pro } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── FEATURE FLAG MANAGEMENT ───────────────────────────────────────────────────
  if (action === 'set_flag') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { flag_name, status, percentage } = body;
    const VALID_STATUSES = ['off','admin_only','beta_users','percentage_rollout','fully_on'];
    if (!flag_name || !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'flag_name and valid status required' });
    const acctRes = await db(`admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=admin_id&limit=1`);
    const acctRows = acctRes.ok ? await acctRes.json() : [];
    const adminIdForFlag = acctRows[0]?.admin_id || 'unknown';
    // UPSERT — creates the row if it doesn't exist yet, updates otherwise
    await db(`feature_flags?on_conflict=flag_name`, {
      method: 'POST',
      body: JSON.stringify({ flag_name, status, percentage: status === 'percentage_rollout' ? (parseInt(percentage) || 0) : 0, updated_by: adminIdForFlag, updated_at: new Date().toISOString() }),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'set_flag', target_type: 'feature_flag', target_id: flag_name, metadata: { status, percentage } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── SEED DEFAULT FLAGS ────────────────────────────────────────────────────────
  if (action === 'seed_flags') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const defaultFlags = [
      { flag_name: 'ai_credit_system_enabled', status: 'fully_on', percentage: 0, description: 'Enables the daily AI credit system. When off, all users get unlimited AI.' },
      { flag_name: 'reddit_import_enabled',    status: 'off',      percentage: 0, description: 'Enables automatic Reddit report import via cron.' },
      { flag_name: 'job_refresh_enabled',      status: 'fully_on', percentage: 0, description: 'Enables the Adzuna job refresh cron job.' },
    ];
    let created = 0;
    for (const f of defaultFlags) {
      const r = await db(`feature_flags?on_conflict=flag_name`, {
        method: 'POST',
        body: JSON.stringify({ ...f, updated_at: new Date().toISOString() }),
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      });
      if (r.ok && r.status !== 409) created++;
    }
    return res.status(200).json({ ok: true, created, total: defaultFlags.length });
  }

  // ── GET RECENT JOBS ───────────────────────────────────────────────────────────
  if (action === 'get_recent_jobs') {
    const { period } = body;
    const now = new Date();
    const todayISO2  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekISO2   = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthISO2  = new Date(Date.now() - 30 * 86400000).toISOString();
    const cutoff = period === 'today' ? todayISO2 : period === 'month' ? monthISO2 : weekISO2;
    const r = await db(`jobs?created_at=gte.${encodeURIComponent(cutoff)}&select=id,company,title,city,apply_url,created_at,availability_status,source&order=created_at.desc&limit=200`);
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.error('[get_recent_jobs] DB error', r.status, errBody);
      return res.status(500).json({ error: 'Query failed', detail: errBody.slice(0, 200) });
    }
    const jobs = await r.json();
    return res.status(200).json({ ok: true, jobs: Array.isArray(jobs) ? jobs : [], total: Array.isArray(jobs) ? jobs.length : 0, period });
  }

  // ── DUPLICATE CLUSTER MANAGEMENT ──────────────────────────────────────────────
  if (action === 'update_cluster') {
    const { cluster_id, status: clusterStatus, admin_note } = body;
    const VALID = ['suspected','safe','watching','limited','frozen','suspended'];
    if (!cluster_id || !VALID.includes(clusterStatus)) return res.status(400).json({ error: 'cluster_id and valid status required' });
    await db(`duplicate_clusters?id=eq.${encodeURIComponent(cluster_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: clusterStatus, admin_note: admin_note || null, updated_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'update_cluster', target_type: 'duplicate_cluster', target_id: String(cluster_id), metadata: { status: clusterStatus } }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'remove_listing') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const { job_id } = body;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    await db(`jobs?id=eq.${encodeURIComponent(job_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ availability_status: 'removed' }),
      headers: { Prefer: 'return=minimal' },
    });
    // Mark all expired reports for this job as resolved
    await db(`job_availability_reports?job_id=eq.${encodeURIComponent(job_id)}&status=eq.expired`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'confirmed_expired' }),
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'remove_listing', target_type: 'job', target_id: String(job_id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  // ── JOB DEDUPLICATION ────────────────────────────────────────────────────────
  if (action === 'scan_job_dupes') {
    // Adzuna uses different tracking params per search query, so apply_url varies
    // for the same job matched by multiple searches. Use (title, company, city) instead.
    const r = await db('jobs?select=id,title,company,city&limit=100000');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const jobs = await r.json();
    const seen = new Map();
    for (const j of (jobs || [])) {
      const key = `${(j.title || '').toLowerCase().trim()}|${(j.company || '').toLowerCase().trim()}|${(j.city || '').toLowerCase().trim()}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    let suspected = 0;
    for (const count of seen.values()) if (count > 1) suspected += count - 1;
    return res.status(200).json({ ok: true, suspected, total: (jobs || []).length });
  }

  if (action === 'dedupe_jobs') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    const r = await db('jobs?select=id,title,company,city,last_seen_at,created_at&limit=100000');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const jobs = await r.json();
    // Group by (title, company, city) case-insensitive
    const byKey = new Map();
    for (const j of (jobs || [])) {
      const key = `${(j.title || '').toLowerCase().trim()}|${(j.company || '').toLowerCase().trim()}|${(j.city || '').toLowerCase().trim()}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(j);
    }
    const toDelete = [];
    for (const group of byKey.values()) {
      if (group.length <= 1) continue;
      // Keep newest by last_seen_at, then created_at
      group.sort((a, b) => ((b.last_seen_at || b.created_at || '') > (a.last_seen_at || a.created_at || '') ? 1 : -1));
      toDelete.push(...group.slice(1).map(j => j.id));
    }
    if (!toDelete.length) return res.status(200).json({ ok: true, deleted: 0 });
    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += 100) {
      const batch = toDelete.slice(i, i + 100);
      // SECURITY: Encode each ID to prevent injection via crafted job IDs.
      const encodedIds = batch.map(id => encodeURIComponent(String(id))).join(',');
      const dr = await db(`jobs?id=in.(${encodedIds})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (dr.ok) deleted += batch.length;
    }
    return res.status(200).json({ ok: true, deleted });
  }

  if (action === 'deny_report') {
    const { job_id } = body;
    if (!job_id) return res.status(400).json({ error: 'job_id required' });
    // Mark job as confirmed active and dismiss reports
    await db(`jobs?id=eq.${encodeURIComponent(job_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ availability_status: 'active', last_checked_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    });
    await db(`job_availability_reports?job_id=eq.${encodeURIComponent(job_id)}&status=eq.expired`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'denied' }),
      headers: { Prefer: 'return=minimal' },
    });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'deny_report', target_type: 'job', target_id: String(job_id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'approve_report') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db(`reports?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ needs_review: false, outcome_weight: 1.0 }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'approve_report', target_type: 'report', target_id: String(id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'investigate_report') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db(`reports?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ needs_review: true }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'investigate_report', target_type: 'report', target_id: String(id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'deny_hiring_report') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await db(`reports?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ outcome_weight: 0, needs_review: false }), headers: { Prefer: 'return=minimal' } });
    await db('admin_audit_log', { method: 'POST', body: JSON.stringify({ admin_id: sess.admin_id, username: 'admin', action: 'deny_hiring_report', target_type: 'report', target_id: String(id) }), headers: { Prefer: 'return=minimal' } });
    return res.status(200).json({ ok: true });
  }

  if (action === 'detect_duplicates_by_signals') {
    if (adminRole === 'moderator') return res.status(403).json({ error: 'Insufficient role' });
    // Find IPs shared by 2+ distinct users in the last 30 days
    const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();
    const signalsRes = await db(`login_signals?created_at=gte.${monthISO}&select=user_id,ip_address&limit=5000`);
    if (!signalsRes.ok) return res.status(500).json({ error: 'Could not query signals' });
    const signals = await signalsRes.json();
    // Group by IP
    const ipGroups = {};
    signals.forEach(s => {
      if (!s.ip_address || s.ip_address === 'unknown') return;
      if (!ipGroups[s.ip_address]) ipGroups[s.ip_address] = new Set();
      ipGroups[s.ip_address].add(s.user_id);
    });
    // Find shared IPs with 2-10 distinct users (>10 = likely NAT/campus, skip)
    const suspects = [];
    for (const [ip, users] of Object.entries(ipGroups)) {
      if (users.size >= 2 && users.size <= 10) {
        suspects.push({ ip, user_ids: [...users], count: users.size });
      }
    }
    // Upsert clusters for new suspect groups
    let created = 0;
    for (const s of suspects.slice(0, 50)) {
      const userArray = `{${s.user_ids.map(u => `"${u}"`).join(',')}}`;
      const existing = await db(`duplicate_clusters?signals=cs.{"ip:${s.ip}"}&limit=1`);
      if (existing.ok && (await existing.json()).length > 0) continue;
      const riskScore = Math.min(100, 20 + s.count * 10);
      await db('duplicate_clusters', {
        method: 'POST',
        body: JSON.stringify({ user_ids: s.user_ids, signals: [`ip:${s.ip}`], risk_score: riskScore, status: 'suspected' }),
        headers: { Prefer: 'return=minimal' },
      });
      created++;
    }
    return res.status(200).json({ ok: true, suspects: suspects.length, clusters_created: created });
  }

  // ── get_jobs_grouped: all jobs by company for admin browser ───────────────────
  if (action === 'get_jobs_grouped') {
    const r = await db('jobs?select=id,company,availability_status&limit=10000');
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const jobs = await r.json();
    const groups = {};
    for (const j of (jobs || [])) {
      const co = j.company || 'Unknown';
      if (!groups[co]) groups[co] = { company: co, total: 0, active: 0 };
      groups[co].total++;
      if (j.availability_status === 'active') groups[co].active++;
    }
    const sorted = Object.values(groups).sort((a, b) => b.total - a.total);
    return res.status(200).json({ ok: true, groups: sorted, total_jobs: (jobs || []).length });
  }

  // ── get_company_jobs: all listings for one company ────────────────────────────
  if (action === 'get_company_jobs') {
    const { company } = body;
    if (!company) return res.status(400).json({ error: 'company required' });
    const r = await db(`jobs?company=eq.${encodeURIComponent(company)}&select=id,title,city,apply_url,source,availability_status,created_at,last_seen_at&order=created_at.desc&limit=500`);
    if (!r.ok) return res.status(500).json({ error: 'Query failed' });
    const jobs = await r.json();
    return res.status(200).json({ ok: true, jobs: jobs || [], company });
  }

  // ── get_kpi_detail: return raw rows behind a KPI card ─────────────────────
  if (body.action === 'get_kpi_detail') {
    const metric = body.metric;
    const now = new Date();
    const todayISO = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekISO  = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthISO = new Date(Date.now() - 30 * 86400000).toISOString();

    let rows = [];

    if (metric === 'total_accounts') {
      const r = await db('profiles?select=id,email,created_at&order=created_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'new_today') {
      const r = await db(`profiles?created_at=gte.${todayISO}&select=id,email,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'new_this_week') {
      const r = await db(`profiles?created_at=gte.${weekISO}&select=id,email,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'companies_scored') {
      const r = await db('company_scores?select=company_id,score,ghost_rate,response_rate,updated_at&order=score.desc&limit=100');
      const scores = await r.json();
      if (Array.isArray(scores) && scores.length > 0) {
        const ids = scores.map(s => s.company_id).filter(Boolean);
        const cr = await db(`companies?id=in.(${ids.join(',')})&select=id,name`);
        const companies = await cr.json();
        const nameMap = {};
        if (Array.isArray(companies)) companies.forEach(c => { nameMap[c.id] = c.name; });
        rows = scores.map(s => ({ ...s, company: nameMap[s.company_id] || s.company_id }));
      } else {
        rows = Array.isArray(scores) ? scores : [];
      }
    } else if (metric === 'total_reports') {
      const r = await db('reports?select=id,company_name,outcome,role,created_at&order=created_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'reports_today') {
      const r = await db(`reports?created_at=gte.${todayISO}&select=id,company_name,outcome,role,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'reports_week') {
      const r = await db(`reports?created_at=gte.${weekISO}&select=id,company_name,outcome,role,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'ghost_rate') {
      const r = await db(`applications?status=eq.ghosted&updated_at=gte.${monthISO}&select=id,company_name,role,city,stage,updated_at&order=updated_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'apps_total') {
      const r = await db('applications?select=id,company_name,role,status,stage,created_at&order=created_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'ghosted_30d') {
      const r = await db(`applications?status=eq.ghosted&updated_at=gte.${monthISO}&select=id,company_name,role,city,stage,updated_at&order=updated_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'hired_30d') {
      const r = await db(`applications?status=eq.hired&updated_at=gte.${monthISO}&select=id,company_name,role,city,updated_at&order=updated_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'co_lookups') {
      const r = await db(`search_logs?created_at=gte.${todayISO}&select=query,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'jobs_total') {
      const r = await db('jobs?select=company,title,city,availability_status,source,created_at&order=created_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'jobs_active') {
      const r = await db('jobs?availability_status=eq.active&select=company,title,city,source,last_seen_at&order=last_seen_at.desc&limit=100');
      rows = await r.json();
    } else if (metric === 'jobs_today') {
      const r = await db(`jobs?created_at=gte.${todayISO}&select=company,title,city,source,created_at&order=created_at.desc&limit=100`);
      rows = await r.json();
    } else if (metric === 'jobs_stale') {
      const r = await db('jobs?availability_status=in.(stale,expired)&select=company,title,city,availability_status,last_seen_at&order=last_seen_at.desc&limit=100');
      rows = await r.json();
    } else {
      return res.status(400).json({ error: 'Unknown metric' });
    }

    if (!Array.isArray(rows)) rows = [];
    return res.status(200).json({ ok: true, metric, rows });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
