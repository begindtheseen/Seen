import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketForTitle, normalizeCityLabel, computeCityDemand } from './demandFromCorpus.js';

const NOW = Date.parse('2026-07-22T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();
const job = (title, over = {}) => ({ title, level: 'Mid level', salary: null, created_at: daysAgo(10), last_seen_at: daysAgo(2), ...over });

test('bucketForTitle: specific wins over broad, unknown titles are null (never fabricated)', () => {
  assert.equal(bucketForTitle('Senior Software Engineer').title, 'Software Engineer');
  assert.equal(bucketForTitle('Customer Success Manager').title, 'Customer Service / Support'); // not Sales
  assert.equal(bucketForTitle('CDL Class A Truck Driver').title, 'Driver / Delivery');
  assert.equal(bucketForTitle('Registered Nurse (ICU)').title, 'Nursing');
  assert.equal(bucketForTitle('Warehouse Order Picker').title, 'Warehouse Associate');
  assert.equal(bucketForTitle('Chief Vibes Officer'), null);
  assert.equal(bucketForTitle(''), null);
});

test('normalizeCityLabel canonicalizes casing and state codes', () => {
  assert.equal(normalizeCityLabel('austin, tx'), 'Austin, TX');
  assert.equal(normalizeCityLabel('  SAN   FRANCISCO '), 'San Francisco');
  assert.equal(normalizeCityLabel('new york,ny'), 'New York, NY');
  assert.equal(normalizeCityLabel(''), '');
});

test('computeCityDemand: honest counts, bounded DI, majority level, note explains itself', () => {
  const jobs = [
    ...Array.from({ length: 10 }, () => job('Software Engineer', { level: 'Senior', salary: '$150k' })),
    ...Array.from({ length: 4 }, () => job('Registered Nurse')),
    job('Underwater Basket Weaver'), // unmatched — must not appear anywhere
  ];
  const { rows, totalListings } = computeCityDemand({ city: 'denver, co', jobs, nowMs: NOW });
  assert.equal(totalListings, 14);
  assert.equal(rows.length, 2);
  const swe = rows.find(r => r.role_title === 'Software Engineer');
  assert.equal(swe.city, 'Denver, CO');
  assert.equal(swe.count, 10);                       // count = real listings, nothing else
  assert.equal(swe.level, 'Senior');                 // majority level
  assert.ok(swe.di >= 30 && swe.di <= 95, `di ${swe.di} in bounds`);
  assert.match(swe.note, /^Computed from 10 live listings on Seen/);
  assert.equal(swe.data_version, 'corpus-v1');
  assert.equal(swe.bls_period, null);                // never dressed up as BLS
  assert.match(swe.src, /^Seen live listings · 14 tracked$/);
});

test('a single stray listing never becomes a "market" (min 2 per bucket)', () => {
  const { rows, totalListings } = computeCityDemand({ city: 'Boise, ID', jobs: [job('Electrician')], nowMs: NOW });
  assert.deepEqual(rows, []);
  assert.equal(totalListings, 0);
});

test('empty/missing inputs return empty, never throw', () => {
  assert.deepEqual(computeCityDemand({ city: '', jobs: [job('x')], nowMs: NOW }).rows, []);
  assert.deepEqual(computeCityDemand({ city: 'Denver', jobs: [], nowMs: NOW }).rows, []);
  assert.deepEqual(computeCityDemand({}).rows, []);
});

test('fresh, active markets rate hotter than stale ones', () => {
  const fresh = computeCityDemand({
    city: 'Austin, TX',
    jobs: Array.from({ length: 30 }, () => job('Software Engineer', { created_at: daysAgo(3), last_seen_at: daysAgo(1), salary: '$120k' })),
    nowMs: NOW,
  });
  const stale = computeCityDemand({
    city: 'Austin, TX',
    jobs: Array.from({ length: 30 }, () => job('Software Engineer', { created_at: daysAgo(90), last_seen_at: daysAgo(45) })),
    nowMs: NOW,
  });
  assert.equal(fresh.rows[0].urg, 'hot');
  assert.equal(stale.rows[0].urg, 'warm');
  assert.ok(fresh.rows[0].di > stale.rows[0].di, `fresh di ${fresh.rows[0].di} > stale di ${stale.rows[0].di}`);
  assert.ok(stale.rows[0].di >= 30, 'stale still bounded at floor');
});

test('caps at top 6 buckets by volume', () => {
  const titles = ['Software Engineer', 'Registered Nurse', 'Truck Driver', 'Warehouse Picker', 'Accountant', 'Electrician', 'Receptionist', 'Retail Cashier'];
  const jobs = titles.flatMap((t, i) => Array.from({ length: 8 - i >= 2 ? 8 - i : 2 }, () => job(t)));
  const { rows } = computeCityDemand({ city: 'Chicago, IL', jobs, nowMs: NOW });
  assert.ok(rows.length <= 6, `rows ${rows.length} capped at 6`);
  assert.equal(rows[0].count >= rows[rows.length - 1].count, true); // sorted by volume
});
