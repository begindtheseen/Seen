// Tests for radius/distance math + the DB bounding-box pre-filter.
// Run: node --test lib/server/geo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineMiles,
  milesToKm,
  hasUsableCoords,
  withinRadius,
  sanitizeCoords,
  boundingBox,
  geoBoxClause,
} from './geo.js';

// Real coordinates from the diagnosed bug. Tustin, CA (search center) vs a "Vista, San Diego
// County" listing that leaked into a 25-mile Tustin search. Vista's coords are exactly as they
// sit in prod; Tustin is the city center Nominatim resolves.
const TUSTIN = { lat: 33.7458, lng: -117.8265 };
const VISTA = { lat: 33.16, lng: -117.24 };

test('haversineMiles: identical points = 0, null → Infinity', () => {
  assert.equal(haversineMiles(TUSTIN, TUSTIN), 0);
  assert.equal(haversineMiles(TUSTIN, { lat: null, lng: -117 }), Infinity);
  assert.equal(haversineMiles(null, TUSTIN), Infinity);
});

test('haversineMiles: ~30 miles due north is ~30', () => {
  // 1° latitude ≈ 69.09 miles → 30 mi north is +0.4342°.
  const north = { lat: TUSTIN.lat + 30 / 69.093, lng: TUSTIN.lng };
  assert.ok(Math.abs(haversineMiles(TUSTIN, north) - 30) < 0.5);
});

test('milesToKm converts', () => {
  assert.ok(Math.abs(milesToKm(25) - 40.23) < 0.5);
});

// ── hasUsableCoords ───────────────────────────────────────────────────────────────────────
test('hasUsableCoords: real points usable; NULL and (0,0) are NOT', () => {
  assert.equal(hasUsableCoords({ lat: 33, lng: -117 }), true);
  assert.equal(hasUsableCoords({ lat: '33', lng: '-117' }), true); // string coords coerce
  assert.equal(hasUsableCoords({ lat: 0, lng: -117 }), true);      // equator is a real place
  assert.equal(hasUsableCoords({ lat: 33, lng: 0 }), true);        // prime meridian is real

  assert.equal(hasUsableCoords({ lat: 0, lng: 0 }), false);        // geocode-failure sentinel
  assert.equal(hasUsableCoords({ lat: null, lng: 5 }), false);
  assert.equal(hasUsableCoords({ lat: 5, lng: null }), false);
  assert.equal(hasUsableCoords({ lat: NaN, lng: 5 }), false);
  assert.equal(hasUsableCoords({}), false);
  assert.equal(hasUsableCoords(null), false);
  assert.equal(hasUsableCoords(undefined), false);
});

// ── withinRadius: THE bug + the required test cases ─────────────────────────────────────────
test('withinRadius: Vista is OUTSIDE 25mi of Tustin (the bug) but inside a wider radius', () => {
  const d = haversineMiles(TUSTIN, VISTA);
  // NOTE: the diagnosis called it "~48mi"; the true great-circle from Tustin city-center is
  // ~52.7mi. Either way it is far outside 25mi — which is exactly the leak that was shipping.
  assert.ok(d > 45 && d < 60, `expected ~52.7mi, got ${d.toFixed(2)}`);

  assert.equal(withinRadius(TUSTIN, VISTA, 25), false); // must be EXCLUDED at 25mi
  assert.equal(withinRadius(TUSTIN, VISTA, 60), true);  // included once the radius is wide enough
  // Pin the real boundary (~52.7mi).
  assert.equal(withinRadius(TUSTIN, VISTA, 52), false);
  assert.equal(withinRadius(TUSTIN, VISTA, 53), true);
});

test('withinRadius: exact 25-excluded / 50-included boundary (controlled 30mi pair)', () => {
  const center = { lat: 34.0, lng: -118.0 };
  const north30 = { lat: 34.0 + 30 / 69.093, lng: -118.0 }; // ~30mi due north
  assert.ok(Math.abs(haversineMiles(center, north30) - 30) < 0.5);
  assert.equal(withinRadius(center, north30, 25), false); // excluded at 25mi
  assert.equal(withinRadius(center, north30, 50), true);  // included at 50mi
});

test('withinRadius: NULL and (0,0) coords are never within radius (even a huge one)', () => {
  assert.equal(withinRadius(TUSTIN, { lat: null, lng: null }, 25), false);
  assert.equal(withinRadius(TUSTIN, { lat: null, lng: null }, 99999), false);
  assert.equal(withinRadius(TUSTIN, { lat: 0, lng: 0 }, 25), false);
  assert.equal(withinRadius(TUSTIN, { lat: 0, lng: 0 }, 99999), false);
  // Unusable CENTER (geocode failed) also yields false, never a match.
  assert.equal(withinRadius({ lat: 0, lng: 0 }, VISTA, 25), false);
  assert.equal(withinRadius(null, VISTA, 25), false);
});

test('withinRadius: negative / non-finite radius → false', () => {
  assert.equal(withinRadius(TUSTIN, TUSTIN, -1), false);
  assert.equal(withinRadius(TUSTIN, TUSTIN, NaN), false);
});

// ── sanitizeCoords (ingest guard) ───────────────────────────────────────────────────────────
test('sanitizeCoords: (0,0) and non-finite collapse to NULL; real coords pass through', () => {
  assert.deepEqual(sanitizeCoords(0, 0), { lat: null, lng: null });
  assert.deepEqual(sanitizeCoords(NaN, 5), { lat: null, lng: null });
  assert.deepEqual(sanitizeCoords(undefined, undefined), { lat: null, lng: null });
  assert.deepEqual(sanitizeCoords('', ''), { lat: null, lng: null });
  assert.deepEqual(sanitizeCoords(33.16, -117.24), { lat: 33.16, lng: -117.24 });
  assert.deepEqual(sanitizeCoords('33.16', '-117.24'), { lat: 33.16, lng: -117.24 }); // strings coerce
  // A single-axis zero is a REAL place (equator / prime meridian) — only BOTH-zero is the sentinel.
  assert.deepEqual(sanitizeCoords(0, -117.24), { lat: 0, lng: -117.24 });
  assert.deepEqual(sanitizeCoords(33.16, 0), { lat: 33.16, lng: 0 });
});

// ── boundingBox: strict superset of the circle (DB pre-filter correctness) ───────────────────
test('boundingBox: contains the full circle, brackets the center, excludes far points', () => {
  const center = { lat: 34.0, lng: -118.0 };
  const box = boundingBox(center, 25);
  // Brackets the center.
  assert.ok(box.latMin < center.lat && center.lat < box.latMax);
  assert.ok(box.lngMin < center.lng && center.lng < box.lngMax);
  // A point exactly 25mi due north/east (on the circle) is INSIDE the box (superset property).
  const north25 = { lat: center.lat + 25 / 69.093, lng: center.lng };
  const east25 = { lat: center.lat, lng: center.lng + 25 / (69.093 * Math.cos((34 * Math.PI) / 180)) };
  assert.ok(north25.lat <= box.latMax, 'circle top must be inside the box');
  assert.ok(east25.lng <= box.lngMax, 'circle right must be inside the box');
  // A point at 2× the radius (50mi north) is OUTSIDE the box.
  const north50 = { lat: center.lat + 50 / 69.093, lng: center.lng };
  assert.ok(north50.lat > box.latMax, '50mi north must be outside a 25mi box');
});

test('boundingBox: a US center never boxes in (0,0)', () => {
  const box = boundingBox(TUSTIN, 25);
  assert.ok(box.latMin > 1, 'latMin well above 0 → lat=0 excluded');
  assert.ok(box.lngMax < -100, 'lngMax well below 0 → lng=0 excluded');
});

test('boundingBox: null for unusable center / non-positive miles', () => {
  assert.equal(boundingBox(null, 25), null);
  assert.equal(boundingBox({ lat: 0, lng: 0 }, 25), null);
  assert.equal(boundingBox(TUSTIN, 0), null);
  assert.equal(boundingBox(TUSTIN, Infinity), null);
});

// ── geoBoxClause: the PostgREST fragment pushed to the DB ────────────────────────────────────
test('geoBoxClause: builds an indexed lat/lng range filter; empty without a center', () => {
  assert.equal(geoBoxClause(null, 25), '');
  assert.equal(geoBoxClause({ lat: 0, lng: 0 }, 25), '');

  const clause = geoBoxClause(TUSTIN, 25);
  for (const frag of ['lat=gte.', 'lat=lte.', 'lng=gte.', 'lng=lte.', 'lat=not.is.null', 'lng=not.is.null']) {
    assert.ok(clause.includes(frag), `missing ${frag}`);
  }
  // The emitted bounds must actually bracket the center.
  const box = boundingBox(TUSTIN, 25);
  assert.ok(clause.includes(`lat=gte.${box.latMin.toFixed(6)}`));
  assert.ok(clause.includes(`lng=lte.${box.lngMax.toFixed(6)}`));
});
