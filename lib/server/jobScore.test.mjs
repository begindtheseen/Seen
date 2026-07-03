// Tests: the canonical listing scorer (lib/server/jobScore.js).
// Run: node --test lib/server/jobScore.test.mjs
//
// Locks the owner directive "score for a reason or no score": every point is earned from a
// signal present in the LISTING (source, salary disclosure, description, title), the scorer
// is deterministic, bounded, and scoreRow() derives from real signals rather than inventing
// a constant (the deleted `|| 65` / `|| 25` defaults).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreJob, wasteScore, scoreRow, scoreFactors, wasteFactors, explainListingScore } from './jobScore.js';

const base = () => ({
  title: 'Software Engineer',
  company: 'Acme Widgets',
  source: 'Adzuna',
  description: 'We are hiring a software engineer to join our team and build things. '.repeat(6),
  salary: null,
  type: 'Full-time',
});

test('score is bounded 18–95 and rounded, for a wide range of inputs', () => {
  const inputs = [
    base(),
    { ...base(), source: 'Greenhouse', salary: '$180k', salary_min: 180000, company: 'Stripe',
      description: 'Detailed role. interview process: 3 rounds. remote. 401k equity pto. '.repeat(30) },
    { ...base(), company: 'Infosys', source: 'unknown', description: 'commission only unpaid volunteer', title: 'Sales rockstar ninja' },
  ];
  for (const j of inputs) {
    const s = scoreJob(j);
    assert.ok(Number.isInteger(s), `score is an integer: ${s}`);
    assert.ok(s >= 18 && s <= 95, `score in [18,95]: ${s}`);
  }
});

test('every point is EARNED — a strong listing scores materially higher than a bare one', () => {
  const bare = scoreJob(base()); // unknown company, no salary, generic desc, Adzuna
  const strong = scoreJob({
    ...base(),
    source: 'Greenhouse',              // +18 real ATS
    salary: '$180k', salary_min: 180000, // +12 disclosed, +6 high comp
    company: 'Stripe',                 // +15 known-good nudge
    description: 'interview process: 3 rounds. technical screen. remote hybrid. 401k equity pto parental leave. base pay $180000. '.repeat(20),
  });
  assert.ok(strong > bare + 25, `strong (${strong}) should far exceed bare (${bare})`);
});

test('red flags push a listing down for a reason', () => {
  const clean = scoreJob(base());
  const flagged = scoreJob({
    ...base(),
    title: 'Sales Rockstar (commission)',
    description: 'commission only. 1099 only. staffing agency on behalf of our client. ' + base().description,
    type: 'Contract',
  });
  assert.ok(flagged < clean, `flagged (${flagged}) should be below clean (${clean})`);
});

test('the deleted thin scorer is gone — an unknown company with no salary is NOT a flat 65', () => {
  // The old ingest scorer returned exactly 65 for any unknown company (baseline 65).
  // The signal-based scorer must NOT reproduce that fabricated floor.
  const s = scoreJob(base());
  assert.notEqual(s, 65, 'unknown/no-salary listing must not fabricate the old 65 baseline');
});

test('scoreJob is deterministic (no randomness / time dependence)', () => {
  const j = base();
  assert.equal(scoreJob(j), scoreJob(j));
  assert.equal(wasteScore(j), wasteScore(j));
});

test('wasteScore is bounded 5–90 and rises with real ghost-risk signals', () => {
  const low = wasteScore({ ...base(), source: 'Greenhouse', salary: '$150k', salary_min: 150000 });
  const high = wasteScore({ ...base(), company: 'Accenture', description: 'staffing agency, unpaid, commission only. ' + base().description });
  assert.ok(low >= 5 && low <= 90);
  assert.ok(high >= 5 && high <= 90);
  assert.ok(high > low, `high-risk waste (${high}) should exceed low-risk (${low})`);
});

test('scoreRow prefers a real stored score over recomputing', () => {
  const row = { ...base(), score: 42, waste_score: 33 };
  const out = scoreRow(row);
  assert.equal(out.score, 42);
  assert.equal(out.waste_score, 33);
});

test('scoreRow DERIVES from signals when a stored score is missing — never a magic 65/25', () => {
  const row = { ...base(), score: null, waste_score: undefined };
  const out = scoreRow(row);
  assert.equal(out.score, scoreJob(row), 'derives score from the listing signals');
  assert.equal(out.waste_score, wasteScore(row), 'derives waste from the listing signals');
  assert.notEqual(out.score, 65);
  assert.notEqual(out.waste_score, 25);
});

test('scoreRow treats 0 / non-finite stored values as missing and re-derives', () => {
  for (const bad of [0, NaN, '', 'x', -5]) {
    const out = scoreRow({ ...base(), score: bad, waste_score: bad });
    assert.ok(out.score >= 18 && out.score <= 95, `re-derived score valid for stored=${String(bad)}`);
    assert.ok(out.waste_score >= 5 && out.waste_score <= 90);
  }
});

// ── Explainability (legal defensibility): the explanation IS the computation ──────────

test('the factor deltas SUM to the raw score, and score == clamp(raw) — for every listing', () => {
  const listings = [
    base(),
    { ...base(), source: 'Greenhouse', salary: '$180k', salary_min: 180000, company: 'Stripe',
      description: 'interview process: 3 rounds. remote hybrid. 401k equity pto parental leave. base pay $180000. '.repeat(20) },
    { ...base(), company: 'Infosys', description: 'staffing agency, unpaid, commission only, 1099 only. team player fast-paced wear many hats. ' + base().description,
      title: 'Sales Rockstar (commission)', type: 'Contract' },
    { ...base(), description: 'tiny' }, // triggers desc_thin but fails buildJob length gate; scorer still explains it
  ];
  for (const j of listings) {
    const s = scoreFactors(j);
    const summed = s.factors.reduce((a, x) => a + x.points, 0);
    assert.equal(summed, s.raw, 'score factor deltas must sum to raw');
    assert.equal(s.score, Math.min(95, Math.max(18, Math.round(s.raw))), 'score is the clamped raw');
    assert.equal(s.score, scoreJob(j), 'scoreFactors().score matches scoreJob()');

    const w = wasteFactors(j);
    assert.equal(w.factors.reduce((a, x) => a + x.points, 0), w.raw, 'waste factor deltas must sum to raw');
    assert.equal(w.score, wasteScore(j), 'wasteFactors().score matches wasteScore()');
  }
});

test('every factor carries a non-empty plain-English reason (no number without a stated reason)', () => {
  const j = { ...base(), source: 'Greenhouse', salary: '$130k', salary_min: 130000, company: 'Stripe' };
  for (const fct of [...scoreFactors(j).factors, ...wasteFactors(j).factors]) {
    assert.ok(typeof fct.signal === 'string' && fct.signal.length > 0);
    assert.ok(typeof fct.reason === 'string' && fct.reason.length >= 10, `reason present for ${fct.signal}`);
    assert.equal(typeof fct.points, 'number');
  }
});

test('explainListingScore returns a self-consistent, exportable breakdown', () => {
  const row = { ...base(), source: 'Greenhouse', salary: '$130k', salary_min: 130000, score: 77, waste_score: 12 };
  const ex = explainListingScore(row);
  // The exported transparency_score is the recomputation and equals the sum of its factors.
  assert.equal(ex.transparency_score, scoreJob(row));
  assert.equal(ex.score_factors.reduce((a, x) => a + x.points, 0), ex.transparency_raw);
  assert.equal(ex.waste_factors.reduce((a, x) => a + x.points, 0), ex.waste_raw);
  // Stored values are carried through for reference.
  assert.equal(ex.stored_score, 77);
  assert.equal(ex.stored_waste_score, 12);
});
