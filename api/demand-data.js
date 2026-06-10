// /api/demand-data — Public read endpoint for demand_data table.
// Returns data grouped by city in the same shape as the frontend DEMAND constant,
// so loadDemand() can use it directly without restructuring.
// Falls back gracefully (empty array) if table doesn't exist yet.

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = !origin || origin.includes('localhost') || origin.includes('127.0.0.1') ||
    ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(origin);
  res.setHeader('Access-Control-Allow-Origin', allowed ? (origin || '*') : 'https://seenjobs.io');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache for 6 hours — data refreshes monthly but this keeps reads fast
  res.setHeader('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return res.status(200).json({ ok: true, demand: [], generated_at: new Date().toISOString() });
  }

  try {
    // Fetch all rows ordered by city then di desc (highest demand role first per city)
    const url = `${SUPABASE_URL}/rest/v1/demand_data?select=*&order=city.asc,di.desc&limit=500`;
    const r = await fetch(url, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });

    if (!r.ok) {
      // Table may not exist yet (migration not run) — return empty so frontend uses fallback
      return res.status(200).json({ ok: true, demand: [], generated_at: new Date().toISOString() });
    }

    const rawRows = await r.json();
    if (!Array.isArray(rawRows) || !rawRows.length) {
      return res.status(200).json({ ok: true, demand: [], generated_at: new Date().toISOString() });
    }

    // Group rows by city into the DEMAND array shape expected by loadDemand()
    const cityMap = new Map();
    let latestUpdatedAt = null;
    let blsPeriod = null;

    for (const row of rawRows) {
      if (!cityMap.has(row.city)) {
        cityMap.set(row.city, {
          city: row.city,
          urg: row.urg,
          src: row.src,
          jobs: [],
        });
      }
      cityMap.get(row.city).jobs.push({
        t: row.role_title,
        n: row.niche,
        l: row.level,
        count: row.count,
        di: row.di,
        note: row.note || '',
      });
      if (!latestUpdatedAt || row.updated_at > latestUpdatedAt) {
        latestUpdatedAt = row.updated_at;
      }
      if (row.bls_period && !blsPeriod) {
        blsPeriod = row.bls_period;
      }
    }

    const demand = Array.from(cityMap.values());

    return res.status(200).json({
      ok: true,
      demand,
      generated_at: latestUpdatedAt || new Date().toISOString(),
      bls_period: blsPeriod,
      row_count: rawRows.length,
    });
  } catch (e) {
    console.error('demand-data error:', e.message);
    return res.status(200).json({ ok: true, demand: [], generated_at: new Date().toISOString() });
  }
}
