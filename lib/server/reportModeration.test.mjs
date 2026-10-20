// Run: node --test lib/server/reportModeration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportState, moderationPlan, rulesCheck } from './reportModeration.js';
import { isScorableReport } from './reportCounts.js';

const live = { id: 'a', company_name: 'walmart', outcome: 'offer', platform: 'Public review · reddit.com', trust_reason: 'external_import', needs_review: false, outcome_weight: 0.3,
  report_text: 'The bar to be hired at Walmart is low. My advice is to simply answer honestly. [Source: https://www.reddit.com/r/walmart/x]' };

test('state: what the page and the grade actually read', () => {
  assert.deepEqual(reportState(live), { state: 'live', counted: true, employeeReview: false });
  assert.equal(reportState({ ...live, needs_review: true }).state, 'held');
  assert.equal(reportState({ ...live, needs_review: true, trust_reason: 'admin_rejected' }).state, 'rejected');
  assert.equal(reportState({ ...live, trust_reason: 'duplicate_import', needs_review: true }).counted, false);
});

test('reject takes a LIVE report out of the grade (the old ✕ only zeroed a weight the grade ignores)', () => {
  const p = moderationPlan(live, 'reject');
  const after = { ...live, ...p.patch };
  assert.equal(isScorableReport(after), false, 'no longer counted');
  assert.equal(reportState(after).state, 'rejected');
  assert.match(p.message, /out of its grade/);
  assert.equal(moderationPlan(after, 'reject').patch, null);
});

test('approve says why when there is nothing to approve; hold and restore round-trip', () => {
  assert.equal(moderationPlan(live, 'approve').patch, null);
  assert.match(moderationPlan(live, 'approve').message, /Already live/);
  const held = { ...live, needs_review: true };
  assert.deepEqual(moderationPlan(held, 'approve').patch, { needs_review: false });
  assert.deepEqual(moderationPlan(live, 'hold').patch, { needs_review: true });
  const rejected = { ...live, ...moderationPlan(live, 'reject').patch };
  assert.match(moderationPlan(rejected, 'restore').message, /restore it by hand/, 'no audit record → no guess');
  const back = moderationPlan(rejected, 'restore', { needs_review: false, trust_reason: 'external_import', outcome_weight: 0.3 });
  assert.deepEqual({ ...rejected, ...back.patch }, live);
});

test('rules flag: the old collector’s advice is flagged; a first-hand post passes; Glassdoor summaries are not judged', () => {
  assert.equal(rulesCheck(live), 'fails');
  assert.equal(rulesCheck({ ...live, report_text: 'Finished loop interview for Amazon , still no feedback from recruiter. I had interviews on Monday and they ghosted me. [Source: https://www.reddit.com/x]', company_name: 'amazon' }), 'passes');
  assert.equal(rulesCheck({ ...live, platform: 'Glassdoor', trust_reason: 'external_import', report_text: 'Vehicle Engineering interview - no offer [B]. Hiring account shows…' }), null);
  assert.equal(rulesCheck({ ...live, trust_reason: 'direct_submission', platform: 'linkedin' }), null, 'a direct report is never second-guessed');
});
