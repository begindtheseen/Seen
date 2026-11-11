// Round 11: a bulk undo is shaped by the work — one conditional PATCH per run of ≤40 rows that share their prior
// values, no read before the write, scores queued not recomputed inline. Target on the fake at 60 ms per call:
// 1,040 reports undone in ≤ 3 rounds and ≤ 60 calls, counts exact, replay-safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const system = await import('../lib/server/admin/system.js');
const { world, RPCS, caller, createFakeRest } = await import('../lib/server/admin/testing/world.mjs');

async function approved(n) {
  const T = world({ held: n, liveReports: 0, companies: Array.from({ length: 120 }, (_, i) => `Company ${i}`) });
  // Like real data: every row has its own weight and one of three trust reasons (the rig's batch).
  T.reports.forEach((r, i) => { r.outcome = 'interview'; r.outcome_weight = 0.3 + (i % 997) / 10000; r.trust_reason = ['external_import', 'reddit_rule_match', null][i % 3]; });
  const fake = createFakeRest({ tables: T, rpcs: RPCS });
  const call = await caller(handler, fake);
  const a = await call({ action: 'review_held', decision: 'approve', scope: 'all', request_id: '7c1f0a3e-0000-4000-8000-0000000000b1' });
  assert.equal(a.jsonBody.changed, n, JSON.stringify(a.jsonBody).slice(0, 300));
  const held = () => T.reports.filter((r) => r.needs_review === true).length;
  return { fake, call, audit: a.jsonBody.undo.args.audit_id, held };
}

test('1,040 approvals undone at 60 ms per call: ≤ 3 rounds, ≤ 60 calls, exact counts, scores queued', async () => {
  const { fake, call, audit, held } = await approved(1040);
  fake.faults.push({ match: '/rest/v1/', delayMs: 60 });
  const start = fake.log.length;
  let round = 1, last, sum = 0;
  do { last = (await call({ action: 'undo', audit_id: audit, request_id: 'r11-undo-0001', round })).jsonBody; sum += last.changed; round++; } while (!last.complete && round <= 10);
  const rounds = round - 1, calls = fake.log.length - start;
  assert.ok(rounds <= 3, `rounds ${rounds}`);
  assert.ok(calls <= 60, `calls ${calls}`);
  assert.equal(held(), 1040);
  assert.equal(sum, 1040);
  assert.equal(last.restored, 1040);
  assert.equal(last.remaining, 0);
  assert.equal(last.message, '1,040 reports are back in the review queue.');
  assert.equal(last.recompute.queued, 120, 'every touched company queued for its score');
  assert.equal(fake.log.slice(start).filter((e) => e.method === 'GET' && e.path.endsWith('/reports')).length, 0, 'no read before the write');
});

test('short rounds resume where the last stopped: a row changed in between is changed_since, restored rows are never re-touched, totals exact', async () => {
  const { fake, call, audit, held } = await approved(200);
  const prev = system.UNDO_TUNING.roundMs;
  system.UNDO_TUNING.roundMs = -1; // one 40-row PATCH per round
  try {
    const send = (round) => call({ action: 'undo', audit_id: audit, request_id: 'r11-undo-0002', round }).then((r) => r.jsonBody);
    const r1 = await send(1);
    assert.equal(r1.changed, 40);
    assert.equal(r1.complete, false);
    // Someone edits a not-yet-restored row; it must not be overwritten.
    const touchedByHand = fake.tables.reports.find((r) => r.needs_review === false && r.trust_reason !== 'admin_rejected');
    touchedByHand.trust_reason = 'admin_rejected';
    touchedByHand.needs_review = true;
    const patchesBefore = fake.log.filter((e) => e.method === 'PATCH' && e.path.endsWith('/reports')).length;
    let round = 2, last = r1, sum = r1.changed;
    while (!last.complete && round < 20) { last = await send(round); sum += last.changed; round++; }
    const patches = fake.log.filter((e) => e.method === 'PATCH' && e.path.endsWith('/reports')).length - patchesBefore;
    assert.equal(patches, 4, 'the remaining 160 rows in four PATCHes — round 1\'s rows never sent again');
    assert.equal(sum, 199);
    assert.equal(last.restored, 199);
    assert.deepEqual(last.skipped, [{ reason: 'changed_since', count: 1 }]);
    assert.equal(touchedByHand.trust_reason, 'admin_rejected', 'left alone');
    assert.equal(held(), 200);
    assert.match(last.message, /^199 reports are back in the review queue · 1 changed since and left alone\.$/);
    // Lost last answer: re-sent → replay.
    assert.equal((await send(round - 1)).replayed, true);
  } finally { system.UNDO_TUNING.roundMs = prev; }
});
