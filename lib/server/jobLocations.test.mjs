// "Where <company> is hiring" aggregation (lib/jobLocations.ts) over current job-listing locations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateJobLocations, normalizePlace } from '../jobLocations.ts';

test('normalizePlace cleans zips, countries, hybrid prefixes, and casing', () => {
  assert.equal(normalizePlace('Austin, TX 78701'), 'Austin, TX');
  assert.equal(normalizePlace('Austin, TX, United States'), 'Austin, TX');
  assert.equal(normalizePlace('austin, tx'), 'Austin, TX');
  assert.equal(normalizePlace('NEW YORK, NY'), 'New York, NY');
  assert.equal(normalizePlace('Hybrid - Dallas, TX'), 'Dallas, TX');
  assert.equal(normalizePlace('McLean, VA'), 'McLean, VA');
  assert.equal(normalizePlace('Portland, OR'), 'Portland, OR');
  assert.equal(normalizePlace('USA'), 'United States');
  assert.equal(normalizePlace('United States'), 'United States');
  assert.equal(normalizePlace('N/A'), null);
  assert.equal(normalizePlace('  '), null);
});

test('aggregateJobLocations counts per place + a Remote bucket, top N, honest totals', () => {
  const jobs = [
    { location: 'Austin, TX' }, { location: 'Austin, TX 78701' }, { location: 'austin, tx' },
    { location: 'Remote' }, { location: 'Remote - US' }, { location: 'Work from home' },
    { location: 'Dallas, TX; Austin, TX' },
    { location: 'Chicago, IL' },
    { location: '' }, { location: null }, {},
  ];
  const s = aggregateJobLocations(jobs, { top: 2 });
  assert.equal(s.listings, 11);
  assert.equal(s.withLocation, 8);
  assert.equal(s.remote, 3);
  assert.deepEqual(s.places, [{ label: 'Austin, TX', count: 4 }, { label: 'Chicago, IL', count: 1 }]);
  assert.equal(s.otherPlaces, 1); // Dallas, TX cut by top=2
});

test('aggregateJobLocations: a listing naming one place twice counts once; empty input is safe', () => {
  assert.deepEqual(aggregateJobLocations([{ location: 'Austin, TX | Austin, TX 78701' }]).places, [{ label: 'Austin, TX', count: 1 }]);
  const e = aggregateJobLocations(null);
  assert.deepEqual(e, { listings: 0, withLocation: 0, remote: 0, places: [], otherPlaces: 0 });
});
