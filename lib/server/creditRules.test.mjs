// Tests: credit rules are the SINGLE SOURCE OF TRUTH.
// Run: node --test lib/server/creditRules.test.mjs
//
// Asserts (a) the owner-decided constant values, (b) the isomorphic .ts re-export is
// byte-identical to the server .js, and (c) the server consumers (credits.js, user-sync.js)
// actually import the constants and no longer carry the old hardcoded 3/day baselines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as rules from './creditRules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

test('constant values match the owner decision (free = 1/day)', () => {
  assert.equal(rules.WELCOME_CREDITS, 10);
  assert.equal(rules.FREE_DAILY_CREDITS, 1);
  assert.equal(rules.PRO_DAILY_CREDITS, 999);
  assert.equal(rules.RESUME_OPTIMIZE_COST, 1);
  assert.equal(rules.HUMANPROOF_COST, 1);
  assert.equal(rules.RESUME_PARSE_COST, 1);
  assert.equal(rules.RESUME_SURVEY_AWARD, 2);
  assert.equal(rules.TRACK_APPLICATION_AWARD, 1);
  assert.equal(rules.MAX_DAILY_EARN, 5);
  assert.equal(rules.MAX_FREE_BALANCE, rules.FREE_DAILY_CREDITS + rules.MAX_DAILY_EARN);
});

test('monetization constants match the owner-approved 2026-07-04 decision', () => {
  assert.equal(rules.PRO_TRIAL_DAYS, 7);
  assert.deepEqual(rules.ONE_TIME_SKUS.sprint, { name: 'Interview Sprint', amount_cents: 1499, credits: 30, pro_days: 7 });
  assert.deepEqual(rules.ONE_TIME_SKUS.credits20, { name: 'Credit Pack', amount_cents: 499, credits: 20, pro_days: 0 });
});

test('hasProAccess: pro flag OR unexpired pro_until window', () => {
  const now = Date.parse('2026-07-04T12:00:00Z');
  assert.equal(rules.hasProAccess(null, now), false);
  assert.equal(rules.hasProAccess({}, now), false);
  assert.equal(rules.hasProAccess({ pro: true }, now), true);
  assert.equal(rules.hasProAccess({ pro: false }, now), false);
  // Window in the future → Pro even with pro=false (sprint SKU purchase).
  assert.equal(rules.hasProAccess({ pro: false, pro_until: '2026-07-10T12:00:00Z' }, now), true);
  // Expired window → not Pro.
  assert.equal(rules.hasProAccess({ pro: false, pro_until: '2026-07-01T12:00:00Z' }, now), false);
  // Garbage timestamps never grant.
  assert.equal(rules.hasProAccess({ pro: false, pro_until: 'not-a-date' }, now), false);
  // pro flag wins regardless of an expired window.
  assert.equal(rules.hasProAccess({ pro: true, pro_until: '2026-07-01T12:00:00Z' }, now), true);
});

test('creditBalance: daily + purchased, tolerant of pre-migration rows', () => {
  assert.equal(rules.creditBalance(null), 0);
  assert.equal(rules.creditBalance({ balance: 2 }), 2); // purchased_credits column absent (migration 044 not applied)
  assert.equal(rules.creditBalance({ balance: 1, purchased_credits: 20 }), 21);
  assert.equal(rules.creditBalance({ balance: 0, purchased_credits: 5 }), 5);
  assert.equal(rules.creditBalance({ balance: -3, purchased_credits: -1 }), 0); // never negative
});

test('lib/creditRules.ts re-exports the identical server literals', () => {
  // The isomorphic client surface is a PURE re-export (no redefined values), so it can
  // never drift as long as it (a) sources from the server .js and (b) re-exports every
  // constant by name. We assert the source text rather than importing the .ts at runtime
  // — a serverless/Node .js↔.ts import is exactly the production hazard this repo forbids.
  const iso = readFileSync(join(ROOT, 'lib', 'creditRules.ts'), 'utf8');
  assert.match(iso, /from '\.\/server\/creditRules\.js'/, 'creditRules.ts must re-export from the server .js');
  for (const key of Object.keys(rules)) {
    assert.match(iso, new RegExp(`\\b${key}\\b`), `creditRules.ts must re-export ${key}`);
  }
});

test('credits.js consumes the constants and dropped the old 3/day reset', () => {
  const src = readFileSync(join(ROOT, 'lib', 'server', 'credits.js'), 'utf8');
  assert.match(src, /from '\.\/creditRules\.js'/, 'credits.js must import creditRules');
  assert.match(src, /balance: FREE_DAILY_CREDITS, daily_earned: 0, last_reset: today/, 'daily reset must use FREE_DAILY_CREDITS');
  // The old hardcoded "reset to 3" baseline must be gone.
  assert.doesNotMatch(src, /balance: 3, daily_earned: 0/, 'stale balance:3 reset still present');
  assert.doesNotMatch(src, /balance: 999/, 'stale balance:999 literal still present');
});

test('user-sync.js consumes the constants for every reset baseline', () => {
  const src = readFileSync(join(ROOT, 'api', 'user-sync.js'), 'utf8');
  assert.match(src, /from '\.\.\/lib\/server\/creditRules\.js'/, 'user-sync.js must import creditRules');
  // No stale daily-reset ternaries or literal earn caps remain in credit paths.
  assert.doesNotMatch(src, /\? 999 : 3/, 'stale "? 999 : 3" reset ternary still present');
  assert.doesNotMatch(src, /max_daily_earn: 3/, 'stale max_daily_earn: 3 still present');
  assert.doesNotMatch(src, /balance: 2, daily_earned: 0/, 'stale consume reset-to-2 still present');
});
