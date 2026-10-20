// Run: node --test lib/reports/collectorRun.test.mjs — the shared applicant-report run loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCollection } from './collectorRun.js';

const acct = (i, outcome = 'ghosted') => ({ outcome, excerpt: `account ${i}`, url: `https://x.test/${i}` });
// A source that hands over `n` accounts, one at a time, honouring the goal it is given.
const source = (id, n, extra = {}) => ({ id, label: id, toItem: (company, a) => ({ company, source_url: a.url, excerpt: a.excerpt }),
  harvest: async (company, { goal, onAccounts }) => {
    let found = 0; let fresh = 0;
    for (let i = 0; i < n; i++) {
      found++;
      const added = await onAccounts([acct(`${id}${i}`)]);
      if (typeof added === 'number') fresh += added;
      if (goal > 0 && (typeof added === 'number' ? fresh : found) >= goal) return { found, stoppedBy: 'goal', searches: 1 };
    }
    return { found, stoppedBy: 'exhausted', searches: 1, ...extra };
  } });
// A fake Seen: everything is new except URLs it already holds.
const seen = (held = new Set(), calls = []) => async (items) => {
  calls.push(items.length);
  const fresh = items.filter((x) => !held.has(x.source_url));
  return { imported_reports: fresh.length, published_reports: fresh.length, duplicates: items.length - fresh.length };
};

test('one goal of NEW reports across sources: the second source fills what the first could not', async () => {
  const r = await runCollection({ targets: ['Acme'], goal: 5, postItems: seen(), sources: [source('reddit', 3), source('hackernews', 10)], log: () => {} });
  const row = r.companies[0];
  assert.equal(row.stopped_by, 'goal');
  assert.equal(row.imported, 5);
  assert.deepEqual({ r: row.by_source.reddit.new_reports, h: row.by_source.hackernews.new_reports }, { r: 3, h: 2 });
  assert.equal(r.imported_reports, 5);
  assert.deepEqual(r.sources, ['reddit', 'hackernews']);
});

test('accounts Seen already holds do not count toward the goal', async () => {
  const held = new Set(['https://x.test/reddit0', 'https://x.test/reddit1']);
  const r = await runCollection({ targets: ['Acme'], goal: 2, postItems: seen(held), sources: [source('reddit', 10)], log: () => {} });
  assert.equal(r.companies[0].imported, 2);
  assert.equal(r.companies[0].found, 4, 'read past the two already in Seen');
  assert.equal(r.companies[0].duplicates, 2);
});

test('a source that throws does not stop the next one; a stopped ingest stops the run and lists who was not reached', async () => {
  const boom = { id: 'reddit', label: 'Reddit', toItem: (c, a) => a, harvest: async () => { throw new Error('archive down'); } };
  const r = await runCollection({ targets: ['Acme'], goal: 3, postItems: seen(), sources: [boom, source('hackernews', 5)], log: () => {}, warn: () => {} });
  assert.equal(r.companies[0].imported, 3);
  assert.equal(r.companies[0].by_source.reddit.stopped_by, 'error');
  assert.match(r.companies[0].error, /Reddit: archive down/);
  const down = await runCollection({ targets: ['Acme', 'Beta', 'Gamma'], goal: 3, postItems: async () => { throw new Error('Seen ingest failed (401): Unauthorized'); }, sources: [source('reddit', 5)], log: () => {}, warn: () => {} });
  assert.equal(down.ok, false);
  assert.equal(down.stopped_early, 'ingest_error');
  assert.deepEqual(down.not_reached, ['Beta', 'Gamma']);
});

test('a dry run sends nothing and counts accounts found; the run budget lists companies not reached', async () => {
  const calls = [];
  const dry = await runCollection({ targets: ['Acme'], goal: 2, dryRun: true, postItems: seen(new Set(), calls), sources: [source('reddit', 5)], log: () => {} });
  assert.deepEqual(calls, []);
  assert.equal(dry.companies[0].found, 2);
  assert.equal(dry.companies[0].new_reports, null);
  let t = 0;
  const timed = await runCollection({ targets: ['Acme', 'Beta'], goal: 0, runDeadline: 10, now: () => (t += 6), postItems: seen(), sources: [source('reddit', 1)], log: () => {} });
  assert.deepEqual(timed.not_reached, ['Beta']);
  assert.equal(timed.stopped_early, 'time');
});

test('a source-specific stop (Google’s CAPTCHA) is reported as itself', async () => {
  const blocked = { id: 'google', label: 'Google', toItem: (c, a) => a, harvest: async () => ({ found: 0, stoppedBy: 'google_blocked', searches: 1 }) };
  const r = await runCollection({ targets: ['Acme'], goal: 5, postItems: async () => ({}), sources: [blocked], log: () => {} });
  assert.equal(r.companies[0].stopped_by, 'google_blocked');
});
