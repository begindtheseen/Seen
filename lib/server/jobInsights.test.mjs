// Tests for the deterministic job-insights generator. Run:
//   node --test lib/server/jobInsights.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobInsights } from './jobInsights.js';

// ── Domino's-style low-signal listing ────────────────────────────────────────
// Regression for the live bug: "WHAT DOMINO'S IS HIRING FOR" listed
// domino / drivers / perhaps / supplemental, and the tip told the user to
// "Mirror these exact terms — domino, drivers, perhaps".
const dominos = buildJobInsights({
  title: "Delivery Driver",
  company: "Domino's Franchise",
  description: `Domino's is hiring delivery drivers. As a Domino's driver you will
    perhaps earn supplemental income. Drivers must have a car. This is a great
    opportunity to join our team. Drivers work various hours and additionally may
    pick up supplemental shifts. Domino's drivers are the face of the store.`,
  needsSummary: false,
});

test("company tokens never appear in what_they_want", () => {
  const lowered = dominos.what_they_want.map(w => w.toLowerCase());
  for (const bad of ['domino', 'dominos', "domino's", 'driver', 'drivers', 'franchise']) {
    assert.ok(!lowered.includes(bad), `"${bad}" leaked into what_they_want: ${JSON.stringify(dominos.what_they_want)}`);
  }
});

test("filler words never appear in what_they_want", () => {
  const lowered = dominos.what_they_want.map(w => w.toLowerCase());
  for (const bad of ['perhaps', 'supplemental', 'various', 'additionally', 'opportunity', 'store', 'hours']) {
    assert.ok(!lowered.includes(bad), `filler "${bad}" leaked into what_they_want: ${JSON.stringify(dominos.what_they_want)}`);
  }
});

test("what_they_want entries are capitalized", () => {
  for (const w of dominos.what_they_want) {
    assert.ok(/^[A-Z]/.test(w), `entry not capitalized: "${w}"`);
  }
});

test("insider_tip does NOT tell users to mirror terms when no real skills matched", () => {
  assert.ok(!/Mirror these exact terms/i.test(dominos.insider_tip),
    `unexpected mirror tip: "${dominos.insider_tip}"`);
});

// ── Tech listing with recognized hard skills ─────────────────────────────────
const tech = buildJobInsights({
  title: "Senior Backend Engineer",
  company: "Acme Corp",
  description: `We are hiring a Senior Backend Engineer. You will design scalable
    data pipelines using Python and PostgreSQL, write SQL queries, and deploy on
    AWS with Docker. Strong communication required. Experience with Kubernetes is
    a plus.`,
  needsSummary: false,
});

test("recognized skills surface in what_they_want", () => {
  const set = new Set(tech.what_they_want);
  assert.ok(set.has('Python'), `Python missing: ${JSON.stringify(tech.what_they_want)}`);
  assert.ok(set.has('AWS'), `AWS missing: ${JSON.stringify(tech.what_they_want)}`);
  // The mirror tip must reference recognized hard skills (Python/SQL/etc.), proving
  // real skills — not frequency-ranked filler — drove the insight.
  assert.ok(/Python|SQL|AWS|Docker/.test(tech.insider_tip),
    `mirror tip did not reference recognized skills: "${tech.insider_tip}"`);
});

test("insider_tip uses the mirror tip when real skills matched", () => {
  assert.ok(/Mirror these exact terms/i.test(tech.insider_tip),
    `expected mirror tip, got: "${tech.insider_tip}"`);
});

test("response shape is preserved", () => {
  for (const key of ['what_they_want', 'hidden_requirements', 'insider_tip', 'description_summary']) {
    assert.ok(key in tech, `missing field: ${key}`);
  }
  assert.ok(Array.isArray(tech.what_they_want));
  assert.ok(Array.isArray(tech.hidden_requirements));
  assert.equal(typeof tech.insider_tip, 'string');
});

// ═══════════════════════════════════════════════════════════════════════════
// v2 structural engine — section parsing + structured extractors (certs,
// experience, education, schedule, physical, screening) across industries.
// ═══════════════════════════════════════════════════════════════════════════

// ── Delivery driver — license + clean record + schedule signal ───────────────
const delivery = buildJobInsights({
  title: "Delivery Driver",
  company: "Acme Logistics",
  needsSummary: false,
  description: `Delivery Driver — Acme Logistics

Responsibilities:
Deliver packages safely and on time to customers across the metro area.

Requirements:
- Valid driver's license and a clean driving record required.
- Must be 21 or older with reliable transportation.
- 2+ years of delivery or driving experience preferred.

Schedule:
- 2nd shift, 2:30pm - 11pm. Weekends required.`,
});

test("delivery: license + clean record extracted into what_they_want", () => {
  const set = new Set(delivery.what_they_want.map(w => w.toLowerCase()));
  assert.ok(set.has("valid driver's license"), `license missing: ${JSON.stringify(delivery.what_they_want)}`);
  assert.ok(set.has('clean driving record'), `clean record missing: ${JSON.stringify(delivery.what_they_want)}`);
});

test("delivery: a schedule signal surfaces in hidden_requirements", () => {
  const blob = delivery.hidden_requirements.join(' ').toLowerCase();
  assert.ok(/shift|schedule|weekend/.test(blob), `no schedule signal: ${JSON.stringify(delivery.hidden_requirements)}`);
});

test("delivery: no company-name token leaks into what_they_want", () => {
  const lowered = delivery.what_they_want.map(w => w.toLowerCase());
  for (const bad of ['acme', 'logistics']) {
    assert.ok(!lowered.some(w => w.split(/\s+/).includes(bad)), `company token "${bad}" leaked: ${JSON.stringify(delivery.what_they_want)}`);
  }
});

test("delivery: insider_tip is the license/cert tier, not a phrase mirror", () => {
  assert.ok(/driver's license|headline/i.test(delivery.insider_tip), `expected cert-tier tip: "${delivery.insider_tip}"`);
  assert.ok(!/Mirror these exact terms/i.test(delivery.insider_tip), `should not mirror: "${delivery.insider_tip}"`);
});

// ── Warehouse — physical demand + forklift certification ─────────────────────
const warehouse = buildJobInsights({
  title: "Warehouse Associate",
  company: "Metro Distribution",
  needsSummary: false,
  description: `Warehouse Associate — Metro Distribution

Responsibilities:
Pick, pack, and load orders in a fast-paced distribution center.

Requirements:
- Able to lift 50 lbs repeatedly and stand for long periods.
- Forklift certification required.
- Must pass a background check and drug screen.
- Prior warehouse experience is a plus.

Schedule:
- Full-time, 1st shift.`,
});

test("warehouse: forklift certification in what_they_want, lift 50 lbs in signals", () => {
  const set = new Set(warehouse.what_they_want.map(w => w.toLowerCase()));
  assert.ok(set.has('forklift certification'), `forklift cert missing: ${JSON.stringify(warehouse.what_they_want)}`);
  const blob = warehouse.hidden_requirements.join(' ').toLowerCase();
  assert.ok(/lift 50 lbs/.test(blob), `"lift 50 lbs" not surfaced: ${JSON.stringify(warehouse.hidden_requirements)}`);
});

test("warehouse: screening surfaces as a hidden requirement", () => {
  const blob = warehouse.hidden_requirements.join(' ').toLowerCase();
  assert.ok(/background check|drug screen/.test(blob), `no screening signal: ${JSON.stringify(warehouse.hidden_requirements)}`);
});

// ── Nurse — clinical certs + license + degree ────────────────────────────────
const nurse = buildJobInsights({
  title: "Registered Nurse",
  company: "Riverside Health",
  needsSummary: false,
  description: `Registered Nurse — Riverside Health

Requirements:
- Active RN license required.
- Current BLS and ACLS certification.
- 3+ years of ICU experience.
- Bachelor's degree in Nursing (BSN) preferred.

Schedule:
- Night shift, 7pm - 7am.`,
});

test("nurse: BLS/ACLS + RN license surface in what_they_want", () => {
  const set = new Set(nurse.what_they_want.map(w => w.toLowerCase()));
  assert.ok(set.has('bls'), `BLS missing: ${JSON.stringify(nurse.what_they_want)}`);
  assert.ok(set.has('acls'), `ACLS missing: ${JSON.stringify(nurse.what_they_want)}`);
  assert.ok(set.has('rn license'), `RN license missing: ${JSON.stringify(nurse.what_they_want)}`);
});

test("nurse: experience + education extracted", () => {
  const set = new Set(nurse.what_they_want.map(w => w.toLowerCase()));
  assert.ok([...set].some(w => /\d\+ years/.test(w)), `experience missing: ${JSON.stringify(nurse.what_they_want)}`);
  assert.ok(set.has("bachelor's degree"), `education missing: ${JSON.stringify(nurse.what_they_want)}`);
});

// ── Cross-fixture invariants ─────────────────────────────────────────────────
// A conservative filler blacklist: bare boilerplate tokens that must never appear
// as a standalone word inside any what_they_want entry.
const FILLER_TOKENS = ['perhaps', 'various', 'supplemental', 'additionally', 'opportunity',
  'store', 'please', 'apply', 'seeking', 'looking'];

for (const [name, out] of [['delivery', delivery], ['warehouse', warehouse], ['nurse', nurse], ['tech', tech], ["dominos", dominos]]) {
  test(`${name}: what_they_want ≤ 5, capitalized, no filler tokens`, () => {
    assert.ok(out.what_they_want.length <= 5, `too many entries: ${JSON.stringify(out.what_they_want)}`);
    for (const w of out.what_they_want) {
      assert.ok(/^[A-Z0-9]/.test(w), `entry not capitalized: "${w}"`);
      const words = w.toLowerCase().split(/\s+/);
      for (const bad of FILLER_TOKENS) {
        assert.ok(!words.includes(bad), `filler "${bad}" leaked into "${w}" (${name})`);
      }
    }
  });
}

// ── Determinism ──────────────────────────────────────────────────────────────
test("engine is deterministic — same input yields deep-equal output", () => {
  const input = {
    title: "Warehouse Associate",
    company: "Metro Distribution",
    needsSummary: true,
    description: warehouse ? `Requirements:\n- Forklift certification required.\n- Able to lift 50 lbs.\n- Must pass a background check.` : '',
  };
  const a = buildJobInsights(input);
  const b = buildJobInsights(input);
  assert.deepEqual(a, b);
});
