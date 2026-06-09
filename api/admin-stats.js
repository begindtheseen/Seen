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
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${token}`,
      },
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
  // Approximation: jobs with expires_at > (now + 6d 20h) were added in last ~4 hours
  // jobs with expires_at > (now + 6d 0h) were added in last ~24 hours
  // Full 7-day window = any active job (could have been added anytime in last 7 days)
  const fresh24h = new Date(Date.now() + 6 * 86400000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();

  // Returns the count from Content-Range header, or 0 on any error
  const safeCount = async (url) => {
    try {
      const r = await fetch(url, { headers: { ...svc, Prefer: 'count=exact', Range: '0-0' } });
      if (!r.ok) return 0;
      return parseInt(r.headers?.get('Content-Range')?.split('/')?.[1] ?? '0') || 0;
    } catch { return 0; }
  };

  const safeJson = async (url) => {
    try {
      const r = await fetch(url, { headers: svc });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  };

  // Probe whether search_logs table exists — a 404/400 from Supabase means the table
  // is missing; a 200 (even with 0 rows) means it exists and logging is active.
  const searchLogsReady = await (async () => {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/search_logs?limit=0&select=id`, { headers: svc });
      return r.ok; // 200 = table exists, 4xx = does not exist
    } catch { return false; }
  })();

  const [
    totalJobs,
    freshJobs,
    queryRows,
    searchLogsToday,
    searchLogsWeek,
    locationRows,
  ] = await Promise.all([
    safeCount(`${SUPABASE_URL}/rest/v1/jobs?expires_at=gt.${now}&select=id`),
    safeCount(`${SUPABASE_URL}/rest/v1/jobs?expires_at=gt.${fresh24h}&select=id`),
    safeJson(`${SUPABASE_URL}/rest/v1/jobs?expires_at=gt.${now}&select=search_query&limit=5000`),
    searchLogsReady
      ? safeCount(`${SUPABASE_URL}/rest/v1/search_logs?created_at=gt.${oneDayAgo}&select=id`)
      : Promise.resolve(0),
    searchLogsReady
      ? safeJson(`${SUPABASE_URL}/rest/v1/search_logs?created_at=gt.${sevenDaysAgo}&select=created_at,query,location&limit=10000`)
      : Promise.resolve([]),
    safeJson(`${SUPABASE_URL}/rest/v1/jobs?expires_at=gt.${now}&select=location&limit=5000`),
  ]);

  // Top search queries from job tags
  const qCounts = {};
  for (const r of (queryRows || [])) {
    const q = (r.search_query || '').trim().toLowerCase();
    if (q) qCounts[q] = (qCounts[q] || 0) + 1;
  }
  const topQueries = Object.entries(qCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([query, count]) => ({ query, count }));

  // Top locations
  const lCounts = {};
  for (const r of (locationRows || [])) {
    const loc = (r.location || 'Unknown').split(',')[0].trim() || 'Unknown';
    lCounts[loc] = (lCounts[loc] || 0) + 1;
  }
  const topLocations = Object.entries(lCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([location, count]) => ({ location, count }));

  // Search volume by day (from search_logs if table exists)
  const searchByDay = {};
  const searchTopQ = {};
  for (const r of (searchLogsWeek || [])) {
    const day = (r.created_at || '').slice(0, 10);
    if (day) searchByDay[day] = (searchByDay[day] || 0) + 1;
    const q = (r.query || '').trim().toLowerCase();
    if (q) searchTopQ[q] = (searchTopQ[q] || 0) + 1;
  }
  const searchChart = Object.entries(searchByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
  const searchTopQueries = Object.entries(searchTopQ)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  return res.status(200).json({
    ok: true,
    jobs: {
      total: totalJobs,
      added_last_24h_approx: freshJobs,
    },
    search_logs_ready: searchLogsReady,
    searches: {
      today: searchLogsReady ? searchLogsToday : null,
      week_total: searchLogsReady ? (searchLogsWeek || []).length : null,
      chart: searchLogsReady && searchChart.length ? searchChart : null,
      top_queries: searchLogsReady && searchTopQueries.length ? searchTopQueries : null,
    },
    top_job_queries: topQueries,
    top_locations: topLocations,
    generated_at: new Date().toISOString(),
  });
}
