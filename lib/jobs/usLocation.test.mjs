// Run: node --test lib/jobs/usLocation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationScope, inUsMarket } from './usLocation.js';

const cases = {
  us: ['San Francisco, CA', 'Austin, TX 78701', 'Remote - US', 'US (Remote)', 'Remote - United States', 'Springfield, IL',
    'Hybrid - Seattle', 'New York or London', 'Georgia', 'Atlanta', 'Washington, DC', 'United States of America', 'Remote, North America'],
  remote: ['Remote', 'Anywhere', 'Work from home'],
  unknown: ['', null, undefined, 'Multiple Locations', 'TBD'],
  non_us: ['Remote (EMEA)', 'London, UK', 'London', 'Bengaluru, IN', 'Toronto, ON', 'Toronto, Ontario, Canada', 'Latin America',
    'Remote, Canada', 'Berlin, Germany', 'Paris', 'Kraków', 'Bogotá', 'Ciudad de México', 'CDMX', 'Singapore', 'Remote - APAC'],
  unplaced: ['Puebla', 'Medellín', 'Practice Locations'],
};

for (const [scope, list] of Object.entries(cases)) {
  test(`${scope}: ${list.length} locations`, () => {
    for (const loc of list) assert.equal(locationScope(loc), scope, JSON.stringify(loc));
  });
}

test('inUsMarket keeps US, remote and unknown; drops foreign and unplaceable', () => {
  assert.equal(inUsMarket('Denver, CO'), true);
  assert.equal(inUsMarket('Remote'), true);
  assert.equal(inUsMarket(''), true);
  assert.equal(inUsMarket('London'), false);
  assert.equal(inUsMarket('Puebla'), false);
});

test('a two-letter code never outranks a named foreign place ("IN" is also India, "CA" also Canada)', () => {
  assert.equal(locationScope('Chennai, IN'), 'non_us');
  assert.equal(locationScope('Vancouver, BC, CA'), 'non_us');
  assert.equal(locationScope('Fresno, CA'), 'us');
});
