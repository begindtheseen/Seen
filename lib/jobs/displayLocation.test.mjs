// Run: node --test lib/jobs/displayLocation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayLocation, locationParts } from './displayLocation.js';

test('displayLocation: a board office list reads as one line (the round-3 strings, verbatim)', () => {
  // /saved and the card printed these raw (Dev, 2026-11-03).
  assert.equal(displayLocation('Bozeman, Montana, United States; Missoula, Montana, United States; Open to Remote'), 'Remote (US) · Bozeman, MT · Missoula, MT');
  assert.equal(displayLocation('Toronto Canada, San Francisco, Remote in US, Remote in Canada'), 'Remote (US) · San Francisco');
  assert.equal(displayLocation('Bozeman, Montana, United States; Missoula, Montana, United States'), 'Bozeman, MT · Missoula, MT');
  assert.equal(displayLocation('Austin, TX, United States | Denver, CO, United States | Seattle, WA, United States'), 'Austin, TX · Denver, CO · +1 more');
  assert.equal(displayLocation('New York, New York, United States; New York, New York, United States'), 'New York, NY', 'the same office twice is one place');
  // A long multi-office line: two named places, then the count.
  assert.equal(displayLocation('Atlanta, Georgia, United States; Boston, Massachusetts, United States; Charlotte, North Carolina, United States; Dallas, Texas, United States; Phoenix, Arizona, United States'), 'Atlanta, GA · Boston, MA · +3 more');
  // Remote with no US word and no US place named stays plain "Remote".
  assert.equal(displayLocation('London, United Kingdom; Remote'), 'Remote');
  assert.equal(displayLocation('Boston, Massachusetts, United States; Las Vegas, Nevada, United States; Pittsburgh, Pennsylvania, United States; Remote U.S.'), 'Remote (US) · Boston, MA · Las Vegas, NV · +1 more');
});

test('displayLocation: one place stays itself, minus the country, state as its code', () => {
  assert.equal(displayLocation('Phoenix, AZ'), 'Phoenix, AZ');
  assert.equal(displayLocation('Phoenix, AZ, United States'), 'Phoenix, AZ');
  assert.equal(displayLocation('Phoenix, Arizona, United States'), 'Phoenix, AZ');
  assert.equal(displayLocation('San Francisco, CA, USA'), 'San Francisco, CA');
  assert.equal(displayLocation('Tempe, Maricopa County'), 'Tempe, Maricopa County');
  assert.equal(displayLocation('Remote - US'), 'Remote - US', 'a single remote line is printed as written');
  assert.equal(displayLocation('Remote, Phoenix, AZ'), 'Remote (US) · Phoenix, AZ', 'a bare state glues back onto its city');
  assert.equal(displayLocation('United States'), 'United States', 'the country alone is the place');
  assert.equal(displayLocation(''), '');
  assert.equal(displayLocation(null), '');
});

test('locationParts: split on ; | and spaced slashes — a city/state comma is not a separator', () => {
  assert.deepEqual(locationParts('Bozeman, Montana, United States; Open to Remote'), ['Bozeman, MT', 'Open to Remote']);
  assert.deepEqual(locationParts('Dallas/Fort Worth, TX'), ['Dallas/Fort Worth, TX']);
  assert.deepEqual(locationParts('Phoenix, AZ'), ['Phoenix, AZ'], 'one comma, no remote word → one part');
  assert.deepEqual(locationParts('Toronto Canada, San Francisco, Remote in US, Remote in Canada'), ['Toronto Canada', 'San Francisco', 'Remote in US', 'Remote in Canada']);
});
