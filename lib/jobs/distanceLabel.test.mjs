// node --test lib/jobs/distanceLabel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceLabel } from './distanceLabel.js';

test('the card says how the listing was placed', () => {
  assert.equal(distanceLabel({ distance_miles: 4.2, distance_by: 'coords', near_place: 'Phoenix, AZ' }), '4 mi');
  assert.equal(distanceLabel({ distance_miles: 0.3, distance_by: 'coords', near_place: null }), 'under 1 mi');
  assert.equal(distanceLabel({ distance_miles: 0, distance_by: 'text', near_place: 'Phoenix, AZ' }), 'in Phoenix', 'never "0 mi" for a city-name listing');
  assert.equal(distanceLabel({ distance_miles: 9.8, distance_by: 'text', near_place: 'Tempe, AZ' }), 'in Tempe · about 10 mi');
  assert.equal(distanceLabel({ distance_miles: 0.3, distance_by: 'county', near_place: 'Los Angeles County, CA' }), 'in Los Angeles County');
  assert.equal(distanceLabel({ distance_miles: null, distance_by: 'name', near_place: null }), '');
  assert.equal(distanceLabel({}), '');
});
