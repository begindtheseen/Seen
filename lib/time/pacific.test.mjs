// Run: node --test lib/time/pacific.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pacificDate, pacificMidnight, pacificDayStart, pacificWeekStart, formatPacific, pacificHour, pacificDayOfYear } from './pacific.js';

test('the Pacific day, not the server day', () => {
  // 2026-10-21 05:42 PT = 12:42 UTC; 2026-10-21 18:30 PT = 01:30 UTC on the 22nd.
  assert.equal(pacificDate(new Date('2026-10-21T12:42:00Z')), '2026-10-21');
  assert.equal(pacificDate(new Date('2026-10-22T01:30:00Z')), '2026-10-21');
  assert.equal(pacificDate(new Date('2026-10-21T06:59:59Z')), '2026-10-20');
  assert.equal(pacificHour(new Date('2026-10-21T12:42:00Z')), 5);
});
test('midnight PT is correct on both sides of daylight saving', () => {
  assert.equal(pacificMidnight('2026-10-21').toISOString(), '2026-10-21T07:00:00.000Z'); // PDT
  assert.equal(pacificMidnight('2026-12-01').toISOString(), '2026-12-01T08:00:00.000Z'); // PST
  assert.equal(pacificMidnight('2026-11-01').toISOString(), '2026-11-01T07:00:00.000Z'); // DST ends at 2 AM that day
  assert.equal(pacificMidnight('2026-03-08').toISOString(), '2026-03-08T08:00:00.000Z'); // DST starts at 2 AM that day
  assert.equal(pacificDayStart(new Date('2026-10-22T01:30:00Z')).toISOString(), '2026-10-21T07:00:00.000Z');
  assert.equal(pacificDayStart(new Date('2026-10-21T12:42:00Z'), -6).toISOString(), '2026-10-15T07:00:00.000Z');
  assert.equal(pacificWeekStart(new Date('2026-10-21T12:42:00Z')).toISOString(), '2026-10-19T07:00:00.000Z'); // Monday
});
test('display carries PT', () => {
  assert.equal(formatPacific('2026-10-21T12:42:00Z'), 'Oct 21, 2026, 5:42 AM PT');
  assert.equal(formatPacific('2026-10-21T12:42:00Z', { month: 'long', year: 'numeric' }), 'October 2026');
  assert.equal(pacificDayOfYear(new Date('2026-01-01T10:00:00Z')), 1);
});
