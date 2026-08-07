import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, computeBenchmark, MIN_INDUSTRY_PEERS, industryToken, industryLabelOf } from './benchmark.js';

// ── percentile ────────────────────────────────────────────────────────────────
test('percentile: higher-is-better basic', () => {
  // value beats 3 of 4 peers → 75th
  assert.equal(percentile(0.8, [0.1, 0.2, 0.3, 0.9], true), 75);
});

test('percentile: ties count as half (midpoint)', () => {
  // one peer equal, two below, one above → (2 + 0.5)/4 = 62.5 → 63
  assert.equal(percentile(0.5, [0.5, 0.2, 0.3, 0.9], true), 63);
});

test('percentile: lower-is-better inverts', () => {
  // ghost rate 0.2, lower is better: beats peers with HIGHER ghost (0.4,0.5,0.6) → 3/3 = 100
  assert.equal(percentile(0.2, [0.4, 0.5, 0.6], false), 100);
});

test('percentile: empty peers or null value → null', () => {
  assert.equal(percentile(0.5, [], true), null);
  assert.equal(percentile(null, [0.1, 0.2], true), null);
  assert.equal(percentile(undefined, [0.1], true), null);
});

test('percentile: ignores non-finite peer values', () => {
  assert.equal(percentile(0.9, [0.1, NaN, undefined, 0.2], true), 100);
});

// ── computeBenchmark ─────────────────────────────────────────────────────────────
const peer = (score, ghost, resp, wait) => ({ overall_score: score, ghost_rate: ghost, response_rate: resp, avg_wait_days: wait });

test('computeBenchmark: industry scope with enough peers, averages over peers only', () => {
  const company = peer(70, 0.30, 0.70, 15);
  const peers = [peer(50, 0.5, 0.4, 20), peer(55, 0.45, 0.45, 22), peer(60, 0.4, 0.5, 18), peer(52, 0.48, 0.42, 25), peer(58, 0.42, 0.48, 19)];
  const b = computeBenchmark(company, peers, { scope: 'industry', industryLabel: 'Healthcare' });
  assert.equal(b.scope, 'industry');
  assert.equal(b.industry, 'Healthcare');
  assert.equal(b.nPeers, 5);
  // avg response of peers = (0.4+0.45+0.5+0.42+0.48)/5 = 0.45
  assert.ok(Math.abs(b.average.response - 0.45) < 1e-9);
  // company response 0.70 beats all 5 → 100th percentile
  assert.equal(b.percentile.response, 100);
  assert.equal(b.verdict.tone, 'good');
});

test('computeBenchmark: falls back to "all" scope when industry peers too few', () => {
  const company = peer(60, 0.4, 0.5, 20);
  const peers = [peer(50, 0.5, 0.4, 20), peer(55, 0.45, 0.45, 22)]; // only 2 < MIN_INDUSTRY_PEERS
  const b = computeBenchmark(company, peers, { scope: 'industry', industryLabel: 'Widgets' });
  assert.ok(peers.length < MIN_INDUSTRY_PEERS);
  assert.equal(b.scope, 'all');
  assert.equal(b.industry, null); // industry label dropped once we fall back to the global set
});

test('computeBenchmark: bad verdict when company trails peers on responsiveness', () => {
  const company = peer(40, 0.65, 0.20, 40);
  const peers = [peer(60, 0.4, 0.6, 15), peer(62, 0.38, 0.62, 14), peer(58, 0.42, 0.58, 16), peer(64, 0.36, 0.64, 12), peer(59, 0.41, 0.59, 15)];
  const b = computeBenchmark(company, peers, { scope: 'industry', industryLabel: 'SaaS' });
  assert.equal(b.percentile.response, 0); // beats none
  assert.equal(b.verdict.tone, 'bad');
  assert.match(b.verdict.headline, /Behind/);
  // cost-of-gap present: avg response ~0.606 vs company 0.20 → ~41 pts
  assert.ok(b.cost && b.cost.gapPoints > 30);
  assert.match(b.cost.headline, /SaaS/);
});

test('computeBenchmark: no cost claimed when company meets/beats the peer bar', () => {
  const company = peer(75, 0.25, 0.75, 12);
  const peers = [peer(50, 0.5, 0.4, 20), peer(55, 0.45, 0.45, 22), peer(60, 0.4, 0.5, 18), peer(52, 0.48, 0.42, 25), peer(58, 0.42, 0.48, 19)];
  const b = computeBenchmark(company, peers, { scope: 'industry', industryLabel: 'Retail' });
  assert.equal(b.cost, null);
  assert.equal(b.verdict.tone, 'good');
});

test('computeBenchmark: neutral verdict when peers below rank floor', () => {
  const company = peer(60, 0.4, 0.5, 20);
  const b = computeBenchmark(company, [peer(50, 0.5, 0.4, 20)], { scope: 'industry', industryLabel: 'Tiny' });
  assert.equal(b.verdict.tone, 'neutral');
  assert.match(b.verdict.headline, /Not enough peers/);
});

test('computeBenchmark: null-safe on missing company/peer fields', () => {
  const b = computeBenchmark({}, [{ overall_score: 50 }, { overall_score: 60 }, { overall_score: 55 }, { overall_score: 52 }, { overall_score: 58 }], { scope: 'industry', industryLabel: 'X' });
  assert.equal(b.company.response, null);
  assert.equal(b.percentile.response, null); // can't rank a null value
  assert.ok(b.average.score != null);
  assert.equal(b.cost, null);
});

test('computeBenchmark: clamps out-of-range stored rates', () => {
  // a bad merge could store 34.0 instead of 0.34; benchmark must clamp, never propagate 3400%
  const company = peer(60, 34.0, 0.5, 20);
  const peers = [peer(50, 0.5, 0.4, 20), peer(55, 0.45, 0.45, 22), peer(60, 0.4, 0.5, 18), peer(52, 0.48, 0.42, 25), peer(58, 0.42, 0.48, 19)];
  const b = computeBenchmark(company, peers, { scope: 'industry', industryLabel: 'Healthcare' });
  assert.ok(b.company.ghost <= 1 && b.company.ghost >= 0);
});

// ── industry bucketing (the free-text normalizer) ────────────────────────────────
test('industryToken: first word, lowercased, parentheticals stripped', () => {
  assert.equal(industryToken('Healthcare staffing (travel nursing)'), 'healthcare');
  assert.equal(industryToken('Financial Services'), 'financial');
  assert.equal(industryToken('SaaS'), 'saas');
  assert.equal(industryToken('IT / Software'), 'it');
  assert.equal(industryToken(''), '');
  assert.equal(industryToken(null), '');
  assert.equal(industryToken('A'), ''); // single char rejected (too broad to prefix-match)
});

test('industryLabelOf: cleaned, up to two words, title-cased', () => {
  assert.equal(industryLabelOf('Healthcare staffing (travel nursing)'), 'Healthcare Staffing');
  assert.equal(industryLabelOf('retail'), 'Retail');
  assert.equal(industryLabelOf('Real Estate'), 'Real Estate');
  assert.equal(industryLabelOf('healthcare'), 'Healthcare');
});
