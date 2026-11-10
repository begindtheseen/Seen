// The distance a job card shows in an area search — honest about how the listing was placed (lib/geo/radius.js):
//   placed by its own coordinates  → "4 mi" ("under 1 mi" when closer)
//   placed by the town its text names → nothing more when the card's location already names it ("Phoenix, AZ"),
//     "about 10 mi" when that town is away from the searched place (town centre to town centre, never "0 mi"),
//     "in Tempe · about 10 mi" for a multi-city listing (the city that counted)
//   placed at a county's principal city → "in Los Angeles County" unless the location already says so
//   unknown → '' (nothing shown)
// Pure; tests in lib/jobs/distanceLabel.test.mjs.

const city = (place) => String(place || '').split(',')[0].trim();

/**
 * @param {{ location?: string, distance_miles?: number|null, distance_by?: string|null, near_place?: string|null }} job
 * @returns {string}
 */
export function distanceLabel(job) {
  const d = typeof job?.distance_miles === 'number' && Number.isFinite(job.distance_miles) ? job.distance_miles : null;
  const by = job?.distance_by || null;
  const place = city(job?.near_place);
  if (by === 'coords' && d != null) return d < 1 ? 'under 1 mi' : `${Math.round(d)} mi`;
  if (!place || (by !== 'county' && by !== 'text')) return '';
  const loc = String(job?.location || '');
  const multi = /;|\||•| or /i.test(loc);
  // The card already shows the location: don't repeat "in Phoenix" under "Phoenix, AZ" (a multi-city row still
  // names the city that counted).
  const named = !multi && loc.toLowerCase().includes(place.toLowerCase());
  const far = by === 'text' && d != null && d >= 1 ? `about ${Math.round(d)} mi` : '';
  if (named) return far;
  return far ? `in ${place} · ${far}` : `in ${place}`;
}
