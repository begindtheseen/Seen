// A rejected batch must cost the rejected ROWS, not the batch.
//
// upsertJobs used to do `if (!res.ok) return { upserted: 0, rows: [] }` with no log, so a total
// write failure was indistinguishable from "the sources found nothing today". Surfacing that error
// then exposed how expensive it was: PostgREST posts a batch as ONE multi-row INSERT, so a single
// unacceptable row 409s all 100. Production lost ~6,500 listings in one run that way after the
// dedupe trigger was rekeyed (migration 067) and re-ingested rows started reaching the INSERT.
//
// Three distinct ways a batch died, all fixed here:
//   * duplicate rows WITHIN the batch — a BEFORE INSERT trigger cannot see rows inserted earlier in
//     its own statement, so the in-database dedupe is blind to them
//   * mixed object shapes — PGRST102 "All object keys must match"
//   * one bad row poisoning 99 good ones — no isolation on failure

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { upsertJobs, dedupeBatch } = await import('./jobSources.js');

const job = (over = {}) => ({
  title: 'Registered Nurse', company: 'Acme Health', location: 'Houston, TX',
  description: 'x'.repeat(200), apply_url: 'https://example.com/1', external_id: null, ...over,
});

// Fake PostgREST. `reject` decides per-request whether the batch is refused, so a test can make one
// specific row toxic and assert the rest still land.
function installFetch({ reject = null, status = 409, body = 'duplicate key value violates unique constraint' } = {}) {
  const posts = [];
  let inFlight = 0, maxInFlight = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/companies')) {
      return { ok: true, status: 200, async json() { return [{ id: 'company-1' }]; } };
    }
    const rows = JSON.parse(opts.body);
    posts.push(rows);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    if (reject && reject(rows)) {
      return { ok: false, status, async text() { return body; } };
    }
    return {
      ok: true, status: 201,
      async json() { return rows.map((r, i) => ({ id: `job-${posts.length}-${i}`, title: r.title, company: r.company, location: r.location, created_at: 'now' })); },
    };
  };
  return { posts, maxInFlight: () => maxInFlight };
}

const silence = async (fn) => {
  const orig = console.error; console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

// ── The batch-loss regression ─────────────────────────────────────────────────────────────────

test('one unacceptable row costs one row, not the 99 travelling with it', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => job({ apply_url: `https://example.com/${i}`, title: `Nurse ${i}` }));
  const { posts } = installFetch({ reject: (batch) => batch.some((r) => r.title === 'Nurse 42') });
  const out = await silence(() => upsertJobs(rows, 'https://db.test', 'key'));
  assert.equal(out.upserted, 99, 'the 99 valid rows must land');
  assert.equal(out.dropped, 1);
  assert.ok(out.error, 'and the rejection is still reported');
  assert.ok(posts.length > 1, 'the batch was split rather than abandoned');
});

test('a batch where every row is rejected reports all of them dropped', async () => {
  const rows = Array.from({ length: 4 }, (_, i) => job({ title: `Nurse ${i}` }));
  installFetch({ reject: () => true });
  const out = await silence(() => upsertJobs(rows, 'https://db.test', 'key'));
  assert.equal(out.upserted, 0);
  assert.equal(out.dropped, 4);
  assert.match(out.error, /409/);
});

test('the failing row is named in the log, not just counted', async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    installFetch({ reject: (b) => b.some((r) => r.company === 'Toxic Co') });
    await upsertJobs([job(), job({ company: 'Toxic Co', title: 'LVN' })], 'https://db.test', 'key');
    assert.ok(errors.some((e) => /Toxic Co \/ LVN/.test(e)), `expected the row identified, got ${JSON.stringify(errors)}`);
  } finally { console.error = orig; }
});

test('retry halves run sequentially so overlapping rows cannot deadlock', async () => {
  // Concurrent batches acquire the same row locks in opposite order via the trigger's UPDATE and
  // deadlock (40P01) — which costs the whole batch, the thing this retry exists to prevent.
  const rows = Array.from({ length: 16 }, (_, i) => job({ title: `Nurse ${i}` }));
  const { maxInFlight } = installFetch({ reject: (b) => b.some((r) => r.title === 'Nurse 3') });
  await silence(() => upsertJobs(rows, 'https://db.test', 'key'));
  assert.equal(maxInFlight(), 1, 'never more than one insert in flight');
});

// ── Intra-batch duplicates ────────────────────────────────────────────────────────────────────

test('duplicate external_ids within a batch are collapsed before sending', async () => {
  const { posts } = installFetch();
  const out = await upsertJobs([
    job({ external_id: '7602261', title: 'Nurse A' }),
    job({ external_id: '7602261', title: 'Nurse A (updated)' }),
    job({ external_id: '999', title: 'Nurse B' }),
  ], 'https://db.test', 'key');
  const sent = posts.flat();
  assert.equal(sent.length, 2, `expected 2 rows sent, got ${sent.length}`);
  assert.equal(out.upserted, 2);
  assert.ok(sent.some((r) => r.title === 'Nurse A (updated)'), 'the later read of the same posting wins');
});

test('duplicate title+company+location within a batch are collapsed, case-insensitively', async () => {
  const { posts } = installFetch();
  await upsertJobs([
    job({ title: 'Registered Nurse', company: 'Acme Health', location: 'Houston, TX' }),
    job({ title: 'registered nurse', company: 'ACME HEALTH', location: 'houston, tx' }),
  ], 'https://db.test', 'key');
  assert.equal(posts.flat().length, 1);
});

test('the same posting arriving under two identities is merged once, not twice', async () => {
  // Row 2 shares an external_id with row 1 and a name key with row 3 — all one listing.
  const out = dedupeBatch([
    job({ external_id: 'e1', title: 'A' }),
    job({ external_id: 'e1', title: 'B' }),
    job({ external_id: null, title: 'B' }),
  ]);
  assert.equal(out.length, 1, `expected 1 merged row, got ${out.length}`);
});

test('rows with no external_id are deduped on name alone, not collapsed together', async () => {
  const out = dedupeBatch([
    job({ external_id: null, title: 'Nurse A' }),
    job({ external_id: null, title: 'Nurse B' }),
    job({ external_id: null, title: 'Nurse A' }),
  ]);
  assert.equal(out.length, 2, 'two distinct titles survive, the repeat is folded');
});

// ── Shape uniformity (PGRST102) ───────────────────────────────────────────────────────────────

test('company_id is always present, so an unresolved company cannot split the shape', async () => {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/companies')) return { ok: true, status: 200, async json() { return []; } };
    const rows = JSON.parse(opts.body);
    for (const r of rows) assert.ok('company_id' in r, 'every row carries the key');
    return { ok: true, status: 201, async json() { return rows.map((_, i) => ({ id: `j${i}` })); } };
  };
  const out = await upsertJobs([job(), job({ title: 'LVN' })], 'https://db.test', 'key');
  assert.equal(out.upserted, 2);
});

test('rows of different shapes are posted as separate uniform requests', async () => {
  const { posts } = installFetch();
  await upsertJobs([
    job({ title: 'A' }),
    { title: 'B', company: 'Acme Health', location: 'Houston, TX', apply_url: 'https://example.com/b' }, // no description/external_id
  ], 'https://db.test', 'key');
  assert.equal(posts.length, 2, 'one request per shape');
  for (const batch of posts) {
    const sig = Object.keys(batch[0]).sort().join(' ');
    for (const r of batch) assert.equal(Object.keys(r).sort().join(' '), sig, 'each request is internally uniform');
  }
});

// ── Unchanged behaviour ───────────────────────────────────────────────────────────────────────

test('a successful write carries no error and reports what landed', async () => {
  installFetch();
  const out = await upsertJobs([job()], 'https://db.test', 'key');
  assert.equal(out.upserted, 1);
  assert.equal(out.error, undefined);
  assert.equal(out.rows[0].id, 'job-1-0');
});

test('an empty input is not a failure', async () => {
  global.fetch = async () => { throw new Error('should not be called'); };
  assert.deepEqual(await upsertJobs([], 'https://db.test', 'key'), { upserted: 0, rows: [] });
});

test('a statement timeout still surfaces after the splits are exhausted', async () => {
  installFetch({ reject: () => true, status: 500, body: '{"code":"57014","message":"canceling statement due to statement timeout"}' });
  const out = await silence(() => upsertJobs([job()], 'https://db.test', 'key'));
  assert.equal(out.upserted, 0);
  assert.match(out.error, /57014/);
});
