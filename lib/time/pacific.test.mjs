// Run: node --test lib/time/pacific.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pacificDate, pacificMidnight, pacificDayStart, pacificWeekStart, formatPacific, pacificHour, pacificDayOfYear, pacificDaysBetween } from './pacific.js';

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

test('pacificDaysBetween counts California calendar days, not 24-hour periods', () => {
  // Applied 2026-10-23 23:30 PT (06:30 UTC on the 24th); checked 2026-10-24 09:00 PT = 9.5 h later → Day 1.
  const applied = Date.parse('2026-10-24T06:30:00Z');
  assert.equal(pacificDaysBetween(applied, Date.parse('2026-10-24T16:00:00Z')), 1);
  assert.equal(Math.floor((Date.parse('2026-10-24T16:00:00Z') - applied) / 86400000), 0, 'the old arithmetic said Day 0');
  // Same PT day (23:30 → 23:59 PT) is Day 0 even though UTC has rolled over.
  assert.equal(pacificDaysBetween(applied, Date.parse('2026-10-24T06:59:00Z')), 0);
  // Across the DST end (Nov 1 2026): Oct 25 noon PT → Nov 8 noon PT is 14 calendar days.
  assert.equal(pacificDaysBetween(Date.parse('2026-10-25T19:00:00Z'), Date.parse('2026-11-08T20:00:00Z')), 14);
  // Earlier `to` is negative; a Date or a number both work.
  assert.equal(pacificDaysBetween(new Date('2026-10-30T19:00:00Z'), new Date('2026-10-23T19:00:00Z')), -7);
});
