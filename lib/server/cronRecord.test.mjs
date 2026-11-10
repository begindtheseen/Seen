import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withCronRecord, cronResult } from './cronRecord.js';

const resOf = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

test('a Vercel cron run is recorded once with its result, a short count and duration_ms; other calls are not', async () => {
  const rows = [];
  const record = async (...a) => { rows.push(a); return true; };
  const h = withCronRecord('demand', async (req, res) => res.status(200).json({ ok: true, cities: 12, ms: 40 }), { record, isCron: (req) => req.cron });
  await h({ cron: true }, resOf());
  await h({ cron: false }, resOf());
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], 'demand'); assert.equal(rows[0][1], 'ok');
  assert.match(rows[0][2], /^cities 12, duration_ms \d+$/);
  assert.ok(rows[0][3].startedAt);
});

test('failures and partial runs are said as such; a throwing recorder never fails the cron; a name function picks the action', async () => {
  assert.equal(cronResult(500, {}), 'failed'); assert.equal(cronResult(200, { ok: false }), 'failed'); assert.equal(cronResult(200, { out_of_time: true }), 'partial');
  const bad = withCronRecord('x', async (req, res) => res.status(200).json({ ok: true }), { record: async () => { throw new Error('db down'); }, isCron: () => true });
  const r = resOf(); await bad({}, r); assert.equal(r.code, 200);
  const rows = [];
  const named = withCronRecord((req) => (req.query.action === 'reconcile_all' ? 'stripe:reconcile_all' : null), async (req, res) => res.status(200).json({ ok: true }), { record: async (...a) => rows.push(a), isCron: () => true });
  await named({ query: { action: 'checkout' } }, resOf()); await named({ query: { action: 'reconcile_all' } }, resOf());
  assert.deepEqual(rows.map((x) => x[0]), ['stripe:reconcile_all']);
  const thrower = withCronRecord('t', async () => { throw new Error('boom'); }, { record: async (...a) => rows.push(a), isCron: () => true });
  await assert.rejects(thrower({}, resOf())); assert.equal(rows.at(-1)[1], 'failed');
});
