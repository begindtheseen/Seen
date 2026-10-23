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

// ── 2026-10-23: the "Safe improvements" class defect seen on the live site ─────────────────
// A real applicant's résumé (fictional person, the audit account) produced two "before" bullets
// that were the SAME sentence fragment from the SUMMARY ("…customer service or sales associate
// role in the Phoenix area.") with two different templated "after"s. Rules pinned here:
//   • a rewrite's `original` is a real EXPERIENCE bullet — never a summary or skills line,
//   • one rewrite per source bullet, never the same rewrite twice,
//   • the "after" keeps the bullet's own facts (numbers, tools) — it is not a template sentence,
//   • a skill that only lives in the summary/skills list yields guidance, not a fake rewrite.
const JORDAN = `Jordan Avery
Phoenix, AZ 85004 · (602) 555-0148 · jordan.avery.jobs@gmail.com

SUMMARY
Customer-focused retail and front-desk professional with 5+ years across sales, membership services and
guest operations. Known for calm problem-solving, upsell results and reliable attendance. Looking for a full-
time customer service or sales associate role in the Phoenix area.

EXPERIENCE
Mar 2024 – Present
Membership Specialist — UFC Gym, Phoenix, AZ
• Sold and renewed 40+ memberships per month; ranked top 3 of 12 on the sales floor for 6 straight months
• Handled billing questions, freezes and cancellations for 1,200+ members with a 94% satisfaction score
• Trained 4 new front-desk hires on the POS system and the daily opening and closing checklist
Jun 2022 – Feb 2024
Valet Attendant — Ace Parking, Scottsdale, AZ
• Parked and retrieved 150+ vehicles per shift at a resort with zero damage claims in 20 months
• Greeted guests, managed keys and tickets, and resolved wait-time complaints on the spot

SKILLS
Customer service · POS systems (Square, Clover) · Cash handling · Upselling · Conflict resolution ·
Scheduling · Microsoft Office · Google Workspace · Bilingual (English/Spanish, conversational)`;

const MERCURY_JD = `Customer Support Specialist. Required: strong customer service and communication skills. You will answer tickets, resolve billing questions and document every contact in the CRM. Ensure all customer requirements are met. Point of sale experience preferred.`;

test('rewrites come from experience bullets only, deduped, and keep the bullet\'s own facts', () => {
  const r = optimizeFromSeenFit({ resume: JORDAN, jobDescription: MERCURY_JD, job: 'Customer Support Specialist', company: 'mercury' });
  const real = r.optimized_bullets.filter((b) => !/^\(/.test(b.original));
  assert.ok(real.length >= 1, 'expected a grounded rewrite from the POS bullet');
  for (const b of real) {
    assert.ok(!/Phoenix area/.test(b.original), `summary fragment used as a bullet: ${b.original}`);
    assert.ok(/^•/.test(b.original) || /^[A-Z][a-z]+ed\b/.test(b.original), `not an experience bullet: ${b.original}`);
    assert.ok(!/fast-paced environment/.test(b.optimized), `template sentence instead of the real bullet: ${b.optimized}`);
    assert.ok(b.optimized !== b.original);
  }
  const originals = real.map((b) => b.original.toLowerCase());
  assert.equal(new Set(originals).size, originals.length, 'the same "before" bullet was emitted twice');
  const afters = real.map((b) => b.optimized.toLowerCase());
  assert.equal(new Set(afters).size, afters.length, 'the same rewrite was emitted twice');
  // The POS bullet keeps its facts and now carries the literal keyword for ATS.
  const pos = real.find((b) => /POS system/.test(b.original));
  assert.ok(pos, 'the POS bullet should be the rewritten one');
  assert.match(pos.optimized, /Trained 4 new front-desk hires on the POS \(point of sale\) system/);
  assert.ok(optimizedBulletsAreGrounded(r.optimized_bullets, JORDAN));
});

test('a skill that lives only in the summary/skills list is guidance, never a fake "before"', () => {
  const summaryOnly = `Pat Lee\nSUMMARY\nSeeking a customer service role.\nEXPERIENCE\nCook — Diner 2020 - 2022\n• Prepared 300 plates per shift\nSKILLS\nCustomer service`;
  const r = optimizeFromSeenFit({ resume: summaryOnly, jobDescription: 'Required: customer service.', job: 'Associate', company: 'Co' });
  assert.ok(r.optimized_bullets.every((b) => /^\(/.test(b.original)), JSON.stringify(r.optimized_bullets));
});
