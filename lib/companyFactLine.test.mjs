// Run: node --test lib/companyFactLine.test.mjs
// The one quotable sentence printed by llms.txt, /data and /lists (and adoptable by the company page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyFactLine, factMonth, longMonth, attributionLine, companyPageUrl } from './companyFactLine.ts';
import { companyMetaFacts } from './companyMeta.ts';

const OCT = new Date('2026-10-24T18:00:00Z');
// Prod score row for Walmart, 2026-10-24 (read-only).
const walmart = { gradeable: true, overall_score: 91, response_rate: 0.866071, ghost_rate: 0.133929, avg_wait_days: null, report_count: 48, first_party_report_count: 48, mention_count: 32, data_source: 'reports' };

test('Walmart: the canonical sentence, its parts and its URL', () => {
  const f = companyFactLine(companyMetaFacts('Walmart', walmart, null), { asOf: OCT, storedName: 'walmart' });
  assert.equal(f.sentence, 'Walmart: 87% of applicants hear back, 13% never do (48 applicant accounts and 32 online mentions, Oct 2026)');
  assert.equal(f.claim, '87% of applicants hear back, 13% never do');
  assert.equal(f.url, 'https://seenjobs.io/company/walmart');
  assert.equal(f.line, `${f.sentence} https://seenjobs.io/company/walmart`);
});

test('plurals: 1 applicant account, 1 online mention; no mentions clause when there are none', () => {
  const one = { gradeable: true, overall_score: 70, response_rate: 0.5, ghost_rate: 0.5, first_party_report_count: 5, mention_count: 1, data_source: 'reports' };
  assert.match(companyFactLine(companyMetaFacts('Acme', one, null), { asOf: OCT }).sentence, /\(5 applicant accounts and 1 online mention, Oct 2026\)$/);
  const solo = { gradeable: true, overall_score: 70, first_party_report_count: 1, mention_count: 8, data_source: 'reports' };
  const f = companyFactLine(companyMetaFacts('Solo', solo, null), { asOf: OCT });
  assert.match(f.basis, /^1 applicant account and 8 online mentions$/);
  const none = { ...one, mention_count: 0 };
  assert.equal(companyFactLine(companyMetaFacts('Acme', none, null), { asOf: OCT }).basis, '5 applicant accounts');
});

test('no data, or not graded: null (nothing is invented)', () => {
  assert.equal(companyFactLine(null), null);
  assert.equal(companyFactLine(companyMetaFacts('Nobody', null, null)), null);
  const ungraded = { gradeable: false, overall_score: null, first_party_report_count: 2, data_source: 'reports' };
  assert.equal(companyFactLine(companyMetaFacts('Thin Co', ungraded, null)), null);
});

test('graded with too few reports for a rate: grade only, no percentage', () => {
  const s = { gradeable: true, overall_score: 71, response_rate: 0.9, ghost_rate: 0.1, first_party_report_count: 3, mention_count: 6, data_source: 'reports' };
  const f = companyFactLine(companyMetaFacts('Small Co', s, null), { asOf: OCT });
  assert.equal(f.sentence, 'Small Co: Seen Grade C- (71/100), too few applicant accounts for a response rate (3 applicant accounts and 6 online mentions, Oct 2026)');
  assert.doesNotMatch(f.sentence, /%/);
});

test('agency vs employer wording', () => {
  const rh = { gradeable: true, overall_score: 58, response_rate: 0.4, ghost_rate: 0.6, first_party_report_count: 20, mention_count: 0, data_source: 'reports' };
  const agency = companyFactLine(companyMetaFacts('Robert Half', rh, null), { asOf: OCT, agency: true, storedName: 'robert half' });
  assert.equal(agency.sentence, 'Robert Half (staffing agency): 40% of applicants hear back, 60% never do (20 applicant accounts, Oct 2026)');
  assert.equal(agency.url, 'https://seenjobs.io/company/robert-half');
  const employer = companyFactLine(companyMetaFacts('Robert Half', rh, null), { asOf: OCT });
  assert.ok(employer.sentence.startsWith('Robert Half: 40%'));
});

test('a 0% ghost rate reads as words, not "0% never do"', () => {
  const s = { gradeable: true, overall_score: 97, response_rate: 1, ghost_rate: 0, first_party_report_count: 11, data_source: 'reports' };
  assert.equal(companyFactLine(companyMetaFacts("Raising Cane's", s, null), { asOf: OCT }).claim, '100% of applicants hear back, none report being ghosted');
});

test('URLs use the one slug scheme (punctuation kept, spaces as hyphens)', () => {
  assert.equal(companyPageUrl("dick's sporting goods"), "https://seenjobs.io/company/dick's-sporting-goods");
  assert.equal(companyPageUrl('h&m'), 'https://seenjobs.io/company/h%26m');
});

test('dates are California months; no em or en dashes anywhere', () => {
  // 2026-11-01 05:00 UTC is still October 31 in California.
  assert.equal(factMonth(new Date('2026-11-01T05:00:00Z')), 'Oct 2026');
  assert.equal(longMonth(OCT), 'October 2026');
  assert.equal(attributionLine(OCT), 'Source: Seen (seenjobs.io), applicant accounts, October 2026');
  const f = companyFactLine(companyMetaFacts('Walmart', walmart, null), { asOf: OCT });
  assert.doesNotMatch(f.line + attributionLine(OCT), /[–—]/);
});
