import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseCompanyIntel, POPULATION_PRIOR, POPULATION_PRIOR_STRENGTH } from './companyIntel.js';
import { gradeLetter } from '../../lib/gradeScale.js';

const outs = (n, outcome) => Array.from({ length: n }, () => ({ outcome }));

test('two glowing public posts no longer make a perfect score; thirty Seen reports are the company\'s own', () => {
  const thin = fuseCompanyIntel({ sources: [{ type: 'reddit', outcomes: outs(2, 'offer') }] });
  assert.ok(thin.overall_score < 80, `2 public posts: ${thin.overall_score}`);
  assert.ok(Math.abs(thin.response_rate - POPULATION_PRIOR.response_rate) < 0.1, 'near the typical company');
  const bad = fuseCompanyIntel({ sources: [{ type: 'reddit', outcomes: outs(1, 'ghosted') }] });
  assert.notEqual(gradeLetter(bad.overall_score), 'F', `1 bad post: ${bad.overall_score}`);
  const strong = fuseCompanyIntel({ sources: [{ type: 'direct', outcomes: outs(30, 'offer') }] });
  assert.ok(strong.response_rate > 0.95, `30 Seen reports: ${strong.response_rate}`);
  assert.ok(strong.overall_score >= 90, `30 Seen reports: ${strong.overall_score}`);
  assert.equal(POPULATION_PRIOR_STRENGTH, 2);
});

test('no evidence keeps the neutral 50 baseline; a web-research prior still uses its own blend', () => {
  assert.equal(fuseCompanyIntel({ sources: [] }).overall_score, 50);
  const withWeb = fuseCompanyIntel({ web: { response_rate: 0.2, ghost_rate: 0.8 }, sources: [{ type: 'direct', outcomes: outs(1, 'offer') }] });
  assert.ok(withWeb.response_rate < 0.4, 'blends with the web prior, not the population prior');
});
