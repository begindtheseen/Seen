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
