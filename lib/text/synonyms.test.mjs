// Tests for lib/text/synonyms.js (distilled WordNet 3.1) and lib/text/morph.js. Precision pins: the
// look-alikes below must never match; the same-thing pairs must.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameWord, relateWords, synonymsOf, lemmaOf } from './synonyms.js';
import { stem, lemmaCandidates, inflectionCandidates, derivationCandidates } from './morph.js';

test('one word family by rule: present / presented / presenting / presentation', () => {
  for (const [a, b] of [['present', 'presented'], ['present', 'presenting'], ['present', 'presentation'], ['presented', 'presentation'],
    ['educate', 'education'], ['manage', 'management'], ['supervise', 'supervision'], ['teach', 'taught'], ['lead', 'led'],
    ['schedule', 'scheduled'], ['supply', 'supplies'], ['inspect', 'inspection']]) {
    assert.equal(relateWords(a, b).how === 'family' || relateWords(a, b).how === 'identical', true, `${a} / ${b}`);
  }
});

test('kept synonyms (first sense of both words)', () => {
  for (const [a, b, pos] of [['teach', 'instruct', 'v'], ['repair', 'fix', 'v'], ['build', 'construct', 'v'], ['help', 'assist', 'v'],
    ['buy', 'purchase', 'v'], ['salary', 'pay', 'n'], ['error', 'mistake', 'n'], ['attorney', 'lawyer', 'n']]) {
    assert.ok(sameWord(a, b, /** @type {any} */ (pos)), `${a} ≈ ${b}`);
  }
});

test('look-alikes never match (precision pins)', () => {
  for (const [a, b] of [['coach', 'manager'], ['partner', 'spouse'], ['manager', 'director'], ['lead', 'result'], ['cook', 'ready'],
    ['fix', 'secure'], ['drive', 'motor'], ['hire', 'charter'], ['sales', 'marketing'], ['safety', 'security'], ['nurse', 'doctor'],
    ['check', 'cheque'], ['stock', 'share'], ['board', 'plank'], ['coach', 'bus'], ['station', 'state'], ['department', 'depart'],
    ['number', 'numb'], ['counter', 'count'], ['signal', 'sign'], ['mission', 'miss'], ['question', 'quest'], ['corner', 'corn']]) {
    assert.equal(sameWord(a, b), false, `${a} must not match ${b}`);
  }
});

test('unknown words are only equal to themselves', () => {
  assert.equal(sameWord('haccp', 'haccp'), true);
  assert.equal(sameWord('haccp', 'sanitation'), false);
  assert.equal(lemmaOf('zzzqqq'), null);
  assert.deepEqual(synonymsOf('zzzqqq'), []);
});

test('synonymsOf: same part of speech, sorted, never the word itself', () => {
  const s = synonymsOf('repair', 'v');
  assert.ok(s.includes('fix'));
  assert.ok(!s.includes('repair'));
  assert.deepEqual(s, [...s].sort());
  assert.ok(synonymsOf('repaired', 'v').includes('fix'));   // lemmatised first
});

test('morphology rules', () => {
  assert.equal(stem('engineering'), stem('engineer'));
  assert.equal(stem('operations'), stem('operator'));
  assert.equal(stem('nursing'), stem('nurse'));
  assert.ok(inflectionCandidates('shipped').includes('ship'));
  assert.ok(inflectionCandidates('supplies').includes('supply'));
  assert.ok(inflectionCandidates('led').includes('lead'));
  assert.deepEqual(derivationCandidates('department'), []);
  assert.ok(derivationCandidates('verification').includes('verify'));
  assert.equal(lemmaCandidates('presentation')[0], 'presentation');
  assert.equal(lemmaCandidates('constructor').includes('constructor'), true);   // no prototype keys
});
