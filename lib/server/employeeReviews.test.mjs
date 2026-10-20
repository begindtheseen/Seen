// Employee reviews move the grade by their letter grades — never as hiring outcomes.
// Run: node --test lib/server/employeeReviews.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { employeeReviewGrade, employeeReviewSignal, isEmployeeReview, EMPLOYEE_REVIEWS_FILTER } from './employeeReviews.js';
import { employeeReviewAdjustment, EMPLOYEE_REVIEW_POINTS_MAX } from '../../api/_utils/companyScore.js';
import { fuseCompanyIntel } from '../../api/_utils/companyIntel.js';

const rev = (g, o = {}) => ({ trust_reason: 'external_employee_review', needs_review: false, outcome: 'human', report_text: `Title [${g}]. Reviewer … Source: Indeed employee review`, ...o });

test('grade parsing: the bracketed letter grade, on a 4-point scale', () => {
  assert.equal(employeeReviewGrade('Cut throat [D]. Reviewer reports…'), 1);
  assert.equal(employeeReviewGrade('Good [A-]. …'), 3.7);
  assert.equal(employeeReviewGrade('Meh [C]'), 2);
  assert.equal(employeeReviewGrade('Awful [F]'), 0);
  assert.equal(employeeReviewGrade('no grade here'), null);
  assert.equal(employeeReviewGrade('[E]'), null);
});

test('which rows are employee reviews: approved, or still held from an import — never rejected or duplicate copies', () => {
  assert.equal(isEmployeeReview(rev('A')), true);
  assert.equal(isEmployeeReview({ trust_reason: 'external_import', needs_review: true, report_text: 'x. Source: Indeed employee review' }), true);
  assert.equal(isEmployeeReview({ trust_reason: 'admin_rejected', needs_review: true, report_text: 'x. Source: Indeed employee review' }), false);
  assert.equal(isEmployeeReview({ trust_reason: 'duplicate_import', needs_review: true, report_text: 'x. Source: Indeed employee review' }), false);
  assert.equal(isEmployeeReview({ trust_reason: 'external_import', needs_review: false, report_text: 'Engineer interview' }), false);
  assert.match(EMPLOYEE_REVIEWS_FILTER, /trust_reason\.eq\.external_employee_review/);
  const s = employeeReviewSignal([rev('A'), rev('D'), rev('?'), { trust_reason: null, report_text: 'hiring account' }]);
  assert.deepEqual(s, { count: 3, grades: [4, 1] });
});

test('adjustment: bounded ±5, neutral at C, scaled by sample size, nothing under 5 reviews', () => {
  assert.equal(employeeReviewAdjustment([4, 4, 4, 4]), 0, 'under 5 reviews');
  assert.equal(employeeReviewAdjustment(Array(30).fill(4)), EMPLOYEE_REVIEW_POINTS_MAX);
  assert.equal(employeeReviewAdjustment(Array(30).fill(0)), -EMPLOYEE_REVIEW_POINTS_MAX);
  assert.equal(employeeReviewAdjustment(Array(300).fill(4)), 5, 'never more than the cap');
  assert.equal(employeeReviewAdjustment(Array(30).fill(2)), 0, 'C is neutral');
  assert.equal(employeeReviewAdjustment(Array(10).fill(0)), -2, 'a third of full strength at 10 reviews');
  assert.equal(employeeReviewAdjustment(['x', null, -1, 9]), 0);
});

test('fusion: employee reviews move the score, never the response / ghost rates or the applicant count', () => {
  const sources = [{ type: 'direct', outcomes: [{ outcome: 'ghosted' }, { outcome: 'interview' }, { outcome: 'hired' }, { outcome: 'rejected' }, { outcome: 'ghosted' }] }];
  const base = fuseCompanyIntel({ web: {}, sources });
  const bad = fuseCompanyIntel({ web: {}, sources, employeeReviews: { count: 40, grades: Array(40).fill(0) } });
  const good = fuseCompanyIntel({ web: {}, sources, employeeReviews: { count: 40, grades: Array(40).fill(4) } });
  assert.equal(bad.overall_score, base.overall_score - 5);
  assert.equal(good.overall_score, base.overall_score + 5);
  for (const f of [bad, good]) {
    assert.equal(f.response_rate, base.response_rate);
    assert.equal(f.ghost_rate, base.ghost_rate);
    assert.equal(f.first_party_report_count, base.first_party_report_count);
  }
  assert.equal(good.employee_review_count, 40);
  assert.equal(good.employee_review_adjustment, 5);
  assert.equal(good.employee_review_avg_grade, 4);
  assert.equal(base.employee_review_adjustment, 0);
  assert.equal(base.employee_review_count, 0);
});
