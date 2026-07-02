// Tests: /api/resume scanner + optimize compat wrappers over the canonical SeenFit engine.
// Run: node --test lib/server/seenfitCompat.test.mjs
//
// Verifies (a) the LEGACY response keys the existing UI reads are all present with the right
// types, and (b) the anti-hallucination guarantee survives the wrapper — every rewritten /
// optimized bullet's `original` is a real span of the résumé, never invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scannerFromSeenFit, optimizeFromSeenFit, optimizedBulletsAreGrounded } from './seenfitCompat.js';

const RESUME = `Jane Doe
Retail Associate

EXPERIENCE
Acme Store — Sales Associate
- Provided customer service to shoppers at a busy point of sale register.
- Handled cash handling and daily register reconciliation.
- Managed inventory management and restocking on the floor.

SKILLS
Customer service, cash handling, point of sale, inventory management, scheduling.
`;

const JD = `We are hiring a Retail Sales Associate.
Requirements: customer service, cash handling, point of sale experience.
Preferred: inventory management and scheduling.
You will help customers, run the register, and keep the floor stocked.`;

test('scanner wrapper returns every legacy key with correct types', () => {
  const r = scannerFromSeenFit({ resume: RESUME, jobDescription: JD, job: 'Retail Sales Associate', company: 'Acme' });
  assert.equal(typeof r.match_score, 'number');
  assert.ok(r.match_score >= 8 && r.match_score <= 98);
  assert.equal(typeof r.score_summary, 'string');
  assert.ok(Array.isArray(r.missing_keywords));
  assert.ok(Array.isArray(r.strong_keywords));
  assert.ok(Array.isArray(r.specific_fixes));
  assert.equal(typeof r.ghost_risk_note, 'string');
  assert.ok(r.ghost_risk_note.length > 0);
});

test('scanner strong_keywords reflect real résumé matches; fixes trace to résumé text', () => {
  const r = scannerFromSeenFit({ resume: RESUME, jobDescription: JD, job: 'Retail Sales Associate', company: 'Acme' });
  // The résumé clearly matches core requirements, so at least one strong keyword surfaces.
  assert.ok(r.strong_keywords.length > 0, 'expected matched keywords');
  // Every non-guidance fix `current` must be a literal résumé span (no fabrication).
  for (const fix of r.specific_fixes) {
    const cur = String(fix.current || '').trim();
    if (!cur || /^\(/.test(cur)) continue; // additive guidance template
    assert.ok(RESUME.includes(cur), `fix.current not found in résumé: ${cur}`);
  }
});

test('scanner ghost note uses company intel when provided', () => {
  const intelNote = 'SEEN DATA on Acme (from 12 real applicant reports): 40% were ghosted.';
  const r = scannerFromSeenFit({ resume: RESUME, jobDescription: JD, job: 'x', company: 'Acme', intelNote });
  assert.ok(r.ghost_risk_note.startsWith(intelNote));
});

test('optimize wrapper returns every legacy key with correct types', () => {
  const r = optimizeFromSeenFit({ resume: RESUME, jobDescription: JD, job: 'Retail Sales Associate', company: 'Acme', pro: false });
  assert.ok(Array.isArray(r.job_priorities));
  assert.ok(Array.isArray(r.optimized_bullets));
  assert.ok(Array.isArray(r.keywords_added));
  assert.equal(r.stealth, undefined, 'non-pro must not get stealth');
  for (const b of r.optimized_bullets) {
    assert.equal(typeof b.original, 'string');
    assert.equal(typeof b.optimized, 'string');
    assert.equal(typeof b.addresses, 'string');
  }
});

test('optimize bullets are grounded — no fabricated originals', () => {
  const r = optimizeFromSeenFit({ resume: RESUME, jobDescription: JD, job: 'Retail Sales Associate', company: 'Acme', pro: false });
  assert.ok(r.optimized_bullets.length > 0, 'expected at least one grounded bullet');
  assert.ok(optimizedBulletsAreGrounded(r.optimized_bullets, RESUME), 'every bullet.original must be a real résumé span');
});

test('optimize sets stealth flag only for Pro', () => {
  const r = optimizeFromSeenFit({ resume: RESUME, jobDescription: JD, job: 'x', company: 'Acme', pro: true });
  assert.equal(r.stealth, true);
});

test('optimize degrades to additive guidance when résumé has no matchable evidence', () => {
  const r = optimizeFromSeenFit({ resume: 'Objective: seeking a role.', jobDescription: JD, job: 'x', company: 'Acme', pro: false });
  // No grounded bullets → additive templates, which are clearly-marked "(…)" guidance and are
  // therefore exempt from the substring invariant (and must still pass it vacuously).
  assert.ok(Array.isArray(r.optimized_bullets));
  assert.ok(optimizedBulletsAreGrounded(r.optimized_bullets, 'Objective: seeking a role.'));
});
