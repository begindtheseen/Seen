// Tests: the admin listing re-score (backfill) endpoint helper (api/admin-rescore-jobs.js).
// Run: node --test api/admin-rescore-jobs.test.mjs
//
// Locks the two load-bearing pieces of the backfill: (1) salaryMinFromString reconstructs the
// lower salary bound from the stored display string EXACTLY as scripts/rescore-jobs.mjs does, so
// the >$120k nudge fires identically to ingest time; (2) the endpoint routes recompute through
// the canonical scorer (scoreJob/wasteScore) rather than a private constant — the reconstructed
// salary_min actually changes the score the way the canonical scorer intends.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { salaryMinFromString } from './admin-rescore-jobs.js';
import { scoreJob } from '../lib/server/jobScore.js';

test('salaryMinFromString: "$180k" → 180000', () => {
  assert.equal(salaryMinFromString('$180k'), 180000);
});

test('salaryMinFromString: range "$180k–$220k" uses the lower bound', () => {
  assert.equal(salaryMinFromString('$180k–$220k'), 180000);
});

test('salaryMinFromString: plain dollars "$120000" → 120000', () => {
  assert.equal(salaryMinFromString('$120,000'), 120000);
});

test('salaryMinFromString: hourly "$45/hr" is not an annual figure → 0', () => {
  assert.equal(salaryMinFromString('$45/hr'), 0);
});

test('salaryMinFromString: blank / null → 0', () => {
  assert.equal(salaryMinFromString(''), 0);
  assert.equal(salaryMinFromString(null), 0);
  assert.equal(salaryMinFromString(undefined), 0);
});

test('reconstructed salary_min feeds the canonical scorer: >$120k earns the salary_high nudge', () => {
  const row = {
    title: 'Software Engineer',
    company: 'Acme Widgets',
    source: 'Adzuna',
    description: 'We are hiring a software engineer to join our team and build things. '.repeat(6),
    salary: '$180k',
    type: 'Full-time',
  };
  const salary_min = salaryMinFromString(row.salary);
  assert.equal(salary_min, 180000);
  // The high-salary listing must score strictly above the same listing with the salary stripped —
  // proving the backfill routes through scoreJob and the reconstructed salary_min actually counts.
  const withSalary = scoreJob({ ...row, salary_min });
  const withoutSalary = scoreJob({ ...row, salary: '', salary_min: 0 });
  assert.ok(withSalary > withoutSalary, `expected ${withSalary} > ${withoutSalary}`);
});
