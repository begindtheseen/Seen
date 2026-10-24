// Run: node --test lib/jobs/searchUrl.test.mjs — a search survives a reload, a share and Back (audit H2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchQueryString, readSearchQuery, searchPath } from './searchUrl.js';

test('a committed search writes only what differs from the defaults', () => {
  assert.equal(searchPath({ q: 'cashier', loc: 'Phoenix, AZ', radius: '25', sort: 'best' }), '/jobs?q=cashier&loc=Phoenix%2C+AZ');
  assert.equal(searchQueryString({ q: 'customer service', loc: 'Tucson, AZ', radius: '50', sort: 'recent', type: 'Part-time', posted: '7', niche: 'retail', level: 'entry' }),
    'q=customer+service&loc=Tucson%2C+AZ&r=50&sort=recent&niche=retail&level=entry&type=Part-time&posted=7');
  assert.equal(searchPath({ q: 'nurse', radius: '0' }), '/jobs?q=nurse&r=0', 'Remote is kept');
  assert.equal(searchPath({ q: '  ' }), '/jobs', 'no query → no search in the URL');
});

test('reading it back restores every control; junk falls back to defaults', () => {
  assert.deepEqual(readSearchQuery('?q=cashier&loc=Phoenix%2C+AZ&r=50&sort=recent&type=Part-time&posted=1'),
    { q: 'cashier', loc: 'Phoenix, AZ', radius: '50', sort: 'recent', niche: '', level: '', type: 'Part-time', posted: '1' });
  assert.deepEqual(readSearchQuery('q=x&r=999&sort=evil&type=Contract&posted=2&niche=<b>'),
    { q: 'x', loc: '', radius: '25', sort: 'best', niche: '', level: '', type: '', posted: '' });
  assert.equal(readSearchQuery('').q, '');
  // round trip
  const s = { q: 'warehouse', loc: 'Mesa, AZ', radius: '10', sort: 'waste', niche: 'logistics', level: '', type: 'Full-time', posted: '30' };
  assert.deepEqual(readSearchQuery(searchQueryString(s)), s);
});
