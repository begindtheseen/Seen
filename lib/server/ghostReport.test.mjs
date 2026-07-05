// Tests for the Weekly Ghost Report assembler — the honesty rules are the point.
// Run: node --test lib/server/ghostReport.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleGhostReport, pickHeadline, buildCaption } from './ghostReport.js';

const row = (name, { ghost = null, reply = null, wait = null, reports = 0, overall = 50 } = {}) => ({
  name,
  industry: null,
  score: {
    overall_score: overall,
    ghost_rate: ghost,
    response_rate: reply,
    avg_wait_days: wait,
    report_count: reports,
    risk_level: overall >= 70 ? 'safe' : overall >= 40 ? 'warn' : 'danger',
    waste: 0,
  },
});

test('ranks worst offenders by ghost rate, only counting rows with enough reports', () => {
  const rows = [
    row('Aerotek', { ghost: 0.8, reply: 0.15, wait: 21, reports: 40, overall: 25 }),
    row('Robert Half', { ghost: 0.6, reply: 0.3, wait: 14, reports: 30, overall: 40 }),
    row('Thin Co', { ghost: 0.99, reply: 0.0, wait: 30, reports: 2, overall: 10 }), // below minReports → excluded
    row('No Reports Inc', { ghost: null, reply: null, reports: 0, overall: 55 }), // web prior only → excluded
  ];
  const rep = assembleGhostReport(rows, { minReports: 3 });
  assert.equal(rep.worstOffenders.length, 2);
  assert.equal(rep.worstOffenders[0].name, 'Aerotek');
  assert.equal(rep.worstOffenders[0].ghostPct, 80);
  assert.ok(!rep.worstOffenders.some((r) => r.name === 'Thin Co'), 'thin row must not be ranked');
  assert.ok(!rep.worstOffenders.some((r) => r.name === 'No Reports Inc'), 'zero-report row must not be ranked');
});

test('response leaders sort by reply rate, then fastest wait', () => {
  const rows = [
    row('SlowReplier', { ghost: 0.2, reply: 0.9, wait: 20, reports: 20 }),
    row('FastReplier', { ghost: 0.2, reply: 0.9, wait: 3, reports: 20 }),
    row('LowReplier', { ghost: 0.7, reply: 0.3, wait: 5, reports: 20 }),
  ];
  const rep = assembleGhostReport(rows);
  assert.equal(rep.responseLeaders[0].name, 'FastReplier'); // same reply%, faster wait wins
  assert.equal(rep.responseLeaders[1].name, 'SlowReplier');
});

test('agency spotlight picks the worst-ghosting flagged agency only', () => {
  const rows = [
    row('Aerotek', { ghost: 0.7, reply: 0.2, reports: 30 }),
    row('Robert Half', { ghost: 0.85, reply: 0.1, reports: 25 }),
    row('Some Employer', { ghost: 0.95, reply: 0.05, reports: 50 }), // higher ghost but NOT an agency
  ];
  const rep = assembleGhostReport(rows, { agencyNames: ['aerotek', 'robert half'] });
  assert.equal(rep.agencySpotlight.name, 'Robert Half');
  assert.equal(rep.headline.agenciesTracked, 2);
});

test('headline totals and averages come only from reported rows', () => {
  const rows = [
    row('A', { ghost: 0.6, reply: 0.4, wait: 10, reports: 10 }),
    row('B', { ghost: 0.4, reply: 0.5, wait: 20, reports: 10 }),
    row('C', { ghost: null, reports: 0, overall: 60 }), // no reports → excluded from avg
  ];
  const rep = assembleGhostReport(rows);
  assert.equal(rep.headline.reportsTotal, 20);
  assert.equal(rep.headline.companiesTracked, 2);
  assert.equal(rep.headline.avgGhostRatePct, 50); // (60+40)/2
  assert.equal(rep.headline.avgWaitDays, 15);
});

test('empty / all-zero-report input yields an honest empty report, never throws', () => {
  const rep = assembleGhostReport([row('X', { reports: 0, overall: 50 })]);
  assert.equal(rep.hasReported, false);
  assert.equal(rep.worstOffenders.length, 0);
  assert.equal(rep.headline.avgGhostRatePct, null);
  assert.equal(assembleGhostReport([]).hasReported, false);
  assert.equal(assembleGhostReport(null).hasReported, false);
});

test('pickHeadline uses the honest-small framing while N is low', () => {
  const small = assembleGhostReport([row('A', { ghost: 0.6, reply: 0.4, reports: 5 })]);
  assert.match(pickHeadline(small), /building a public ghost-rate index/i);
  assert.match(pickHeadline(small), /5 reports in/i);

  const none = assembleGhostReport([]);
  assert.match(pickHeadline(none), /just starting|framework/i);
});

test('pickHeadline surfaces the agency spotlight once data is substantial', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(row(`Filler ${i}`, { ghost: 0.5, reply: 0.5, reports: 6 }));
  rows.push(row('Robert Half', { ghost: 0.85, reply: 0.1, reports: 12 }));
  const rep = assembleGhostReport(rows, { agencyNames: ['robert half'] });
  assert.equal(rep.headline.thin, false);
  assert.match(pickHeadline(rep), /Robert Half has now been reported/);
});

test('buildCaption includes methodology, the ask, and the report link — no fabricated claim', () => {
  const rows = [
    row('Aerotek', { ghost: 0.8, reply: 0.15, wait: 21, reports: 40 }),
    row('Costco', { ghost: 0.2, reply: 0.75, wait: 6, reports: 40 }),
  ];
  const rep = assembleGhostReport(rows);
  const cap = buildCaption(rep, 'https://seenjobs.io');
  assert.match(cap, /Methodology:/);
  assert.match(cap, /\/report\?outcome=ghosted/);
  assert.match(cap, /Aerotek/);
  assert.match(cap, /keeping these receipts in public/);
});
