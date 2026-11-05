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

test('stripTitleLocation / collapseLocationVariants: one role posted once per city is one row (Speechify, round 3)', async () => {
  const { stripTitleLocation, collapseLocationVariants, roleKey } = await import('./groupListings.js');
  assert.equal(stripTitleLocation('Team Lead, Android Core Product - Cleveland, OH, USA'), 'Team Lead, Android Core Product');
  assert.equal(stripTitleLocation('Team Lead, Android Core Product – Atlanta, USA'), 'Team Lead, Android Core Product');
  assert.equal(stripTitleLocation('Tech Lead, Android Core Product - Phoenix, AZ, USA'), 'Tech Lead, Android Core Product');
  assert.equal(stripTitleLocation('Site Manager, DashMart - [Nashville, TN]'), 'Site Manager, DashMart');
  assert.equal(stripTitleLocation('Kitchen Manager, DashMart - [Charlotte, NC]'), 'Kitchen Manager, DashMart');
  assert.equal(stripTitleLocation('Specialty Sales Team Leader- (Tempe, AZ)'), 'Specialty Sales Team Leader');
  assert.equal(stripTitleLocation('Traveling Lead Maintenance Technician (75% Travel; EPA Certified) - Phoenix, AZ'), 'Traveling Lead Maintenance Technician (75% Travel; EPA Certified)');
  assert.equal(stripTitleLocation('Backend Engineer (Remote - US)'), 'Backend Engineer');
  // Not a place: a specialty after the dash, a parenthesised level, a plain title.
  assert.equal(stripTitleLocation('Senior Manager, DashMart Fulfillment Services - Strategy & Operations'), 'Senior Manager, DashMart Fulfillment Services - Strategy & Operations');
  assert.equal(stripTitleLocation('Pharmacy Technician (Part-time)'), 'Pharmacy Technician (Part-time)');
  assert.equal(stripTitleLocation('TAX MANAGER | Lead, Grow & Make an Impact!'), 'TAX MANAGER | Lead, Grow & Make an Impact!');
  assert.equal(stripTitleLocation('Cashier'), 'Cashier');

  const sp = (id, city) => ({ id, company: 'Speechify', title: `Team Lead, Android Core Product - ${city}`, location: 'Remote', score: 90 });
  const rows = [sp('a', 'Cleveland, OH, USA'), { id: 'x', company: 'Harbor', title: 'Team Lead, Legal Conflicts', location: 'Remote' }, sp('b', 'Atlanta, GA, USA'), sp('c', 'Boise, ID, USA'), { id: 'y', company: 'Speechify', title: 'Tech Lead, Android Core Product - Phoenix, AZ, USA', location: 'Remote' }];
  const out = collapseLocationVariants(rows);
  assert.deepEqual(out.map((j) => j.id), ['a', 'x', 'y'], 'the first copy stays in its place; a different role at the same company stays');
  assert.equal(out[0].also_in, 2);
  assert.equal(out[1].also_in, undefined);
  assert.equal(rows[0].also_in, undefined, 'the input is not mutated');
  assert.equal(roleKey(rows[0]), roleKey(rows[2]));
  // The page's card grouping uses the same key, so the variants are one card too.
  const g = groupListings(rows);
  assert.deepEqual(g.map((x) => x.lead.id), ['a', 'x', 'y']);
  assert.deepEqual(g[0].more.map((x) => x.id), ['b', 'c']);
});
