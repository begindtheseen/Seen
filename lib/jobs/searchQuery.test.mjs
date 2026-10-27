// What a person meant by the search box (audit 2026-10-27: "cashir", "nurce", "recepcionist", "electrition" found
// nothing; "work from home data entry" listed data engineers; "nurses" found 0 in Phoenix while "nurse" found 59).
// Run: node --test lib/jobs/searchQuery.test.mjs lib/jobs/searchModifiers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchQuery, correctWord, singularWord, wordCount } from './searchQuery.js';

test('a misspelt role word is fixed against the words listings use, and the fix is reported', () => {
  for (const [typed, role] of [['cashir', 'cashier'], ['nurce', 'nurse'], ['recepcionist', 'receptionist'], ['electrition', 'electrician'], ['warehous', 'warehouse'], ['phlebotimist', 'phlebotomist']]) {
    const p = parseSearchQuery(typed);
    assert.equal(p.role, role, typed);
    assert.deepEqual(p.corrections, [{ from: typed, to: role }]);
  }
});

test('real words, names and tech terms are never "corrected"', () => {
  for (const q of ['budtender', 'esthetician', 'sommelier', 'kubernetes', 'stripe', 'doordash', 'chick fil a', 'in-n-out', 'c++ developer', '.net developer', 'RN', 'HVAC technician']) {
    assert.deepEqual(parseSearchQuery(q).corrections, [], q);
  }
  assert.equal(correctWord('cashier'), null);
  assert.equal(correctWord('rn'), null, 'too short to guess');
  assert.equal(parseSearchQuery('cashir', { exact: true }).role, 'cashir', 'exact keeps the words as typed');
});

test('modifiers come off the role and become flags', () => {
  const cases = [
    ['part time cashier', 'cashier', { partTime: true }],
    ['night shift warehouse', 'warehouse', { night: true }],
    ['remote customer service', 'customer service', { remote: true }],
    ['work from home data entry', 'data entry', { remote: true }],
    ['entry level marketing', 'marketing', { entry: true }],
    ['barista no experience', 'barista', { entry: true }],
    ['sales associate full time', 'sales associate', { fullTime: true }],
    ['line cook hiring now', 'line cook', {}],
    ['cashier that pays 18 an hour', 'cashier', { payMin: 18 }],
  ];
  for (const [q, role, flags] of cases) {
    const p = parseSearchQuery(q);
    assert.equal(p.role, role, q);
    for (const [k, v] of Object.entries(flags)) assert.equal(p[k], v, `${q}: ${k}`);
    assert.equal(p.browse, false, q);
  }
  assert.equal(parseSearchQuery('overnight stocker').role, 'overnight stocker', '"overnight" in a title stays');
});

test('nothing but modifiers is a browse, not a title search for "part time"', () => {
  for (const [q, flag] of [['part time', 'partTime'], ['remote', 'remote'], ['entry level', 'entry'], ['weekend jobs', 'weekend']]) {
    const p = parseSearchQuery(q);
    assert.equal(p.browse, true, q);
    assert.equal(p.role, '', q);
    assert.equal(p[flag], true, q);
  }
  const pay = parseSearchQuery('jobs that pay 20 an hour');
  assert.equal(pay.browse, true);
  assert.equal(pay.payMin, 20);
  assert.equal(parseSearchQuery('jobs that pay $25/hr').payMin, 25);
});

test('a place after "in"/"near" moves to the location — only when the location box is empty', () => {
  assert.deepEqual([parseSearchQuery('nurse jobs in tucson').role, parseSearchQuery('nurse jobs in tucson').location], ['nurse', 'Tucson, AZ']);
  assert.equal(parseSearchQuery('cashier near phoenix').location, 'Phoenix, AZ');
  assert.equal(parseSearchQuery('teacher in arizona').location, 'Arizona');
  assert.equal(parseSearchQuery('nurse in tucson', { hasLocation: true }).location, null, 'the location box wins');
  assert.equal(parseSearchQuery('university of phoenix').role, 'university of phoenix', 'an employer name is not a place');
  assert.equal(parseSearchQuery('university of phoenix').location, null);
});

test('a plural role word searches its singular; a word whose plural is the common form stays', () => {
  assert.equal(parseSearchQuery('nurses').role, 'nurse');
  assert.equal(parseSearchQuery('drivers').role, 'driver');
  assert.equal(singularWord('cashiers'), 'cashier');
  for (const w of ['sales', 'operations', 'logistics', 'analytics', 'business']) assert.equal(singularWord(w), null, w);
  assert.ok(wordCount('nurse') > wordCount('nurses'));
});
