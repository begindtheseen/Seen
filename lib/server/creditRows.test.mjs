// The welcome row every first credit event creates, and earning that never lowers a balance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { firstCreditsRow, earnedBalance, WELCOME_CREDITS, MAX_FREE_BALANCE, TRACK_APPLICATION_AWARD } from './creditRules.js';
import { ensureCreditsRow } from './ensureCreditsRow.js';

test('firstCreditsRow carries the welcome bonus as the balance', () => {
  assert.deepEqual(firstCreditsRow('2026-10-24'), { balance: WELCOME_CREDITS, daily_earned: 0, last_reset: '2026-10-24', pro: false });
});

test('earnedBalance adds up to the cap and never lowers a balance above it', () => {
  assert.deepEqual(earnedBalance(1, TRACK_APPLICATION_AWARD), { balance: 2, gained: 1 });
  assert.deepEqual(earnedBalance(MAX_FREE_BALANCE - 1, 3), { balance: MAX_FREE_BALANCE, gained: 1 });
  assert.deepEqual(earnedBalance(MAX_FREE_BALANCE, 1), { balance: MAX_FREE_BALANCE, gained: 0 });
  // the bug: a welcome balance (10) used to become min(11, 6) = 6
  assert.deepEqual(earnedBalance(WELCOME_CREDITS, 1), { balance: WELCOME_CREDITS, gained: 0 });
  assert.deepEqual(earnedBalance(null, 1), { balance: 1, gained: 1 });
});

function fakeDb({ existing = null, insertOk = true } = {}) {
  const calls = [];
  const db = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', prefer: opts.headers?.Prefer, body: opts.body ? JSON.parse(opts.body) : null });
    if (path.startsWith('ai_credits?on_conflict')) {
      if (!insertOk) return new Response('boom', { status: 500 });
      return Response.json(existing ? [] : [{ ...JSON.parse(opts.body) }], { status: 201 });
    }
    if (path.startsWith('ai_credits?user_id')) return Response.json(existing ? [existing] : []);
    if (path === 'credit_transactions') return new Response(null, { status: 201 });
    return new Response(null, { status: 404 });
  };
  return { db, calls };
}

test('ensureCreditsRow creates the welcome row with ON CONFLICT DO NOTHING and logs the bonus once', async () => {
  const { db, calls } = fakeDb();
  const row = await ensureCreditsRow(db, 'u1', '2026-10-24');
  assert.equal(row.balance, WELCOME_CREDITS);
  assert.match(calls[0].prefer, /resolution=ignore-duplicates/, 'never merge-duplicates (that overwrites a concurrent row)');
  const txns = calls.filter((c) => c.path === 'credit_transactions');
  assert.deepEqual(txns.map((t) => [t.body.reason, t.body.delta]), [['welcome_bonus', WELCOME_CREDITS]]);
});

test('ensureCreditsRow returns the existing row untouched when one already exists (no second bonus)', async () => {
  const existing = { user_id: 'u1', balance: 3, daily_earned: 2, last_reset: '2026-10-24', pro: false };
  const { db, calls } = fakeDb({ existing });
  const row = await ensureCreditsRow(db, 'u1', '2026-10-24');
  assert.deepEqual(row, existing);
  assert.equal(calls.filter((c) => c.path === 'credit_transactions').length, 0);
});
