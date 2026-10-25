// The SQL Pro rule (consume_credit, the function gateAI really calls) must match hasProAccess in JS:
// subscription flag OR comped OR an unexpired pro_until. Found 2026-10-25: the SQL ignored comped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { hasProAccess } from './creditRules.js';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const latest = readdirSync(dir).filter((f) => /\.sql$/.test(f)).sort()
  .filter((f) => /CREATE OR REPLACE FUNCTION public\.consume_credit/i.test(readFileSync(new URL(f, dir), 'utf8'))).pop();

test('the latest consume_credit counts comped, the subscription flag and pro_until', () => {
  const sql = readFileSync(new URL(latest, dir), 'utf8');
  const line = sql.split('\n').find((l) => /v_pro\s*:=/.test(l));
  assert.ok(line, `v_pro assignment in ${latest}`);
  assert.match(line, /v_row\.pro\b/);
  assert.match(line, /comped/);
  assert.match(line, /pro_until/);
});

test('hasProAccess agrees on the same three cases', () => {
  assert.equal(hasProAccess({ pro: false, comped: true }), true);
  assert.equal(hasProAccess({ pro: true }), true);
  assert.equal(hasProAccess({ pro: false, pro_until: new Date(Date.now() + 1e6).toISOString() }), true);
  assert.equal(hasProAccess({ pro: false, comped: false, pro_until: null }), false);
});
