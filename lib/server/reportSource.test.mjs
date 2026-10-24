// Display-honesty labels for third-party report rows (lib/reportSource.ts) — must agree with the
// scoring classifier (api/_utils/companyIntel.js classifyPlatform) on what is third-party.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRedditSourced, isPublicReviewSourced, isPublicDiscussion, publicReviewHost, publicReviewLabel,
  reportSourceBadge, reportSourceLink, PUBLIC_DISCUSSION_LABEL, PUBLIC_REVIEW_PLATFORM_PREFIX,
} from '../reportSource.ts';
import { classifyPlatform, PUBLIC_REVIEW_PLATFORM_PREFIX as SERVER_PREFIX, publicReviewPlatform } from '../../api/_utils/companyIntel.js';

const REVIEW = 'Public review · glassdoor.com';

test('the display prefix is the scoring contract prefix', () => {
  assert.equal(PUBLIC_REVIEW_PLATFORM_PREFIX, SERVER_PREFIX);
  assert.equal(publicReviewPlatform('glassdoor.com'), REVIEW);
});

test('labels agree with classifyPlatform: every labeled row is low-trust, every unlabeled row is not', () => {
  const platforms = ['Reddit r/recruitinghell', 'Reddit', REVIEW, 'Public review · indeed.com', 'public review · some-forum.example',
    'Glassdoor', 'Company website', 'seen_intel', '', null, 'Public web · glassdoor.com'];
  for (const p of platforms) {
    const cls = classifyPlatform(p);
    assert.equal(isPublicDiscussion(p), cls === 'reddit' || cls === 'public_web', String(p));
    assert.equal(isPublicReviewSourced(p), cls === 'public_web', String(p));
    assert.equal(isRedditSourced(p), cls === 'reddit', String(p));
    // Imported review-site rows carry an "Imported from …" badge — keyed on how they ARRIVED
    // (trust_reason), never on the platform alone (a first-hand report's platform is where the person
    // applied). Without an import reason only Reddit / public-review rows are badged.
    assert.equal(reportSourceBadge(p) !== null, isPublicDiscussion(p), String(p));
    assert.ok(reportSourceBadge(p, null, 'external_import') !== null, String(p));
  }
});

test('public review rows get a host-bearing label; Reddit keeps the public-discussion label', () => {
  assert.equal(publicReviewHost(REVIEW), 'glassdoor.com');
  assert.equal(publicReviewHost('Public review · www.Indeed.com'), 'indeed.com');
  assert.equal(publicReviewHost('Public review · not a host'), null);
  assert.equal(publicReviewHost('Reddit r/jobs'), null);
  assert.equal(publicReviewLabel('glassdoor.com'), 'Sourced from a public review site (glassdoor.com)');
  assert.equal(reportSourceBadge(REVIEW).label, 'Sourced from a public review site (glassdoor.com)');
  assert.equal(reportSourceBadge('Public review · ???').label, 'Sourced from a public review site');
  assert.equal(reportSourceBadge('Reddit r/jobs').label, PUBLIC_DISCUSSION_LABEL);
  assert.equal(reportSourceBadge('Company website'), null);
  assert.equal(reportSourceBadge('Glassdoor', null, 'external_import').label, 'Imported from Glassdoor');
  assert.equal(reportSourceBadge('Glassdoor', null, 'duplicate_import').label, 'Imported from Glassdoor');
  assert.equal(reportSourceBadge('Glassdoor'), null, 'a platform alone never makes a row "imported"');
  assert.equal(reportSourceBadge('Indeed', 'Great team. Source: Indeed employee review').label, 'Employee review · Indeed');
});

test('reportSourceLink parses the web-reports suffix and splits it off the body', () => {
  const url = 'https://www.glassdoor.com/Interview/Robert-Half-Interview-Questions-E1234.htm';
  const text = `Applied, did a phone screen, then silence for 6 weeks. [Public glassdoor.com post, posted 2025-03-02: ${url}]`;
  assert.deepEqual(reportSourceLink(REVIEW, text), {
    body: 'Applied, did a phone screen, then silence for 6 weeks.', url, host: 'glassdoor.com', posted: '2025-03-02',
  });
  const noDate = `Never heard back. [Public glassdoor.com post: ${url}]`;
  assert.equal(reportSourceLink(REVIEW, noDate).posted, null);
  assert.equal(reportSourceLink(REVIEW, noDate).body, 'Never heard back.');
  // Bare trailing URL also works.
  assert.equal(reportSourceLink(REVIEW, `Ghosted after onsite ${url}`).url, url);
  // Reddit rows written by the same pipeline link to reddit only.
  const rd = 'https://www.reddit.com/r/recruitinghell/comments/abc123/';
  assert.equal(reportSourceLink('Reddit r/recruitinghell', `Ghosted. [Public reddit.com post: ${rd}]`).url, rd);
});

test('reportSourceLink never links first-hand reports, mismatched hosts, non-http, or truncated suffixes', () => {
  const url = 'https://www.glassdoor.com/Reviews/x.htm';
  assert.equal(reportSourceLink('Company website', `My report ${url}`), null);           // first-hand: no link
  assert.equal(reportSourceLink(null, `My report ${url}`), null);
  assert.equal(reportSourceLink(REVIEW, 'Ghosted. [Public evil.com post: https://evil.com/x]'), null); // host mismatch
  assert.equal(reportSourceLink('Reddit r/jobs', `Ghosted. [Public glassdoor.com post: ${url}]`), null);
  assert.equal(reportSourceLink(REVIEW, 'Ghosted. javascript:alert(1)'), null);
  assert.equal(reportSourceLink(REVIEW, 'Ghosted. [Public glassdoor.com post: https://www.glassdoor.com/Rev'), null); // cut by 2000-char cap
  assert.equal(reportSourceLink(REVIEW, 'No URL here.'), null);
  assert.equal(reportSourceLink(REVIEW, null), null);
  // Subdomain of the platform host is the same site.
  assert.equal(reportSourceLink('Public review · indeed.com', 'x [Public indeed.com post: https://uk.indeed.com/cmp/x/reviews]').host, 'uk.indeed.com');
});

// M5 (audit 2026-10-24): the feed badged a first-party report "Imported from LinkedIn" because the
// person had applied through LinkedIn (trust_reason direct_submission, platform 'LinkedIn').
test('a first-hand Seen report is never badged as imported, whatever site it was applied through', async () => {
  const { isImportedReview, isFirstPartyReport } = await import('../reportSource.ts');
  for (const platform of ['LinkedIn', 'linkedin', 'Indeed', 'Glassdoor', 'Seen', '']) {
    assert.equal(reportSourceBadge(platform, 'Got a response after 3 rounds', 'direct_submission'), null, platform);
    assert.equal(reportSourceBadge(platform, null, 'anonymous_unverified'), null, platform);
    assert.equal(isImportedReview(platform, 'direct_submission'), false, platform);
  }
  assert.equal(isFirstPartyReport('direct_submission'), true);
  assert.equal(isFirstPartyReport('external_import'), false);
  assert.equal(isImportedReview('Glassdoor', 'external_import'), true);
  assert.equal(isImportedReview('Reddit r/jobs', 'external_import'), false, 'Reddit rows are public discussion, not imports');
  assert.equal(reportSourceBadge('Indeed', 'x', 'external_employee_review').label, 'Employee review · Indeed');
  assert.equal(reportSourceBadge('Other', null, 'external_import').label, 'Imported from a review site');
});
