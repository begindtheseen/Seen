// The flags the admin shows are exactly the flags code reads (each reader is checked at its file:line), the
// cron list matches vercel.json, and the schedule maths is right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { FLAG_READERS, CRONS, cronName, cronStep, parseCron } = await import('../lib/server/admin/system.js');

test('every listed flag is read at the file:line given', () => {
  for (const [flag, def] of Object.entries(FLAG_READERS)) {
    for (const ref of def.readers) {
      const [file, lines] = ref.split(':');
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      const [a, b] = lines.split('-').map(Number);
      const window = text.slice(a - 3, (b || a) + 2).join('\n');
      assert.ok(window.includes(flag), `${flag} is not read near ${ref}`);
    }
  }
  assert.equal(Object.values(FLAG_READERS).filter((d) => d.dangerous).length, 1, 'only the credit system is marked dangerous');
});

test('the cron list is vercel.json\'s', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.deepEqual(CRONS, v.crons.map(({ path: p, schedule }) => ({ path: p, schedule })));
});

test('cron names and schedule maths (UTC, as Vercel runs them)', () => {
  assert.equal(cronName('/api/refresh-jobs'), 'refresh-jobs');
  assert.equal(cronName('/api/stripe?action=reconcile_all'), 'stripe:reconcile_all');
  const from = new Date('2026-11-10T14:30:00Z'); // a Tuesday
  assert.equal(cronStep('0 15 * * *', from).toISOString(), '2026-11-10T15:00:00.000Z');
  assert.equal(cronStep('0 15 * * *', from, -1).toISOString(), '2026-11-09T15:00:00.000Z');
  assert.equal(cronStep('*/15 * * * *', from).toISOString(), '2026-11-10T14:45:00.000Z');
  assert.equal(cronStep('5 16,22 * * *', from).toISOString(), '2026-11-10T16:05:00.000Z');
  assert.equal(cronStep('0 8 * * 1', from).toISOString(), '2026-11-16T08:00:00.000Z', 'next Monday');
  assert.equal(cronStep('0 4 1 * *', from).toISOString(), '2026-12-01T04:00:00.000Z');
  assert.equal(cronStep('0 4 1 * *', from, -1).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(parseCron('nonsense'), null);
  for (const c of CRONS) assert.ok(cronStep(c.schedule, from), `${c.path} ${c.schedule} parses`);
});
