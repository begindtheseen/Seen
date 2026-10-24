// Run: node --test lib/companyMeta.test.mjs
// Audit 2026-10-24 (money/legal L-1): /company/walmart's <meta description> + WebPage JSON-LD said
// 62 reports / 73% / 27% / 81, while the H1, FAQPage and OG card said 48 / 87% / 13% / 91. The
// fixtures below are the prod score row and the prod company_summaries row of that day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyMetaFacts, summaryMatchesScore, clipSentences } from './companyMeta.ts';
import { buildCompanySummary } from './companyPageSummary.ts';
import { buildCompanyFaq } from './server/companyFaq.js';

const walmart = { gradeable: true, overall_score: 91, response_rate: 0.866071, ghost_rate: 0.133929, avg_wait_days: null, report_count: 48, first_party_report_count: 48, mention_count: 32, data_source: 'reports' };
const staleSummary = { summary: 'Seen has 62 self-reported applicant reports and community signals about Walmart, drawn from public Reddit discussion and public review sites; these are claims, not verified facts. Of those, 33 have a resolved outcome, giving a 73% response rate and a 27% ghost rate, for a Seen grade of 81/100.', report_count_at_generation: 62, generated_at: '2026-10-17T18:16:14.767Z', data_basis: null };
const rows = Array.from({ length: 48 }, (_, i) => ({ id: String(i), outcome: i < 6 ? 'ghosted' : 'offer', platform: 'Reddit r/walmart', report_text: `t${i} [Source: https://www.reddit.com/r/walmart/comments/a${i}/]` }));

test('Walmart: metadata, FAQ and the page render the SAME numbers from one score row', () => {
  const facts = companyMetaFacts('Walmart', walmart, staleSummary);
  const page = buildCompanySummary(walmart, rows);
  assert.equal(facts.summaryUsable, false);                          // 62 ≠ 48, 81 ≠ 91 → the frozen paragraph is not quoted
  assert.equal(facts.reportCount, page.applicantReports);            // 48
  assert.equal(facts.respPct, page.responsePct);                     // 87
  assert.equal(facts.ghostPct, page.ghostPct);                       // 13
  assert.equal(facts.score, 91);
  assert.equal(facts.grade, 'A');
  assert.equal(facts.description, 'Walmart has a Seen Grade of A (91/100) from 48 applicant reports and 32 online mentions: 87% of applicants hear back, 13% are ghosted. Most applicants hear back. Self-reported outcomes from Seen users and public discussion — claims, not verified facts.');
  assert.doesNotMatch(facts.description, /62|73%|27%|81\/100/);
  // The FAQPage node is fed the same facts.
  const faq = buildCompanyFaq({ name: facts.name, overallScore: facts.score, ghostRate: facts.ratesShown ? walmart.ghost_rate : null, responseRate: facts.ratesShown ? walmart.response_rate : null, avgWaitDays: facts.waitDays, reportCount: facts.reportCount });
  assert.match(faq.find((f) => /ghost applicants/.test(f.question)).answer, /Based on 48 applicant reports, Walmart has a 13% ghost rate/);
  assert.match(faq.find((f) => /respond to/.test(f.question)).answer, /87% response rate/);
});

test('a stored summary is quoted only while its numbers match the live score', () => {
  const fresh = { ...staleSummary, summary: 'Seen has 48 self-reported applicant reports about Walmart. Of those, all have a resolved outcome, for a Seen grade of 91/100.', report_count_at_generation: 48 };
  assert.equal(summaryMatchesScore(fresh, 48, 91), true);
  assert.equal(summaryMatchesScore(fresh, 48, 90), false);           // same count, score moved → stale
  assert.equal(summaryMatchesScore(staleSummary, 48, 91), false);
  assert.equal(summaryMatchesScore({ ...fresh, summary: 'No score quoted here.' }, 48, 91), true);
  assert.equal(summaryMatchesScore(null, 48, 91), false);
  const facts = companyMetaFacts('Walmart', walmart, fresh);
  assert.equal(facts.summaryUsable, true);
  assert.equal(facts.description, fresh.summary);
  assert.equal(clipSentences('One. Two. Three.', 9), 'One. Two.');
  assert.equal(clipSentences('Short.', 50), 'Short.');
});

test('below 5 applicant reports no percentage is published anywhere; below the grade gate no grade', () => {
  const chipotle = { gradeable: true, overall_score: 72, response_rate: 0.767442, ghost_rate: 0.232558, report_count: 2, first_party_report_count: 2, mention_count: 6, data_source: 'reports' };
  const f = companyMetaFacts('Chipotle', chipotle, null);
  assert.equal(f.ratesShown, false);
  assert.equal(f.respPct, null);
  assert.doesNotMatch(f.description, /%/);
  assert.match(f.description, /Seen Grade of B \(72\/100\) from 2 applicant reports and 6 online mentions — too few applicant reports for a response rate \(5 needed\)/);
  assert.equal(buildCompanySummary(chipotle, []).ratesShown, false);  // the page agrees
  const faq = buildCompanyFaq({ name: f.name, overallScore: f.score, ghostRate: f.ratesShown ? chipotle.ghost_rate : null, responseRate: f.ratesShown ? chipotle.response_rate : null, avgWaitDays: f.waitDays, reportCount: f.reportCount });
  assert.equal(faq.some((q) => /ghost applicants|respond to/.test(q.question)), false);
  const ungraded = companyMetaFacts('Acme', { gradeable: false, overall_score: null, ghost_rate: null, response_rate: null, first_party_report_count: 3, report_count: 3, data_source: 'reports' }, staleSummary);
  assert.equal(ungraded.grade, null);
  assert.equal(ungraded.summaryUsable, false);
  assert.match(ungraded.description, /not graded on Seen yet \(3 applicant reports so far; a grade needs 5 pieces of evidence\)/);
  assert.match(companyMetaFacts('Zed', null, null).description, /0 applicant reports so far/);
});
