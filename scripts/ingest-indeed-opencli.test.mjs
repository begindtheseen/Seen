import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configFromEnv, runIndeedImport, unwrapOpenCli } from './ingest-indeed-opencli.mjs';

const env = { SEEN_LOCAL_INGEST_TOKEN: 'secret', INDEED_SEARCHES_JSON: '[{"query":"product manager","location":"Remote"},{"query":"bad"}]', INDEED_RESULTS_PER_SEARCH: '2', INDEED_MAX_PAGES: '2' };
const hit = id => ({ id, title: 'Product Manager', company: 'Quadra Group', location: 'Remote', url: `https://www.indeed.com/viewjob?jk=${id}` });
const ok = data => ({ stdout: JSON.stringify({ ok: true, data }) });

test('config validates limits and defaults to all searches', () => {
  assert.equal(configFromEnv(env).maxSearches, Infinity);
  assert.throws(() => configFromEnv({ ...env, INDEED_MAX_SEARCHES: 'zero' }), /positive integer/);
  assert.throws(() => configFromEnv({ ...env, INDEED_DETAIL_CONCURRENCY: '2' }), /positive integer/);
});

test('unwrapOpenCli supports 1.x and 2.x payloads', () => {
  assert.deepEqual(unwrapOpenCli('[{"id":"x"}]'), [{ id: 'x' }]);
  assert.deepEqual(unwrapOpenCli('{"ok":true,"data":[{"id":"x"}]}'), [{ id: 'x' }]);
});

test('pipeline continues after a failed search/detail and reports accurate metrics', async () => {
  const ids = ['1111111111111111', '2222222222222222'];
  const calls = [];
  const execFileImpl = async (_bin, args) => {
    calls.push(args);
    if (args[1] === 'search' && args[2] === 'bad') throw new Error('blocked');
    if (args[1] === 'search') return ok([hit(ids[0]), hit(ids[0]), hit(ids[1])]);
    if (args[2] === ids[1]) throw new Error('detail challenge');
    return ok([{ ...hit(ids[0]), description: 'A useful detailed description '.repeat(8) }]);
  };
  const fetchImpl = async (_url, init) => ({ ok: true, json: async () => ({ accepted: JSON.parse(init.body).jobs.length, upserted: 1, rejected: 0, deduplicated: 0 }) });
  const out = await runIndeedImport({ env, execFileImpl, fetchImpl, log: { warn() {} }, random: () => 0 });
  assert.equal(out.searches_attempted, 2); assert.equal(out.searches_successful, 1); assert.equal(out.searches_failed, 1);
  assert.equal(out.unique_indeed_ids, 2); assert.equal(out.duplicate_search_hits, 4);
  assert.equal(out.detail_requests_successful, 1); assert.equal(out.detail_requests_failed, 1); assert.equal(out.upserted, 1);
  assert.ok(calls.some(a => a.includes('--start')));
});
