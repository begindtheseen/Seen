// Run: node --test lib/jobs/groupListings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupListings } from './groupListings.js';

const row = (id, company, title, location) => ({ id, company, title, location });

test('groupListings: same employer + title → one card with the rest as more locations, order kept', () => {
  const rows = [
    row('1', 'plscareers', 'Customer Service Representative', '5828 W. Thomas Rd., Phoenix, AZ'),
    row('2', 'Walmart', 'Cosmetics Cashier', 'Glendale, AZ'),
    row('3', 'plscareers', 'Customer Service Representative', '5045 W Indian School Rd, Phoenix, AZ'),
    row('4', 'PLSCareers', 'Customer Service Representative', 'Mesa, AZ'),
    row('5', 'plscareers', 'Store Manager', 'Phoenix, AZ'),
    row('6', 'Walmart', 'Cosmetics Cashier', 'Mesa, AZ'),
  ];
  const g = groupListings(rows);
  assert.deepEqual(g.map((x) => x.lead.id), ['1', '2', '5']);
  assert.deepEqual(g[0].more.map((x) => x.id), ['3', '4'], 'case-insensitive on the company');
  assert.deepEqual(g[1].more.map((x) => x.id), ['6']);
  assert.deepEqual(g[2].more, []);
  // Every row is still accounted for — counts stay honest.
  assert.equal(g.reduce((n, x) => n + 1 + x.more.length, 0), rows.length);
  assert.deepEqual(groupListings([]), []);
  assert.deepEqual(groupListings(null), []);
});
