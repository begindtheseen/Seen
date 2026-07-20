import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCompanyName, coreTokens, companyMatchConfidence, bestCompanyMatch,
  companyIndexKey, buildCompanyIndex, matchViaIndex,
} from './companyEntityMatch.js';

test('normalize strips CIK/ticker parentheticals, punctuation, and legal noise', () => {
  assert.equal(normalizeCompanyName('Pandora Media, Inc.  (CIK 0001230276)'), 'pandora media inc');
  assert.equal(normalizeCompanyName('Howmet Aerospace Inc.  (HWM)  (CIK 0000004281)'), 'howmet aerospace inc');
  assert.equal(normalizeCompanyName('Amazon.com, Inc.'), 'amazon com inc');
  assert.equal(normalizeCompanyName('AT&T Inc.'), 'at and t inc');
});

test('coreTokens drops corporate-form words but keeps distinctive ones', () => {
  assert.deepEqual(coreTokens('Amazon.com, Inc.'), ['amazon']);
  assert.deepEqual(coreTokens('General Motors Company'), ['general', 'motors']);
  assert.deepEqual(coreTokens('The Home Depot, Inc.'), ['home', 'depot']);
  // entirely-generic name falls back to raw tokens (never the everything-matching empty set)
  assert.deepEqual(coreTokens('Holdings Inc'), ['holdings', 'inc']);
});

test('HIGH: same entity across legal-suffix / .com / punctuation differences', () => {
  assert.equal(companyMatchConfidence('Amazon.com, Inc.', 'Amazon'), 'high');
  assert.equal(companyMatchConfidence('Apple Inc.', 'Apple'), 'high');
  assert.equal(companyMatchConfidence('Wells Fargo & Company', 'Wells Fargo and Company'), 'high');
  assert.equal(companyMatchConfidence('The Home Depot, Inc.', 'Home Depot'), 'high');
  assert.equal(companyMatchConfidence('Pandora Media, Inc. (CIK 0001230276)', 'Pandora Media'), 'high');
});

test('NONE: near-miss different entities are NEVER matched (the defamation guard)', () => {
  // one distinctive token differs → different company
  assert.equal(companyMatchConfidence('Apple Inc.', 'Apple Bank'), 'none');
  assert.equal(companyMatchConfidence('United Airlines', 'United Health'), 'none');
  assert.equal(companyMatchConfidence('Delta Air Lines', 'Delta Dental'), 'none');
  // a generic prefix must not swallow a fuller name
  assert.equal(companyMatchConfidence('General', 'General Motors'), 'none');
  assert.equal(companyMatchConfidence('First National Bank', 'First National'), 'none');
  // extra distinctive descriptor on the formal name → conservative miss (safe)
  assert.equal(companyMatchConfidence('Meta Platforms, Inc.', 'Meta'), 'none');
});

test('empty / whitespace / all-punctuation names never match', () => {
  assert.equal(companyMatchConfidence('', 'Apple'), 'none');
  assert.equal(companyMatchConfidence('   ', 'Apple'), 'none');
  assert.equal(companyMatchConfidence('.,-', 'Apple'), 'none');
  assert.equal(companyMatchConfidence('Apple', ''), 'none');
});

test('bestCompanyMatch returns the high-confidence candidate or null, carrying its key', () => {
  const cands = [
    { name: 'Uber', key: 'uber' },
    { name: 'Amazon', key: 'amazon' },
    { name: 'Apple Bank', key: 'apple-bank' },
  ];
  const m = bestCompanyMatch('Amazon.com, Inc.', cands);
  assert.deepEqual(m, { name: 'Amazon', key: 'amazon', confidence: 'high' });

  // "Apple Inc." must NOT match "Apple Bank" → no candidate → null
  assert.equal(bestCompanyMatch('Apple Inc.', cands), null);

  // plain-string candidates supported; key is null
  assert.deepEqual(bestCompanyMatch('Uber Technologies... ', ['Nope']), null);
  assert.deepEqual(bestCompanyMatch('Uber', ['Uber']), { name: 'Uber', key: null, confidence: 'high' });
});

test('token order does not matter', () => {
  assert.equal(companyMatchConfidence('Fargo Wells', 'Wells Fargo'), 'high');
});

test('index key is order-independent and suffix-insensitive', () => {
  assert.equal(companyIndexKey('Wells Fargo & Company'), companyIndexKey('Fargo Wells'));
  assert.equal(companyIndexKey('Amazon.com, Inc.'), companyIndexKey('Amazon'));
  assert.notEqual(companyIndexKey('Apple'), companyIndexKey('Apple Bank'));
});

test('matchViaIndex mirrors high-confidence matching, at O(1) per lookup', () => {
  const idx = buildCompanyIndex([
    { name: 'Amazon', key: 'amazon' },
    { name: 'Apple Bank', key: 'apple-bank' },
    'Wells Fargo & Company',
  ]);
  assert.deepEqual(matchViaIndex(idx, 'Amazon.com, Inc.'), { name: 'Amazon', key: 'amazon', confidence: 'high' });
  // formal SEC name for Wells Fargo (string candidate → key null)
  assert.deepEqual(matchViaIndex(idx, 'WELLS FARGO & CO'), { name: 'Wells Fargo & Company', key: null, confidence: 'high' });
  // Apple Inc. must NOT resolve to Apple Bank
  assert.equal(matchViaIndex(idx, 'Apple Inc.'), null);
  // unknown company
  assert.equal(matchViaIndex(idx, 'Coursera, Inc.'), null);
});

test('buildCompanyIndex: first writer wins, blank names skipped', () => {
  const idx = buildCompanyIndex([{ name: 'Uber', key: 'a' }, { name: 'Uber Inc', key: 'b' }, '', null]);
  assert.equal(matchViaIndex(idx, 'Uber').key, 'a');
});
