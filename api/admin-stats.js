export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = !origin || origin.includes('localhost') || origin.includes('127.0.0.1') ||
    ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? (origin || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

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

  // Check whether search_logs table exists (probe with limit=0)
  const searchLogsReady = await (async () => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/search_logs?limit=0&select=id`, { headers: svc });
      return r.ok;
    } catch { return false; }
  })();

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
  ]);

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
  });
}
