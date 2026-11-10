// node --test lib/jobs/distanceLabel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceLabel } from './distanceLabel.js';

test('the card says how the listing was placed', () => {
  assert.equal(distanceLabel({ distance_miles: 4.2, distance_by: 'coords', near_place: 'Phoenix, AZ' }), '4 mi');
  assert.equal(distanceLabel({ distance_miles: 0.3, distance_by: 'coords', near_place: null }), 'under 1 mi');
  assert.equal(distanceLabel({ location: 'Phoenix, AZ', distance_miles: 0, distance_by: 'text', near_place: 'Phoenix, AZ' }), '', 'never "0 mi", never a repeat of the location');
  assert.equal(distanceLabel({ location: 'US > Arizona > Phoenix', distance_miles: 0, distance_by: 'text', near_place: 'Phoenix, AZ' }), '');
  assert.equal(distanceLabel({ location: 'Tempe, AZ', distance_miles: 9.8, distance_by: 'text', near_place: 'Tempe, AZ' }), 'about 10 mi');
  assert.equal(distanceLabel({ location: 'Austin, TX; Tempe, AZ', distance_miles: 9.8, distance_by: 'text', near_place: 'Tempe, AZ' }), 'in Tempe · about 10 mi', 'multi-city: the city that counted');
  assert.equal(distanceLabel({ location: 'Phx Metro', distance_miles: 0, distance_by: 'text', near_place: 'Phoenix, AZ' }), 'in Phoenix');
  assert.equal(distanceLabel({ location: 'Pico Heights, Los Angeles County', distance_miles: 0.3, distance_by: 'county', near_place: 'Los Angeles County, CA' }), '');
  assert.equal(distanceLabel({ location: 'Palms', distance_miles: 0.3, distance_by: 'county', near_place: 'Los Angeles County, CA' }), 'in Los Angeles County');
  assert.equal(distanceLabel({ distance_miles: null, distance_by: 'name', near_place: null }), '');
  assert.equal(distanceLabel({}), '');
});
