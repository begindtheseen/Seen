// GET /api/places — place suggestions for every place field on the site (components/ui/LocationInput.tsx) and the
// one fixed format ("City, ST", a state's name, or "Remote") a field ends up holding.
//
//   GET /api/places?q=pho          → { q, suggestions: [{ label, kind, detail? }], resolved: { label, kind } | null }
//   GET /api/places?resolve=boise%20id → { resolved: { label: "Boise, ID", kind: "place" } | null }
//
// `kind` is 'place' | 'state' | 'zip' | 'remote'. `resolved` is what the whole text means when nothing is picked
// (null = keep the text as typed; rules in lib/geo/placeSuggest.js). Static data only — no database, no network, no
// rate limit: the index is built once per instance (at import) and every answer is cached at Vercel's edge for a day.

import { suggestPlaces, resolvePlace, warmPlaceIndex } from '../lib/geo/placeSuggest.js';

// Build the index (and the ZIP list) while the instance starts, not inside the first person's request.
try { warmPlaceIndex(); suggestPlaces('85004'); suggestPlaces('850'); } catch (e) { console.error(`[places] warm failed: ${e?.message || e}`); }

const MAX_LEN = 80;
const clean = (v) => String(Array.isArray(v) ? v[0] ?? '' : v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_LEN);

export default function handler(req, res) {
  if (req.method === 'OPTIONS') { res.setHeader('Allow', 'GET, HEAD, OPTIONS'); return res.status(204).end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const query = req.query || {};
  try {
    let body;
    if (query.resolve !== undefined) {
      body = { resolved: resolvePlace(clean(query.resolve)) };
    } else {
      const q = clean(query.q);
      body = { q, suggestions: suggestPlaces(q, 8), resolved: resolvePlace(q) };
    }
    // The same text always gets the same answer until the data is rebuilt: cache it at the edge.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json(body);
  } catch (e) {
    console.error(`[places] ${e?.message || e}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'unavailable' });
  }
}
