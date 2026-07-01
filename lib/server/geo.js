// Keyless geocoding + distance math for real radius search. Geocodes a searched
// location string to coordinates (cached in geocode_cache so we call the geocoder once
// per unique place), and computes great-circle miles between points. No API keys.

export const MILES_PER_KM = 0.621371;
export function milesToKm(mi) { return mi / MILES_PER_KM; }

// Great-circle distance in miles between two {lat,lng} points.
export function haversineMiles(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return Infinity;
  const R = 3958.7613; // Earth radius, miles
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function normQ(loc) {
  return String(loc || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Geocode a free-form US location ("Moreno Valley, CA") → { lat, lng } | null.
// DB cache first (geocode_cache), then Nominatim (OpenStreetMap, keyless). Cached forever
// since a place's coordinates don't change. Never throws — returns null on any failure so
// callers degrade to coarse city/state matching instead of breaking the search.
export async function geocodeLocation(loc, supabaseUrl, serviceKey) {
  const q = normQ(loc);
  if (!q) return null;

  const dbHeaders = supabaseUrl && serviceKey
    ? { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
    : null;

  // 1) Cache
  if (dbHeaders) {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/geocode_cache?q=eq.${encodeURIComponent(q)}&select=lat,lng&limit=1`, { headers: dbHeaders });
      if (r.ok) {
        const rows = await r.json();
        if (rows?.[0] && rows[0].lat != null && rows[0].lng != null) return { lat: rows[0].lat, lng: rows[0].lng };
      }
    } catch (_e) { /* ignore, fall through to live geocode */ }
  }

  // 2) Nominatim (OSM) — keyless. Requires a descriptive User-Agent per their policy.
  let coords = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': 'SeenJobs/1.0 (+https://seenjobs.io)', Accept: 'application/json' }, signal: controller.signal }
    );
    clearTimeout(timeout);
    if (r.ok) {
      const rows = await r.json();
      const m = Array.isArray(rows) ? rows[0] : null;
      const lat = m ? parseFloat(m.lat) : NaN;
      const lng = m ? parseFloat(m.lon) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) coords = { lat, lng };
    }
  } catch (_e) { /* geocoder down/timeout → null */ }

  // 3) Cache the hit (fire-and-forget)
  if (coords && dbHeaders) {
    fetch(`${supabaseUrl}/rest/v1/geocode_cache`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ q, lat: coords.lat, lng: coords.lng }),
    }).catch(() => {});
  }

  return coords;
}
