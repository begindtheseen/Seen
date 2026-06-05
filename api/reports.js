// Server-side reports fetch — uses service key to bypass RLS.
// Returns all reports for a company, optionally filtered by city.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'DB not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
  const { company, city } = body || {};
  if (!company) return res.status(400).json({ error: 'company required' });

  const hdrs = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  const normalize = n => {
    if (!n) return '';
    return n.trim().toLowerCase()
      .replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies|gmbh|s\.a\.|ag)\.?$/i, '')
      .trim();
  };

  const canonical = normalize(company.trim());
  const searchWord = encodeURIComponent(canonical.split(/\s+/)[0]);

  try {
    // ── 1. Find all matching company IDs ─────────────────────────────────────
    const cosRes = await fetch(
      `${SUPABASE_URL}/rest/v1/companies?name=ilike.*${searchWord}*&select=id,name&limit=20`,
      { headers: hdrs }
    );
    const cosRows = cosRes.ok ? await cosRes.json() : [];
    const ids = (cosRows || [])
      .filter(c => normalize(c.name) === canonical || c.name.toLowerCase().includes(canonical))
      .map(c => c.id)
      .filter(Boolean);

    if (!ids.length) {
      return res.status(200).json({ ok: true, reports: [], company_ids: [] });
    }

    // ── 2. Fetch reports ──────────────────────────────────────────────────────
    const inFilter = ids.map(id => `"${id}"`).join(',');
    let url = `${SUPABASE_URL}/rest/v1/reports`
      + `?company_id=in.(${inFilter})`
      + `&needs_review=eq.false`
      + `&select=role,outcome,ghost_stage,rounds,wait_days,unpaid_work,report_text,platform,created_at,experience_level,company_locations(city)`
      + `&order=created_at.desc`
      + `&limit=100`;

    // Optional city filter
    if (city && city.trim()) {
      // We can't easily filter by joined column in PostgREST — fetch all and filter in JS
    }

    const rRes = await fetch(url, { headers: hdrs });
    if (!rRes.ok) {
      const err = await rRes.text();
      return res.status(500).json({ error: 'reports fetch failed', detail: err.slice(0, 150) });
    }
    let reports = await rRes.json();

    // Apply city filter server-side (after fetch, since PostgREST can't filter on embedded JOIN)
    const cityFilter = city?.trim()?.toLowerCase();
    if (cityFilter) {
      reports = reports.filter(r => {
        const c = (r.company_locations?.city || '').toLowerCase();
        return !c || c.includes(cityFilter);
      });
    }

    // Return distinct cities for the filter dropdown
    const allCities = [...new Set(
      (await (async () => {
        // Fetch unfiltered to get all cities for dropdown
        if (!cityFilter) return reports;
        const allRes = await fetch(url, { headers: hdrs });
        return allRes.ok ? await allRes.json() : reports;
      })())
      .map(r => r.company_locations?.city)
      .filter(Boolean)
    )].sort();

    return res.status(200).json({ ok: true, reports, cities: allCities, company_ids: ids });

  } catch(e) {
    console.error('reports API error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
