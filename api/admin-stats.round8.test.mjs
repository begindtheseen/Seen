// Round 8: an unknown outcome at the database is not a failure. For additive writes (a credit grant, the undo of a
// credit grant): the answer to the write is lost after it landed → Retry completes it once; the write did not land
// → Retry runs it once; the balance moved in between → 409 with the true balance; the record's own final write
// failed → Retry after 70 s answers done. Every write action is classified additive or set-style.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler, ACTIONS } = await import('./admin-stats.js');
const { world, RPCS, caller, createFakeRest, uid } = await import('../lib/server/admin/testing/world.mjs');
const { WRITE_CLASS, READS, SELF_IDEMPOTENT, ADDITIVE } = await import('../lib/server/admin/idempotency.js');
const C = await import('../lib/server/admin/testing/contract.mjs');

const U = uid(1, '6'); // balance 7 in the world
const bal = (f) => f.tables.ai_credits.find((c) => c.user_id === U).balance;
const ledger = (f, reason) => f.tables.credit_transactions.filter((t) => t.user_id === U && t.reason === reason).length;
const audits = (f, action) => f.tables.admin_audit_log.filter((a) => a.action === action && a.target_id === U).length;
const ageRecords = (f) => { for (const a of f.tables.admin_audit_log) if (a.action === 'request_result') a.created_at = new Date(Date.now() - 80_000).toISOString(); };

async function rig(faults = []) {
  const fake = createFakeRest({ tables: world(), rpcs: RPCS, faults });
  return { fake, call: await caller(handler, fake) };
}
const grant = (rid) => ({ action: 'grant_credits', user_id: U, amount: 5, request_id: rid });

test('grant: the write lands and its answer is lost → Retry completes it once (one ledger row, one audit row, Undo works)', async () => {
  const { fake, call } = await rig([{ match: '/ai_credits?user_id=eq.', method: 'PATCH', applyThen: true, status: 504, times: 1 }]);
  const first = await call(grant('lost-answer-0001'));
  assert.equal(first.statusCode, 504);
  assert.deepEqual(C.checkErr(first.jsonBody), []);
  assert.equal(first.jsonBody.retryable, true);
  assert.equal(bal(fake), 12, 'the database did it');
  assert.equal(audits(fake, 'grant_credits'), 1, 'its audit row was kept');
  const retry = await call(grant('lost-answer-0001'));
  assert.equal(retry.statusCode, 200, JSON.stringify(retry.jsonBody));
  assert.equal(retry.jsonBody.replayed, true);
  assert.equal(retry.jsonBody.changed, 0);
  assert.match(retry.jsonBody.message, /Added 5 credits · balance 12/);
  assert.equal(bal(fake), 12, 'granted exactly once');
  assert.equal(ledger(fake, 'admin_grant'), 1, 'one ledger row');
  assert.equal(audits(fake, 'grant_credits'), 1, 'one audit row');
  const again = await call(grant('lost-answer-0001'));
  assert.equal(again.jsonBody.replayed, true);
  assert.equal(bal(fake), 12);
  const u = await call({ action: 'undo', ...retry.jsonBody.undo.args });
  assert.equal(u.statusCode, 200);
  assert.equal(bal(fake), 7);
});

test('grant: the write does NOT land and answers an error → Retry grants once', async () => {
  const { fake, call } = await rig([{ match: '/ai_credits?user_id=eq.', method: 'PATCH', status: 503, times: 1 }]);
  const first = await call(grant('not-applied-0001'));
  assert.equal(first.statusCode, 504);
  assert.equal(bal(fake), 7);
  const retry = await call(grant('not-applied-0001'));
  assert.equal(retry.statusCode, 200);
  assert.notEqual(retry.jsonBody.replayed, true);
  assert.equal(bal(fake), 12);
  assert.equal(ledger(fake, 'admin_grant'), 1);
  assert.equal(audits(fake, 'grant_credits'), 1, 'the first try\'s kept audit row and this one are the same press — no second row');
});

test('grant: a spend lands between the lost answer and the Retry → 409 with the true balance, nothing granted', async () => {
  const { fake, call } = await rig([{ match: '/ai_credits?user_id=eq.', method: 'PATCH', applyThen: true, status: 504, times: 1 }]);
  await call(grant('spent-between-0001'));
  fake.tables.ai_credits.find((c) => c.user_id === U).balance = 9; // the user spent 3
  const retry = await call(grant('spent-between-0001'));
  assert.equal(retry.statusCode, 409);
  assert.deepEqual(C.checkErr(retry.jsonBody), []);
  assert.equal(retry.jsonBody.retryable, false);
  assert.match(retry.jsonBody.error, /it is now 9/);
  assert.equal(bal(fake), 9);
});

test('grant: the record\'s own final write fails → Retry within 70 s is in progress; after 70 s it answers done and grants nothing', async () => {
  // PATCHes to the record: 1 = intent, 2 = done (fails).
  const { fake, call } = await rig([{ match: '/admin_audit_log?id=eq.', method: 'PATCH', skip: 1, times: 1, status: 500 }]);
  const first = await call(grant('final-write-0001'));
  assert.equal(first.statusCode, 200);
  assert.equal(bal(fake), 12);
  const rec = fake.tables.admin_audit_log.find((a) => a.action === 'request_result' && String(a.target_id).includes('final-write-0001'));
  assert.equal(rec.metadata.status, 'running', 'the record\'s final write was the one that failed');
  const soon = await call(grant('final-write-0001'));
  assert.equal(soon.statusCode, 409);
  assert.equal(soon.jsonBody.code, 'in_progress');
  ageRecords(fake);
  const later = await call(grant('final-write-0001'));
  assert.equal(later.statusCode, 200, JSON.stringify(later.jsonBody));
  assert.equal(later.jsonBody.replayed, true);
  assert.equal(bal(fake), 12);
  assert.equal(ledger(fake, 'admin_grant'), 1);
  assert.equal(audits(fake, 'grant_credits'), 1);
});

test('undo of a grant: lost answer → done once; not applied → runs once; moved balance → 409; final record write fails → done after 70 s', async () => {
  // Lost answer after it landed.
  {
    const { fake, call } = await rig();
    const g = (await call(grant('undo-base-0001'))).jsonBody;
    fake.faults.push({ match: '/ai_credits?user_id=eq.', method: 'PATCH', applyThen: true, status: 504, times: 1 });
    const u1 = await call({ action: 'undo', ...g.undo.args, request_id: 'undo-lost-0001' });
    assert.equal(u1.statusCode, 504);
    assert.equal(bal(fake), 7);
    const u2 = await call({ action: 'undo', ...g.undo.args, request_id: 'undo-lost-0001' });
    assert.equal(u2.statusCode, 200, JSON.stringify(u2.jsonBody));
    assert.equal(u2.jsonBody.replayed, true);
    assert.equal(bal(fake), 7);
    assert.equal(ledger(fake, 'admin_grant_undo'), 1);
  }
  // Not applied.
  {
    const { fake, call } = await rig();
    const g = (await call(grant('undo-base-0002'))).jsonBody;
    fake.faults.push({ match: '/ai_credits?user_id=eq.', method: 'PATCH', status: 503, times: 1 });
    assert.equal((await call({ action: 'undo', ...g.undo.args, request_id: 'undo-nope-0002' })).statusCode, 504);
    assert.equal(bal(fake), 12);
    const u2 = await call({ action: 'undo', ...g.undo.args, request_id: 'undo-nope-0002' });
    assert.equal(u2.statusCode, 200);
    assert.equal(bal(fake), 7);
    assert.equal(ledger(fake, 'admin_grant_undo'), 1);
  }
  // Balance moved.
  {
    const { fake, call } = await rig();
    const g = (await call(grant('undo-base-0003'))).jsonBody;
    fake.faults.push({ match: '/ai_credits?user_id=eq.', method: 'PATCH', applyThen: true, status: 504, times: 1 });
    await call({ action: 'undo', ...g.undo.args, request_id: 'undo-moved-0003' });
    fake.tables.ai_credits.find((c) => c.user_id === U).balance = 4;
    const u2 = await call({ action: 'undo', ...g.undo.args, request_id: 'undo-moved-0003' });
    assert.equal(u2.statusCode, 409);
    assert.match(u2.jsonBody.error, /it is now 4/);
    assert.equal(bal(fake), 4);
  }
  // The record's final write fails.
  {
    const { fake, call } = await rig();
    const g = (await call(grant('undo-base-0004'))).jsonBody;
    // For this press the PATCHes to admin_audit_log rows are: 1 = intent, 2 = annotate the grant's row, 3 = done (fails).
    fake.faults.push({ match: '/admin_audit_log?id=eq.', method: 'PATCH', skip: 2, times: 1, status: 500 });
    const u1 = await call({ action: 'undo', ...g.undo.args, request_id: 'undo-final-0004' });
    assert.equal(u1.statusCode, 200);
    assert.equal(bal(fake), 7);
    const rec = fake.tables.admin_audit_log.find((a) => a.action === 'request_result' && String(a.target_id).includes('undo-final-0004'));
    assert.equal(rec.metadata.status, 'running', 'the record\'s final write was the one that failed');
    ageRecords(fake);
    const u2 = await call({ action: 'undo', ...g.undo.args, request_id: 'undo-final-0004' });
    assert.equal(u2.statusCode, 200, JSON.stringify(u2.jsonBody));
    assert.equal(u2.jsonBody.replayed, true);
    assert.equal(bal(fake), 7, 'never subtracted twice');
    assert.equal(ledger(fake, 'admin_grant_undo'), 1);
    assert.equal(fake.tables.admin_audit_log.filter((a) => a.action === 'undo' && a.metadata?.request).length, 1, 'one undo audit row');
  }
});

test('no counter and no record: an additive write refuses (nothing changed); a set-style write runs', async () => {
  const noCounter = { ...RPCS };
  delete noCounter.increment_rate_limit;
  const fake = createFakeRest({ tables: world(), rpcs: noCounter });
  const call = await caller(handler, fake);
  const g = await call(grant('no-counter-0001'));
  assert.equal(g.statusCode, 503);
  assert.match(g.jsonBody.error, /nothing was changed/);
  assert.equal(bal(fake), 7);
  const s = await call({ action: 'set_flag', flag_name: 'seenfit_engine_enabled', status: 'off', request_id: 'no-counter-0002' });
  assert.equal(s.statusCode, 200);
});

test('every write action is classified additive or set-style (a new write fails this until it is)', () => {
  const unclassified = Object.keys(ACTIONS).filter((a) => !READS.has(a) && !SELF_IDEMPOTENT.has(a) && !WRITE_CLASS[a]);
  assert.deepEqual(unclassified, []);
  const stale = Object.keys(WRITE_CLASS).filter((a) => !ACTIONS[a]);
  assert.deepEqual(stale, [], 'no class for an action that does not exist');
  for (const [a, [cls, why]] of Object.entries(WRITE_CLASS)) {
    assert.ok(['additive', 'set'].includes(cls), a);
    assert.ok(why && why.length > 10, `${a} says why`);
  }
  assert.deepEqual([...ADDITIVE].sort(), ['grant_credits', 'undo']);
});
