// Run: node --test lib/server/adzunaPay.test.mjs — Adzuna's salary ESTIMATES are not the employer's pay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adzunaPay } from './jobSources.js';
import { scoreFactors } from './jobScore.js';

test('a predicted salary is dropped; a real one is formatted; the scorer only credits real pay', () => {
  assert.deepEqual(adzunaPay({ salary_min: 36000, salary_max: 36000, salary_is_predicted: '1' }), { salary: null, salaryMin: 0, salaryMax: 0, predicted: true });
  assert.deepEqual(adzunaPay({ salary_min: 51000, salary_max: 70000, salary_is_predicted: '0' }), { salary: '$51k–$70k/yr', salaryMin: 51000, salaryMax: 70000, predicted: false });
  assert.equal(adzunaPay({}).salary, null);
  const est = adzunaPay({ salary_min: 36000, salary_max: 36000, salary_is_predicted: '1' });
  const f = scoreFactors({ source: 'Adzuna', title: 'Crew Member', salary: est.salary, salary_min: est.salaryMin, description: 'x'.repeat(300) });
  assert.ok(!f.factors.some((x) => x.signal === 'salary_disclosed'), 'an estimate earns no “compensation disclosed” points');
});
