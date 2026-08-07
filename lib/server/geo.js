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

// A point's coordinates are USABLE for distance math only if both are finite numbers AND
// not the (0,0) geocode-failure sentinel. ~28% of ingested job rows sit at (0,0) and ~12%
// are NULL; treating (0,0) as a real point drops a job in the Atlantic off Africa (~8000mi
// from any US city) instead of honestly "unknown". Both must be EXCLUDED from radius
// (location-scoped) searches — they can't be distance-checked — never leaked in near 0,0.
export function hasUsableCoords(point) {
  if (!point) return false;
  const { lat: rawLat, lng: rawLng } = point;
  // Reject NULL/undefined/'' BEFORE coercion — Number(null) is 0 (finite), which would
  // otherwise sneak a coordinate-less row through as if it sat on the equator.
  if (rawLat == null || rawLng == null || rawLat === '' || rawLng === '') return false;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

// True iff `point` lies within `miles` of `center` by great-circle distance. Unknown/unusable
// coords (NULL or 0,0, on either endpoint) are NEVER within radius — the honest answer when a
// listing can't be distance-checked is "no", so it's excluded rather than assumed nearby.
export function withinRadius(center, point, miles) {
  if (!hasUsableCoords(center) || !hasUsableCoords(point)) return false;
  if (!Number.isFinite(miles) || miles < 0) return false;
  return haversineMiles(center, point) <= miles;
}

// Ingest guard: sources (esp. Adzuna) return latitude:0/longitude:0 for listings they could
// NOT geocode. Persisting (0,0) makes a job look like it's in the ocean and pollutes radius
// math; store NULL instead so "unknown location" is honest and the filter excludes it. Any
// non-finite input (undefined/NaN/'') also collapses to NULL. Returns { lat, lng }.
export function sanitizeCoords(lat, lng) {
  // Reject NULL/undefined/'' up front — Number(null) is 0, which would fabricate an equator
  // point out of a missing coordinate (this is exactly how secondary sources with no coords
  // were being persisted at 0,0). Only a genuine numeric (0,0) pair is the failure sentinel.
  if (lat == null || lng == null || lat === '' || lng === '') return { lat: null, lng: null };
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return { lat: null, lng: null };
  if (la === 0 && lo === 0) return { lat: null, lng: null };
  return { lat: la, lng: lo };
}

// Axis-aligned bounding box (a strict SUPERSET of the radius circle) around a center, used to
// push the distance pre-filter INTO the database as an indexed lat/lng range scan instead of
// loading the whole corpus into Node. Padding uses 68.7 mi/deg (slightly under the true ~69)
// so the box always fully contains the circle — the exact-circle haversine refine on the
// returned page removes the corner over-inclusions. Returns null for an unusable center.
const _MI_PER_DEG = 68.7;
export function boundingBox(center, miles) {
  if (!hasUsableCoords(center) || !Number.isFinite(miles) || miles <= 0) return null;
  const latPad = miles / _MI_PER_DEG;
  const cosLat = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)); // guard near the poles
  const lngPad = miles / (_MI_PER_DEG * cosLat);
  return {
    latMin: center.lat - latPad,
    latMax: center.lat + latPad,
    lngMin: center.lng - lngPad,
    lngMax: center.lng + lngPad,
  };
}

// PostgREST filter fragment (leading '&') that scopes a jobs query to the bounding box so the
// DB does the distance pre-filter on the jobs_latlng_idx index (migration 033). Also asserts
// lat/lng NOT NULL. (0,0) never survives: a US-geocoded center's box can't contain 0,0, and the
// haversine refine drops it regardless.) Returns '' when there's no usable center to box.
export function geoBoxClause(center, miles) {
  const b = boundingBox(center, miles);
  if (!b) return '';
  const f = n => n.toFixed(6);
  return `&lat=gte.${f(b.latMin)}&lat=lte.${f(b.latMax)}&lng=gte.${f(b.lngMin)}&lng=lte.${f(b.lngMax)}&lat=not.is.null&lng=not.is.null`;
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
