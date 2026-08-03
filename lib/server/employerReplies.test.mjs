import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeReplyBody, isValidReportId, reportBelongsToCompany, REPLY_MAX,
} from './employerReplies.js';

test('normalizeReplyBody trims, collapses blank runs, caps length, rejects empty', () => {
  assert.equal(normalizeReplyBody('  We reached out on the 5th.  '), 'We reached out on the 5th.');
  assert.equal(normalizeReplyBody('a\n\n\n\nb'), 'a\n\nb'); // 3+ newlines collapse to 2
  assert.equal(normalizeReplyBody(''), null);
  assert.equal(normalizeReplyBody('   '), null);
  assert.equal(normalizeReplyBody('x'), null); // below REPLY_MIN
  assert.equal(normalizeReplyBody(null), null);
  assert.equal(normalizeReplyBody('a'.repeat(REPLY_MAX + 500)).length, REPLY_MAX);
});

test('isValidReportId accepts uuid + numeric ids, rejects junk/injection', () => {
  assert.equal(isValidReportId('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isValidReportId('12345'), true);
  assert.equal(isValidReportId(''), false);
  assert.equal(isValidReportId('   '), false);
  assert.equal(isValidReportId('1;drop table'), false); // spaces/punctuation blocked
  assert.equal(isValidReportId('a,b'), false);
  assert.equal(isValidReportId('x'.repeat(65)), false); // too long
  assert.equal(isValidReportId(null), false);
});

test('reportBelongsToCompany: matches your own reports (incl. suffix variants), rejects others', () => {
  assert.equal(reportBelongsToCompany('acme', 'Acme'), true);
  assert.equal(reportBelongsToCompany('acme', 'Acme Inc'), true);       // contains-match
  assert.equal(reportBelongsToCompany('acme corp', 'Acme'), true);
  assert.equal(reportBelongsToCompany('acme', 'Globex'), false);
  assert.equal(reportBelongsToCompany('', 'Acme'), false);
  assert.equal(reportBelongsToCompany('acme', ''), false);
  assert.equal(reportBelongsToCompany('acme', null), false);
});
