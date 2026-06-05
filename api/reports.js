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
  console.log(`REPORTS API: looking up "${company}" → canonical="${canonical}" word="${canonical.split(/\s+/)[0]}"`);

  try {
    // ── 1. Find all matching company IDs ─────────────────────────────────────
    const cosRes = await fetch(
      `${SUPABASE_URL}/rest/v1/companies?name=ilike.*${searchWord}*&select=id,name&limit=20`,
      { headers: hdrs }
    );
    const cosRows = cosRes.ok ? await cosRes.json() : [];
    console.log(`REPORTS API: company search returned ${cosRows?.length || 0} rows:`, JSON.stringify((cosRows||[]).map(c=>c.name)));

    const ids = (cosRows || [])
      .filter(c => normalize(c.name) === canonical || c.name.toLowerCase().includes(canonical))
      .map(c => c.id)
      .filter(Boolean);

    console.log(`REPORTS API: matched ${ids.length} company IDs: ${ids.join(', ')}`);

    if (!ids.length) {
      return res.status(200).json({ ok: true, reports: [], cities: [], company_ids: [], _debug: `no company found for "${canonical}"` });
    }

    // ── 2. Fetch reports for those companies ──────────────────────────────────
    // Use plain UUIDs in the in() filter — no quotes around UUIDs in PostgREST
    const inFilter = ids.join(',');
    // Encode the select so embedded-resource parens don't corrupt the URL
    const selectCols = encodeURIComponent('role,outcome,ghost_stage,rounds,wait_days,unpaid_work,report_text,platform,created_at,experience_level,location_id');
    const rUrl = `${SUPABASE_URL}/rest/v1/reports`
      + `?company_id=in.(${inFilter})`
      + `&select=${selectCols}`
      + `&order=created_at.desc`
      + `&limit=100`;

    const rRes = await fetch(rUrl, { headers: hdrs });
    if (!rRes.ok) {
      const err = await rRes.text();
      console.error('REPORTS API: reports fetch failed:', rRes.status, err.slice(0, 200));
      return res.status(500).json({ error: 'reports fetch failed', detail: err.slice(0, 150) });
    }
    const reports = await rRes.json();
    console.log(`REPORTS API: found ${reports?.length || 0} reports`);

    // ── 3. Fetch city names for all location_ids ───────────────────────────────
    const locIds = [...new Set((reports || []).map(r => r.location_id).filter(Boolean))];
    const cityMap = {};
    if (locIds.length) {
      const locRes = await fetch(
        `${SUPABASE_URL}/rest/v1/company_locations?id=in.(${locIds.join(',')})&select=id,city&limit=100`,
        { headers: hdrs }
      );
      if (locRes.ok) {
        const locRows = await locRes.json();
        (locRows || []).forEach(l => { if (l.id && l.city) cityMap[l.id] = l.city; });
      }
    }

    // Attach city to each report
    const enriched = (reports || []).map(r => ({
      ...r,
      city: r.location_id ? (cityMap[r.location_id] || '') : '',
    }));

    // City filter
    const cityFilter = city?.trim()?.toLowerCase();
    const filtered = cityFilter
      ? enriched.filter(r => !r.city || r.city.toLowerCase().includes(cityFilter))
      : enriched;

    // All distinct cities for filter dropdown
    const cities = [...new Set(enriched.map(r => r.city).filter(Boolean))].sort();

    return res.status(200).json({ ok: true, reports: filtered, cities, company_ids: ids });

  } catch(e) {
    console.error('REPORTS API error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
