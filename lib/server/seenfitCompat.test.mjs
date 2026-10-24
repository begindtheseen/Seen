// Tests: /api/resume scanner + optimize compat wrappers over the canonical SeenFit engine.
// Run: node --test lib/server/seenfitCompat.test.mjs
//
// Verifies (a) the LEGACY response keys the existing UI reads are all present with the right
// types, and (b) the anti-hallucination guarantee survives the wrapper — every rewritten /
// optimized bullet's `original` is a real span of the résumé, never invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scannerFromSeenFit, optimizeFromSeenFit, optimizedBulletsAreGrounded, optimizedRewritesAreGrounded } from './seenfitCompat.js';
import { isSubstantiveRewrite, keywordKey } from '../optimizer/rewriteGuard.js';

const RESUME = `Jane Doe
Retail Associate

EXPERIENCE
Acme Store — Sales Associate
- Provided customer service to shoppers at a busy point of sale register.
- Handled cash handling and daily register reconciliation.
- Managed inventory management and restocking on the floor.
- Responsible for scheduling shifts and the weekly staff rota.

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

test('optimize bullets are grounded — no fabricated originals, no invented words', () => {
  const r = optimizeFromSeenFit({ resume: RESUME, jobDescription: JD, job: 'Retail Sales Associate', company: 'Acme', pro: false });
  const real = r.optimized_bullets.filter((b) => !/^\(/.test(b.original));
  assert.ok(real.length > 0, 'expected the duty-phrase bullet to be rewritten');
  // "Responsible for …" → "Handled …": the verb is grounded because the résumé itself says "Handled".
  assert.ok(real.some((b) => /^Handled scheduling shifts/.test(b.optimized)), JSON.stringify(real));
  assert.ok(optimizedBulletsAreGrounded(r.optimized_bullets, RESUME), 'every bullet.original must be a real résumé span');
  assert.ok(optimizedRewritesAreGrounded(r.optimized_bullets, RESUME, JD), 'every added word must come from the résumé or the posting');
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
  // Nothing in this résumé needs a word changed for this posting, so there may be no rewrite at
  // all (a rewrite that only changed punctuation would be a defect — see the next test); whatever
  // IS shown must obey the rules below.
  for (const b of r.optimized_bullets) assert.ok(!/Phoenix area/.test(b.original), `summary fragment used as a bullet: ${b.original}`);
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
  assert.ok(optimizedBulletsAreGrounded(r.optimized_bullets, JORDAN));
  assert.ok(optimizedRewritesAreGrounded(r.optimized_bullets, JORDAN, MERCURY_JD));
});

test('a rewrite that would only add a parenthetical or a period is not shown; the wording gap is a note', () => {
  const r = optimizeFromSeenFit({ resume: JORDAN, jobDescription: MERCURY_JD, job: 'Customer Support Specialist', company: 'mercury' });
  const real = r.optimized_bullets.filter((b) => !/^\(/.test(b.original));
  // The POS bullet matches "point of sale" by alias. The old engine "improved" it to
  // "POS (point of sale) system" — a parenthetical is not an improvement, so it is not a rewrite.
  assert.ok(!real.some((b) => /POS system/.test(b.original)), JSON.stringify(real));
  for (const b of real) assert.ok(isSubstantiveRewrite(b.original, b.optimized), `punctuation-only rewrite shown: ${b.optimized}`);
  // …and the person is told about the wording instead, quoting their own spelling.
  assert.ok(r.wording_notes.some((n) => /“POS”/.test(n) && /point of sale/.test(n)), JSON.stringify(r.wording_notes));
  // A requirement the résumé meets (by alias) is never also "missing".
  assert.ok(!r.keywords_added.map(keywordKey).includes(keywordKey('point of sale')), JSON.stringify(r.keywords_added));
});

// ── 2026-10-23 B: the second audit's Optimize output (desktop aloyoga, phone Walmart) ──────────
// Same fictional applicant, the résumé exactly as the audit account stored it. Pinned defects:
// a "safe improvement" that only dropped the bullet glyph and added a period; "cashier" listed
// under "Why you match" AND "Missing from your résumé"; "(cashier)" stuffed into "POS system".
const JORDAN_AUDIT = `Jordan Avery
Phoenix, AZ 85004 · (602) 555-0148 · jordan.avery.jobs@gmail.com · linkedin.com/in/jordanavery

SUMMARY
Customer-focused retail and front-desk professional with 5+ years across sales, membership services and
guest operations. Known for calm problem-solving, upsell results and reliable attendance. Looking for a full-
time customer service or sales associate role in the Phoenix area.

EXPERIENCE
Membership Specialist — UFC Gym, Phoenix, AZ Mar 2024 – Present
• Sold and renewed 40+ memberships per month; ranked top 3 of 12 on the sales floor for 6 straight months
• Handled billing questions, freezes and cancellations for 1,200+ members with a 94% satisfaction score
• Trained 4 new front-desk hires on the POS system and the daily opening and closing checklist
Valet Attendant — Ace Parking, Scottsdale, AZ Jun 2022 – Feb 2024
• Parked and retrieved 150+ vehicles per shift at a resort with zero damage claims in 20 months
• Greeted guests, managed keys and tickets, and resolved wait-time complaints on the spot
Sales Associate — GNC, Tempe, AZ Aug 2020 – May 2022
• Advised customers on supplements and hit monthly sales goals 18 of 22 months
• Managed inventory counts, restocking and the weekly promo resets
EDUCATION
Associate of Arts, General Studies — Mesa Community College, 2020

SKILLS
Customer service · POS systems (Square, Clover) · Cash handling · Upselling · Conflict resolution ·
Scheduling · Microsoft Office · Google Workspace · Bilingual (English/Spanish, conversational)`;

const ALO_JD = `WHY JOIN ALO? Mindful movement. It's at the core of why we do what we do at ALO.

SALES ASSOCIATE
Our Seasonal Sales Associates are the face of the brand at Biltmore Fashion Park. As a Sales Associate you will deliver an exceptional guest experience on the sales floor.

RESPONSIBILITIES
• Drive sales and meet daily sales goals through genuine connection with guests
• Deliver excellent customer service and product knowledge
• Support visual merchandising standards and replenishment on the sales floor
• Communication with the leadership team on guest feedback

QUALIFICATIONS
• Previous retail or customer service experience preferred
• Strong communication skills and leadership potential
• Proficiency in Excel is a plus
• High school diploma or equivalent`;

const WALMART_JD = `Cosmetics Cashier
As a Cosmetics Cashier at Walmart you will be the friendly face at the register in the cosmetics department.
What you'll do
• Operate the cash register and process customer transactions accurately
• Greet customers and answer questions about cosmetics products
• Follow company policy for cash handling and returns
Requirements
• Cashier or retail experience preferred
• Must pass a background check`;

test('audit (desktop): a rewrite that only strips the glyph and adds a period is never a "safe improvement"', () => {
  const r = optimizeFromSeenFit({ resume: JORDAN_AUDIT, jobDescription: ALO_JD, job: 'Seasonal Sales Associate (Part-Time) - Biltmore Fashion Park', company: 'aloyoga' });
  const real = r.optimized_bullets.filter((b) => !/^\(/.test(b.original));
  assert.equal(real.length, 0, `nothing in this résumé needs a word changed, yet a rewrite was shown: ${JSON.stringify(real)}`);
  // The guidance that replaces it asks only for requirements the résumé does NOT meet.
  for (const b of r.optimized_bullets) assert.ok(!['sales', 'customer service'].includes(b.addresses), `asked for a new "${b.addresses}" bullet the résumé already proves`);
  // Matched and missing are disjoint and each keyword appears once.
  const keys = r.keywords_added.map(keywordKey);
  assert.equal(new Set(keys).size, keys.length, 'duplicate keyword (case/plural) in missing list');
  assert.ok(!keys.includes('sale'), '"sales" is matched — it cannot be missing');
  assert.ok(optimizedRewritesAreGrounded(r.optimized_bullets, JORDAN_AUDIT, ALO_JD));
});

test('audit (phone): "cashier" cannot be both matched and missing, and "(cashier)" is never inserted into a bullet', () => {
  const r = optimizeFromSeenFit({ resume: JORDAN_AUDIT, jobDescription: WALMART_JD, job: 'Cosmetics Cashier', company: 'Walmart' });
  assert.ok(!r.keywords_added.map(keywordKey).includes('cashier'), JSON.stringify(r.keywords_added));
  for (const b of r.optimized_bullets) assert.ok(!/\(cashier\)/.test(b.optimized), b.optimized);
  assert.ok(r.wording_notes.some((n) => /“POS”/.test(n) && /“cashier”/.test(n)), JSON.stringify(r.wording_notes));
  assert.ok(optimizedRewritesAreGrounded(r.optimized_bullets, JORDAN_AUDIT, WALMART_JD));
});

test('"Responsible for" is rewritten only with a verb the résumé or posting already uses', () => {
  const duty = `Pat Lee\nEXPERIENCE\nClerk — Shop 2020 - 2022\n• Responsible for cash handling at the register\nSKILLS\nCash handling`;
  const noVerb = optimizeFromSeenFit({ resume: duty, jobDescription: 'Required: cash handling.', job: 'Cashier', company: 'Co' });
  assert.ok(noVerb.optimized_bullets.every((b) => /^\(/.test(b.original)), 'no grounded verb available → no rewrite: ' + JSON.stringify(noVerb.optimized_bullets));
  const withVerb = optimizeFromSeenFit({ resume: duty, jobDescription: 'Required: cash handling. Cash is handled at the register.', job: 'Cashier', company: 'Co' });
  const real = withVerb.optimized_bullets.filter((b) => !/^\(/.test(b.original));
  assert.equal(real.length, 1, JSON.stringify(withVerb.optimized_bullets));
  assert.equal(real[0].optimized, 'Handled cash handling at the register.');
  assert.ok(optimizedRewritesAreGrounded(withVerb.optimized_bullets, duty, 'Required: cash handling. Cash is handled at the register.'));
});

test('a skill that lives only in the summary/skills list is guidance, never a fake "before"', () => {
  const summaryOnly = `Pat Lee\nSUMMARY\nSeeking a customer service role.\nEXPERIENCE\nCook — Diner 2020 - 2022\n• Prepared 300 plates per shift\nSKILLS\nCustomer service`;
  const r = optimizeFromSeenFit({ resume: summaryOnly, jobDescription: 'Required: customer service.', job: 'Associate', company: 'Co' });
  assert.ok(r.optimized_bullets.every((b) => /^\(/.test(b.original)), JSON.stringify(r.optimized_bullets));
});
