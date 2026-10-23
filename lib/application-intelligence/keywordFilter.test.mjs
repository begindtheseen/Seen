// Tests: the keyword chip gate — pinned by the real phrase a job seeker saw on the live site
// ("are met", from "…ensure customer requirements are met"). Run:
//   node --test lib/application-intelligence/keywordFilter.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isUsableKeyword, usableKeywords } from './keywordFilter.js';
import { parseJobV2 } from './jobParserV2.js';
import { buildApplicationPackage } from './index.js';

test('stopword / auxiliary fragments are never keywords', () => {
  for (const bad of ['are met', 'is', 'be', 'has been', 'will be', 'the', 'and', 'of the', 'to', 'documented', 'ensuring', 'ab', 'a+', '12', 'not', 'must have', 'can', 'other', 'plus']) {
    assert.equal(isUsableKeyword(bad), false, `"${bad}" should be rejected`);
  }
});

test('real skills, tools and short aliases pass', () => {
  for (const ok of ['customer service', 'sql', 'crm', 'pos', 'point of sale', 'zendesk', 'cash handling', 'marketing', 'forklift', 'excel', 'microsoft office', 'route planning', 'conflict resolution', 'c#', 'c++']) {
    assert.equal(isUsableKeyword(ok), true, `"${ok}" should pass`);
  }
});

test('usableKeywords filters and dedupes, keeping order', () => {
  assert.deepEqual(usableKeywords(['CRM', 'are met', 'crm', 'Zendesk', '', null, 'is']), ['CRM', 'Zendesk']);
});

test('the live sentence no longer yields "are met" or "documented" as requirements', () => {
  const jd = 'Customer Support Specialist. Required: strong customer service and communication. Ensure all customer requirements are met and documented. Skills: Zendesk, CRM.';
  const labels = parseJobV2(jd, { jobTitle: 'Customer Support Specialist' }).requirements.map(r => r.normalizedLabel);
  assert.ok(!labels.includes('are met'), labels.join(', '));
  assert.ok(!labels.includes('documented'), labels.join(', '));
  assert.ok(labels.includes('zendesk') && labels.includes('crm'), labels.join(', '));
});

test('ATS missing-keyword chips never contain a fragment', () => {
  const resume = `Jordan Avery\nEXPERIENCE\nSales Associate — GNC 2020 - 2022\n• Advised customers on supplements and hit monthly sales goals 18 of 22 months\nSKILLS\nCustomer service · POS systems · Cash handling`;
  const jd = 'Customer Support Specialist. Required: customer service and communication. Ensure all customer requirements are met and documented. Experience with Zendesk and a CRM is required.';
  const pkg = buildApplicationPackage({ resumeText: resume, jobDescription: jd, jobTitle: 'Customer Support Specialist' });
  const chips = [...pkg.ats.missing_exact_keywords, ...(pkg.ats.missing_required_keywords || [])];
  for (const c of chips) assert.equal(isUsableKeyword(c), true, `chip "${c}" is a fragment`);
  assert.ok(chips.includes('zendesk'));
});
