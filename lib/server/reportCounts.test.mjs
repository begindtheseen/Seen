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
