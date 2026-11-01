// node --test lib/geo/usPlaces.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocodePlace, distanceMiles, withinMiles, placesWithin } from './usPlaces.js';

const place = (t) => { const g = geocodePlace(t); return g && `${g.name}, ${g.state}`; };

test('geocodePlace: the formats job listings and searches use', () => {
  assert.equal(place('Phoenix, AZ'), 'Phoenix, AZ');
  assert.equal(place('Phoenix, Arizona'), 'Phoenix, AZ');
  assert.equal(place('phoenix az'), 'Phoenix, AZ');
  assert.equal(place('Phoenix'), 'Phoenix, AZ'); // bare name → the most populous Phoenix
  assert.equal(place('Austin, TX 78701'), 'Austin, TX');
  assert.equal(place('New York, NY (Hybrid)'), 'New York, NY');
  assert.equal(place('Greater Seattle Area'), 'Seattle, WA');
  assert.equal(place('Hybrid remote in Phoenix, AZ'), 'Phoenix, AZ');
  assert.equal(place('Phoenix, AZ +2 locations'), 'Phoenix, AZ');
  assert.equal(place('Remote (Austin, TX)'), 'Austin, TX');
  assert.equal(place('Austin, Texas, United States'), 'Austin, TX');
  assert.equal(place('US-AZ-Phoenix'), 'Phoenix, AZ');
  assert.equal(place('Winston-Salem, NC'), 'Winston-Salem, NC');
  assert.equal(place('Old Sixth Ward, Houston'), 'Houston, TX');
  assert.equal(place('Tempe, Maricopa County'), 'Tempe, AZ');
  assert.equal(place('Indiana, PA'), 'Indiana, PA');
  assert.equal(place('Washington, DC'), 'Washington, DC');
  assert.equal(place('Washington, D.C.'), 'Washington, DC');
  assert.equal(place('St. Louis, MO'), 'St. Louis, MO');
  assert.equal(place('Saint Louis'), 'St. Louis, MO');
  assert.equal(place('Ft. Lauderdale'), 'Fort Lauderdale, FL');
  assert.equal(place('Nashville, TN'), 'Nashville, TN');
  assert.equal(place('Honolulu, HI'), 'Honolulu, HI');
  assert.equal(place('Brooklyn, NY'), 'Brooklyn, NY');
  assert.equal(place('Bay Area'), 'San Francisco, CA');
  assert.equal(place('Phoenix, AZ; Dallas, TX'), 'Phoenix, AZ');
  assert.equal(place('Kansas City'), 'Kansas City, MO');
  assert.equal(place('Portland'), 'Portland, OR');
});

test('geocodePlace: ZIP codes', () => {
  const z = geocodePlace('85004');
  assert.equal(z.state, 'AZ');
  assert.equal(z.name, 'Phoenix');
  assert.ok(distanceMiles(z, { lat: 33.4484, lng: -112.074 }) < 3);
  // A ZIP next to its city gives the finer point.
  const a = geocodePlace('Austin, TX 78701');
  assert.ok(distanceMiles(a, { lat: 30.2711, lng: -97.7437 }) < 2);
});

test('geocodePlace: remote / nowhere / foreign → null', () => {
  for (const t of ['Remote', 'Remote - US', 'United States', 'USA', 'Anywhere', 'Multiple Locations', '', '   ', null, undefined,
    'Paris, France', 'Toronto, ON', 'London, UK']) {
    assert.equal(geocodePlace(t), null, String(t));
  }
});

test('geocodePlace: a whole state → its center, flagged stateOnly', () => {
  const tx = geocodePlace('Texas');
  assert.equal(tx.state, 'TX');
  assert.equal(tx.name, null);
  assert.equal(tx.stateOnly, true);
  assert.ok(tx.lat > 25 && tx.lat < 37 && tx.lng < -93 && tx.lng > -107);
  assert.equal(geocodePlace('Arizona (Remote)').stateOnly, true);
  assert.equal(geocodePlace('Phoenix, TX').stateOnly, true); // no Phoenix in Texas → just the state
  assert.equal(geocodePlace('New York').stateOnly, undefined); // a lone "New York" is the city
});

test('distanceMiles: within 1% of known great-circle distances', () => {
  const JFK = { lat: 40.6413, lng: -73.7781 }, LAX = { lat: 33.9416, lng: -118.4085 };
  assert.ok(Math.abs(distanceMiles(JFK, LAX) - 2475) / 2475 < 0.01); // published JFK–LAX: 2,475 mi
  const a = { lat: 33.0, lng: -112.0 }, b = { lat: 34.0, lng: -112.0 };
  assert.ok(Math.abs(distanceMiles(a, b) - 69.09) / 69.09 < 0.01); // 1° of latitude
  assert.equal(distanceMiles(a, a), 0);
  assert.equal(distanceMiles(a, { lat: null, lng: 1 }), Infinity);
  assert.equal(distanceMiles(a, { lat: 0, lng: 0 }), Infinity); // (0,0) is the geocode-failure sentinel
  const phx = geocodePlace('Phoenix, AZ'), tuc = geocodePlace('Tucson, AZ');
  assert.ok(Math.abs(distanceMiles(phx, tuc) - 108) / 108 < 0.03); // downtown to downtown ≈ 108 mi
});

test('withinMiles: true / false / null', () => {
  assert.equal(withinMiles('Tempe, AZ', 'Phoenix, AZ', 25), true);
  assert.equal(withinMiles('Tucson, AZ', 'Phoenix, AZ', 25), false);
  assert.equal(withinMiles('Tucson, AZ', 'Phoenix, AZ', 150), true);
  assert.equal(withinMiles({ lat: 33.42, lng: -111.94 }, { lat: 33.45, lng: -112.07 }, 10), true);
  assert.equal(withinMiles({ lat: 33.42, lng: -111.94 }, 'Phoenix, AZ', 10), true);
  // A row: its own coordinates first, its text when it has none.
  assert.equal(withinMiles({ lat: null, lng: null, location: 'Mesa, AZ' }, 'Phoenix, AZ', 25), true);
  assert.equal(withinMiles({ lat: 32.22, lng: -110.97, location: 'Phoenix, AZ' }, 'Phoenix, AZ', 25), false);
  assert.equal(withinMiles('Remote', 'Phoenix, AZ', 25), null);
  assert.equal(withinMiles('Arizona', 'Phoenix, AZ', 25), null); // a whole state is never "within" a city radius
  assert.equal(withinMiles('Phoenix, AZ', 'Texas', 500), null);
  assert.equal(withinMiles({ lat: 0, lng: 0 }, 'Phoenix, AZ', 25), null);
  assert.equal(withinMiles('Tempe, AZ', 'Phoenix, AZ', NaN), null);
});

test('placesWithin: the biggest places inside the radius', () => {
  const near = placesWithin(geocodePlace('Phoenix, AZ'), 25, { limit: 10 });
  const names = near.map((p) => p.name);
  assert.equal(names[0], 'Phoenix');
  for (const n of ['Mesa', 'Chandler', 'Tempe', 'Scottsdale']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('Tucson'));
  assert.ok(near.every((p) => p.miles <= 25));
  assert.deepEqual(placesWithin({ lat: null, lng: null }, 25), []);
});
