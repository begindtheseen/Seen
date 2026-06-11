export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = !origin || origin.includes('localhost') || origin.includes('127.0.0.1') ||
    ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? (origin || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Not configured' });
  }

  // Verify JWT and check admin email
  const token = (req.headers.authorization || '').replace(/^Bearer /i, '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const user = await userRes.json();
    if (ADMIN_EMAIL && user.email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Auth failed' });
  }

  const svc = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  // ── POST: company merge / dedup actions ────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return res.status(400).json({ error: 'Bad JSON' }); }

    const dbH = { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const SFXRE = /[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i;
    const norm = n => n ? n.toLowerCase().trim().replace(SFXRE, '').trim() : '';

    if (body.action === 'find_duplicates') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/company_scores?select=company_name,report_count,overall_score&limit=2000`,
        { headers: svc }
      );
      if (!r.ok) return res.status(502).json({ error: 'DB error' });
      const scores = await r.json();
      const groups = {};
      for (const s of scores) {
        const key = norm(s.company_name);
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
      }
      const duplicates = Object.entries(groups)
        .filter(([, g]) => g.length > 1)
        .map(([key, companies]) => ({
          key,
          companies: companies.sort((a, b) => (b.report_count || 0) - (a.report_count || 0)),
        }))
        .sort((a, b) => {
          const ta = a.companies.reduce((s, c) => s + (c.report_count || 0), 0);
          const tb = b.companies.reduce((s, c) => s + (c.report_count || 0), 0);
          return tb - ta;
        });
      return res.status(200).json({ ok: true, duplicates });
    }

    if (body.action === 'merge') {
      const { primary, secondary } = body;
      if (!primary || !secondary) return res.status(400).json({ error: 'primary and secondary required' });
      if (primary === secondary) return res.status(400).json({ error: 'Cannot merge a company with itself' });

      const enc = s => encodeURIComponent(s);
      const [pRes, sRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=eq.${enc(primary)}&select=*&limit=1`, { headers: svc }),
        fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=eq.${enc(secondary)}&select=*&limit=1`, { headers: svc }),
      ]);
      const [pRows, sRows] = await Promise.all([pRes.json(), sRes.json()]);
      const pRow = pRows[0], sRow = sRows[0];
      if (!pRow) return res.status(404).json({ error: `Primary company not found: "${primary}"` });
      if (!sRow) return res.status(404).json({ error: `Secondary company not found: "${secondary}"` });

      const pC = pRow.report_count || 0;
      const sC = sRow.report_count || 0;
      const total = pC + sC;
      const wa = (a, b) => total > 0 ? ((a || 0) * (pC || 1) + (b || 0) * (sC || 1)) / (pC + sC || 1) : a || 0;

      await Promise.all([
        // Update primary with merged weighted-average stats
        fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=eq.${enc(primary)}`, {
          method: 'PATCH', headers: dbH,
          body: JSON.stringify({
            report_count: total,
            overall_score: Math.round(wa(pRow.overall_score, sRow.overall_score)),
            ghost_rate:    parseFloat(wa(pRow.ghost_rate, sRow.ghost_rate).toFixed(3)),
            response_rate: parseFloat(wa(pRow.response_rate, sRow.response_rate).toFixed(3)),
            avg_wait_days: (pRow.avg_wait_days != null || sRow.avg_wait_days != null)
              ? Math.round(wa(pRow.avg_wait_days || 0, sRow.avg_wait_days || 0)) : null,
            data_quality: Math.max(pRow.data_quality || 0, sRow.data_quality || 0),
          }),
        }),
        // Redirect all reports from secondary → primary
        fetch(`${SUPABASE_URL}/rest/v1/reports?company_name=eq.${enc(secondary)}`, {
          method: 'PATCH', headers: dbH,
          body: JSON.stringify({ company_name: primary }),
        }),
        // Register secondary as an alias of primary
        fetch(`${SUPABASE_URL}/rest/v1/company_aliases`, {
          method: 'POST',
          headers: { ...dbH, Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({ canonical: primary, alias: secondary.toLowerCase(), source: 'admin_merge' }),
        }),
      ]);

      // Delete secondary score row last
      await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=eq.${enc(secondary)}`, {
        method: 'DELETE', headers: dbH,
      });

      return res.status(200).json({ ok: true, primary, secondary, merged_report_count: total });
    }

    if (body.action === 'auto_merge') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/company_scores?select=company_name,report_count,overall_score,ghost_rate,response_rate,avg_wait_days,data_quality&limit=2000`,
        { headers: svc }
      );
      if (!r.ok) return res.status(502).json({ error: 'DB error' });
      const scores = await r.json();

      const groups = {};
      for (const s of scores) {
        const key = norm(s.company_name);
        if (!groups[key]) groups[key] = [];
        groups[key].push(s);
      }

      let mergedCount = 0;
      const mergedGroups = [];
      const enc = s => encodeURIComponent(s);
      const dbH2 = { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' };

      for (const [, group] of Object.entries(groups)) {
        if (group.length <= 1) continue;
        group.sort((a, b) => (b.report_count || 0) - (a.report_count || 0));
        const primary = group[0];
        const dupes = group.slice(1);
        const totalCount = group.reduce((s, c) => s + (c.report_count || 0), 0);

        for (const dup of dupes) {
          await fetch(`${SUPABASE_URL}/rest/v1/reports?company_name=eq.${enc(dup.company_name)}`, {
            method: 'PATCH', headers: dbH2, body: JSON.stringify({ company_name: primary.company_name }),
          });
          await fetch(`${SUPABASE_URL}/rest/v1/company_aliases`, {
            method: 'POST',
            headers: { ...dbH2, Prefer: 'resolution=ignore-duplicates,return=minimal' },
            body: JSON.stringify({ canonical: primary.company_name, alias: dup.company_name.toLowerCase(), source: 'auto_merge' }),
          });
          await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=eq.${enc(dup.company_name)}`, {
            method: 'DELETE', headers: dbH2,
          });
          mergedCount++;
        }

        if (totalCount !== (primary.report_count || 0)) {
          await fetch(`${SUPABASE_URL}/rest/v1/company_scores?company_name=eq.${enc(primary.company_name)}`, {
            method: 'PATCH', headers: dbH2, body: JSON.stringify({ report_count: totalCount }),
          });
        }

        mergedGroups.push({ canonical: primary.company_name, absorbed: dupes.map(d => d.company_name) });
      }

      return res.status(200).json({ ok: true, merged: mergedCount, groups: mergedGroups });
    }

    if (body.action === 'resolve_issue' || body.action === 'dismiss_issue') {
      const { id, resolver_note } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const newStatus = body.action === 'resolve_issue' ? 'resolved' : 'dismissed';
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/user_issues?id=eq.${parseInt(id, 10)}`,
        {
          method: 'PATCH', headers: dbH,
          body: JSON.stringify({ status: newStatus, resolved_at: new Date().toISOString(), resolver_note: resolver_note || null }),
        }
      );
      if (!r.ok) return res.status(502).json({ error: 'DB error updating issue' });
      return res.status(200).json({ ok: true, id, status: newStatus });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  const now = new Date().toISOString();
  const oneDayAgo  = new Date(Date.now() - 86400000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Count rows from a table with optional filter. Returns integer. Never throws.
  const count = async (table, filter = '') => {
    try {
      const url = `${SUPABASE_URL}/rest/v1/${table}?select=id${filter ? '&' + filter : ''}`;
      const r = await fetch(url, { headers: { ...svc, Prefer: 'count=exact', Range: '0-0' } });
      if (!r.ok) return 0;
      return parseInt(r.headers?.get('Content-Range')?.split('/')?.[1] ?? '0') || 0;
    } catch { return 0; }
  };

  // Fetch JSON rows. Returns array. Never throws.
  const rows = async (table, filter = '', select = '*', limit = 1000) => {
    try {
      const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=${limit}${filter ? '&' + filter : ''}`;
      const r = await fetch(url, { headers: svc });
      return r.ok ? (await r.json() || []) : [];
    } catch { return []; }
  };

  // Check whether optional tables exist (probe with limit=0)
  const [searchLogsReady, errorsReady, issuesReady] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/search_logs?limit=0&select=id`, { headers: svc }).then(r => r.ok).catch(() => false),
    fetch(`${SUPABASE_URL}/rest/v1/api_errors?limit=0&select=id`, { headers: svc }).then(r => r.ok).catch(() => false),
    fetch(`${SUPABASE_URL}/rest/v1/user_issues?limit=0&select=id`, { headers: svc }).then(r => r.ok).catch(() => false),
  ]);

  // Run all queries in parallel
  const [
    totalUsers,
    newUsersToday,
    newUsersWeek,

    totalReports,
    reportsToday,
    reportsWeek,
    recentReports,        // for daily chart + top companies

    totalApplications,
    recentApplications,   // for ghost rate + stage breakdown

    companiesWithScores,

    companySearchesToday, // from search_logs where source='company'
    companySearchesWeek,
    companySearchRows,    // for top searched companies

    jobSearchesToday,
    jobSearchesWeek,
    jobSearchRows,

    activeRateLimitKeys,

    errorRowsToday,
    errorRowsWeek,
  ] = await Promise.all([
    // ── Users ──────────────────────────────────────────────────────────────
    count('profiles'),
    count('profiles', `created_at=gt.${oneDayAgo}`),
    count('profiles', `created_at=gt.${sevenDaysAgo}`),

    // ── Community reports ───────────────────────────────────────────────────
    count('reports'),
    count('reports', `created_at=gt.${oneDayAgo}`),
    count('reports', `created_at=gt.${sevenDaysAgo}`),
    rows('reports', `created_at=gt.${thirtyDaysAgo}`, 'company_name,outcome,created_at', 5000),

    // ── Application tracking ────────────────────────────────────────────────
    count('applications'),
    rows('applications', `created_at=gt.${thirtyDaysAgo}`, 'company_name,stage,status,created_at', 5000),

    // ── Company data coverage ────────────────────────────────────────────────
    count('company_scores'),

    // ── Company lookups (search_logs source='company') ───────────────────────
    searchLogsReady ? count('search_logs', `source=eq.company&created_at=gt.${oneDayAgo}`) : Promise.resolve(null),
    searchLogsReady ? count('search_logs', `source=eq.company&created_at=gt.${sevenDaysAgo}`) : Promise.resolve(null),
    searchLogsReady ? rows('search_logs', `source=eq.company&created_at=gt.${sevenDaysAgo}`, 'query,created_at', 5000) : Promise.resolve([]),

    // ── Job searches (search_logs source='api') ──────────────────────────────
    searchLogsReady ? count('search_logs', `source=eq.api&created_at=gt.${oneDayAgo}`) : Promise.resolve(null),
    searchLogsReady ? count('search_logs', `source=eq.api&created_at=gt.${sevenDaysAgo}`) : Promise.resolve(null),
    searchLogsReady ? rows('search_logs', `source=eq.api&created_at=gt.${sevenDaysAgo}`, 'query,result_count,created_at', 2000) : Promise.resolve([]),

    // ── Rate limit hits ──────────────────────────────────────────────────────
    count('rate_limits', `expires_at=gt.${now}`),

    // ── API errors ───────────────────────────────────────────────────────────
    errorsReady ? rows('api_errors', `created_at=gt.${oneDayAgo}`, 'endpoint,error_msg,created_at', 500) : Promise.resolve([]),
    errorsReady ? rows('api_errors', `created_at=gt.${sevenDaysAgo}`, 'endpoint,created_at', 2000) : Promise.resolve([]),
  ]);

  // ── User issues queue ────────────────────────────────────────────────────────
  const [openIssueCount, openIssues] = issuesReady
    ? await Promise.all([
        count('user_issues', 'status=eq.open'),
        rows('user_issues', 'status=eq.open&order=created_at.desc', 'id,type,target_type,target_name,notes,created_at', 100),
      ])
    : [0, []];

  // ── Reports: daily chart (last 30 days) ─────────────────────────────────
  const reportsByDay = {};
  for (const r of recentReports) {
    const day = (r.created_at || '').slice(0, 10);
    if (day) reportsByDay[day] = (reportsByDay[day] || 0) + 1;
  }
  const reportChart = Object.entries(reportsByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, count]) => ({ date, count }));

  // ── Reports: top companies by report count ───────────────────────────────
  const reportCoCounts = {};
  for (const r of recentReports) {
    const co = (r.company_name || '').trim();
    if (co) reportCoCounts[co] = (reportCoCounts[co] || 0) + 1;
  }
  const topReportedCompanies = Object.entries(reportCoCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([company, count]) => ({ company, count }));

  // ── Reports: outcome breakdown ───────────────────────────────────────────
  const outcomes = { ghosted: 0, rejected: 0, offer: 0, interview: 0, waiting: 0 };
  for (const r of recentReports) {
    const o = (r.outcome || '').toLowerCase();
    if (o === 'ghosted' || r.ghost_stage) outcomes.ghosted++;
    else if (outcomes[o] !== undefined) outcomes[o]++;
  }

  // ── Applications: ghost rate ─────────────────────────────────────────────
  let ghostedApps = 0, hiredApps = 0;
  for (const a of recentApplications) {
    const s = (a.status || a.stage || '').toLowerCase();
    if (s.includes('ghost') || s.includes('no response')) ghostedApps++;
    if (s.includes('hired') || s.includes('offer') || s.includes('accepted')) hiredApps++;
  }
  const ghostRate = recentApplications.length > 0
    ? Math.round((ghostedApps / recentApplications.length) * 100)
    : null;

  // ── Company searches: top companies being researched ─────────────────────
  const coSearchCounts = {};
  for (const r of companySearchRows) {
    const q = (r.query || '').trim();
    if (q) coSearchCounts[q] = (coSearchCounts[q] || 0) + 1;
  }
  const topSearchedCompanies = Object.entries(coSearchCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([company, count]) => ({ company, count }));

  // ── Job searches: top queries, zero-result searches ──────────────────────
  const jobQueryCounts = {};
  let zeroResultSearches = 0;
  for (const r of jobSearchRows) {
    const q = (r.query || '').trim();
    if (!q) continue;
    jobQueryCounts[q] = (jobQueryCounts[q] || 0) + 1;
    if ((r.result_count || 0) === 0) zeroResultSearches++;
  }
  const topJobQueries = Object.entries(jobQueryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([query, count]) => ({ query, count }));

  return res.status(200).json({
    ok: true,
    generated_at: now,

    users: {
      total: totalUsers,
      new_today: newUsersToday,
      new_this_week: newUsersWeek,
    },

    reports: {
      total: totalReports,
      today: reportsToday,
      this_week: reportsWeek,
      chart: reportChart.length ? reportChart : null,
      top_companies: topReportedCompanies,
      outcome_breakdown: outcomes,
    },

    applications: {
      total: totalApplications,
      ghost_rate_pct: ghostRate,
      ghosted_30d: ghostedApps,
      hired_30d: hiredApps,
    },

    companies: {
      with_scores: companiesWithScores,
    },

    company_lookups: {
      ready: searchLogsReady,
      today: companySearchesToday,
      this_week: companySearchesWeek,
      top: topSearchedCompanies.length ? topSearchedCompanies : null,
    },

    job_searches: {
      ready: searchLogsReady,
      today: jobSearchesToday,
      this_week: jobSearchesWeek,
      zero_result_7d: zeroResultSearches,
      top_queries: topJobQueries.length ? topJobQueries : null,
    },

    rate_limits: {
      active_keys: activeRateLimitKeys,
    },

    api_errors: (() => {
      if (!errorsReady) return { ready: false };
      const byEndpoint = {};
      for (const e of errorRowsWeek) {
        byEndpoint[e.endpoint] = (byEndpoint[e.endpoint] || 0) + 1;
      }
      return {
        ready: true,
        today: errorRowsToday.length,
        this_week: errorRowsWeek.length,
        by_endpoint: Object.entries(byEndpoint).sort((a,b)=>b[1]-a[1]).map(([endpoint,count])=>({endpoint,count})),
        recent: errorRowsToday.slice(0, 20).map(e => ({ endpoint: e.endpoint, msg: e.error_msg, at: e.created_at })),
      };
    })(),

    issues: {
      ready: issuesReady,
      open: openIssueCount,
      items: openIssues,
    },
  });
}
