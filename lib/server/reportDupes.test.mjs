// Each account counts once. Prod 2026-10-20: the SpaceX/Tesla import ran twice (150 extra copies).
// Run: node --test lib/server/reportDupes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateReports, reportDupKey, DUPLICATE_PATCH } from './reportDupes.js';
import { isScorableReport } from './reportCounts.js';
import { isEmployeeReview } from './employeeReviews.js';

const T = 'Software Engineer interview - recruiter, take-home, technical, onsite [B+]. Hiring-process account';
const row = (o) => ({ company_name: 'SpaceX', outcome: 'interview', platform: 'Glassdoor', role: 'Unknown', report_text: T, trust_reason: 'external_import', needs_review: false, created_at: '2025-01-01T00:00:00Z', ...o });

test('a doubled import: the later copy is marked, the oldest original kept', () => {
  const a = row({ id: 'a', created_at: '2024-12-09T00:00:00Z' });
  const b = row({ id: 'b', created_at: '2026-01-04T00:00:00Z' });
  const c = row({ id: 'c', company_name: 'spacex', report_text: `  ${T.toUpperCase()}  ` }); // case + whitespace differ
  const { dupes, groups } = findDuplicateReports([b, c, a]);
  assert.equal(groups, 1);
  assert.deepEqual(dupes.map((d) => d.id).sort(), ['b', 'c']);
  assert.ok(dupes.every((d) => d.keep === 'a'));
});

test('different accounts are never merged: outcome, source, role or text differ, or the text is too short', () => {
  const base = row({ id: 'x' });
  for (const o of [{ outcome: 'rejected' }, { platform: 'Indeed' }, { role: 'Intern' }, { report_text: `${T} — second account` }]) {
    assert.equal(findDuplicateReports([base, row({ id: 'y', ...o })]).dupes.length, 0, JSON.stringify(o));
  }
  assert.equal(reportDupKey(row({ report_text: 'Ghosted' })), null, 'two short first-party reports stay two reports');
  assert.equal(findDuplicateReports([row({ id: '1', report_text: 'Ghosted' }), row({ id: '2', report_text: 'Ghosted' })]).dupes.length, 0);
});

test('an approved copy is never dropped for a rejected one; marked / rejected copies are left alone', () => {
  const rejectedOld = row({ id: 'old', created_at: '2024-01-01T00:00:00Z', trust_reason: 'admin_rejected', needs_review: true });
  const approvedNew = row({ id: 'new', created_at: '2026-01-01T00:00:00Z' });
  assert.deepEqual(findDuplicateReports([rejectedOld, approvedNew]).dupes, [], 'the approved copy is the keeper; the rejected one already counts for nothing');
  const marked = row({ id: 'm', trust_reason: 'duplicate_import', needs_review: true });
  assert.deepEqual(findDuplicateReports([row({ id: 'k' }), marked]).dupes, [], 're-running finds nothing new');
});

test('a marked copy is hidden, never scored and no longer an employee review', () => {
  const hiring = { ...row({}), ...DUPLICATE_PATCH };
  assert.equal(isScorableReport(row({})), true);
  assert.equal(isScorableReport(hiring), false);
  const emp = { trust_reason: 'external_employee_review', needs_review: false, report_text: 'Good [A-]. Source: Indeed employee review' };
  assert.equal(isEmployeeReview(emp), true);
  assert.equal(isEmployeeReview({ ...emp, ...DUPLICATE_PATCH }), false);
  assert.equal(DUPLICATE_PATCH.needs_review, true, 'held, so the OLD score filter also skips it');
});
