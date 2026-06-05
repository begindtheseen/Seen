// Server-side reports fetch — uses service key to bypass RLS.
// Queries by company_name column directly — no company table join needed.
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

  // Normalize: strip legal suffixes, lowercase for matching
  const normalize = n => n ? n.trim().toLowerCase()
    .replace(/[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i, '')
    .trim() : '';

  const canonical = normalize(company.trim());
  const firstWord = canonical.split(/\s+/)[0];

  console.log(`REPORTS: company="${company}" canonical="${canonical}"`);

  try {
    // ── Query reports directly by company_name (no FK join) ───────────────────
    // Use first significant word so "Towne Park LLC" matches "Towne Park"
    const nameEnc = encodeURIComponent(`*${firstWord}*`);
    const url = `${SUPABASE_URL}/rest/v1/reports`
      + `?company_name=ilike.${nameEnc}`
      + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,location_id,company_name,company_id`
      + `&order=created_at.desc`
      + `&limit=100`;

    console.log(`REPORTS: fetching URL: ${url.replace(SUPABASE_URL, '[URL]')}`);

    const rRes = await fetch(url, { headers: hdrs });

    if (!rRes.ok) {
      const err = await rRes.text();
      console.error(`REPORTS: fetch failed ${rRes.status}:`, err.slice(0, 300));

      // Fallback: try querying by company_id if company_name column doesn't exist yet
      const cosRes = await fetch(
        `${SUPABASE_URL}/rest/v1/companies?name=ilike.${nameEnc}&select=id,name&limit=20`,
        { headers: hdrs }
      );
      if (!cosRes.ok) {
        return res.status(200).json({ ok: true, reports: [], cities: [], _debug: `fetch failed: ${rRes.status}` });
      }
      const cosRows = await cosRes.json();
      const ids = (cosRows || [])
        .filter(c => normalize(c.name) === canonical || c.name.toLowerCase().includes(canonical))
        .map(c => c.id).filter(Boolean);

      if (!ids.length) {
        return res.status(200).json({ ok: true, reports: [], cities: [], _debug: 'no company found' });
      }

      const fbUrl = `${SUPABASE_URL}/rest/v1/reports`
        + `?company_id=in.(${ids.join(',')})`
        + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,location_id,company_id`
        + `&order=created_at.desc&limit=100`;
      const fbRes = await fetch(fbUrl, { headers: hdrs });
      const fbRows = fbRes.ok ? await fbRes.json() : [];
      console.log(`REPORTS: fallback company_id query got ${fbRows?.length || 0} rows`);
      return buildResponse(res, fbRows, hdrs, SUPABASE_URL, city);
    }

    const rows = await rRes.json();
    console.log(`REPORTS: company_name query got ${rows?.length || 0} rows`);

    // Also get any older reports that have company_id but no company_name
    // by doing a secondary company_id-based lookup and merging
    const cosRes2 = await fetch(
      `${SUPABASE_URL}/rest/v1/companies?name=ilike.${nameEnc}&select=id,name&limit=20`,
      { headers: hdrs }
    );
    let extraRows = [];
    if (cosRes2.ok) {
      const cosRows2 = await cosRes2.json();
      const ids2 = (cosRows2 || [])
        .filter(c => normalize(c.name) === canonical || c.name.toLowerCase().includes(canonical))
        .map(c => c.id).filter(Boolean);
      if (ids2.length) {
        const knownIds = new Set((rows || []).map(r => r.id));
        const fbUrl2 = `${SUPABASE_URL}/rest/v1/reports`
          + `?company_id=in.(${ids2.join(',')})`
          + `&select=id,role,outcome,ghost_stage,rounds,report_text,platform,created_at,experience_level,location_id,company_id`
          + `&order=created_at.desc&limit=100`;
        const fb2 = await fetch(fbUrl2, { headers: hdrs });
        if (fb2.ok) {
          const fb2Rows = await fb2.json();
          extraRows = (fb2Rows || []).filter(r => !knownIds.has(r.id));
          if (extraRows.length) console.log(`REPORTS: merged ${extraRows.length} older company_id-only rows`);
        }
      }
    }

    return buildResponse(res, [...(rows || []), ...extraRows], hdrs, SUPABASE_URL, city);

  } catch(e) {
    console.error('REPORTS error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

async function buildResponse(res, reports, hdrs, SUPABASE_URL, city) {
  // Fetch city names for any location_ids
  const locIds = [...new Set((reports || []).map(r => r.location_id).filter(Boolean))];
  const cityMap = {};
  if (locIds.length) {
    try {
      const locRes = await fetch(
        `${SUPABASE_URL}/rest/v1/company_locations?id=in.(${locIds.join(',')})&select=id,city&limit=100`,
        { headers: hdrs }
      );
      if (locRes.ok) {
        const locRows = await locRes.json();
        (locRows || []).forEach(l => { if (l.id && l.city) cityMap[l.id] = l.city; });
      }
    } catch(_e) {}
  }

  const enriched = (reports || []).map(r => ({
    ...r,
    city: r.location_id ? (cityMap[r.location_id] || '') : '',
  }));

  const cityFilter = city?.trim()?.toLowerCase();
  const filtered = cityFilter
    ? enriched.filter(r => !r.city || r.city.toLowerCase().includes(cityFilter))
    : enriched;

  const cities = [...new Set(enriched.map(r => r.city).filter(Boolean))].sort();

  return res.status(200).json({ ok: true, reports: filtered, cities, total: enriched.length });
}
