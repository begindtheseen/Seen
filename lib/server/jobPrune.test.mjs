import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRUNE_DEFAULTS,
  normalizeGraceDays,
  normalizeMaxRows,
  pruneCutoffISO,
  chunkIds,
  buildCandidateUrl,
  buildDeleteUrl,
  pruneStaleJobs,
} from './jobPrune.js';

const DAY_MS = 86400000;

// ── normalizeGraceDays: the safety clamp (cutoff can never move into the future) ──────────────
test('normalizeGraceDays: clamps negatives to 0, floors floats, NaN → default', () => {
  assert.equal(normalizeGraceDays(30), 30);
  assert.equal(normalizeGraceDays(0), 0);
  assert.equal(normalizeGraceDays(-5), 0, 'a negative grace must never delete not-yet-expired rows');
  assert.equal(normalizeGraceDays(12.9), 12);
  assert.equal(normalizeGraceDays('7'), 7);
  assert.equal(normalizeGraceDays('nope'), PRUNE_DEFAULTS.graceDays);
  assert.equal(normalizeGraceDays(undefined), PRUNE_DEFAULTS.graceDays);
});

test('normalizeMaxRows: clamps to [1, 50000], NaN → default', () => {
  assert.equal(normalizeMaxRows(5000), 5000);
  assert.equal(normalizeMaxRows(0), 1);
  assert.equal(normalizeMaxRows(-100), 1);
  assert.equal(normalizeMaxRows(999999), 50000);
  assert.equal(normalizeMaxRows('bad'), PRUNE_DEFAULTS.maxRows);
});

// ── pruneCutoffISO: the SAFETY INVARIANT — cutoff is always ≤ now ─────────────────────────────
test('pruneCutoffISO: cutoff = now − graceDays, and is never in the future', () => {
  const now = Date.UTC(2026, 6, 8, 10, 0, 0); // 2026-07-08T10:00:00Z
  assert.equal(pruneCutoffISO(30, now), new Date(now - 30 * DAY_MS).toISOString());
  assert.equal(pruneCutoffISO(0, now), new Date(now).toISOString(), 'grace 0 → cutoff exactly now');
  // A negative grace must be clamped so the cutoff stays at now (never selects a future-expiry row).
  assert.equal(pruneCutoffISO(-10, now), new Date(now).toISOString());
  assert.ok(new Date(pruneCutoffISO(30, now)).getTime() <= now, 'cutoff must be ≤ now');
});

// ── chunkIds ──────────────────────────────────────────────────────────────────────────────────
test('chunkIds: splits into fixed-size groups, remainder last', () => {
  assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkIds([], 100), []);
  assert.deepEqual(chunkIds([1], 100), [[1]]);
  assert.equal(chunkIds(Array.from({ length: 250 }, (_, i) => i), 100).length, 3);
});

// ── URL builders: the two load-bearing filters must always be present ──────────────────────────
test('buildCandidateUrl: excludes employer-posted, filters on expires_at<cutoff, bounds the limit', () => {
  const u = buildCandidateUrl('https://db.test', { cutoffISO: '2026-07-08T10:00:00.000Z', limit: 5000 });
  assert.ok(u.includes('is_employer_posted=eq.false'), 'employer-posted rows are never fetched as candidates');
  assert.ok(u.includes('expires_at=lt.'), 'only rows past the cutoff are candidates');
  assert.ok(u.includes(encodeURIComponent('2026-07-08T10:00:00.000Z')));
  assert.ok(u.includes('limit=5000'));
  assert.ok(u.includes('order=expires_at.asc'), 'oldest-dead first drains the worst backlog first');
});

test('buildDeleteUrl: targets exactly the given ids', () => {
  assert.equal(buildDeleteUrl('https://db.test', ['a', 'b', 'c']), 'https://db.test/rest/v1/jobs?id=in.(a,b,c)');
});

// ── a fake Supabase REST surface that HONORS the candidate filters ──────────────────────────────
// GET select: applies is_employer_posted=eq.false + expires_at<cutoff + limit (so the test proves
// the query — not just the code — excludes employer rows and future-expiry rows). DELETE: removes ids.
function makeSupabase(rows) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const deletes = [];
  const fetchImpl = async (u, opts = {}) => {
    const method = opts.method || 'GET';
    const url = new URL(u);
    if (method === 'GET') {
      const emp = url.searchParams.get('is_employer_posted'); // "eq.false"
      const exp = url.searchParams.get('expires_at');         // "lt.<iso>"
      const limit = Number(url.searchParams.get('limit') || 1000);
      const cutoff = exp && exp.startsWith('lt.') ? new Date(exp.slice(3)) : null;
      let out = [...store.values()];
      if (emp === 'eq.false') out = out.filter((r) => r.is_employer_posted === false);
      if (cutoff) out = out.filter((r) => new Date(r.expires_at) < cutoff);
      out.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
      out = out.slice(0, limit);
      return { ok: true, status: 200, json: async () => out };
    }
    if (method === 'DELETE') {
      const idParam = url.searchParams.get('id') || ''; // "in.(a,b,c)"
      const inner = idParam.replace(/^in\.\(/, '').replace(/\)$/, '');
      const ids = inner ? inner.split(',').map((s) => decodeURIComponent(s)) : [];
      for (const id of ids) store.delete(id);
      deletes.push(ids);
      return { ok: true, status: 204 };
    }
    return { ok: false, status: 405 };
  };
  return { fetchImpl, deletes, store };
}

const NOW = Date.UTC(2026, 6, 8, 10, 0, 0); // fixed clock
const iso = (deltaDays) => new Date(NOW + deltaDays * DAY_MS).toISOString();

// a/b: long dead (35d past expiry) → eligible. c: only 5d past expiry → within 30d grace, NOT eligible.
// d: still live (expires in the future) → NEVER eligible. e: 40d past expiry but EMPLOYER-POSTED → excluded.
const ROWS = () => [
  { id: 'a', company: 'Acme', title: 'Nurse',   expires_at: iso(-35), is_employer_posted: false },
  { id: 'b', company: 'Beta', title: 'Cook',    expires_at: iso(-40), is_employer_posted: false },
  { id: 'c', company: 'Gamma', title: 'Welder', expires_at: iso(-5),  is_employer_posted: false },
  { id: 'd', company: 'Delta', title: 'Barista', expires_at: iso(+3),  is_employer_posted: false },
  { id: 'e', company: 'Epsilon', title: 'Clerk', expires_at: iso(-40), is_employer_posted: true },
];

test('pruneStaleJobs dry-run: counts eligible rows, writes NOTHING', async () => {
  const { fetchImpl, deletes, store } = makeSupabase(ROWS());
  const s = await pruneStaleJobs({ url: 'https://db.test', key: 'k', apply: false, graceDays: 30, fetchImpl, nowMs: NOW });
  assert.equal(s.candidates, 2, 'only a + b are ≥30d past expiry, non-employer');
  assert.equal(s.deleted, 0);
  assert.equal(deletes.length, 0, 'dry-run must not DELETE');
  assert.equal(store.size, 5, 'nothing removed');
});

test('pruneStaleJobs apply: deletes long-dead non-employer rows, returns exact count', async () => {
  const { fetchImpl, deletes, store } = makeSupabase(ROWS());
  const s = await pruneStaleJobs({ url: 'https://db.test', key: 'k', apply: true, graceDays: 30, fetchImpl, nowMs: NOW });
  assert.equal(s.candidates, 2);
  assert.equal(s.deleted, 2);
  assert.equal(deletes.length, 1, 'one chunk for two ids');
  assert.deepEqual([...store.keys()].sort(), ['c', 'd', 'e'], 'only a + b removed');
});

test('pruneStaleJobs SAFETY: never deletes a future-expiry (live) row or an employer-posted row', async () => {
  const { fetchImpl, store } = makeSupabase(ROWS());
  await pruneStaleJobs({ url: 'https://db.test', key: 'k', apply: true, graceDays: 30, fetchImpl, nowMs: NOW });
  assert.ok(store.has('d'), 'a listing whose expires_at is in the future must survive');
  assert.ok(store.has('e'), 'an employer-posted listing must survive even when long past expiry');
});

test('pruneStaleJobs: grace 0 deletes everything past expiry (bounded mirror of deleteExpired), still employer-safe', async () => {
  const { fetchImpl, store } = makeSupabase(ROWS());
  const s = await pruneStaleJobs({ url: 'https://db.test', key: 'k', apply: true, graceDays: 0, fetchImpl, nowMs: NOW });
  assert.equal(s.candidates, 3, 'a, b, c are all past expiry at grace 0');
  assert.deepEqual([...store.keys()].sort(), ['d', 'e'], 'live (d) + employer (e) survive');
});

test('pruneStaleJobs: respects maxRows and flags capped + chunks deletes', async () => {
  // 250 long-dead rows, cap 100/run, chunk 100 → deletes exactly 100 across 1 page in ≤1 chunk of 100.
  const many = Array.from({ length: 250 }, (_, i) => ({
    id: `j${i}`, company: 'Co', title: 'T', expires_at: iso(-50), is_employer_posted: false,
  }));
  const { fetchImpl, deletes } = makeSupabase(many);
  const s = await pruneStaleJobs({ url: 'https://db.test', key: 'k', apply: true, graceDays: 30, maxRows: 100, chunkSize: 100, fetchImpl, nowMs: NOW });
  assert.equal(s.candidates, 100, 'select is bounded to maxRows');
  assert.equal(s.deleted, 100);
  assert.equal(s.capped, true, 'a full page signals more remain for the next run');
  assert.equal(deletes.length, 1, '100 ids in one chunk of 100');
});

test('pruneStaleJobs: throws on a failed select (surfaces the error, no silent under-delete)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(
    () => pruneStaleJobs({ url: 'https://db.test', key: 'k', apply: true, fetchImpl, nowMs: NOW }),
    /select failed: HTTP 500/,
  );
});

test('pruneStaleJobs: requires url + key', async () => {
  await assert.rejects(() => pruneStaleJobs({ key: 'k' }), /url and key are required/);
});
