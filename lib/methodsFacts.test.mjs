// Run: node --test lib/methodsFacts.test.mjs
// The public /methods page prints these numbers; each is checked against the function that uses it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BASE_FORMULA, VERDICT_THRESHOLDS, SUBMIT_HOLDS, TENURE_POINTS_MAX, GRADE_BANDS } from './methodsFacts.js';
import { calcOverallScore, tenureAdjustment, MIN_TENURE_SAMPLE } from '../api/_utils/companyScore.js';
import { responseVerdict } from './companyPageSummary.ts';
import { gradeLetter } from './gradeScale.js';
import { assessSubmitTrust } from '../api/_utils/reportWrite.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the printed base formula IS calcOverallScore', () => {
  const f = BASE_FORMULA;
  const printed = (rr, gr, wait, n) => Math.max(0, Math.min(100, Math.round(
    f.start + rr * f.responsePoints - gr * f.ghostPoints - Math.min(wait / f.waitCapDays, 1) * f.waitPoints
    + Math.min(f.volumeMax, Math.log(n + 1) * f.volumePerLn))));
  for (const rr of [0, 0.2, 0.5, 0.87, 1]) for (const gr of [0, 0.13, 0.5, 1]) for (const wait of [0, 9, 30, 60, 200]) for (const n of [0, 1, 3, 8, 50, 3000]) {
    assert.equal(calcOverallScore(rr, gr, wait, n), printed(rr, gr, wait, n), `${rr} ${gr} ${wait} ${n}`);
  }
});

test('the printed verdict thresholds and grade bands are the ones the code uses', () => {
  assert.equal(responseVerdict(VERDICT_THRESHOLDS.most), 'most_hear_back');
  assert.equal(responseVerdict(VERDICT_THRESHOLDS.most - 0.001), 'mixed');
  assert.equal(responseVerdict(VERDICT_THRESHOLDS.half), 'mixed');
  assert.equal(responseVerdict(VERDICT_THRESHOLDS.half - 0.001), 'few_hear_back');
  for (const b of GRADE_BANDS) {
    assert.equal(gradeLetter(b.min), b.letter);
    if (b.min > 0) assert.notEqual(gradeLetter(b.min - 1), b.letter);
  }
});

test('the tenure bound is ±8', () => {
  assert.equal(tenureAdjustment(60, 50), TENURE_POINTS_MAX);
  assert.equal(tenureAdjustment(6, 50), -TENURE_POINTS_MAX);
  assert.equal(tenureAdjustment(60, MIN_TENURE_SAMPLE - 1), 0);
});

test('the printed anti-gaming holds are assessSubmitTrust', async () => {
  const realFetch = globalThis.fetch;
  try {
    const run = async ({ dup, today }) => {
      const urls = [];
      globalThis.fetch = async (u) => {
        urls.push(String(u));
        const isDupQuery = /company_id=eq\./.test(String(u));
        const n = isDupQuery ? (dup ? 1 : 0) : today;
        return { ok: true, json: async () => Array.from({ length: n }, (_, i) => ({ id: i })) };
      };
      const out = await assessSubmitTrust('https://db.example', {}, 'u1', 'company_id=eq.c1');
      return { out, urls };
    };
    const below = await run({ dup: false, today: SUBMIT_HOLDS.dailyCap - 1 });
    assert.equal(below.out.review, false);
    const capped = await run({ dup: false, today: SUBMIT_HOLDS.dailyCap });
    assert.equal(capped.out.reason, 'velocity_capped');
    assert.equal(capped.out.weight, SUBMIT_HOLDS.heldWeight);
    const dup = await run({ dup: true, today: 0 });
    assert.equal(dup.out.reason, 'duplicate_user_company');
    // the duplicate window is dupDays
    const since = decodeURIComponent(new URL(dup.urls.find((u) => /company_id=eq\./.test(u))).searchParams.get('created_at')).replace(/^gte\./, '');
    const days = (Date.now() - Date.parse(since)) / 864e5;
    assert.ok(Math.abs(days - SUBMIT_HOLDS.dupDays) < 0.01, String(days));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the methods page prints from these facts, not hand-typed numbers', () => {
  const src = readFileSync(path.join(here, '..', 'app', 'methods', 'page.tsx'), 'utf8');
  for (const name of ['BASE_FORMULA', 'TRUST', 'MIN_REPORTS_FOR_GRADE', 'MIN_REPORTS_FOR_RATES', 'GRADE_BANDS', 'PRIOR_STRENGTH', 'SUBMIT_HOLDS', 'VERDICT_THRESHOLDS']) {
    assert.ok(src.includes(name), name);
  }
  assert.ok(!/[—–]/.test(src.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')), 'no dashes in the page copy');
});
