// Unit tests for the merge-integrity range guards. These are the DB-facing writers'
// last line of defense against out-of-range rates/scores persisting (the "3400% ghost
// rate" class of bug). Kept pure so they can be asserted directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampRate, clampScore, normalizeCompany } from './reportWrite.js';

test('clampRate keeps in-range fractions untouched', () => {
  assert.equal(clampRate(0), 0);
  assert.equal(clampRate(0.34), 0.34);
  assert.equal(clampRate(1), 1);
});

test('clampRate clamps out-of-range values into [0,1]', () => {
  assert.equal(clampRate(34), 1);      // the classic "34.0 not 0.34" bug → clamps to 1, never 3400%
  assert.equal(clampRate(1.5), 1);
  assert.equal(clampRate(-0.2), 0);
});

test('clampRate passes null/undefined through as null', () => {
  assert.equal(clampRate(null), null);
  assert.equal(clampRate(undefined), null);
});

test('clampScore keeps in-range scores and clamps to [0,100]', () => {
  assert.equal(clampScore(50), 50);
  assert.equal(clampScore(0), 0);
  assert.equal(clampScore(100), 100);
  assert.equal(clampScore(3400), 100);
  assert.equal(clampScore(-5), 0);
  assert.equal(clampScore(null), null);
});

test('normalizeCompany strips legal suffixes + lowercases (merge dedup key)', () => {
  assert.equal(normalizeCompany('Acme Inc.'), 'acme');
  assert.equal(normalizeCompany('  ACME  '), 'acme');
  assert.equal(normalizeCompany('Acme Solutions'), 'acme');
  assert.equal(normalizeCompany(''), '');
  assert.equal(normalizeCompany(null), '');
});
