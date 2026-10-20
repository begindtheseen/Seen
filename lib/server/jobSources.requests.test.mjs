// Request economy of the job writer (2026-10-20, Supabase prod edge logs for 2026-10-19):
//   * 1,384 of 1,620 POST /rest/v1/jobs were 400 "invalid input syntax for type integer":
//     Adzuna salaries are decimals (41683.01) and jobs.salary_min is integer. One such row made
//     the whole multi-row INSERT fail, postShape halved it ~2×log2(n) times to isolate the row,
//     and the listing itself was still lost.
//   * 4,658 GET /rest/v1/companies?name=eq.… — one lookup per company per upsert.
// Run: node --test lib/server/jobSources.requests.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { upsertJobs, resolveCompanyIds, coerceIntegerColumns } = await import('./jobSources.js');

const INT_COLS = ['salary_min', 'salary_max', 'score', 'waste_score'];

// Fake PostgREST: a companies table, and a jobs INSERT that refuses non-integer integer columns
// exactly like Postgres does (the whole statement fails).
function fakeDb(existing = {}) {
  const companies = new Map(Object.entries(existing));
  let nextId = 1;
  const calls = { companyGets: 0, companyPosts: 0, jobPosts: 0, rejected: 0, urls: [] };
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = opts.method || 'GET';
    if (u.pathname.endsWith('/companies')) {
      if (method === 'GET') {
        calls.companyGets++;
        calls.urls.push(String(url));
        const name = u.searchParams.get('name') || '';
        let wanted = [];
        if (name.startsWith('eq.')) wanted = [name.slice(3)];
        else if (name.startsWith('in.(')) {
          // Parse the quoted in-list the way PostgREST does.
          const body = name.slice(4, -1);
          for (const m of body.matchAll(/"((?:\\.|[^"\\])*)"/g)) wanted.push(m[1].replace(/\\(.)/g, '$1'));
        }
        const rows = wanted.filter((n) => companies.has(n)).map((n) => ({ id: companies.get(n), name: n }));
        return { ok: true, status: 200, async json() { return rows; } };
      }
      calls.companyPosts++;
      const body = JSON.parse(opts.body);
      const list = Array.isArray(body) ? body : [body];
      const out = list.map((r) => { const id = `c${nextId++}`; companies.set(r.name, id); return { id, name: r.name }; });
      return { ok: true, status: 201, async json() { return out; } };
    }
    if (u.pathname.endsWith('/jobs')) {
      calls.jobPosts++;
      const rows = JSON.parse(opts.body);
      const bad = rows.find((r) => INT_COLS.some((k) => r[k] != null && !Number.isInteger(r[k])));
      if (bad) {
        calls.rejected++;
        return { ok: false, status: 400, async text() { return '{"code":"22P02","message":"invalid input syntax for type integer"}'; } };
      }
      return { ok: true, status: 201, async json() { return rows.map((r, i) => ({ id: `j${i}`, title: r.title, company: r.company, location: r.location })); } };
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { calls, companies };
}

const adzuna = (i, over = {}) => ({
  title: `Warehouse Associate ${i}`, company: `Employer ${i}`, location: 'Austin, TX',
  description: 'x'.repeat(200), apply_url: `https://example.com/${i}`, salary_min: 41683.01 + i, score: 70, waste_score: 10, ...over,
});

test('decimal salaries no longer sink the batch: every row lands in ONE insert', async () => {
  const { calls } = fakeDb();
  const rows = Array.from({ length: 50 }, (_, i) => adzuna(i));
  const r = await upsertJobs(rows, 'https://db.test', 'k');
  assert.equal(r.upserted, 50);
  assert.equal(calls.rejected, 0, 'Postgres would have rejected a decimal integer');
  assert.equal(calls.jobPosts, 1);
});

test('coerceIntegerColumns rounds numeric strings/decimals, leaves integers, nulls and junk alone, never mutates', () => {
  const row = { salary_min: 41683.51, salary_max: '52000.2', score: 70, waste_score: null, title: 'x' };
  const out = coerceIntegerColumns(row);
  assert.deepEqual(out, { salary_min: 41684, salary_max: 52000, score: 70, waste_score: null, title: 'x' });
  assert.equal(row.salary_min, 41683.51, 'input untouched');
  const clean = { salary_min: 5, title: 'y' };
  assert.equal(coerceIntegerColumns(clean), clean, 'already-clean rows are not copied');
  assert.equal(coerceIntegerColumns({ salary_min: 'n/a' }).salary_min, 'n/a', 'non-numbers are left for Postgres to report');
});

test('company ids: one lookup per 40 names and one insert for the missing ones', async () => {
  const existing = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`Known Co ${i}`, `k${i}`]));
  const { calls } = fakeDb(existing);
  const names = [
    ...Array.from({ length: 60 }, (_, i) => `Known Co ${i}`),
    ...Array.from({ length: 20 }, (_, i) => `Fresh Co ${i}`),
  ];
  const ids = await resolveCompanyIds(names, 'https://db.test', 'k');
  assert.equal(calls.companyGets, 2, '80 names → 2 lookups, not 80');
  assert.equal(calls.companyPosts, 1, 'only the chunk holding the 20 new names inserts, once');
  assert.equal(ids[0], 'k0');
  assert.equal(ids[59], 'k59');
  assert.ok(ids.slice(60).every((id) => /^c\d+$/.test(id)), 'missing companies created');
  // Second call is served from the warm cache: no requests at all.
  await resolveCompanyIds(names, 'https://db.test', 'k');
  assert.equal(calls.companyGets, 2);
});

test('names with commas, parens and quotes stay one in.() value and still match', async () => {
  const tricky = ['Acme, Inc.', 'Foo (US) Holdings', 'The "Best" Co'];
  const { calls } = fakeDb(Object.fromEntries(tricky.map((n, i) => [n, `t${i}`])));
  const ids = await resolveCompanyIds(tricky, 'https://db.test', 'k');
  assert.deepEqual(ids, ['t0', 't1', 't2']);
  assert.equal(calls.companyPosts, 0);
});

test('invalid names resolve to null without a request; a failed lookup falls back per name', async () => {
  const { calls } = fakeDb({ 'Real Co': 'r1' });
  assert.deepEqual(await resolveCompanyIds(['Unknown', 'n/a', ''], 'https://db.test', 'k'), [null, null, null]);
  assert.equal(calls.companyGets, 0);

  // Batched lookup returns 500 → the single-name path still settles it.
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => (String(url).includes('name=in.')
    ? { ok: false, status: 500, async json() { return {}; } }
    : realFetch(url, opts));
  const [id] = await resolveCompanyIds(['Other Real Co'], 'https://db.test', 'k');
  assert.match(id, /^c\d+$/);
});

test('long names split the lookup by URL size, not just by count', async () => {
  const long = Array.from({ length: 30 }, (_, i) => `Very Long Employer Name ${'ü'.repeat(150)} ${i}`);
  const { calls } = fakeDb(Object.fromEntries(long.map((n, i) => [n, `l${i}`])));
  const ids = await resolveCompanyIds(long, 'https://db.test', 'k');
  assert.deepEqual(ids, long.map((_, i) => `l${i}`));
  assert.ok(calls.companyGets > 1, 'one 30-name URL would be far over the budget');
  for (const u of calls.urls) assert.ok(new URL(u).search.length < 6500, `URL too long: ${new URL(u).search.length}`);
});
