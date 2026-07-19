import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketOutcome,
  roleMatchesTitle,
  summarizeInteractions,
  recentInteractions,
  postingsWithInteractions,
  normalizeInteraction,
} from './employerDashboard.js';

test('bucketOutcome maps the raw report vocabulary to display buckets', () => {
  assert.equal(bucketOutcome('ghosted'), 'ghosted');
  assert.equal(bucketOutcome('autoreject'), 'rejected');
  assert.equal(bucketOutcome('rejected'), 'rejected');
  assert.equal(bucketOutcome('interview'), 'interviewing');
  assert.equal(bucketOutcome('human'), 'interviewing');
  assert.equal(bucketOutcome('offer'), 'hired');
  assert.equal(bucketOutcome('hired'), 'hired');
  assert.equal(bucketOutcome('waiting'), 'waiting');
  // Unknown / missing never throws — degrades to 'waiting'.
  assert.equal(bucketOutcome('something-new'), 'waiting');
  assert.equal(bucketOutcome(undefined), 'waiting');
  assert.equal(bucketOutcome(null), 'waiting');
});

test('summarizeInteractions counts buckets and derives ghost/response rates', () => {
  const reports = [
    { outcome: 'ghosted' },
    { outcome: 'ghosted' },
    { outcome: 'rejected' },
    { outcome: 'interview' },
    { outcome: 'hired' },
  ]; // 5 total → 2 ghosted, 3 responded (rejected+interviewing+hired)
  const s = summarizeInteractions(reports);
  assert.equal(s.total, 5);
  assert.equal(s.counts.ghosted, 2);
  assert.equal(s.counts.rejected, 1);
  assert.equal(s.counts.interviewing, 1);
  assert.equal(s.counts.hired, 1);
  assert.equal(s.ghostRate, 40);
  assert.equal(s.responseRate, 60);
});

test('summarizeInteractions is empty-safe (new employer, zero reports)', () => {
  const s = summarizeInteractions([]);
  assert.equal(s.total, 0);
  assert.equal(s.ghostRate, null);
  assert.equal(s.responseRate, null);
  assert.doesNotThrow(() => summarizeInteractions(undefined));
});

test('roleMatchesTitle associates loose role/title variants, not unrelated ones', () => {
  assert.ok(roleMatchesTitle('Software Engineer', 'Software Engineer'));
  assert.ok(roleMatchesTitle('Senior Software Engineer', 'Software Engineer'));
  assert.ok(roleMatchesTitle('software engineer', 'Software Engineer II'));
  assert.equal(roleMatchesTitle('Registered Nurse', 'Software Engineer'), false);
  // Empty role is company-wide, not posting-specific → never matches a title.
  assert.equal(roleMatchesTitle('', 'Software Engineer'), false);
  assert.equal(roleMatchesTitle('Software Engineer', ''), false);
});

test('postingsWithInteractions attaches per-posting counts by role↔title', () => {
  const postings = [
    { title: 'Software Engineer', location: 'Austin, TX', score: 72, type: 'Full-time' },
    { title: 'Product Manager', location: 'Remote' },
  ];
  const reports = [
    { role: 'Software Engineer', outcome: 'ghosted' },
    { role: 'Senior Software Engineer', outcome: 'interview' },
    { role: 'Product Manager', outcome: 'hired' },
    { role: '', outcome: 'ghosted' }, // company-wide (no role) → excluded from per-posting counts
  ];
  const out = postingsWithInteractions(postings, reports);
  assert.equal(out[0].title, 'Software Engineer');
  assert.equal(out[0].applicantCount, 2); // SE + Senior SE
  assert.equal(out[0].counts.ghosted, 1);
  assert.equal(out[0].counts.interviewing, 1);
  assert.equal(out[0].score, 72);
  assert.equal(out[1].applicantCount, 1); // PM only
  assert.equal(out[1].counts.hired, 1);
  assert.equal(out[1].score, null); // no score on the row → honest null, not a fabricated 0
});

test('postingsWithInteractions is empty-safe and never invents applicants', () => {
  assert.deepEqual(postingsWithInteractions([], []), []);
  assert.deepEqual(postingsWithInteractions(undefined, undefined), []);
  const noReports = postingsWithInteractions([{ title: 'X' }], []);
  assert.equal(noReports[0].applicantCount, 0);
  assert.equal(noReports[0].title, 'X');
});

test('recentInteractions sorts most-recent-first, caps, and normalizes', () => {
  const reports = [
    { role: 'A', outcome: 'ghosted', created_at: '2026-01-01T00:00:00Z' },
    { role: 'B', outcome: 'hired', created_at: '2026-03-01T00:00:00Z' },
    { role: 'C', outcome: 'interview', created_at: '2026-02-01T00:00:00Z' },
  ];
  const out = recentInteractions(reports, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].role, 'B'); // newest first
  assert.equal(out[0].bucket, 'hired');
  assert.equal(out[0].label, 'Hired / Offer');
  assert.equal(out[1].role, 'C');
});

test('normalizeInteraction fills honest fallbacks for sparse rows', () => {
  const n = normalizeInteraction({ outcome: 'ghosted' });
  assert.equal(n.role, 'Role not specified');
  assert.equal(n.bucket, 'ghosted');
  assert.equal(n.tone, 'bad');
  assert.equal(n.createdAt, null);
});
