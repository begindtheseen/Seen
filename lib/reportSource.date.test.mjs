// Report dates on cards: imported (third-party) rows show the SOURCE's posted date, never their
// import time — a 1,000-row batch imported in one day otherwise reads "0d ago" on every card.
// Run: node --test lib/reportSource.date.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePostedDate, relativeAgo, reportDate, sortReportsByDate } from './reportSource.ts';
import { buildReportRow as enrichRow, postedDay } from '../api/_utils/companyEnrichment.js';
import { withAttribution } from '../scripts/credit/lib/reddit.mjs';

const NOW = Date.UTC(2026, 9, 17, 16, 0, 0);
const GD = 'Public review · glassdoor.com';
const gdText = (posted) => `Applicant reports a smooth interview and an offer. [Public glassdoor.com post${posted ? `, posted ${posted}` : ''}: https://www.glassdoor.com/Interview/X.htm]`;

test('parsePostedDate: the three formats found on prod (YYYY-MM-DD, YYYY-MM, YYYY); junk → null', () => {
  assert.deepEqual(parsePostedDate('2025-07-30'), { ms: Date.UTC(2025, 6, 30), precision: 'day' });
  assert.deepEqual(parsePostedDate('2024-03'), { ms: Date.UTC(2024, 2, 15), precision: 'month' });
  assert.deepEqual(parsePostedDate('2023'), { ms: Date.UTC(2023, 6, 1), precision: 'year' });
  for (const bad of ['', null, undefined, 'last week', '2024-13', '1999-01-01', 'that same day']) assert.equal(parsePostedDate(bad), null);
});

test('relativeAgo buckets', () => {
  assert.equal(relativeAgo(NOW - 3600_000, NOW), 'today');
  assert.equal(relativeAgo(NOW - 86_400_000, NOW), 'yesterday');
  assert.equal(relativeAgo(NOW - 5 * 86_400_000, NOW), '5d ago');
  assert.equal(relativeAgo(NOW - 95 * 86_400_000, NOW), '3mo ago');
  assert.equal(relativeAgo(NOW - 800 * 86_400_000, NOW), '2y ago');
  assert.equal(relativeAgo(NOW + 5 * 86_400_000, NOW), '');
});

test('reportDate: imported rows use the posted date, never created_at; undated imports show nothing', () => {
  const importedToday = new Date(NOW - 60_000).toISOString();
  assert.equal(reportDate(GD, gdText('2025-07-30'), importedToday, NOW).label, 'posted Jul 2025');
  assert.equal(reportDate(GD, gdText('2026-10-05'), importedToday, NOW).label, 'posted 12d ago');
  assert.equal(reportDate(GD, gdText('2026-06'), importedToday, NOW).label, 'posted Jun 2026');
  assert.equal(reportDate(GD, gdText('2023'), importedToday, NOW).label, 'posted 2023');
  assert.deepEqual(reportDate(GD, gdText(null), importedToday, NOW), { label: '', sortMs: null });
  // Reddit rows: same rule (attribution written by the self-fill worker / credit backfill).
  const rd = 'Applicant reports no response. [Public reddit.com post, posted 2025-01-10: https://www.reddit.com/r/jobs/comments/abc123/]';
  assert.equal(reportDate('Reddit r/jobs', rd, importedToday, NOW).label, 'posted Jan 2025');
  assert.equal(reportDate('Reddit r/jobs', 'Old row, bare link https://www.reddit.com/r/jobs/comments/abc123/', importedToday, NOW).label, '');
  // First-hand Seen reports keep their submit time.
  assert.equal(reportDate('LinkedIn', 'I applied…', new Date(NOW - 3 * 86_400_000).toISOString(), NOW).label, '3d ago');
});

test('sortReportsByDate: newest real date first, undated imports last in original order', () => {
  const today = new Date(NOW - 60_000).toISOString();
  const rows = [
    { id: 'undated1', platform: GD, report_text: gdText(null), created_at: today },
    { id: 'gd2023', platform: GD, report_text: gdText('2023'), created_at: today },
    { id: 'seen', platform: 'Seen', report_text: 'x', created_at: new Date(NOW - 2 * 86_400_000).toISOString() },
    { id: 'undated2', platform: GD, report_text: gdText(null), created_at: today },
    { id: 'gd2025', platform: GD, report_text: gdText('2025-07-30'), created_at: today },
  ];
  assert.deepEqual(sortReportsByDate(rows, NOW).map((r) => r.id), ['seen', 'gd2025', 'gd2023', 'undated1', 'undated2']);
});

test('writers stamp Reddit rows with the thread date in the attribution the card reads', () => {
  assert.equal(postedDay('2025-03-04T12:00:00Z'), '2025-03-04');
  assert.equal(postedDay('nope'), null);
  const row = enrichRow({ outcome: 'ghosted', summary: 'Applicant reports no response.' }, { companyName: 'sheetz', subreddit: 'jobs', threadId: 'abc123', posted: '2025-03-04T12:00:00Z' });
  assert.equal(reportDate(row.platform, row.report_text, new Date(NOW).toISOString(), NOW).label, 'posted Mar 2025');
  const undated = enrichRow({ outcome: 'ghosted', summary: 'x' }, { companyName: 'sheetz', subreddit: 'jobs', threadId: 'abc123' });
  assert.match(undated.report_text, /\[Public reddit\.com post: https:\/\/www\.reddit\.com\/r\/jobs\/comments\/abc123\/\]$/);
  const bf = withAttribution('Applicant reports no response.', 'https://old.reddit.com/r/jobs/comments/abc123/slug/', '2024-11-02T00:00:00Z', NOW);
  assert.equal(bf, 'Applicant reports no response. [Public reddit.com post, posted 2024-11-02: https://www.reddit.com/r/jobs/comments/abc123/slug/]');
  assert.equal(reportDate('Reddit r/jobs', bf, new Date(NOW).toISOString(), NOW).label, 'posted Nov 2024');
  assert.equal(withAttribution('x', 'https://evil.example/r/jobs/comments/abc/', '2024-01-01', NOW), 'x');
});
