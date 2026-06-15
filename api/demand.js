import { rateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';

// /api/demand — Demand data hub.
//
// GET  /api/demand  — Public read. Returns demand_data grouped by city.
//                     Cache-Control: public, max-age=21600, stale-while-revalidate=86400
//
// POST /api/demand  — Auth required (CRON_SECRET or admin JWT).
//                     Fetches BLS JOLTS + CES, computes DI, upserts demand_data.
//                     Triggered by monthly Vercel cron (0 4 1 * *).
//
// DI formula: round(40 × opening_rate_norm + 35 × growth_norm + 25 × dtf_norm)
//   opening_rate_norm = min(1, jolts / ces / 0.10) × 100
//   growth_norm       = min(1, bls_10yr_growth_pct / 36) × 100
//   dtf_norm          = min(1, avg_days_to_fill / 90) × 100

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = !origin || origin.includes('localhost') || origin.includes('127.0.0.1') ||
    ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? (origin || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { allowed: rlOk } = await rateLimit(req, 'demand');
  if (!rlOk) return res.status(429).json({ error: 'Too many requests — slow down.' });

  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).end();
}

// ── GET: public read ──────────────────────────────────────────────────────────

async function handleGet(req, res) {
  // Cache for 6 hours — data refreshes monthly but this keeps reads fast
  res.setHeader('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return res.status(200).json({ ok: true, demand: [], generated_at: new Date().toISOString() });
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/demand_data?select=*&order=city.asc,di.desc&limit=500`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });

    if (!r.ok) {
      return res.status(200).json({ ok: true, demand: [], generated_at: new Date().toISOString() });
    }

    const rawRows = await r.json();
    if (!Array.isArray(rawRows) || !rawRows.length) {
      return res.status(200).json({ ok: true, demand: [], generated_at: new Date().toISOString() });
    }

    const cityMap = new Map();
    let latestUpdatedAt = null;
    let blsPeriod = null;

    for (const row of rawRows) {
      if (!cityMap.has(row.city)) {
        cityMap.set(row.city, { city: row.city, urg: row.urg, src: row.src, jobs: [] });
      }
      cityMap.get(row.city).jobs.push({
        t: row.role_title, n: row.niche, l: row.level,
        count: row.count, di: row.di, note: row.note || '',
      });
      if (!latestUpdatedAt || row.updated_at > latestUpdatedAt) latestUpdatedAt = row.updated_at;
      if (row.bls_period && !blsPeriod) blsPeriod = row.bls_period;
    }

    return res.status(200).json({
      ok: true,
      demand: Array.from(cityMap.values()),
      generated_at: latestUpdatedAt || new Date().toISOString(),
      bls_period: blsPeriod,
      row_count: rawRows.length,
    });
  } catch (e) {
    console.error('demand GET error:', e.message);
    logError('demand', e.message, { method: 'GET' });
    return res.status(200).json({ ok: true, demand: [], generated_at: new Date().toISOString() });
  }
}

// ── POST: BLS refresh ─────────────────────────────────────────────────────────

async function handlePost(req, res) {
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const CRON_SECRET          = process.env.CRON_SECRET;
  const BLS_API_KEY          = process.env.BLS_API_KEY || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer /i, '').trim();
  let authed = false;
  const adminToken = req.headers['x-admin-token'] || '';
  const isCron     = req.headers['x-vercel-cron'] === '1';

  if (isCron || (CRON_SECRET && token === CRON_SECRET)) {
    authed = true;
  } else if (adminToken) {
    const sr = await fetch(`${SUPABASE_URL}/rest/v1/admin_sessions?token=eq.${encodeURIComponent(adminToken)}&select=expires_at&limit=1`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
    const sess = sr.ok ? (await sr.json())?.[0] : null;
    if (sess && new Date(sess.expires_at) > new Date()) authed = true;
  } else if (token) {
    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
      });
      if (userRes.ok) {
        const user = await userRes.json();
        // SECURITY: Require ADMIN_EMAIL to be configured — fail closed, not open.
        // Without this check, any authenticated user could trigger demand data refresh.
        const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
        if (ADMIN_EMAIL && user.email === ADMIN_EMAIL) authed = true;
      }
    } catch (_) {}
  }

  if (!authed) return res.status(401).json({ error: 'Unauthorized' });

  const svc = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── BLS series ──────────────────────────────────────────────────────────────
  const JOLTS_SERIES = [
    { id: 'JTS620000000000000JOL', sector: 'healthcare' },
    { id: 'JTS540000000000000JOL', sector: 'professional' },
    { id: 'JTS550000000000000JOL', sector: 'financial' },
    { id: 'JTS480000000000000JOL', sector: 'trade_transport' },
    { id: 'JTS230000000000000JOL', sector: 'construction' },
    { id: 'JTS510000000000000JOL', sector: 'information' },
  ];
  const CES_SERIES = [
    { id: 'CES6562000001', sector: 'healthcare' },
    { id: 'CES6054000001', sector: 'professional' },
    { id: 'CES5500000001', sector: 'financial' },
    { id: 'CES4348000001', sector: 'trade_transport' },
    { id: 'CES2000000001', sector: 'construction' },
    { id: 'CES5000000001', sector: 'information' },
  ];

  const currentYear = new Date().getFullYear().toString();
  const prevYear    = (new Date().getFullYear() - 1).toString();

  const blsRequest = async (seriesIds, signal) => {
    const body = { seriesid: seriesIds, startyear: prevYear, endyear: currentYear };
    if (BLS_API_KEY) body.registrationkey = BLS_API_KEY;
    const r = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) throw new Error(`BLS API HTTP ${r.status}`);
    return r.json();
  };

  const latestValue = (series) => {
    const data = series?.data || [];
    if (!data.length) return null;
    const sorted = [...data].sort((a, b) => {
      if (a.year !== b.year) return parseInt(b.year) - parseInt(a.year);
      return parseInt(b.period.replace('M', '')) - parseInt(a.period.replace('M', ''));
    });
    const latest = sorted[0];
    return { value: parseFloat(latest.value), period: `${latest.year}-${latest.period}` };
  };

  let sectorData = {};
  let blsPeriod  = 'unknown';

  try {
    const allSeriesIds = [...JOLTS_SERIES.map(s => s.id), ...CES_SERIES.map(s => s.id)];
    const blsCtrl = new AbortController();
    const blsTimer = setTimeout(() => blsCtrl.abort(), 12000);
    const blsData = await blsRequest(allSeriesIds, blsCtrl.signal).finally(() => clearTimeout(blsTimer));
    if (blsData.status !== 'REQUEST_SUCCEEDED') {
      throw new Error(`BLS status: ${blsData.status} — ${blsData.message?.[0] || ''}`);
    }
    const seriesMap = {};
    for (const s of (blsData.Results?.series || [])) {
      const latest = latestValue(s);
      if (latest) { seriesMap[s.seriesID] = latest; blsPeriod = latest.period; }
    }
    for (const { id, sector } of JOLTS_SERIES) {
      if (!sectorData[sector]) sectorData[sector] = {};
      sectorData[sector].jolts = seriesMap[id]?.value || null;
      sectorData[sector].joltsPeriod = seriesMap[id]?.period || null;
    }
    for (const { id, sector } of CES_SERIES) {
      if (!sectorData[sector]) sectorData[sector] = {};
      sectorData[sector].ces = seriesMap[id]?.value || null;
    }
  } catch (blsErr) {
    console.warn('BLS API error — using baseline data:', blsErr.message);
  }

  const openingRateNorm = (sector) => {
    const d = sectorData[sector];
    if (!d?.jolts || !d?.ces || d.ces === 0) return null;
    return Math.min(100, Math.round((d.jolts / d.ces) / 0.10 * 100));
  };

  // ── Occupation table ────────────────────────────────────────────────────────
  // growth: BLS EP 2023-2033 (Dec 2023). dtf: SHRM 2023 + LinkedIn Talent Insights 2024.
  // occ_share: fraction of sector openings for this occupation (BLS OES 2023).
  const OCCUPATIONS = [
    { title:'Home Health Aide',         niche:'Healthcare',            level:'Entry level', sector:'healthcare',     growth:22, dtf:72, occ_share:0.034, note:'BLS/HRSA: 22% projected growth 2023-2033; highest volume occupation in healthcare sector' },
    { title:'Registered Nurse',         niche:'Healthcare',            level:'Mid level',   sector:'healthcare',     growth:6,  dtf:62, occ_share:0.041, note:'HRSA 2023: national RN shortage projected at 78,610 by 2035; avg 62 days to fill per SHRM' },
    { title:'Medical Assistant',        niche:'Healthcare',            level:'Entry level', sector:'healthcare',     growth:15, dtf:45, occ_share:0.021, note:'BLS: 15% growth 2023-2033; high volume, moderate urgency due to shorter training pipeline' },
    { title:'Physical Therapist',       niche:'Healthcare',            level:'Mid level',   sector:'healthcare',     growth:17, dtf:48, occ_share:0.008, note:'BLS: 17% growth 2023-2033; aging population driving sustained PT demand' },
    { title:'Software Engineer',        niche:'Tech / Software',       level:'Mid level',   sector:'professional',   growth:25, dtf:45, occ_share:0.024, note:'BLS: 25% growth 2023-2033; CompTIA State of Tech 2024: 186K+ job postings/month nationally' },
    { title:'Data Analyst',             niche:'Tech / Software',       level:'Mid level',   sector:'professional',   growth:36, dtf:42, occ_share:0.013, note:'BLS: Data Analyst roles growing 36% 2023-2033; highest projected growth of any occupation' },
    { title:'Data Scientist',           niche:'Tech / Software',       level:'Senior',      sector:'professional',   growth:36, dtf:48, occ_share:0.007, note:'BLS: 36% growth 2023-2033; average 48 days to fill (LinkedIn Talent Insights 2024)' },
    { title:'Product Manager',          niche:'Tech / Software',       level:'Senior',      sector:'professional',   growth:10, dtf:40, occ_share:0.009, note:'BLS: 10% growth 2023-2033; high competition but consistent demand in product-led companies' },
    { title:'DevOps Engineer',          niche:'Tech / Software',       level:'Senior',      sector:'professional',   growth:28, dtf:50, occ_share:0.007, note:'CompTIA: DevOps roles growing 28% nationally; cloud infrastructure skills critically short' },
    { title:'Customer Success Manager', niche:'Tech / Software',       level:'Entry level', sector:'professional',   growth:12, dtf:30, occ_share:0.012, note:'LinkedIn: CSM is the highest-volume remote role after SWE; 30-day avg time-to-fill' },
    { title:'Financial Analyst',        niche:'Finance',               level:'Mid level',   sector:'professional',   growth:8,  dtf:42, occ_share:0.014, note:'BLS: 8% growth 2023-2033; finance sector expanding in major metros with no income tax' },
    { title:'Cybersecurity Analyst',    niche:'Tech / Software',       level:'Mid level',   sector:'information',    growth:33, dtf:55, occ_share:0.082, note:'CISA Cyber Workforce Study 2024: 700K unfilled US cybersecurity roles; 33% BLS growth' },
    { title:'Cloud / DevOps Engineer',  niche:'Tech / Software',       level:'Senior',      sector:'information',    growth:28, dtf:50, occ_share:0.062, note:'AWS/Azure skills gaps: avg 50-day fill time; CompTIA: cloud roles fastest-growing in IT' },
    { title:'Network Engineer',         niche:'Tech / Software',       level:'Mid level',   sector:'information',    growth:15, dtf:48, occ_share:0.055, note:'BLS: 15% growth 2023-2033; DoD, DHS, and private sector all reporting critical network gaps' },
    { title:'CDL Truck Driver',         niche:'Logistics / Warehouse', level:'Entry level', sector:'trade_transport', growth:3, dtf:68, occ_share:0.041, note:'ATA Truck Driver Shortage Report 2023: 80,000+ driver shortage nationally; 68-day avg fill' },
    { title:'Logistics Coordinator',    niche:'Logistics / Warehouse', level:'Entry level', sector:'trade_transport', growth:8, dtf:35, occ_share:0.019, note:'BLS: 8% growth 2023-2033; e-commerce growth sustaining above-average logistics hiring' },
    { title:'Electrician',              niche:'Trades / Construction', level:'Entry level', sector:'construction',   growth:11, dtf:55, occ_share:0.063, note:'BLS: 11% growth 2023-2033 + Inflation Reduction Act infrastructure spend driving demand' },
    { title:'Construction Manager',     niche:'Trades / Construction', level:'Mid level',   sector:'construction',   growth:9,  dtf:42, occ_share:0.028, note:'BLS: 9% growth 2023-2033; residential and commercial construction boom in Sun Belt metros' },
    { title:'Industrial Engineer',      niche:'Tech / Software',       level:'Mid level',   sector:'construction',   growth:12, dtf:38, occ_share:0.015, note:'BLS: 12% growth 2023-2033; manufacturing reshoring and energy sector driving IE demand' },
    { title:'Accountant / CPA',         niche:'Finance',               level:'Mid level',   sector:'financial',      growth:4,  dtf:35, occ_share:0.082, note:'BLS: 4% growth 2023-2033; stable demand, AICPA reports aging workforce pipeline concern' },
  ];

  // BLS QCEW 2023 metro employment shares (fraction of national sector employment per MSA)
  const METRO_SHARES = {
    'New York, NY':           { healthcare:0.058, professional:0.062, financial:0.095, trade_transport:0.051, construction:0.040, information:0.072 },
    'Los Angeles, CA':        { healthcare:0.046, professional:0.049, financial:0.032, trade_transport:0.072, construction:0.038, information:0.052 },
    'San Francisco Bay Area': { healthcare:0.028, professional:0.055, financial:0.021, trade_transport:0.012, construction:0.018, information:0.124 },
    'Seattle, WA':            { healthcare:0.021, professional:0.034, financial:0.011, trade_transport:0.019, construction:0.020, information:0.085 },
    'Chicago, IL':            { healthcare:0.041, professional:0.048, financial:0.038, trade_transport:0.046, construction:0.032, information:0.032 },
    'Houston, TX':            { healthcare:0.029, professional:0.033, financial:0.016, trade_transport:0.058, construction:0.065, information:0.018 },
    'Dallas-Fort Worth, TX':  { healthcare:0.025, professional:0.041, financial:0.024, trade_transport:0.042, construction:0.048, information:0.028 },
    'Austin, TX':             { healthcare:0.008, professional:0.021, financial:0.009, trade_transport:0.008, construction:0.019, information:0.024 },
    'Phoenix, AZ':            { healthcare:0.022, professional:0.028, financial:0.015, trade_transport:0.019, construction:0.032, information:0.014 },
    'Miami, FL':              { healthcare:0.024, professional:0.025, financial:0.017, trade_transport:0.028, construction:0.024, information:0.012 },
    'Washington, DC metro':   { healthcare:0.025, professional:0.078, financial:0.018, trade_transport:0.017, construction:0.025, information:0.048 },
    'Atlanta, GA':            { healthcare:0.020, professional:0.036, financial:0.019, trade_transport:0.035, construction:0.028, information:0.024 },
  };

  // LinkedIn 2024: fraction of national sector openings that are remote
  const REMOTE_SHARES = {
    healthcare:0.03, professional:0.28, financial:0.18,
    trade_transport:0.04, construction:0.02, information:0.45,
  };

  const CITY_ROLES = {
    'New York, NY':           ['Home Health Aide','Software Engineer','Registered Nurse','Data Analyst'],
    'Los Angeles, CA':        ['Home Health Aide','Software Engineer','Registered Nurse','Physical Therapist'],
    'San Francisco Bay Area': ['Software Engineer','Cybersecurity Analyst','Data Scientist','Product Manager'],
    'Seattle, WA':            ['Software Engineer','Cloud / DevOps Engineer','Data Analyst','Cybersecurity Analyst'],
    'Chicago, IL':            ['Registered Nurse','CDL Truck Driver','Accountant / CPA','Electrician'],
    'Houston, TX':            ['CDL Truck Driver','Electrician','Registered Nurse','Industrial Engineer'],
    'Dallas-Fort Worth, TX':  ['Software Engineer','Registered Nurse','Cybersecurity Analyst','Financial Analyst'],
    'Austin, TX':             ['Software Engineer','Cybersecurity Analyst','Construction Manager','DevOps Engineer'],
    'Phoenix, AZ':            ['Home Health Aide','CDL Truck Driver','Registered Nurse','Software Engineer'],
    'Miami, FL':              ['Home Health Aide','Registered Nurse','Financial Analyst','Software Engineer'],
    'Washington, DC metro':   ['Cybersecurity Analyst','Software Engineer','Data Analyst','Network Engineer'],
    'Atlanta, GA':            ['Software Engineer','Registered Nurse','Logistics Coordinator','Electrician'],
    'Remote — All US':        ['Software Engineer','Customer Success Manager','Data Analyst','Product Manager'],
  };

  const CITY_URG = {
    'New York, NY':'hot', 'San Francisco Bay Area':'hot', 'Seattle, WA':'hot',
    'Houston, TX':'hot', 'Austin, TX':'hot', 'Phoenix, AZ':'hot', 'Washington, DC metro':'hot',
    'Los Angeles, CA':'warm', 'Chicago, IL':'warm', 'Dallas-Fort Worth, TX':'warm',
    'Miami, FL':'warm', 'Atlanta, GA':'warm', 'Remote — All US':'warm',
  };

  const CITY_SRC = {
    'New York, NY':           'BLS JOLTS · OES 2024 · HRSA',
    'Los Angeles, CA':        'BLS JOLTS · OES 2024 · CA EDD',
    'San Francisco Bay Area': 'BLS JOLTS · OES 2024 · CompTIA',
    'Seattle, WA':            'BLS JOLTS · OES 2024 · WA ESD',
    'Chicago, IL':            'BLS JOLTS · OES 2024 · IL DES',
    'Houston, TX':            'BLS JOLTS · OES 2024 · TX Workforce Commission',
    'Dallas-Fort Worth, TX':  'BLS JOLTS · OES 2024 · TX Workforce Commission',
    'Austin, TX':             'BLS JOLTS · OES 2024 · TX Workforce Commission',
    'Phoenix, AZ':            'BLS JOLTS · OES 2024 · AZ DES',
    'Miami, FL':              'BLS JOLTS · OES 2024 · FL AWI',
    'Washington, DC metro':   'BLS JOLTS · OES 2024 · CISA 2024',
    'Atlanta, GA':            'BLS JOLTS · OES 2024 · GA DOL',
    'Remote — All US':        'BLS JOLTS · OES 2024 · LinkedIn',
  };

  const occByTitle = Object.fromEntries(OCCUPATIONS.map(o => [o.title, o]));
  const dataVersion = `BLS-${blsPeriod}`;

  const computeDI = (occ) => {
    const orLive = openingRateNorm(occ.sector);
    const orFallback = { healthcare:77, professional:68, financial:55, trade_transport:52, construction:48, information:62 }[occ.sector] || 55;
    const orNorm  = orLive ?? orFallback;
    const grNorm  = Math.min(100, Math.round(occ.growth / 36 * 100));
    const dtfNorm = Math.min(100, Math.round(occ.dtf / 90 * 100));
    return Math.min(100, Math.max(30, Math.round(0.40 * orNorm + 0.35 * grNorm + 0.25 * dtfNorm)));
  };

  const nationalCount = (occ) => {
    const joltsCurrent = sectorData[occ.sector]?.jolts ? sectorData[occ.sector].jolts * 1000 : null;
    const joltsFallback = { healthcare:1756, professional:1508, financial:400, trade_transport:512, construction:348, information:176 }[occ.sector] || 500;
    return Math.round((joltsCurrent ?? (joltsFallback * 1000)) * occ.occ_share);
  };

  const rows = [];
  for (const [city, roleTitles] of Object.entries(CITY_ROLES)) {
    const shares = city === 'Remote — All US' ? REMOTE_SHARES : METRO_SHARES[city];
    if (!shares) continue;
    for (const title of roleTitles) {
      const occ = occByTitle[title];
      if (!occ) continue;
      const metroShare = city === 'Remote — All US' ? (REMOTE_SHARES[occ.sector] || 0.05) : (shares[occ.sector] || 0.02);
      rows.push({
        city,
        urg: CITY_URG[city] || 'warm',
        src: CITY_SRC[city] || 'BLS JOLTS · OES 2024',
        role_title: title,
        niche: occ.niche,
        level: occ.level,
        count: Math.max(100, Math.round(nationalCount(occ) * metroShare)),
        di: computeDI(occ),
        note: occ.note,
        bls_series_id: JOLTS_SERIES.find(s => s.sector === occ.sector)?.id || null,
        bls_period: sectorData[occ.sector]?.joltsPeriod || blsPeriod,
        bls_raw_value: sectorData[occ.sector]?.jolts || null,
        data_version: dataVersion,
        updated_at: new Date().toISOString(),
      });
    }
  }

  let rowsUpserted = 0;
  let upsertError = null;

  try {
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/demand_data?on_conflict=city,role_title`, {
      method: 'POST',
      headers: { ...svc, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!upsertRes.ok) {
      const txt = await upsertRes.text();
      upsertError = `${upsertRes.status}: ${txt.slice(0, 200)}`;
    } else {
      rowsUpserted = rows.length;
    }
  } catch (e) {
    upsertError = e.message;
  }

  fetch(`${SUPABASE_URL}/rest/v1/demand_refresh_log`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: upsertError ? 'error' : 'ok',
      rows_upserted: rowsUpserted,
      bls_period: blsPeriod,
      details: upsertError || `${rowsUpserted} rows upserted; BLS period: ${blsPeriod}`,
    }),
  }).catch(() => {});

  if (upsertError) {
    return res.status(500).json({ ok: false, error: upsertError, bls_period: blsPeriod });
  }

  return res.status(200).json({ ok: true, rows_upserted: rowsUpserted, bls_period: blsPeriod, data_version: dataVersion });
}
