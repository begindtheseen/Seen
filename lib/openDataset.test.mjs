// Run: node --test lib/openDataset.test.mjs
// The open dataset (/data + CSV/JSON) and the monthly lists (/lists/*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDataset, buildList, csvCell, datasetCsv, datasetJson, datasetSummary, listJsonLd, isStaffingAgency, joinNames,
  CSV_COLUMNS, LIST_MIN_REPORTS, LIST_END_SIZE,
} from './openDataset.ts';

const OCT = new Date('2026-10-24T18:00:00Z');
const row = (name, fp, resp, ghost, extra = {}) => ({
  company_name: name, gradeable: true, overall_score: 80, response_rate: resp, ghost_rate: ghost,
  first_party_report_count: fp, mention_count: 0, data_source: 'reports', industry: null, updated_at: '2026-10-20T05:48:31.988Z', ...extra,
});

test('CSV cells: commas, quotes and line breaks are quoted; formula starts are neutralised', () => {
  assert.equal(csvCell('Walmart'), 'Walmart');
  assert.equal(csvCell('Johnson, Inc.'), '"Johnson, Inc."');
  assert.equal(csvCell('The "Best" Co'), '"The ""Best"" Co"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('-1 Corp'), "'-1 Corp");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(87), '87');
  assert.equal(csvCell(true), 'true');
});

test('CSV file: header row, one line per company, names with commas survive a round trip', () => {
  const d = buildDataset([row('johnson, smith & "co"', 12, 0.5, 0.25), row('walmart', 48, 0.866071, 0.133929, { mention_count: 32 })], null, OCT);
  const csv = datasetCsv(d);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.join(','));
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('Walmart,https://seenjobs.io/company/walmart,B-,80,87,13,48,,32,,false,2026-10-19,'));
  // Parse the quoted row back: the name keeps its comma and quotes.
  const cells = [...lines[2].matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]);
  assert.equal(cells[0].replace(/^"|"$/g, '').replace(/""/g, '"'), 'Johnson, Smith & "co"');
});

test('dataset: ungraded and duplicate names are left out; public split is clamped; unknown split is null', () => {
  const scores = [
    row('walmart', 48, 0.87, 0.13),
    row('Walmart', 3, 0.1, 0.9), // same company again: first (newest, as read) wins
    { company_name: 'thin co', gradeable: false, overall_score: null, first_party_report_count: 2 },
    row('robert half', 20, 0.4, 0.6, { industry: 'Staffing and Recruitment Services' }),
  ];
  const d = buildDataset(scores, new Map([['walmart', 70], ['robert half', 5]]), OCT);
  assert.deepEqual(d.rows.map((r) => r.company), ['Walmart', 'Robert Half']);
  assert.equal(d.rows[0].publicReports, 48); // 70 listed now, clamped to the grade's 48
  assert.equal(d.rows[1].publicReports, 5);
  assert.equal(d.totals.reports, 68);
  assert.equal(d.totals.publicReports, 53);
  assert.equal(d.rows[1].agency, true);
  const unknown = buildDataset(scores, null, OCT);
  assert.equal(unknown.rows[0].publicReports, null);
  assert.equal(unknown.totals.publicReports, null);
  assert.equal(datasetSummary(unknown), 'As of October 24, 2026, Seen grades 2 companies from 68 applicant reports.');
  assert.equal(datasetSummary(d), 'As of October 24, 2026, Seen grades 2 companies from 68 applicant reports; 53 of those reports were found in public posts such as Reddit threads and review sites, not submitted to Seen.');
});

test('rates appear only with enough reports (same rule as the company page)', () => {
  const d = buildDataset([row('small co', 3, 0.9, 0.1, { mention_count: 6 })], null, OCT);
  assert.equal(d.rows[0].responsePct, null);
  assert.equal(d.rows[0].ghostPct, null);
  assert.equal(datasetJson(d).companies[0].response_rate_pct, null);
});

test('agency detection: curated /agencies names, or a stored industry that says staffing', () => {
  assert.equal(isStaffingAgency('robert half'), true);
  assert.equal(isStaffingAgency('Insight Global', null), true);
  assert.equal(isStaffingAgency('korn ferry', 'Staffing'), true);
  assert.equal(isStaffingAgency('indeed', 'Online recruitment / job search technology'), false);
  assert.equal(isStaffingAgency('walmart', 'Retail'), false);
});

test('employers list: only non-agencies with the cutoff, ranked by hear-back; lead names best and worst', () => {
  const d = buildDataset([
    row('walmart', 48, 0.866071, 0.133929),
    row('bank of america', 23, 0.886076, 0.0759),
    row('amazon', 26, 0.618182, 0.254545),
    row('albertsons', 18, 0.959459, 0.04), // under the cutoff
    row('robert half', 20, 0.4, 0.6, { industry: 'Staffing' }), // an agency
  ], null, OCT);
  const l = buildList('employers-that-respond', d);
  assert.equal(l.cutoff, LIST_MIN_REPORTS);
  assert.deepEqual(l.ranked.map((r) => r.company), ['Bank of America', 'Walmart', 'Amazon']);
  assert.equal(l.lead, 'Of the 3 employers with 20 or more applicant reports on Seen, Bank of America replies to the most applicants: 89% hear back. Amazon replies to the fewest: 62%.');
  assert.equal(l.h1, 'Bank of America replies to the most applicants: 89% hear back');
  assert.deepEqual(l.below.map((r) => r.company), ['Albertsons']);
  assert.equal(l.thin, true);
  assert.match(l.thinNote, /^Only 3 employers meet the 20 report cutoff this month/);
  assert.equal(l.rowSay(l.ranked[0]), '23 applicant reports say 89% heard back');
  assert.doesNotMatch(l.title + l.description + l.h1, /[–—]/);
  assert.equal(l.title, 'Employers that respond to applicants, October 2026');
});

test('ties at the top share the verb in the plural', () => {
  const d = buildDataset([row('a co', 30, 0.9, 0.1), row('b co', 25, 0.9, 0.1), row('c co', 22, 0.5, 0.5)], null, OCT);
  const l = buildList('employers-that-respond', d);
  assert.match(l.lead, /A Co and B Co reply to the most applicants: 90% hear back\. C Co replies to the fewest: 50%\.$/);
});

test('agencies list: one qualifier reads as one, ranked by never-hear-back', () => {
  const d = buildDataset([row('robert half', 20, 0.4, 0.6, { industry: 'Staffing and Recruitment Services' }), row('insight global', 10, 0.5, 0.5)], null, OCT);
  const l = buildList('staffing-agencies-ghosting', d);
  assert.equal(l.lead, 'Only 1 staffing agency has 20 or more applicant reports on Seen: Robert Half, where 60% of applicants never hear back (20 applicant reports).');
  assert.equal(l.h1, 'Robert Half: 60% of applicants never hear back');
  assert.match(l.thinNote, /^Only 1 staffing agency meets the 20 report cutoff this month/);
  assert.deepEqual(l.below.map((r) => r.company), ['Insight Global']);
  assert.equal(l.rowSay(l.ranked[0]), '20 applicant reports say 60% never heard back');
  const ld = listJsonLd(l);
  assert.equal(ld['@type'], 'ItemList');
  assert.equal(ld.itemListElement.length, 1); // under-cutoff rows are not in the ItemList
  assert.deepEqual(ld.itemListElement[0], { '@type': 'ListItem', position: 1, name: 'Robert Half', url: 'https://seenjobs.io/company/robert-half', description: '20 applicant reports say 60% never heard back (Oct 2026).' });
});

test('no qualifier: says so, no ranking', () => {
  const d = buildDataset([row('insight global', 10, 0.5, 0.5)], null, OCT);
  const l = buildList('staffing-agencies-ghosting', d);
  assert.equal(l.ranked.length, 0);
  assert.equal(l.lead, 'No staffing agency has 20 or more applicant reports on Seen yet, so there is no ranking this month.');
  assert.equal(l.sections.length, 0);
});

test('a long ranking shows its best and worst ends with true rank numbers', () => {
  const scores = Array.from({ length: 30 }, (_, i) => row(`co ${String(i).padStart(2, '0')}`, 25, (100 - i) / 100, i / 100));
  const l = buildList('employers-that-respond', buildDataset(scores, null, OCT));
  assert.equal(l.thin, false);
  assert.equal(l.sections.length, 2);
  assert.equal(l.sections[0].rows.length, LIST_END_SIZE);
  assert.equal(l.sections[1].startRank, 21);
  assert.equal(l.sections[1].rows.at(-1).company, 'Co 29');
});

test('joinNames', () => {
  assert.equal(joinNames(['A']), 'A');
  assert.equal(joinNames(['A', 'B']), 'A and B');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
});
