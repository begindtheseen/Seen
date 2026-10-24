// Run: node --test lib/industryVerdict.test.mjs
// Fixtures: the benchmark payloads the company pages showed on 2026-10-24 (conversion audit screenshots).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { industryVerdict } from './industryVerdict.ts'

const bench = (score, you, avg, industry = 'Retail & E-Commerce') => ({ scope: industry ? 'industry' : 'all', industry, company: { response: you, score }, average: { response: avg } })

test('Walmart A 91, 87% vs 81%: says "more than the average", never "about average", with the printed numbers', () => {
  const v = industryVerdict(bench(91, 0.866, 0.81), 'Walmart')
  assert.equal(v.kind, 'above')
  assert.equal(v.headline, 'Walmart replies to more applicants than the average Retail & E-Commerce employer on Seen (87% vs 81%)')
  assert.doesNotMatch(v.headline, /about average/)
})

test('Amazon B 65, 62% vs 65% across all employers: "fewer", which a B can carry', () => {
  const v = industryVerdict(bench(65, 0.62, 0.65, null), 'Amazon')
  assert.equal(v.kind, 'below')
  assert.equal(v.headline, 'Amazon replies to fewer applicants than the average employer on Seen (62% vs 65%)')
})

test('a sentence that would contradict the grade is replaced by a neutral heading', () => {
  // A grade with a reply rate no better than average
  assert.equal(industryVerdict(bench(85, 0.80, 0.81), 'X').kind, 'none')
  assert.equal(industryVerdict(bench(85, 0.70, 0.81), 'X').kind, 'none')
  // D / F with a reply rate no worse than average
  assert.equal(industryVerdict(bench(40, 0.82, 0.81), 'Y').kind, 'none')
  assert.equal(industryVerdict(bench(20, 0.90, 0.60), 'Y').headline, 'How Y compares with Retail & E-Commerce')
  // B / C carry any comparison
  assert.equal(industryVerdict(bench(58, 0.40, 0.41, 'Staffing'), 'Robert Half').kind, 'same')
})

test('no reply rates → neutral heading, no invented comparison', () => {
  assert.equal(industryVerdict(bench(70, null, 0.6), 'Z').kind, 'none')
})
