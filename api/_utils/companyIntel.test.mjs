// Tests for the company-intel fusion engine. Run: node --test api/_utils/companyIntel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateOutcomes, blendRate, fuseCompanyIntel, classifyPlatform, PRIOR_STRENGTH, SOURCE_TRUST,
} from './companyIntel.js';

test('classifyPlatform maps real reports.platform values to trust tiers', () => {
  assert.equal(classifyPlatform('Reddit r/recruitinghell'), 'reddit');
  assert.equal(classifyPlatform('Glassdoor'), 'ingest');
  assert.equal(classifyPlatform('seen_intel'), 'seen_intel');
  assert.equal(classifyPlatform('Company website'), 'direct');
  assert.equal(classifyPlatform(''), 'direct');
});

test('waiting/autoreject taxonomy: waiting is non-terminal, autoreject is neutral-resolved', () => {
  const a = aggregateOutcomes([{ outcome: 'waiting' }, { outcome: 'autoreject' }, { outcome: 'ghosted' }, { outcome: 'offer' }]);
  assert.equal(a.total, 4);
  assert.equal(a.resolved, 3);     // waiting excluded; autoreject counts as resolved
  assert.equal(a.ghost, 1);
  assert.equal(a.response, 1);     // offer only — autoreject is not a human response
});

test('aggregateOutcomes buckets resolved outcomes; ignores non-terminal', () => {
  const rows = [
    { outcome: 'ghosted' }, { outcome: 'ghosted' }, { outcome: 'interview' },
    { outcome: 'rejected' }, { outcome: 'offer' }, { outcome: 'pending' }, { outcome: '' },
  ];
  const a = aggregateOutcomes(rows);
  assert.equal(a.total, 7);
  assert.equal(a.resolved, 5);          // pending + '' excluded
  assert.equal(a.ghost, 2);
  assert.equal(a.response, 3);          // interview + rejected + offer
});

test('blendRate: no evidence → prior; no prior → evidence; 50/50 at PRIOR_STRENGTH', () => {
  assert.equal(blendRate(0.3, null, 0), 0.3);
  assert.equal(blendRate(null, 0.8, 10), 0.8);
  // effN == PRIOR_STRENGTH → exactly halfway between prior and empirical.
  assert.equal(blendRate(0.2, 0.6, PRIOR_STRENGTH), 0.4);
  // Large sample → empirical dominates.
  assert.ok(Math.abs(blendRate(0.2, 0.6, 1000) - 0.6) < 0.01);
});

test('web-only (no sources) yields the web rates unchanged', () => {
  const r = fuseCompanyIntel({ web: { ghost_rate: 0.42, response_rate: 0.58, avg_wait_days: 12, avg_rounds: 3, unpaid_rate: 0.1, report_count: 50 } });
  assert.equal(r.ghost_rate, 0.42);
  assert.equal(r.response_rate, 0.58);
  assert.equal(r.avg_wait_days, 12);
  assert.equal(r.report_count, 50);
  assert.deepEqual(r.sources_used, []);
});

test('real direct reports pull the fused rates toward empirical truth', () => {
  // Web prior says "great company" (low ghost), but 40 real reports show heavy ghosting.
  const reports = Array.from({ length: 40 }, () => ({ outcome: 'ghosted' }));
  const r = fuseCompanyIntel({
    web: { ghost_rate: 0.10, response_rate: 0.80, avg_wait_days: 10, report_count: 5 },
    sources: [{ type: 'direct', outcomes: reports }],
  });
  assert.ok(r.ghost_rate > 0.7, `ghost should rise toward 1.0, got ${r.ghost_rate}`);
  assert.ok(r.response_rate < 0.3, `response should fall, got ${r.response_rate}`);
  assert.equal(r.report_count, 45);   // 40 resolved + web's 5
  assert.deepEqual(r.sources_used, ['direct']);
  assert.equal(r.empirical.resolved, 40);
});

test('low-trust Reddit moves the prior less than high-trust direct reports', () => {
  const ghostReports = (n) => Array.from({ length: n }, () => ({ outcome: 'ghosted' }));
  const web = { ghost_rate: 0.2, response_rate: 0.6, avg_wait_days: 10, report_count: 0 };
  const viaReddit = fuseCompanyIntel({ web, sources: [{ type: 'reddit', outcomes: ghostReports(20) }] });
  const viaDirect = fuseCompanyIntel({ web, sources: [{ type: 'direct', outcomes: ghostReports(20) }] });
  // Same raw count, but direct (trust 1.0) shrinks the prior harder than reddit (0.3).
  assert.ok(viaDirect.ghost_rate > viaReddit.ghost_rate);
  assert.ok(SOURCE_TRUST.direct > SOURCE_TRUST.reddit);
});

test('multiple sources pool by trust; wait time is sample-weighted', () => {
  const r = fuseCompanyIntel({
    web: { ghost_rate: 0.3, response_rate: 0.5, avg_wait_days: 30, report_count: 0 },
    sources: [
      { type: 'direct', outcomes: [{ outcome: 'interview' }, { outcome: 'offer' }], avgWaitDays: 5 },
      { type: 'reddit', outcomes: [{ outcome: 'ghosted' }, { outcome: 'ghosted' }], avgWaitDays: 40 },
    ],
  });
  assert.equal(r.empirical.resolved, 4);
  assert.deepEqual(r.sources_used.sort(), ['direct', 'reddit']);
  // Blended wait sits between the web prior (30) and the evidence; finite + sane.
  assert.ok(r.avg_wait_days > 0 && r.avg_wait_days < 40);
});

test('tenure folds in and confidence reflects total sample', () => {
  const reports = Array.from({ length: 12 }, () => ({ outcome: 'interview' }));
  const withTenure = fuseCompanyIntel({
    web: { ghost_rate: 0.2, response_rate: 0.7, avg_wait_days: 10, report_count: 0 },
    sources: [{ type: 'direct', outcomes: reports }],
    avgTenureMonths: 60, tenureSample: 12,
  });
  assert.ok(withTenure.tenure_adjustment > 0);
  assert.equal(withTenure.overall_score, Math.max(0, Math.min(100, withTenure.base_score + withTenure.tenure_adjustment)));
  assert.ok(withTenure.confidence >= 0.66 && withTenure.confidence_label === 'high');
  assert.equal(withTenure.sufficient, true);
});

test('thin evidence stays close to the prior (2 reports barely move it)', () => {
  const r = fuseCompanyIntel({
    web: { ghost_rate: 0.2, response_rate: 0.7, avg_wait_days: 10, report_count: 8 },
    sources: [{ type: 'direct', outcomes: [{ outcome: 'ghosted' }, { outcome: 'ghosted' }] }],
  });
  // effN = 2 → weight = 2/10 = 0.2 toward empirical(1.0): 0.2*1 + 0.8*0.2 = 0.36
  assert.ok(Math.abs(r.ghost_rate - 0.36) < 0.001, `got ${r.ghost_rate}`);
});
