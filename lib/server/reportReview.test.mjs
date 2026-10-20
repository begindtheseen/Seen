import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeldReport, sortHeldReports, groupCounts, decisionPatch, planDecision, POSITIVE_OUTCOMES } from './reportReview.js';
import { isScorableReport } from './reportCounts.js';

const row = (o) => ({ id: o.id || Math.random().toString(16).slice(2), company_name: 'SpaceX', outcome: 'interview', trust_reason: 'external_import', report_text: 'Engineer interview - onsite. Hiring account', created_at: '2026-10-18T00:00:00Z', outcome_weight: 0.55, needs_review: true, ...o });

test('classification: anything not clearly positive needs eyes; anti-gaming holds always do', () => {
  assert.equal(classifyHeldReport(row({ outcome: 'hired' })).group, 'positive');
  for (const o of ['ghosted', 'rejected', 'autoreject', 'assessment', 'unknown', '']) assert.equal(classifyHeldReport(row({ outcome: o })).group, 'needs_eyes', o);
  const anon = classifyHeldReport(row({ outcome: 'hired', trust_reason: 'anonymous_unverified' }));
  assert.equal(anon.group, 'needs_eyes'); assert.ok(anon.flags.includes('anti_gaming_hold'));
  const emp = classifyHeldReport(row({ outcome: 'human', report_text: 'Great team [A-]. Source: Indeed employee review' }));
  assert.equal(emp.group, 'employee_review'); assert.equal(emp.positive, false);
  assert.ok(classifyHeldReport(row({})).flags.includes('no_source_link'));
  const linked = classifyHeldReport(row({ report_text: 'I interviewed [Source: https://www.reddit.com/r/x/comments/abc/]' }));
  assert.equal(linked.sourceUrl, 'https://www.reddit.com/r/x/comments/abc/');
  assert.ok(!linked.flags.includes('no_source_link'));
  assert.ok(POSITIVE_OUTCOMES.has('interview') && !POSITIVE_OUTCOMES.has('rejected'));
});

test('default sort: needs-eyes first (most negative first), then positives, then employee reviews; duplicates flagged', () => {
  const rows = [
    row({ id: 'p', outcome: 'hired' }),
    row({ id: 'e', outcome: 'human', report_text: 'x. Source: Indeed employee review' }),
    row({ id: 'r', outcome: 'rejected' }),
    row({ id: 'g', outcome: 'ghosted' }),
    row({ id: 'd1', outcome: 'interview', report_text: 'Same text', created_at: '2026-10-17T00:00:00Z' }),
    row({ id: 'd2', outcome: 'interview', report_text: 'Same text', created_at: '2026-10-18T00:00:00Z' }),
  ];
  const s = sortHeldReports(rows);
  assert.deepEqual(s.map((r) => r.id).slice(0, 2), ['g', 'r']);
  assert.equal(s[s.length - 1].id, 'e');
  assert.ok(s.find((r) => r.id === 'd2').review.flags.includes('possible_duplicate'), 'the later copy is flagged');
  assert.ok(!s.find((r) => r.id === 'd1').review.flags.includes('possible_duplicate'), 'the oldest copy is not');
  assert.deepEqual(groupCounts(s), { total: 6, needs_eyes: 2, positive: 3, employee_review: 1 });
  assert.deepEqual(sortHeldReports(rows, 'company').length, 6);
});

test('decisions never raise a trust weight, keep employee reviews unscored, and keep rejected rows', () => {
  const hiring = row({ outcome_weight: 0.3 });
  const approved = { ...hiring, ...decisionPatch(hiring, 'approve') };
  assert.deepEqual(decisionPatch(hiring, 'approve'), { needs_review: false }, 'no outcome_weight in an approval');
  assert.equal(approved.outcome_weight, 0.3);
  assert.equal(isScorableReport(approved), true);

  const emp = row({ outcome: 'human', report_text: 'Nice. Source: Indeed employee review' });
  const empApproved = { ...emp, ...decisionPatch(emp, 'approve') };
  assert.equal(empApproved.needs_review, false);
  assert.equal(isScorableReport(empApproved), false, 'an approved employee review is published but never scored');

  const rejected = { ...hiring, ...decisionPatch(hiring, 'reject') };
  assert.deepEqual(decisionPatch(hiring, 'reject'), { needs_review: true, trust_reason: 'admin_rejected', outcome_weight: 0 });
  assert.equal(isScorableReport(rejected), false);
  assert.throws(() => decisionPatch(hiring, 'delete'));

  const plan = planDecision([hiring, emp, row({ id: 'h2' })], 'approve');
  assert.equal(plan.length, 2, 'one PATCH per patch shape');
  assert.equal(plan.find((p) => !p.patch.trust_reason).ids.length, 2);
});
