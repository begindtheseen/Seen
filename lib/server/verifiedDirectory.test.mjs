import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeVerifiedDirectory, companySlug } from './verifiedDirectory.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const inDays = (n) => new Date(NOW + n * DAY).toISOString();

test('companySlug matches the app-wide scheme', () => {
  assert.equal(companySlug('Coca Cola'), 'coca-cola');
  assert.equal(companySlug('  ACME  Corp '), 'acme-corp');
  assert.equal(companySlug(null), '');
});

test('lists only currently-verified companies, joined to their real scores', () => {
  const perks = [
    { company: 'Acme', verified_until: inDays(30) },   // active
    { company: 'Globex', verified_until: inDays(-1) }, // expired → excluded
    { company: 'Initech', verified_until: inDays(10) },// active, no score
  ];
  const scores = [
    { company_name: 'acme', overall_score: 82, ghost_rate: 0.1, response_rate: 0.7, report_count: 40 },
    { company_name: 'globex', overall_score: 30, ghost_rate: 0.8, response_rate: 0.1, report_count: 5 },
  ];
  const out = shapeVerifiedDirectory(perks, scores, NOW);
  assert.equal(out.length, 2); // Globex excluded (expired)
  const acme = out.find(c => c.company === 'Acme');
  assert.equal(acme.grade, 'A');
  assert.equal(acme.responseRate, 70);
  assert.equal(acme.ghostRate, 10);
  assert.equal(acme.slug, 'acme');
  const initech = out.find(c => c.company === 'Initech');
  assert.equal(initech.grade, null);      // no score yet → badge earned, score pending
  assert.equal(initech.reportCount, 0);
});

test('sorts best-score first, unscored last', () => {
  const perks = [
    { company: 'LowScore', verified_until: inDays(5) },
    { company: 'NoScore', verified_until: inDays(5) },
    { company: 'HighScore', verified_until: inDays(5) },
  ];
  const scores = [
    { company_name: 'lowscore', overall_score: 55 },
    { company_name: 'highscore', overall_score: 90 },
  ];
  const out = shapeVerifiedDirectory(perks, scores, NOW);
  assert.deepEqual(out.map(c => c.company), ['HighScore', 'LowScore', 'NoScore']);
});

test('dedupes and tolerates empty / malformed input', () => {
  assert.deepEqual(shapeVerifiedDirectory(null, null, NOW), []);
  const dup = shapeVerifiedDirectory(
    [{ company: 'Acme', verified_until: inDays(5) }, { company: 'acme', verified_until: inDays(9) }],
    [], NOW,
  );
  assert.equal(dup.length, 1);
});
