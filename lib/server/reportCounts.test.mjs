// Run: node --test lib/server/reportCounts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstPartyReportCount, webClaimCount, honestCountFields, publicDiscussionShare, publicDiscussionCountPath, parseExactCount } from './reportCounts.js';
import { NONTERMINAL_OUTCOMES, classifyPlatform } from '../../api/_utils/companyIntel.js';

test('live Robert Half shape: a 3,085 fused count with 0 first-party rows is 0 applicant reports', () => {
  const row = { report_count: 3085, first_party_report_count: 0, web_report_count: 3085, data_source: 'web_research' };
  assert.equal(firstPartyReportCount(row), 0);
  assert.equal(webClaimCount(row), 3085);
  assert.deepEqual(honestCountFields(row), { first_party_report_count: 0, web_report_count: 3085 });
});

test('split columns win over data_source when present (fused rows)', () => {
  const row = { report_count: 48, first_party_report_count: 8, web_report_count: 40, data_source: 'web_search' };
  assert.equal(firstPartyReportCount(row), 8);
  assert.equal(webClaimCount(row), 40);
});

test('legacy rows (split columns null) infer from data_source, erring toward NOT first-party', () => {
  assert.equal(firstPartyReportCount({ report_count: 12, data_source: 'reports' }), 12);
  assert.equal(webClaimCount({ report_count: 12, data_source: 'reports' }), 0);
  for (const ds of ['web_search', 'web_research', 'fused', null, undefined, 'ai_estimate']) {
    assert.equal(firstPartyReportCount({ report_count: 12775, first_party_report_count: null, data_source: ds }), 0, `data_source=${ds}`);
    assert.equal(webClaimCount({ report_count: 12775, web_report_count: null, data_source: ds }), 12775, `data_source=${ds}`);
  }
});

test('garbage in → 0, never NaN or negative', () => {
  assert.equal(firstPartyReportCount(null), 0);
  assert.equal(firstPartyReportCount(undefined), 0);
  assert.equal(firstPartyReportCount({}), 0);
  assert.equal(firstPartyReportCount({ first_party_report_count: -3 }), 0);
  assert.equal(firstPartyReportCount({ first_party_report_count: 'abc' }), 0);
  assert.equal(firstPartyReportCount({ first_party_report_count: '7' }), 7);
  assert.equal(webClaimCount(null), 0);
});

test('publicDiscussionShare: unknown stays unknown, and never exceeds the first-party total', () => {
  assert.equal(publicDiscussionShare(null, 42), null);
  assert.equal(publicDiscussionShare(undefined, 42), null);
  assert.equal(publicDiscussionShare(NaN, 42), null);
  assert.equal(publicDiscussionShare(-1, 42), null);
  assert.equal(publicDiscussionShare(30, 42), 30);
  assert.equal(publicDiscussionShare(0, 42), 0);
  assert.equal(publicDiscussionShare(60, 42), 42); // read after new rows landed, before recompute
  assert.equal(publicDiscussionShare(5, 0), 0);
});

test('publicDiscussionCountPath counts the fusion corpus, narrowed to reddit + public-review platforms', () => {
  const path = publicDiscussionCountPath('Robert Half');
  assert.ok(path.startsWith('reports?select=id&'));
  assert.match(path, /company_name=ilike\.robert%20half(&|$)/);       // stored lowercase name, encoded
  assert.match(path, /needs_review=not\.is\.true/);                   // held-out rows never count
  // One or= over both third-party low-trust classes (mirrors classifyPlatform 'reddit' + 'public_web').
  const or = decodeURIComponent(/&or=\(([^)]*)\)/.exec(path)[1]);
  assert.deepEqual(or.split(','), ['platform.ilike.*reddit*', 'platform.ilike.public review ·*']);
  assert.ok(!/&platform=/.test(path), 'no AND-ed platform filter that would exclude review-site rows');
  const outcomes = decodeURIComponent(/outcome=not\.in\.\(([^)]*)\)/.exec(path)[1]);
  for (const o of NONTERMINAL_OUTCOMES) assert.ok(outcomes.includes(`"${o}"`), `nonterminal "${o}" excluded`);
  assert.equal(classifyPlatform('Reddit r/recruitinghell'), 'reddit');   // the platform shapes it targets
  assert.equal(classifyPlatform('Public review · glassdoor.com'), 'public_web');
  // The ilike patterns accept exactly the platforms the classifier puts in those two classes.
  const like = (pat, v) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(v);
  for (const v of ['Reddit r/jobs', 'Public review · glassdoor.com', 'PUBLIC REVIEW · indeed.com', 'Glassdoor', 'Company website', 'Public web · x.com']) {
    const counted = like('*reddit*', v) || like('public review ·*', v);
    assert.equal(counted, ['reddit', 'public_web'].includes(classifyPlatform(v)), v);
  }
  assert.equal(publicDiscussionCountPath(''), null);
  assert.equal(publicDiscussionCountPath(null), null);
});

test('parseExactCount reads PostgREST totals and refuses unknowns', () => {
  assert.equal(parseExactCount('0-0/42'), 42);
  assert.equal(parseExactCount('*/0'), 0);
  assert.equal(parseExactCount('0-0/*'), null);
  assert.equal(parseExactCount(''), null);
  assert.equal(parseExactCount(null), null);
});

// ── Grade gate (owner decision 2026-10-17): no verdict below MIN_REPORTS_FOR_GRADE real reports ──
import { MIN_REPORTS_FOR_GRADE, isGradeable, reportsNeededForGrade, gateScore, GRADE_FIELDS } from './reportCounts.js';

test('grade gate: the bar is 5 real (first-party) reports; a web-research claim never counts', () => {
  assert.equal(MIN_REPORTS_FOR_GRADE, 5);
  assert.equal(isGradeable({ first_party_report_count: 5 }), true);
  assert.equal(isGradeable({ first_party_report_count: 4 }), false);
  // Starbucks before the fix: 11,525 claimed web mentions, 0 real rows → never gradeable.
  assert.equal(isGradeable({ first_party_report_count: 0, web_report_count: 11525, report_count: 11525, data_source: 'web_search' }), false);
  // Legacy web row (no split columns) infers 0 first-party.
  assert.equal(isGradeable({ report_count: 900, data_source: 'web_research' }), false);
  assert.equal(reportsNeededForGrade({ first_party_report_count: 2 }), 3);
  assert.equal(reportsNeededForGrade({ first_party_report_count: 40 }), 0);
});

test('gateScore: below the bar every verdict field is null, counts/reviews stay; at the bar nothing changes', () => {
  const starbucks = { overall_score: 95, process_score: 95, ghost_rate: 0, response_rate: 1, avg_wait_days: 7, risk_level: 'safe', waste: 3, sufficient: true,
    report_count: 2, first_party_report_count: 2, web_report_count: 0, web_reviews: [{ text: 'x' }], summary: 's', industry: 'Food' };
  const g = gateScore(starbucks);
  assert.equal(g.gradeable, false);
  assert.equal(g.min_reports_for_grade, 5);
  for (const f of GRADE_FIELDS) if (f in starbucks) assert.equal(g[f], null, f);
  assert.equal(g.sufficient, false);
  assert.equal(g.first_party_report_count, 2);
  assert.deepEqual(g.web_reviews, [{ text: 'x' }]);
  assert.equal(g.summary, 's');
  assert.equal(starbucks.overall_score, 95, 'input is not mutated');

  const walmart = { overall_score: 81, ghost_rate: 0.3, risk_level: 'safe', first_party_report_count: 33 };
  assert.deepEqual(gateScore(walmart), { ...walmart, gradeable: true, min_reports_for_grade: 5 });
  assert.equal(gateScore(null), null);
});

import { isScorableReport, SCORABLE_REPORTS_FILTER, scorableResolvedCountPath } from './reportCounts.js';

test('score corpus: every report at its weight; only anti-gaming holds and employee reviews are out', () => {
  // First-hand, public-review and Reddit rows (needs_review false/null) count.
  assert.equal(isScorableReport({ needs_review: false, trust_reason: 'direct_submission' }), true);
  assert.equal(isScorableReport({ needs_review: null }), true);
  // Imported hiring accounts count even though they are queued for an admin spot-check.
  assert.equal(isScorableReport({ needs_review: true, trust_reason: 'external_import', report_text: 'Software Engineer interview - recruiter, take-home, onsite. Source: Glassdoor interview' }), true);
  // Imported EMPLOYEE reviews are not hiring outcomes (the SpaceX/Tesla 99-score bug).
  assert.equal(isScorableReport({ needs_review: true, trust_reason: 'external_import', report_text: 'Great team. Source: Indeed employee review (SpaceX review corpus)' }), false);
  assert.equal(isScorableReport({ needs_review: true, trust_reason: 'external_employee_review', report_text: 'x' }), false);
  // Anti-gaming holds wait for an admin.
  for (const reason of ['anonymous_unverified', 'duplicate_user_company', 'velocity_capped']) {
    assert.equal(isScorableReport({ needs_review: true, trust_reason: reason }), false, reason);
  }
  assert.equal(isScorableReport(null), false);
});

test('the PostgREST filter encodes the same rule, and the count path adds resolved outcomes', () => {
  assert.equal(SCORABLE_REPORTS_FILTER, 'and=(or(trust_reason.is.null,trust_reason.not.in.(external_employee_review,admin_rejected,duplicate_import)),or(needs_review.not.is.true,and(trust_reason.eq.external_import,report_text.not.ilike.*employee%20review*,report_text.not.ilike.*employee%20discussion*)))');
  const p = scorableResolvedCountPath('SpaceX');
  assert.ok(p.startsWith('reports?select=id&company_name=ilike.spacex&'));
  assert.ok(p.includes(SCORABLE_REPORTS_FILTER));
  assert.ok(p.includes('outcome=not.in.('));
  assert.equal(scorableResolvedCountPath(''), null);
});

test('admin review can never turn an employee review or a rejected row into a scored hiring outcome', () => {
  // Approved (published) employee review: needs_review false, but still never scored.
  assert.equal(isScorableReport({ needs_review: false, trust_reason: 'external_employee_review', report_text: 'Great place. Source: Indeed employee review' }), false);
  // Rejected rows are kept for provenance and never counted, held or not.
  assert.equal(isScorableReport({ needs_review: true, trust_reason: 'admin_rejected' }), false);
  assert.equal(isScorableReport({ needs_review: false, trust_reason: 'admin_rejected' }), false);
  // An approved imported hiring account counts (it already did while held).
  assert.equal(isScorableReport({ needs_review: false, trust_reason: 'external_import', report_text: 'Engineer interview - no offer' }), true);
  // First-party rows with NO trust_reason keep counting (SQL <> drops NULLs, so the filter says is.null).
  assert.equal(isScorableReport({ needs_review: false, trust_reason: null }), true);
  assert.match(SCORABLE_REPORTS_FILTER, /trust_reason\.is\.null/);
});

test('a Reddit firsthand EMPLOYEE DISCUSSION is a workplace account, not a hiring outcome', () => {
  assert.equal(isScorableReport({ needs_review: true, trust_reason: 'external_import', report_text: 'Tesla Austin working culture [B]. Source: Reddit firsthand employee discussion' }), false);
});

// ── scoreUpdatedAt: "Last updated" without an updated_at column (verified absent on prod 2026-10-23) ──
test('scoreUpdatedAt derives the last write from expires_at − SCORE_TTL_MS, never before created_at', async () => {
  const { scoreUpdatedAt, SCORE_TTL_MS } = await import('./reportCounts.js');
  assert.equal(SCORE_TTL_MS, 365 * 24 * 60 * 60 * 1000);
  // Walmart (prod): created 2026-06-16, expires 2027-10-20 05:48 → last recompute 2026-10-20 05:48.
  const row = { created_at: '2026-06-16T15:47:08.113Z', expires_at: '2027-10-20T05:48:31.988Z' };
  assert.equal(scoreUpdatedAt(row, Date.parse('2026-10-23T16:00:00Z')), '2026-10-20T05:48:31.988Z');
  // A shorter TTL elsewhere would put the "write" in the future → fall back to created_at.
  assert.equal(scoreUpdatedAt({ created_at: '2026-06-16T15:47:08.113Z', expires_at: '2028-01-01T00:00:00Z' }, Date.parse('2026-10-23T16:00:00Z')), '2026-06-16T15:47:08.113Z');
  // Derived time before creation (a legacy TTL) → created_at.
  assert.equal(scoreUpdatedAt({ created_at: '2026-10-17T16:07:52.994Z', expires_at: '2027-01-01T00:00:00Z' }, Date.parse('2026-10-23T16:00:00Z')), '2026-10-17T16:07:52.994Z');
  assert.equal(scoreUpdatedAt({ created_at: '2026-10-17T16:07:52.994Z' }), '2026-10-17T16:07:52.994Z');
  assert.equal(scoreUpdatedAt({}), null);
  assert.equal(scoreUpdatedAt(null), null);
});

test('Seen-user share: counted by name from one read, clamped to the total, unknown stays null', async () => {
  const { seenUserReportsPath, countSeenUserReports, seenUserShare, SEEN_USER_TRUST_REASONS } = await import('./reportCounts.js');
  const path = seenUserReportsPath();
  assert.match(path, /^reports\?select=company_name&trust_reason=in\.\(direct_submission,anonymous_unverified,duplicate_user_company\)/);
  assert.match(path, /needs_review=not\.is\.true/);
  assert.match(path, /outcome=not\.in\./);
  assert.deepEqual(SEEN_USER_TRUST_REASONS, ['direct_submission', 'anonymous_unverified', 'duplicate_user_company']);
  const counts = countSeenUserReports([{ company_name: 'Walmart' }, { company_name: 'walmart ' }, { company_name: 'Target' }, { company_name: null }]);
  assert.equal(seenUserShare(counts, 'walmart', 48), 2);
  assert.equal(seenUserShare(counts, 'target', 0), 0);       // never more than the accounts behind the grade
  assert.equal(seenUserShare(counts, 'amazon', 26), 0);
  assert.equal(seenUserShare(null, 'walmart', 48), null);    // read failed → no split shown
});
