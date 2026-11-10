// R4 / G3 item (a): years written as words are read as the same years requirement as figures (six wordings pinned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordYears, extractConstraints } from './postingSections.js';

const CASES = [
  ['Four or more years of accounting experience', 4, 'accounting'],
  ['Two-plus years of retail experience', 2, 'retail'],
  ['A minimum of three (3) years of experience in payroll', 3, 'payroll'],
  ["Five years' experience in customer service", 5, 'customer service'],
  ['Three years of experience as a line cook', 3, 'line cook'],
  ['Six or more years of nursing experience', 6, 'nursing'],
];

for (const [line, years, field] of CASES) {
  test(`years as words: "${line}"`, () => {
    const ys = extractConstraints(`Requirements\n- ${line}`).filter((c) => c.kind === 'years');
    assert.equal(ys.length, 1, JSON.stringify(ys));
    assert.equal(ys[0].value, years);
    assert.equal(ys[0].field, field);
  });
}

test('wordYears: figures in, a parenthesised figure kept, linear on long input', () => {
  assert.equal(wordYears('Four or more years'), '4+ years');
  assert.equal(wordYears('Two-plus years'), '2+ years');
  assert.equal(wordYears('three (3) years'), 'three (3) years');
  assert.equal(wordYears("Five years' experience"), '5 years experience');
  const t0 = Date.now();
  wordYears('four or more '.repeat(5000)); wordYears('two - plus '.repeat(5000)); wordYears('years’ '.repeat(5000));
  assert.ok(Date.now() - t0 < 2000);
});
