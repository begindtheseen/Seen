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

// ── Country codes (Lever states one beside a bare place) ─────────────────────────────────────────
import { countryIsUs, withCountry } from './usLocation.js';
test('withCountry: a non-US code names the country so the scope is decisive; US adds nothing', () => {
  assert.equal(withCountry('La Roca del Valles, Barcelona', 'ES'), 'La Roca del Valles, Barcelona, Spain');
  assert.equal(locationScope(withCountry('La Roca del Valles, Barcelona', 'ES')), 'non_us');
  assert.equal(withCountry('Serravalle Scrivia, Piedmont', 'IT'), 'Serravalle Scrivia, Piedmont, Italy');
  assert.equal(locationScope('Serravalle Scrivia, Piedmont'), 'unplaced', 'the text alone cannot be judged');
  assert.equal(locationScope(withCountry('Serravalle Scrivia, Piedmont', 'IT')), 'non_us');
  assert.equal(withCountry('Austin, TX', 'US'), 'Austin, TX');
  assert.equal(withCountry('Barcelona, Spain', 'ES'), 'Barcelona, Spain', 'already named');
  assert.equal(withCountry('', 'DE'), 'Germany');
  assert.equal(withCountry('Remote', ''), 'Remote');
  assert.equal(withCountry('Somewhere', 'ZZ'), 'Somewhere', 'unknown code changes nothing');
  assert.equal(countryIsUs('US'), true);
  assert.equal(countryIsUs('es'), false);
  assert.equal(countryIsUs(''), null);
  assert.equal(countryIsUs('ZZ'), null);
});
