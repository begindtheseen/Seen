import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseCompanyIntel, WEB_CLAIM_CAP } from './companyIntel.js';
import { scoreConfidence, confidenceLabel } from './companyScore.js';

// The honest-count guarantees (migration 063): the LLM web-research *claimed* count is
// (a) split out from first-party rows, (b) clamped, and (c) can never mint "high" confidence.

test('web-only fusion: claim is clamped, split is honest, confidence can never be high', () => {
  const fz = fuseCompanyIntel({
    web: { ghost_rate: 0.4, response_rate: 0.5, avg_wait_days: 30, avg_rounds: 3, unpaid_rate: 0, report_count: 12775 },
    sources: [],
  });
  assert.equal(fz.first_party_report_count, 0);
  assert.equal(fz.web_report_count, WEB_CLAIM_CAP);              // 12,775 → clamped
  assert.equal(fz.report_count, WEB_CLAIM_CAP);                  // fused total = fp + clamped web
  assert.ok(fz.confidence < 0.66, `web-only confidence ${fz.confidence} must stay below 'high'`);
  assert.notEqual(fz.confidence_label, 'high');
  assert.equal(fz.sufficient, true);                             // still scoreable — just honestly labeled
});

test('real rows + web claim: first_party counts rows, total = fp + clamped claim', () => {
  const outcomes = Array.from({ length: 8 }, (_, i) => ({ outcome: i % 2 ? 'ghosted' : 'offer' }));
  const fz = fuseCompanyIntel({
    web: { ghost_rate: 0.5, response_rate: 0.5, report_count: 40 },
    sources: [{ type: 'direct', outcomes }],
  });
  assert.equal(fz.first_party_report_count, 8);
  assert.equal(fz.web_report_count, 40);
  assert.equal(fz.report_count, 48);
});

test('absent/invalid web claim is 0 — the old ||5 floor fabricated five reports from nothing', () => {
  const fz = fuseCompanyIntel({ web: { ghost_rate: 0.3, response_rate: 0.6 }, sources: [] });
  assert.equal(fz.web_report_count, 0);
  assert.equal(fz.report_count, 0);
});

test('scoreConfidence: web claim alone caps at medium, even with full tenure', () => {
  const webOnly = scoreConfidence({ reportCount: 0, webClaimedCount: 10 });
  assert.equal(webOnly, 0.35);
  assert.equal(confidenceLabel(webOnly), 'medium');
  const webPlusTenure = scoreConfidence({ reportCount: 0, webClaimedCount: 10000, tenureSample: 10000 });
  assert.ok(webPlusTenure < 0.66, `web+tenure ${webPlusTenure} must never reach 'high'`);
});

test('scoreConfidence: first-party behavior unchanged; web claim ignored once real rows exist', () => {
  const firstParty = scoreConfidence({ reportCount: 10 });
  assert.equal(firstParty, 0.7);                                  // pre-split behavior preserved
  assert.equal(confidenceLabel(firstParty), 'high');
  assert.equal(
    scoreConfidence({ reportCount: 3, webClaimedCount: 10000 }),
    scoreConfidence({ reportCount: 3 }),
    'a web claim must not inflate confidence when first-party rows exist',
  );
});
