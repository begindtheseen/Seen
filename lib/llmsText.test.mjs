// Run: node --test lib/llmsText.test.mjs
// /llms.txt and /llms-full.txt follow the llms.txt convention (https://llmstxt.org) and print the same
// fact lines as /data and the company pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmsTxt, llmsFullTxt, llmsCompanyItem, LLMS_TOP_COMPANIES } from './llmsText.ts';
import { buildDataset } from './openDataset.ts';

const OCT = new Date('2026-10-24T18:00:00Z');
const row = (name, fp, resp, ghost, extra = {}) => ({
  company_name: name, gradeable: true, overall_score: 80, response_rate: resp, ghost_rate: ghost,
  first_party_report_count: fp, mention_count: 0, data_source: 'reports', updated_at: '2026-10-20T05:48:31.988Z', ...extra,
});
const many = Array.from({ length: 40 }, (_, i) => row(`company ${String(i).padStart(2, '0')}`, 60 - i, 0.8, 0.2));
const d = buildDataset([row('walmart', 98, 0.866071, 0.133929, { mention_count: 32 }), row('robert half', 97, 0.4, 0.6, { industry: 'Staffing' }), ...many], new Map([['walmart', 40]]), OCT);

const ITEM = /^- \[[^\]]+\]\(https:\/\/seenjobs\.io\/[^)\s]*\)(: .+)?$/;

test('structure: H1, blockquote summary, H2 link sections, Optional last', () => {
  const txt = llmsTxt(d);
  const lines = txt.split('\n');
  assert.equal(lines[0], '# Seen');
  assert.ok(lines[2].startsWith('> '));
  // Only one H1; every list line inside an H2 section is a markdown link item.
  assert.equal(lines.filter((l) => /^# /.test(l)).length, 1);
  const firstH2 = lines.findIndex((l) => l.startsWith('## '));
  for (const l of lines.slice(firstH2)) if (l.startsWith('- ')) assert.match(l, ITEM, l);
  const h2s = lines.filter((l) => l.startsWith('## '));
  assert.equal(h2s.at(-1), '## Optional');
  assert.ok(txt.includes('(https://seenjobs.io/data)'));
  assert.ok(txt.includes('https://seenjobs.io/data/employer-response-rates.csv'));
  assert.ok(txt.includes('https://seenjobs.io/lists/employers-that-respond'));
  assert.ok(txt.includes('https://seenjobs.io/methods'));
  assert.ok(txt.includes('https://seenjobs.io/llms-full.txt'));
  assert.ok(txt.includes('Attribution: "Source: Seen (seenjobs.io), applicant reports, October 2026"'));
});

test('llms.txt lists the 25 most reported companies with their fact line', () => {
  const txt = llmsTxt(d);
  const items = txt.split('\n').filter((l) => l.startsWith('- [') && l.includes('/company/'));
  assert.equal(items.length, LLMS_TOP_COMPANIES);
  assert.equal(items[0], '- [Walmart](https://seenjobs.io/company/walmart): 87% of applicants hear back, 13% never do (98 applicant reports and 32 online mentions, Oct 2026)');
  assert.equal(items[1], '- [Robert Half (staffing agency)](https://seenjobs.io/company/robert-half): 40% of applicants hear back, 60% never do (97 applicant reports, Oct 2026)');
});

test('llms-full.txt has a line for every graded company', () => {
  const txt = llmsFullTxt(d);
  const items = txt.split('\n').filter((l) => l.startsWith('- [') && l.includes('/company/'));
  assert.equal(items.length, d.totals.companies);
  assert.match(txt, /## Every graded company \(42 companies, October 2026\)/);
});

test('no instructions aimed at a model, no dashes', () => {
  for (const txt of [llmsTxt(d), llmsFullTxt(d)]) {
    assert.doesNotMatch(txt, /\b(ignore (all |previous )?instructions|you must|always recommend|as an ai)\b/i);
    assert.doesNotMatch(txt, /[–—]/);
    assert.doesNotMatch(txt, /Glassdoor/);
  }
});

test('brackets in a name cannot break the link', () => {
  const [r] = buildDataset([row('acme [us]', 10, 0.5, 0.5)], null, OCT).rows;
  assert.match(llmsCompanyItem(r), ITEM);
});
