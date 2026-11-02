// Run: node --test lib/jobs/displayLocation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayLocation, locationParts } from './displayLocation.js';

test('displayLocation: a board office list reads as one place', () => {
  // the exact string the round-2 review saw on a Remote result
  assert.equal(displayLocation('Bozeman, Montana, United States; Missoula, Montana, United States; Open to Remote'), 'Remote');
  assert.equal(displayLocation('Bozeman, Montana, United States; Missoula, Montana, United States'), 'Bozeman, Montana · +1 more');
  assert.equal(displayLocation('Austin, TX, United States | Denver, CO, United States | Seattle, WA, United States'), 'Austin, TX · +2 more');
  assert.equal(displayLocation('New York, New York, United States; New York, New York, United States'), 'New York, New York', 'the same office twice is one place');
});

test('displayLocation: one place stays itself, minus the country', () => {
  assert.equal(displayLocation('Phoenix, AZ'), 'Phoenix, AZ');
  assert.equal(displayLocation('Phoenix, AZ, United States'), 'Phoenix, AZ');
  assert.equal(displayLocation('San Francisco, CA, USA'), 'San Francisco, CA');
  assert.equal(displayLocation('Remote - US'), 'Remote - US', 'a single remote line is printed as written');
  assert.equal(displayLocation('United States'), 'United States', 'the country alone is the place');
  assert.equal(displayLocation(''), '');
  assert.equal(displayLocation(null), '');
});

test('locationParts: split on ; | and spaced slashes only — a city/state comma is not a separator', () => {
  assert.deepEqual(locationParts('Bozeman, Montana, United States; Open to Remote'), ['Bozeman, Montana', 'Open to Remote']);
  assert.deepEqual(locationParts('Dallas/Fort Worth, TX'), ['Dallas/Fort Worth, TX']);
});
