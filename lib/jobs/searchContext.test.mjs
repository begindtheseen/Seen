// What a search says about itself (lib/jobs/searchContext.js): the family titles it also showed, the stated pay on
// its matches, and where the matches are when the radius is thin. Every figure from the rows handed in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alsoSearched, paySummary, statedPayOf, elsewhereClusters, PAY_MIN_ROWS } from './searchContext.js';
import { geocodePlace, distanceMiles } from '../geo/usPlaces.js';
import { matchesFilters } from './jobFilters.js';
import { searchQueryString, readSearchQuery } from './searchUrl.js';

const row = (title, extra = {}) => ({ title, related: true, in_radius: true, ...extra });

// ── also_searched ───────────────────────────────────────────────────────────────────────────────────────────────
test('alsoSearched: the family titles shown matches carry, most-shown first, never the typed words', () => {
  const rows = [row('Roustabout'), row('Roustabout II'), row('Floorhand - Oklahoma'), row('Floor Hand'), row('Floorhand'), row('Casing Floorhand'), row('Derrickhand'), row('Rig Hand - Workover')];
  const also = alsoSearched(rows, 'roustabout');
  assert.equal(also[0], 'Floorhand'); // "Floor Hand" / "Casing Floorhand" fold into it
  assert.ok(also.includes('Derrickhand') && also.includes('Rig Hand'));
  assert.ok(!also.some((t) => /roustabout/i.test(t)));
  assert.ok(also.length <= 4);
});

test('alsoSearched: only real expansions — a query with no family, rows found by the query itself, other openings', () => {
  assert.deepEqual(alsoSearched([row('Software Engineer'), row('Backend Engineer')], 'software engineer'), []); // no family
  assert.deepEqual(alsoSearched([row('Roustabout'), row('Roustabout Hand')], 'roustabout'), []); // the query's own word
  assert.deepEqual(alsoSearched([row('Floorhand', { related: false })], 'roustabout'), []); // an "other opening"
  // a title made of the query's own words is never an "also" ("warehouse" for "warehouse associate")
  const wa = alsoSearched([row('Warehouse Worker'), row('Material Handler'), row('Warehouse Associate')], 'warehouse associate');
  assert.deepEqual([...wa].sort(), ['Material Handler', 'Warehouse Worker']);
});

test('alsoSearched: acronyms stay upper case', () => {
  assert.deepEqual(alsoSearched([row('CNA - Nights'), row('Patient Care Technician')], 'nursing assistant'), ['CNA', 'Patient Care Technician']);
});

// ── pay_summary ─────────────────────────────────────────────────────────────────────────────────────────────────
const hr = (lo, hi) => row('Floorhand', { salary: hi ? `$${lo}–$${hi}/hr` : `$${lo}/hr` });
const yr = (a, b) => row('Driver', { salary: `$${a}k–$${b}k/yr` });

test('paySummary: 10th–90th percentile of stated hourly pay; one outlier never sets the range', () => {
  const rows = [hr(20, 24), hr(21, 25), hr(22, 26), hr(22, 28), hr(23, 29), hr(24, 30), hr(25, 31), hr(26, 33), hr(27, 35), hr(150), row('Floorhand'), row('Floorhand')];
  const p = paySummary(rows);
  assert.equal(p.stated, 10);
  assert.equal(p.total, 12);
  assert.equal(p.unit, 'hr');
  assert.equal(p.low, 20);
  assert.equal(p.high, 35); // the $150/hr row is above the 90th percentile
  assert.equal(p.text, '$20–$35/hr');
});

test('paySummary: yearly pay rounds to the thousand; fewer than 5 stating rows, or mixed units → nothing', () => {
  const y = paySummary([yr(55, 60), yr(58, 65), yr(60, 70), yr(62, 72), yr(65, 80)]);
  assert.equal(y.unit, 'yr'); assert.equal(y.text, '$55k–$80k/yr');
  assert.equal(paySummary([hr(20), hr(21), hr(22), hr(23)]), null); // 4 < PAY_MIN_ROWS
  assert.equal(PAY_MIN_ROWS, 5);
  // 5 hourly + 3 yearly: no unit holds 80% → not summed into one range
  assert.equal(paySummary([hr(20), hr(21), hr(22), hr(23), hr(24), yr(40, 45), yr(41, 46), yr(42, 47)]), null);
  // 9 hourly + 1 yearly: hourly holds 90% → summarised, the yearly one counted apart
  const m = paySummary([hr(20), hr(21), hr(22), hr(23), hr(24), hr(25), hr(26), hr(27), hr(28), yr(40, 45)]);
  assert.equal(m.unit, 'hr'); assert.equal(m.stated, 9); assert.equal(m.other, 1);
});

test('paySummary: only shown matches inside the area; free text and sub-wage lines state no pay', () => {
  const rows = [hr(20), hr(21), hr(22), hr(23), hr(24), { ...hr(99), related: false }, { ...hr(98), in_radius: false }];
  assert.equal(paySummary(rows).stated, 5);
  assert.equal(statedPayOf({ salary: 'Competitive' }), null);
  assert.equal(statedPayOf({ salary: '$2/hr' }), null);
  assert.deepEqual(statedPayOf({ salary: null, title: 'Floorhand', description: 'Pay: $22 - $28 per hour' }), { lo: 22, hi: 28, period: 'hour' });
});

// ── elsewhere ───────────────────────────────────────────────────────────────────────────────────────────────────
test('elsewhereClusters: rows grouped to the big place near them, neighbours merged, biggest first', () => {
  const at = (loc, n) => Array.from({ length: n }, (_, i) => ({ id: `${loc}-${i}`, title: 'Floorhand', location: loc }));
  const rows = [...at('Midland, TX', 6), ...at('Odessa, TX', 4), ...at('Williston, ND', 3), ...at('Watford City, ND', 2), ...at('Oklahoma City, OK', 1), ...at('Remote', 5), ...at('Boise, ID', 2)];
  const boise = geocodePlace('Boise, ID');
  const out = elsewhereClusters(rows, { center: boise, skip: (r) => /Boise/.test(r.location) });
  assert.deepEqual(out.map((c) => [c.place, c.count]), [['Midland, TX', 10], ['Williston, ND', 5], ['Oklahoma City, OK', 1]]);
  assert.ok(out[0].miles > 900);
  assert.ok(distanceMiles(geocodePlace('Watford City, ND'), geocodePlace('Williston, ND')) < 60);
});

test('elsewhereClusters: rows with coordinates only, and the everyday name of a big city', () => {
  const nash = geocodePlace('Nashville, TN');
  const out = elsewhereClusters([{ title: 'x', location: '', lat: nash.lat + 0.05, lng: nash.lng }, { title: 'x', location: 'Nashville, TN' }]);
  assert.deepEqual(out.map((c) => [c.place, c.count]), [['Nashville, TN', 2]]); // never the Census "Nashville-Davidson"
  assert.deepEqual(elsewhereClusters([{ title: 'x', location: 'Remote' }, { title: 'x', location: 'Texas' }]), []);
});

// ── the paid-training filter ────────────────────────────────────────────────────────────────────────────────────
test('the paid-training filter keeps only rows that train beginners, and rides in a titled search URL', () => {
  assert.equal(matchesFilters({ trains_beginners: true }, { training: true }), true);
  assert.equal(matchesFilters({ trains_beginners: false }, { training: true }), false);
  assert.equal(matchesFilters({}, { training: true }), false);
  assert.equal(matchesFilters({ trains_beginners: false }, {}), true);
  const qs = searchQueryString({ q: 'roustabout', loc: 'Midland, TX', training: true });
  assert.match(qs, /training=1/);
  assert.equal(readSearchQuery(qs).training, true);
  // an area search (no title) cannot apply it: never written, never read
  assert.doesNotMatch(searchQueryString({ loc: 'Midland, TX', training: true }), /training/);
  assert.equal(readSearchQuery('loc=Midland&training=1').training, false);
});
