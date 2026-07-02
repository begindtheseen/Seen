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
