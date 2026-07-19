// Tests for the employer posting-analytics shaper — the honesty rules are the point:
// canonical outcome bucketing, no fabricated rates below the report floor, real source/role cuts.
// Run: node --test lib/server/employerAnalytics.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeEmployerAnalytics, gradeOf, monthKey } from './employerAnalytics.js';

const rep = (outcome, extra = {}) => ({
  outcome,
  source: extra.source ?? 'direct',
  platform: extra.platform ?? 'Reddit',
  role: extra.role ?? 'Cashier',
  wait_days: extra.wait_days,
  created_at: extra.created_at ?? '2026-02-15T00:00:00Z',
});

test('empty input → no data, rates withheld, never fabricated', () => {
  const a = shapeEmployerAnalytics([], null);
  assert.equal(a.hasData, false);
  assert.equal(a.reportCount, 0);
  assert.equal(a.headline.grade, null);
  assert.equal(a.headline.ghostRate, null);
  assert.equal(a.headline.responseRate, null);
  assert.equal(a.headline.ratesWithheld, true);
  assert.deepEqual(a.sources, []);
  assert.deepEqual(a.monthly, []);
  assert.deepEqual(a.roles, []);
});

test('buckets outcomes with the canonical mapping (responded = hired+offer+interview+human, ghost = ghosted, rejected = autoreject+rejected)', () => {
  const rows = [
    rep('hired'), rep('offer'), rep('interview'), rep('human'), // 4 responded
    rep('ghosted'), rep('ghosted'),                              // 2 ghosted
    rep('rejected'), rep('autoreject'),                          // 2 rejected
    rep('waiting'), rep('waiting'),                              // 2 pending
  ]; // total 10
  const a = shapeEmployerAnalytics(rows, null);
  assert.equal(a.responseSummary.responded, 4);
  assert.equal(a.responseSummary.ghosted, 2);
  assert.equal(a.responseSummary.rejected, 2);
  assert.equal(a.responseSummary.pending, 2);
  assert.equal(a.responseSummary.terminal, 8);
  // Live rates use /total (mirrors api/reports.js fetchCompanyStats), computed since total >= 5.
  assert.equal(a.headline.ghostPct, 20);   // 2/10
  assert.equal(a.headline.responsePct, 40); // 4/10
  assert.equal(a.headline.ratesComputedLive, true);
});

test('prefers the cached company_scores rates over live computation, and grades from overall_score', () => {
  const rows = [rep('ghosted'), rep('ghosted'), rep('ghosted'), rep('hired'), rep('waiting')];
  const score = { overall_score: 82, ghost_rate: 0.1, response_rate: 0.7, avg_wait_days: 12, data_quality: 'strong' };
  const a = shapeEmployerAnalytics(rows, score);
  assert.equal(a.headline.grade, 'A');            // 82 → A
  assert.equal(a.headline.overallScore, 82);
  assert.equal(a.headline.ghostPct, 10);          // from score (0.1), NOT live 3/5=60%
  assert.equal(a.headline.responsePct, 70);       // from score (0.7)
  assert.equal(a.headline.ratesComputedLive, false);
  assert.equal(a.headline.avgWaitDays, 12);
  assert.equal(a.headline.dataQuality, 'strong');
});

test('withholds live rates below the 5-report floor instead of guessing', () => {
  const rows = [rep('ghosted'), rep('hired')]; // only 2 reports, no cached score
  const a = shapeEmployerAnalytics(rows, null);
  assert.equal(a.headline.ghostRate, null);
  assert.equal(a.headline.responseRate, null);
  assert.equal(a.headline.ratesWithheld, true);
  assert.equal(a.headline.rateFloor, 5);
  // ...but the raw outcome distribution is still shown honestly.
  assert.equal(a.reportCount, 2);
  assert.equal(a.outcomeBreakdown.find((o) => o.key === 'ghosted').count, 1);
});

test('applicant sources: platform mix (where they applied) and provenance mix (how Seen learned)', () => {
  const rows = [
    rep('hired', { platform: 'Reddit r/jobs', source: 'reddit' }),
    rep('ghosted', { platform: 'Reddit r/jobs', source: 'reddit' }),
    rep('waiting', { platform: 'Company website', source: 'direct' }),
    rep('offer', { platform: '', source: '' }), // empty → labeled buckets
  ];
  const a = shapeEmployerAnalytics(rows, null);
  assert.equal(a.sources[0].key, 'Reddit r/jobs');
  assert.equal(a.sources[0].count, 2);
  assert.equal(a.sources[0].pct, 50); // 2/4
  assert.ok(a.sources.some((s) => s.key === 'Company website'));
  assert.ok(a.sources.some((s) => s.key === 'Unknown platform')); // empty platform bucketed
  assert.ok(a.provenance.some((p) => p.key === 'reddit' && p.count === 2));
});

test('application volume is bucketed by month and sorted ascending', () => {
  const rows = [
    rep('hired', { created_at: '2026-02-10T00:00:00Z' }),
    rep('hired', { created_at: '2026-02-20T00:00:00Z' }),
    rep('ghosted', { created_at: '2025-11-05T00:00:00Z' }),
    rep('waiting', { created_at: 'not-a-date' }), // unparseable → excluded from timeline
  ];
  const a = shapeEmployerAnalytics(rows, null);
  assert.deepEqual(a.monthly, [
    { month: '2025-11', count: 1 },
    { month: '2026-02', count: 2 },
  ]);
});

test('per-role breakdown is the honest per-posting proxy, with responded/ghosted per role', () => {
  const rows = [
    rep('hired', { role: 'Driver' }),
    rep('ghosted', { role: 'Driver' }),
    rep('waiting', { role: 'Driver' }),
    rep('offer', { role: 'Cashier' }),
  ];
  const a = shapeEmployerAnalytics(rows, null, { topRoles: 5 });
  const driver = a.roles.find((r) => r.role === 'Driver');
  assert.equal(driver.count, 3);
  assert.equal(driver.responded, 1);
  assert.equal(driver.ghosted, 1);
  assert.equal(a.roleCount, 2);
  assert.equal(a.roles[0].role, 'Driver'); // most reports first
});

test('gradeOf matches the repo grade thresholds', () => {
  assert.equal(gradeOf(80), 'A');
  assert.equal(gradeOf(65), 'B');
  assert.equal(gradeOf(50), 'C');
  assert.equal(gradeOf(35), 'D');
  assert.equal(gradeOf(34), 'F');
  assert.equal(gradeOf(null), null);
});

test('monthKey parses ISO to YYYY-MM (UTC) and rejects garbage', () => {
  assert.equal(monthKey('2026-02-15T12:00:00Z'), '2026-02');
  assert.equal(monthKey('2025-12-31T23:59:59Z'), '2025-12');
  assert.equal(monthKey('nope'), null);
  assert.equal(monthKey(null), null);
});
