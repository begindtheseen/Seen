// The honest one-line note under a place search — ONE place for the words and the comparison, so the
// jobs hook says the same thing on every path: a fresh answer, a search restored from this tab's cache,
// and the silent top-up refresh that lands a few seconds later (round 3, 2026-11-03: the note was set from
// the fresh answer only, so a cached 25 → 50 mi change said nothing, and a refresh replaced the rows under
// it). Pure; tests in lib/jobs/radiusNotice.test.mjs.

/** The ids of the rows a person compares between two results — the leading dozen. */
export function leadIds(jobs, n = 12) {
  return (Array.isArray(jobs) ? jobs : []).slice(0, n).map((j) => String(j && j.id)).join(',');
}

/**
 * What to say under a place search.
 * @param {object} a
 * @param {string} a.q the title searched
 * @param {string} a.loc the place searched ('' or 'remote' → never a note)
 * @param {string} a.radius the radius searched, as the select holds it ('25'); '0' = remote
 * @param {number} a.total rows on the page
 * @param {number|null} a.inRadius how many of them the server counted inside the radius (null = unknown)
 * @param {string|null} [a.fallback] the server's fallback label ('unrelated' / 'remote_thin' carry their own label)
 * @param {{ key: string, radius: string, ids: string }|null} [a.prev] the last result SHOWN for this title + place
 * @param {string} [a.ids] leadIds of this result
 * @returns {string|null}
 */
export function radiusNotice({ q, loc, radius, total, inRadius, fallback = null, prev = null, ids = '' }) {
  const place = String(loc || '').trim();
  if (!place || place.toLowerCase() === 'remote' || String(radius) === '0' || !total) return null;
  if (fallback === 'unrelated' || fallback === 'remote_thin') return null;
  if (typeof inRadius === 'number' && inRadius < total) {
    return inRadius === 0
      ? `No ${q} jobs within ${radius} mi of ${place} — showing the nearest and remote ones`
      : `Only ${inRadius} within ${radius} mi of ${place} — the rest are further away or remote`;
  }
  // A radius change that brought back the very same rows must say so (25 → 50 mi in Austin looked
  // ignored — it was not, there was nothing more to find).
  if (prev && prev.key === `${q}|${place}` && prev.radius !== String(radius) && prev.ids && prev.ids === ids) {
    const a = parseInt(prev.radius, 10), b = parseInt(radius, 10);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return `Same listings lead at ${radius} mi as at ${prev.radius} mi — nothing closer turned up between ${Math.min(a, b)} and ${Math.max(a, b)} miles of ${place}.`;
    }
  }
  return null;
}
