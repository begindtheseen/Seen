import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickActiveSponsor } from './sponsorSlot.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const inDays = (n) => new Date(NOW + n * DAY).toISOString();

test('null when no active sponsor', () => {
  assert.equal(pickActiveSponsor(null, NOW), null);
  assert.equal(pickActiveSponsor([{ company: 'Acme' }], NOW), null); // no sponsor_until
  assert.equal(pickActiveSponsor([{ company: 'Acme', sponsor_until: inDays(-1) }], NOW), null); // expired
});

test('picks the active sponsor with the longest remaining commitment', () => {
  const perks = [
    { company: 'ShortSponsor', sponsor_until: inDays(3) },
    { company: 'LongSponsor', sponsor_until: inDays(40) },
    { company: 'Expired', sponsor_until: inDays(-5) },
  ];
  const s = pickActiveSponsor(perks, NOW);
  assert.equal(s.company, 'LongSponsor');
  assert.equal(s.until, inDays(40));
});
