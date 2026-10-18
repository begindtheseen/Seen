// Messages on an application, withdrawal, and the exit review — pure rules.
// Run: node --test lib/server/applicationThread.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendThreadEntry, readThread, decodeThread, cleanMessage, employerMessaged, withdrawalOutcome,
  firstResponseDays, interviewRounds, withdrawTrackerPatch, alreadyReviewed, markWithdrawReviewed,
  validateWithdrawReview, buildWithdrawalReport, THREAD_MAX_ENTRIES, MESSAGE_MAX, REVIEW_MAX,
} from './applicationThread.js';
import { classifyPlatform } from '../../api/_utils/companyIntel.js';
import { isScorableReport } from './reportCounts.js';

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const DAY = 86400000;

test('thread entries are compact tuples [from, unix seconds, text(, kind)]', () => {
  const a = appendThreadEntry(null, { from: 'e', text: '  Interview Tue 3pm — call 555-0100  ', nowMs: T0 });
  assert.equal(a.ok, true);
  assert.deepEqual(a.thread, [['e', T0 / 1000, 'Interview Tue 3pm — call 555-0100']]);
  const b = appendThreadEntry(a.thread, { from: 'a', text: '', nowMs: T0 + DAY, kind: 'w' });
  assert.deepEqual(b.thread[1], ['a', (T0 + DAY) / 1000, '', 'w']);
  // Far smaller than the object form it replaces.
  const tuple = JSON.stringify(a.thread[0]).length;
  const object = JSON.stringify({ from: 'employer', at: new Date(T0).toISOString(), text: a.thread[0][2] }).length;
  assert.ok(tuple < object - 30, `${tuple} vs ${object}`);
});

test('decodeThread is what the API returns; corrupt stored values read as empty', () => {
  const t = [['e', T0 / 1000, 'hi'], ['a', T0 / 1000 + 60, 'thanks!', 'w'], ['x', 1, 'bad'], 'junk'];
  assert.deepEqual(decodeThread(t), [
    { from: 'employer', at: new Date(T0).toISOString(), text: 'hi' },
    { from: 'applicant', at: new Date(T0 + 60000).toISOString(), text: 'thanks!', withdrawal: true },
  ]);
  assert.deepEqual(readThread('not json'), []);
  assert.deepEqual(readThread(JSON.stringify([['e', 5, 'x']])), [['e', 5, 'x']]);
  assert.deepEqual(decodeThread(null), []);
});

test('messages are cleaned, capped, and the thread is bounded', () => {
  assert.equal(cleanMessage('a\u0000b\r\n\n\n\nc'), 'ab\n\nc');
  assert.equal(cleanMessage('x'.repeat(MESSAGE_MAX + 50)).length, MESSAGE_MAX);
  assert.equal(appendThreadEntry([], { from: 'e', text: '   ', nowMs: T0 }).ok, false);
  assert.equal(appendThreadEntry([], { from: 'z', text: 'hi', nowMs: T0 }).ok, false);
  const full = Array.from({ length: THREAD_MAX_ENTRIES }, (_, i) => ['e', i, 'm']);
  assert.equal(appendThreadEntry(full, { from: 'e', text: 'one more', nowMs: T0 }).ok, false);
});

test('exit-review outcome comes from what is on record, best evidence first', () => {
  const base = { appliedAtMs: T0, nowMs: T0 + 10 * DAY };
  assert.equal(withdrawalOutcome({ ...base, employerStatus: 'interviewing', stage: 'Viewed' }), 'interview');
  assert.equal(withdrawalOutcome({ ...base, stage: 'Final Round' }), 'interview');
  assert.equal(withdrawalOutcome({ ...base, events: [{ type: 'offer_received' }] }), 'offer');
  assert.equal(withdrawalOutcome({ ...base, employerStatus: 'rejected' }), 'rejected');
  assert.equal(withdrawalOutcome({ ...base, thread: [['e', T0 / 1000, 'call me']] }), 'human');
  assert.equal(withdrawalOutcome({ ...base, stage: 'Phone Screen' }), 'human');
  // "Reviewed" alone is the employer looking, not a reply to the applicant.
  assert.equal(withdrawalOutcome({ ...base, employerStatus: 'reviewed', stage: 'Viewed' }), 'waiting');
  assert.equal(withdrawalOutcome({ ...base, nowMs: T0 + 30 * DAY }), 'ghosted');
  assert.equal(withdrawalOutcome({ ...base, nowMs: T0 + 29 * DAY }), 'waiting');
  // The applicant's own withdrawal note is not a reply from the employer.
  assert.equal(employerMessaged([['a', 1, 'bye', 'w']]), false);
});

test('first response days and interview rounds', () => {
  assert.equal(firstResponseDays({ appliedAtMs: T0, events: [{ type: 'interview_received', date: T0 + 6 * DAY }] }), 6);
  assert.equal(firstResponseDays({ appliedAtMs: T0, events: [], thread: [['e', (T0 + 3 * DAY) / 1000, 'hi']] }), 3);
  assert.equal(firstResponseDays({ appliedAtMs: T0, events: [{ type: 'application_submitted', date: T0 }] }), null);
  assert.equal(interviewRounds([{ type: 'interview_received' }, { type: 'interview_completed' }, { type: 'rejected' }]), 2);
});

test('withdraw patch is idempotent and the exit review can only be given once', () => {
  const app = { status: 'active', events: [{ type: 'application_submitted' }] };
  const p = withdrawTrackerPatch(app, T0);
  assert.equal(p.status, 'withdrawn');
  assert.equal(p.events.at(-1).type, 'withdrawn');
  assert.equal(app.events.length, 1, 'input untouched');
  assert.equal(withdrawTrackerPatch({ ...app, status: 'withdrawn' }, T0), null);
  assert.equal(alreadyReviewed(p.events), false);
  const marked = markWithdrawReviewed(p.events, 'too_slow');
  assert.equal(alreadyReviewed(marked), true);
  assert.equal(marked.at(-1).reason, 'too_slow');
  assert.equal(p.events.at(-1).rv, undefined, 'input untouched');
});

test('exit survey: reason or review, each optional, never both empty', () => {
  assert.deepEqual(validateWithdrawReview({ reason: 'other_offer' }), { ok: true, reason: 'other_offer', review: null });
  assert.equal(validateWithdrawReview({ review: 'x'.repeat(REVIEW_MAX + 9) }).review.length, REVIEW_MAX);
  assert.equal(validateWithdrawReview({}).ok, false);
  assert.equal(validateWithdrawReview({ reason: 'made_up' }).ok, false);
});

test('the exit review is a first-party report that lands in the scoring pool', () => {
  const trust = { weight: 1, reason: 'direct_submission', review: false };
  for (const seenApply of [true, false]) {
    const r = buildWithdrawalReport({ role: 'Barista', outcome: 'ghosted', waitDays: null, rounds: 0, review: 'Never heard back.', trust, uid: 'u1', companyId: 'c1', locationId: null, seenApply });
    assert.equal(classifyPlatform(r.platform), 'direct', r.platform); // full trust weight (SOURCE_TRUST.direct)
    assert.equal(isScorableReport(r), true);
    assert.equal(r.outcome, 'ghosted');
    assert.equal(r.report_text, 'Never heard back.');
  }
  // The anti-gaming hold still applies: a duplicate is kept out until reviewed.
  const held = buildWithdrawalReport({ role: 'x', outcome: 'waiting', trust: { weight: 0.3, reason: 'duplicate_user_company', review: true }, uid: 'u1', companyId: 'c1', seenApply: true });
  assert.equal(isScorableReport(held), false);
});
