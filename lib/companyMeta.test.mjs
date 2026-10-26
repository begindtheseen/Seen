// Run: node --test lib/companyMeta.test.mjs
// Audit 2026-10-24 (money/legal L-1): /company/walmart's <meta description> + WebPage JSON-LD said
// 62 reports / 73% / 27% / 81, while the H1, FAQPage and OG card said 48 / 87% / 13% / 91. The
// fixtures below are the prod score row and the prod company_summaries row of that day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyMetaFacts, summaryMatchesScore, clipSentences, companyRobots } from './companyMeta.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCompanySummary } from './companyPageSummary.ts';
import { buildCompanyFaq } from './server/companyFaq.js';

const walmart = { gradeable: true, overall_score: 91, response_rate: 0.866071, ghost_rate: 0.133929, avg_wait_days: null, report_count: 48, first_party_report_count: 48, mention_count: 32, data_source: 'reports', updated_at: '2026-10-24T05:00:00.000Z' };
const staleSummary = { summary: 'Seen has 62 self-reported applicant accounts and community signals about Walmart, drawn from public Reddit discussion and public review sites; these are claims, not verified facts. Of those, 33 have a resolved outcome, giving a 73% response rate and a 27% ghost rate, for a Seen grade of 81/100.', report_count_at_generation: 62, generated_at: '2026-10-17T18:16:14.767Z', data_basis: null };
const rows = Array.from({ length: 48 }, (_, i) => ({ id: String(i), outcome: i < 6 ? 'ghosted' : 'offer', platform: 'Reddit r/walmart', report_text: `t${i} [Source: https://www.reddit.com/r/walmart/comments/a${i}/]` }));

test('Walmart: metadata, FAQ and the page render the SAME numbers from one score row', () => {
  const facts = companyMetaFacts('Walmart', walmart, staleSummary);
  const page = buildCompanySummary(walmart, rows);
  assert.equal(facts.summaryUsable, false);                          // 62 ≠ 48, 81 ≠ 91 → the frozen paragraph is not quoted
  assert.equal(facts.reportCount, page.applicantReports);            // 48
  assert.equal(facts.respPct, page.responsePct);                     // 87
  assert.equal(facts.ghostPct, page.ghostPct);                       // 13
  assert.equal(facts.score, 91);
  assert.equal(facts.grade, 'A-');
  // 05:00 UTC Oct 24 is still Oct 23 in California, same month either way.
  assert.equal(facts.updatedMonth, 'Oct 2026');
  assert.equal(facts.title, 'Walmart application status: who hears back (48 accounts)');
  assert.equal(facts.description, '87% of applicants hear back from Walmart; 13% never do. From 48 applicant accounts and 32 online mentions, updated Oct 2026. Seen Grade A- (91/100). Applicants\' own accounts, not verified facts.');
  assert.doesNotMatch(facts.description, /62|73%|27%|81\/100/);
  assert.doesNotMatch(`${facts.title} ${facts.description}`, /[—–]/);
  // The FAQPage node is fed the same facts.
  const faq = buildCompanyFaq({ name: facts.name, overallScore: facts.score, ghostRate: facts.ratesShown ? walmart.ghost_rate : null, responseRate: facts.ratesShown ? walmart.response_rate : null, avgWaitDays: facts.waitDays, reportCount: facts.reportCount, mentionCount: facts.mentions });
  assert.match(faq.find((f) => /ghost applicants/.test(f.question)).answer, /^Of 48 applicant accounts on Seen, 13% say Walmart never got back to them/);
  assert.match(faq.find((f) => /application status/.test(f.question)).answer, /^Of 48 applicant accounts on Seen, 87% say Walmart got back to them .* and 13% say they never heard back\./);
  assert.match(faq.find((f) => /hiring process/.test(f.question)).answer, /Seen grades the Walmart hiring process A- \(91\/100\) from 48 applicant accounts and 32 online mentions\./);
  // Walmart's stored wait is null: no answer mentions a wait.
  assert.equal(faq.some((f) => /wait|how long/i.test(`${f.question} ${f.answer}`)), false);
});

test('a stored summary is quoted only while its numbers match the live score', () => {
  const fresh = { ...staleSummary, summary: 'Seen has 48 self-reported applicant accounts about Walmart. Of those, all have a resolved outcome, for a Seen grade of 91/100.', report_count_at_generation: 48 };
  assert.equal(summaryMatchesScore(fresh, 48, 91), true);
  assert.equal(summaryMatchesScore(fresh, 48, 90), false);           // same count, score moved → stale
  assert.equal(summaryMatchesScore(staleSummary, 48, 91), false);
  assert.equal(summaryMatchesScore({ ...fresh, summary: 'No score quoted here.' }, 48, 91), true);
  assert.equal(summaryMatchesScore(null, 48, 91), false);
  const facts = companyMetaFacts('Walmart', walmart, fresh);
  assert.equal(facts.summaryUsable, true);
  // The description always leads with the answer, built from the facts (search plan 2026-10-24).
  assert.match(facts.description, /^87% of applicants hear back from Walmart/);
  assert.equal(clipSentences('One. Two. Three.', 9), 'One. Two.');
  assert.equal(clipSentences('Short.', 50), 'Short.');
});

test('below 5 applicant accounts no percentage is published anywhere; below the grade gate no grade', () => {
  const chipotle = { gradeable: true, overall_score: 72, response_rate: 0.767442, ghost_rate: 0.232558, report_count: 2, first_party_report_count: 2, mention_count: 6, data_source: 'reports' };
  const f = companyMetaFacts('Chipotle', chipotle, null);
  assert.equal(f.ratesShown, false);
  assert.equal(f.respPct, null);
  assert.doesNotMatch(f.description, /%/);
  assert.match(f.description, /Seen Grade of C- \(72\/100\) from 2 applicant accounts and 6 online mentions\. Too few applicant accounts for a response rate yet \(5 needed\)/);
  assert.equal(f.title, 'Chipotle application status: who hears back (2 accounts)');
  assert.equal(buildCompanySummary(chipotle, []).ratesShown, false);  // the page agrees
  const faq = buildCompanyFaq({ name: f.name, overallScore: f.score, ghostRate: f.ratesShown ? chipotle.ghost_rate : null, responseRate: f.ratesShown ? chipotle.response_rate : null, avgWaitDays: f.waitDays, reportCount: f.reportCount });
  assert.equal(faq.some((q) => /ghost applicants|application status/.test(q.question)), false);
  assert.doesNotMatch(faq.map((q) => q.answer).join(' '), /%/);
  const ungraded = companyMetaFacts('Acme', { gradeable: false, overall_score: null, ghost_rate: null, response_rate: null, first_party_report_count: 3, report_count: 3, data_source: 'reports' }, staleSummary);
  assert.equal(ungraded.grade, null);
  assert.equal(ungraded.summaryUsable, false);
  assert.match(ungraded.description, /not graded on Seen yet \(3 applicant accounts so far; a grade needs 5, an online mention counting half\)/);
  assert.equal(ungraded.title, 'Acme application status on Seen');
  assert.match(companyMetaFacts('Zed', null, null).description, /0 applicant accounts so far/);
});

test('a wait under one day is never published; a real one is', () => {
  for (const avg_wait_days of [0, 0.3, null]) assert.equal(companyMetaFacts('Walmart', { ...walmart, avg_wait_days }, null).waitDays, null);
  const f = companyMetaFacts('Walmart', { ...walmart, avg_wait_days: 9.4 }, null);
  assert.equal(f.waitDays, 9);
  assert.match(f.description, /Average wait to hear back: 9 days\./);
});

test('robots: a graded page is indexable; an ungraded one is noindex,follow; a failed read decides nothing', () => {
  assert.deepEqual(companyRobots(companyMetaFacts('Walmart', walmart, null).gradeable, true), {});
  const ungraded = companyMetaFacts('Acme', { gradeable: false, overall_score: null, first_party_report_count: 2, report_count: 2, data_source: 'reports' }, null);
  assert.deepEqual(companyRobots(ungraded.gradeable, true), { robots: { index: false, follow: true } });
  assert.deepEqual(companyRobots(companyMetaFacts('Nobody', null, null).gradeable, true), { robots: { index: false, follow: true } });
  assert.deepEqual(companyRobots(false, false), {});
});

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
test('the company layout spreads companyRobots into its metadata; job listings are noindex,follow; /jobs is not', () => {
  const company = readFileSync(path.join(appDir, 'company', '[slug]', 'layout.tsx'), 'utf8');
  assert.match(company, /\.\.\.companyRobots\(facts\.gradeable, scoreRead\)/);
  assert.match(company, /getScoreState\(slug\)/);
  const job = readFileSync(path.join(appDir, 'jobs', '[id]', 'layout.tsx'), 'utf8');
  assert.match(job, /robots: \{ index: false, follow: true \}/);
  const jobs = readFileSync(path.join(appDir, 'jobs', 'layout.tsx'), 'utf8');
  assert.doesNotMatch(jobs, /index: false|noindex/);
  const sitemap = readFileSync(path.join(appDir, 'sitemap.ts'), 'utf8');
  assert.doesNotMatch(sitemap.replace(/\/\/.*$/gm, ''), /\/jobs\/\$|\/faq\/does-|hiring-process/);
  assert.match(sitemap, /\/methods/);
});
