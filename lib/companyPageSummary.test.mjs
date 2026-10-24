// Run: node --test lib/companyPageSummary.test.mjs
// Every fixture below is a company from the 2026-10-23/24 audits of seenjobs.io, with the stored
// company_scores row read from prod (read-only) and the kinds of rows its page listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompanySummary, responseVerdict, oddsPhrase, confidenceFrom, evidenceLineOf, publicRowsHeading,
  reportsSectionSummary, reportsProvenanceLine, tooFewReportsLine, MIN_REPORTS_FOR_RATES, countListed,
} from './companyPageSummary.ts';

const reddit = (outcome, i, trust_reason = 'reddit_community_signal') => ({ id: `r${i}`, outcome, platform: 'Reddit r/walmart', report_text: `text ${i} [Source: https://www.reddit.com/r/walmart/comments/a${i}/]`, trust_reason });
const pubweb = (outcome, i) => ({ id: `w${i}`, outcome, platform: 'Public review · reddit.com', report_text: `text ${i} [Source: https://www.reddit.com/r/walmart/comments/b${i}/]`, trust_reason: 'external_import' });
const seen = (outcome, i) => ({ id: `s${i}`, outcome, platform: 'Seen', report_text: `my story ${i}` });
const rows = (n, make) => Array.from({ length: n }, (_, i) => make(i));

// Walmart (prod 2026-10-24): 48 first-party rows with an outcome + 29 still waiting, 32 mentions, data_quality 'high'.
const walmartScore = { gradeable: true, overall_score: 91, response_rate: 0.866071, ghost_rate: 0.133929, avg_wait_days: null, report_count: 48, first_party_report_count: 48, web_report_count: 0, mention_count: 32, employee_review_count: 0, data_quality: 'high', data_source: 'reports' };
const walmartRows = [
  ...rows(16, (i) => reddit('waiting', i, 'process_knowledge')), ...rows(13, (i) => reddit('waiting', 100 + i)),
  ...rows(10, (i) => pubweb('offer', i)), ...rows(6, (i) => reddit('hired', 200 + i)), ...rows(4, (i) => pubweb('rejected', 300 + i)),
  ...rows(8, (i) => reddit('ghosted', 400 + i)), ...rows(4, (i) => pubweb('interview', 500 + i)), ...rows(4, (i) => reddit('offer', 600 + i)),
  ...rows(4, (i) => reddit('interview', 700 + i)), ...rows(4, (i) => reddit('human', 800 + i)), ...rows(4, (i) => pubweb('ghosted', 900 + i)),
];

test('Walmart: one denominator — 48 applicant reports everywhere, 29 waiting named and never counted, 77 rows labelled as rows', () => {
  const s = buildCompanySummary(walmartScore, walmartRows);
  assert.equal(s.graded, true);
  assert.equal(s.applicantReports, 48);
  assert.equal(s.listed.rows, 77);
  assert.equal(s.listed.withOutcome, 48);
  assert.equal(s.listed.waiting, 29);
  assert.equal(s.listed.publicDiscussion, 77);
  assert.equal(s.listed.publicWithOutcome, 48);
  assert.equal(s.listed.publicWaiting, 29);
  assert.equal(s.listedNote, '');                    // list and grade agree → no note
  assert.equal(s.ratesShown, true);
  assert.equal(s.responsePct, 87);
  assert.equal(s.evidenceLine, '48 applicant reports · 32 online mentions');
  assert.deepEqual(s.confidence, { level: 'high', word: 'High confidence', emoji: '🟢', label: 'High confidence · 48 applicant reports · 32 online mentions' });
  assert.equal(s.verdict, 'Most applicants hear back — 87% get a response.');
  assert.equal(s.oddsContext, 'Most applicants here hear back · the share of 48 applicant reports (and 32 online mentions, each counting half) that heard back');
  assert.equal(publicRowsHeading(s.listed), '77 rows from public discussion & review sites · 48 with an outcome · 29 still waiting (not counted)');
  assert.equal(reportsSectionSummary(s), '48 applicant reports · 29 still waiting (no outcome yet) · 12 ghosted · 12 interviewed · 20 hired · 48 from public discussion');
  assert.match(reportsProvenanceLine(s), /^48 applicant reports with an outcome — the rows the grade is built from · 48 found in public discussion \(reduced weight\) · 29 more still waiting/);
  assert.deepEqual(s.outcomes, { ghosted: 12, rejected: 4, interview: 12, hired: 20, waiting: 29 });
});

test('Insight Global: the verdict sentence and the odds panel come from the SAME 50% response rate', () => {
  const score = { gradeable: true, overall_score: 60, response_rate: 0.5, ghost_rate: 0.5, report_count: 10, first_party_report_count: 10, mention_count: 0, data_quality: 'low', data_source: 'reports' };
  const s = buildCompanySummary(score, [...rows(5, (i) => seen('ghosted', i)), ...rows(5, (i) => seen('interview', 10 + i))]);
  assert.equal(s.verdictKind, 'mixed');
  assert.equal(s.verdict, 'Mixed: about 50% of applicants hear back, 50% are ghosted.');
  assert.match(s.oddsContext, /^Mixed — about half hear back/);
  assert.equal(responseVerdict(0.5), 'mixed');
  assert.equal(responseVerdict(0.49), 'few_hear_back');
  assert.equal(responseVerdict(0.75), 'most_hear_back');
  assert.equal(oddsPhrase('few_hear_back'), 'Few applicants here hear back');
  // A company most applicants never hear from says so in both places.
  const few = buildCompanySummary({ ...score, response_rate: 0.3, ghost_rate: 0.6 }, []);
  assert.equal(few.verdict, 'Most applicants never hear back — only 30% get a response, 60% are ghosted.');
  assert.equal(few.verdictKind, 'few_hear_back');
});

test('Chipotle: 2 applicant reports + 6 mentions is graded but shows NO percentage — "too few reports"', () => {
  const score = { gradeable: true, overall_score: 72, response_rate: 0.767442, ghost_rate: 0.232558, report_count: 2, first_party_report_count: 2, mention_count: 6, data_quality: 'low', data_source: 'reports' };
  const s = buildCompanySummary(score, rows(2, (i) => reddit('offer', i)));
  assert.equal(s.graded, true);
  assert.equal(s.ratesShown, false);
  assert.equal(s.responsePct, null);
  assert.equal(s.ghostPct, null);
  assert.equal(s.verdictKind, null);
  assert.equal(s.verdict, 'Graded from 2 applicant reports · 6 online mentions — too few applicant reports for a reliable response rate (5 needed).');
  assert.equal(s.oddsContext, tooFewReportsLine(2));
  assert.equal(tooFewReportsLine(2), 'Too few applicant reports (2) to estimate a response chance — 5 needed.');
  assert.equal(MIN_REPORTS_FOR_RATES, 5);
  // Exactly at the bar the percentage is shown.
  assert.equal(buildCompanySummary({ ...score, first_party_report_count: 5, report_count: 5 }, []).ratesShown, true);
});

test('Target: ONE confidence label from data_quality — the card can no longer say "High" under a "Moderate" hero', () => {
  const score = { gradeable: true, overall_score: 93, response_rate: 0.90625, ghost_rate: 0.09375, report_count: 13, first_party_report_count: 13, mention_count: 6, employee_review_count: 0, data_quality: 'medium', data_source: 'reports' };
  const s = buildCompanySummary(score, rows(13, (i) => reddit('offer', i)));
  assert.equal(s.confidence.level, 'moderate');
  assert.equal(s.confidence.label, 'Moderate confidence · 13 applicant reports · 6 online mentions');
  assert.equal(confidenceFrom('strong', 'x').level, 'high');
  assert.equal(confidenceFrom('moderate', 'x').level, 'moderate');
  assert.equal(confidenceFrom('limited', 'x').level, 'low');
  assert.equal(confidenceFrom('', 'x'), null);
  // A web-research estimate with no first-party reports carries no confidence badge at all.
  assert.equal(buildCompanySummary({ gradeable: true, overall_score: 70, response_rate: 0.6, ghost_rate: 0.3, report_count: 3085, data_source: 'web_search', data_quality: 'high' }, []).confidence, null);
});

test('Amazon: when the list and the stored count disagree the page says so once, instead of showing 26 and 28', () => {
  const score = { gradeable: true, overall_score: 80, response_rate: 0.618182, ghost_rate: 0.254545, report_count: 26, first_party_report_count: 26, mention_count: 33, employee_review_count: 0, data_quality: 'high', data_source: 'reports' };
  const s = buildCompanySummary(score, rows(28, (i) => pubweb('ghosted', i)));
  assert.equal(s.applicantReports, 26);
  assert.equal(s.listed.withOutcome, 28);
  assert.equal(s.listedNote, 'The grade was last built from 26 applicant reports; this page lists 28 with an outcome — it is refreshed on the next recompute.');
});

test('employee reviews and never-scored rows are listed but never applicant reports', () => {
  const emp = { id: 'e', outcome: 'human', platform: 'Indeed', report_text: 'Employee review [B+] good place to work', trust_reason: 'external_import' };
  const rejected = { id: 'x', outcome: 'ghosted', platform: 'Seen', report_text: 'nope', trust_reason: 'admin_rejected' };
  const { listed, scorableWithOutcome } = countListed([emp, rejected, seen('hired', 1), seen('waiting', 2)]);
  assert.equal(listed.employee, 1);
  assert.equal(listed.imported, 1);
  assert.equal(listed.withOutcome, 2);        // the rejected row still lists with its outcome…
  assert.equal(scorableWithOutcome, 1);       // …but is not one the grade counts
  assert.equal(listed.waiting, 1);
  assert.equal(evidenceLineOf(11, 0, 3), '11 applicant reports · 3 employee reviews');
});

test('below the grade gate: no rates, no verdict, counts still honest', () => {
  const s = buildCompanySummary({ gradeable: false, overall_score: null, response_rate: null, ghost_rate: null, first_party_report_count: 3, report_count: 3, mention_count: 0, data_quality: 'low', data_source: 'reports' }, rows(3, (i) => seen('ghosted', i)));
  assert.equal(s.graded, false);
  assert.equal(s.verdict, '');
  assert.equal(s.oddsContext, '');
  assert.equal(s.ratesShown, false);
  assert.equal(s.applicantReports, 3);
  assert.equal(s.listed.withOutcome, 3);
  assert.equal(s.listedNote, '');
  assert.equal(buildCompanySummary(null, null).applicantReports, 0);
  assert.equal(reportsSectionSummary(buildCompanySummary(null, [])), 'None yet — be the first to report');
});
