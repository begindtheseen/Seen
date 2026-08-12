// A rejected batch is not an empty batch.
//
// upsertJobs used to do `if (!res.ok) return { upserted: 0, rows: [] }` with no log and no error
// field, so a total write failure — a constraint violation, a statement timeout, schema drift —
// was indistinguishable from "the sources found nothing today". That is how a dead ingestion path
// keeps reporting healthy runs. Same class as the unchecked PATCH that left remove_listing and the
// stale sweep silently doing nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { upsertJobs } = await import('./jobSources.js');

const JOB = {
  title: 'Registered Nurse', company: 'Acme Health', location: 'Houston, TX',
  description: 'x'.repeat(200), apply_url: 'https://example.com/1',
};

function installFetch(jobsResponse) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET' });
    // Company lookup/create — always succeeds so the test isolates the jobs write.
    if (u.includes('/rest/v1/companies')) {
      return { ok: true, status: 200, async json() { return [{ id: 'company-1' }]; } };
    }
    return jobsResponse();
  };
  return calls;
}

test('a rejected batch is logged and reported, not silently zeroed', async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    installFetch(() => ({
      ok: false, status: 409,
      async text() { return 'duplicate key value violates unique constraint "jobs_uniq"'; },
    }));
    const out = await upsertJobs([JOB, { ...JOB, title: 'LVN' }], 'https://db.test', 'key');
    assert.equal(out.upserted, 0);
    assert.ok(out.error, 'the caller can tell a failed write from an empty one');
    assert.match(out.error, /409/);
    assert.ok(
      errors.some((e) => /upsertJobs failed: 409.*jobs_uniq.*2 rows dropped/s.test(e)),
      `expected the failure logged with its size, got ${JSON.stringify(errors)}`,
    );
  } finally { console.error = origError; }
});

test('a statement timeout on the batch surfaces the same way', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    installFetch(() => ({
      ok: false, status: 500,
      async text() { return '{"code":"57014","message":"canceling statement due to statement timeout"}'; },
    }));
    const out = await upsertJobs([JOB], 'https://db.test', 'key');
    assert.equal(out.upserted, 0);
    assert.match(out.error, /57014/);
  } finally { console.error = origError; }
});

test('a successful write carries no error and reports what landed', async () => {
  installFetch(() => ({
    ok: true, status: 201,
    async json() { return [{ id: 'job-1', title: JOB.title, company: JOB.company, location: JOB.location, created_at: 'now' }]; },
  }));
  const out = await upsertJobs([JOB], 'https://db.test', 'key');
  assert.equal(out.upserted, 1);
  assert.equal(out.error, undefined);
  assert.equal(out.rows[0].id, 'job-1');
});

test('an empty input is not a failure', async () => {
  installFetch(() => { throw new Error('should not be called'); });
  const out = await upsertJobs([], 'https://db.test', 'key');
  assert.deepEqual(out, { upserted: 0, rows: [] });
});
