// The distance a job card shows in an area search — honest about how the listing was placed (lib/geo/radius.js):
//   placed by its own coordinates  → "4 mi" ("under 1 mi" when closer)
//   placed by the town its text names → "in Tempe" — and, when that is another town, "in Tempe · about 10 mi"
//     (a town-centre-to-town-centre figure, never "0 mi" for a listing that only says "Phoenix")
//   placed at a county's principal city → "in Los Angeles County"
//   unknown → '' (nothing shown)
// Pure; tests in lib/jobs/distanceLabel.test.mjs.

const city = (place) => String(place || '').split(',')[0].trim();

/**
 * @param {{ distance_miles?: number|null, distance_by?: string|null, near_place?: string|null }} job
 * @returns {string}
 */
export function distanceLabel(job) {
  const d = typeof job?.distance_miles === 'number' && Number.isFinite(job.distance_miles) ? job.distance_miles : null;
  const by = job?.distance_by || null;
  const place = city(job?.near_place);
  if (by === 'coords' && d != null) return d < 1 ? 'under 1 mi' : `${Math.round(d)} mi`;
  if (by === 'county' && place) return `in ${place}`;
  if (by === 'text' && place) return d != null && d >= 1 ? `in ${place} · about ${Math.round(d)} mi` : `in ${place}`;
  return '';
}
