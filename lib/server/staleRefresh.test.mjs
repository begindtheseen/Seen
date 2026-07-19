import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLiveness,
  checkListing,
  staleCount,
  refreshStaleJobs,
  STALE_STATUSES,
  DEAD_MARKERS,
} from './staleRefresh.js';

// ── classifyLiveness: the pure verdict, every branch ────────────────────────────
test('classifyLiveness: 404/410 are dead', () => {
  assert.equal(classifyLiveness({ status: 404 }), 'dead');
  assert.equal(classifyLiveness({ status: 410 }), 'dead');
});

test('classifyLiveness: clean 2xx is live', () => {
  assert.equal(classifyLiveness({ status: 200, body: '<html>Apply now — Senior Engineer</html>' }), 'live');
  assert.equal(classifyLiveness({ status: 204, body: '' }), 'live');
});

test('classifyLiveness: 2xx page saying the posting is gone is dead', () => {
  assert.equal(classifyLiveness({ status: 200, body: 'Sorry, this job has expired.' }), 'dead');
  assert.equal(classifyLiveness({ status: 200, body: 'We are no longer accepting applications' }), 'dead');
  assert.equal(classifyLiveness({ status: 200, body: 'This position has been filled.' }), 'dead');
  assert.equal(classifyLiveness({ status: 200, body: 'Job not found' }), 'dead');
});

test('classifyLiveness: the bare word "expired" in a normal description is NOT dead', () => {
  // precision guard — a JD mentioning an "expired certification" must stay live
  assert.equal(classifyLiveness({ status: 200, body: 'Must renew any expired certification within 30 days.' }), 'live');
});

test('classifyLiveness: blocked / ambiguous / no-response carry no signal → unknown', () => {
  for (const status of [401, 403, 405, 429, 500, 502, 503]) {
    assert.equal(classifyLiveness({ status }), 'unknown', `HTTP ${status} should be unknown`);
  }
  assert.equal(classifyLiveness({ status: null }), 'unknown'); // timeout / network error
});

test('exports: stale set is exactly stale+expired; markers are real regexes', () => {
  assert.deepEqual(STALE_STATUSES, ['stale', 'expired']);
  assert.ok(DEAD_MARKERS.length > 0 && DEAD_MARKERS.every((re) => re instanceof RegExp));
});

// ── checkListing: IO isolated behind an injected fetch ──────────────────────────
function resp(status, { body = '', url = 'https://example.test/final' } = {}) {
  return { status, url, redirected: false, text: async () => body };
}

test('checkListing: a 200 apply_url is live', async () => {
  const r = await checkListing(
    { id: '1', apply_url: 'https://jobs.example.test/123', company: 'Acme' },
    { fetchImpl: async () => resp(200, { body: 'Apply for this role' }) },
  );
  assert.equal(r.verdict, 'live');
  assert.equal(r.status, 200);
  assert.equal(r.id, '1');
});

test('checkListing: a 404 apply_url is dead', async () => {
  const r = await checkListing(
    { id: '2', apply_url: 'https://jobs.example.test/gone' },
    { fetchImpl: async () => resp(404) },
  );
  assert.equal(r.verdict, 'dead');
});

test('checkListing: a thrown fetch (timeout/abort) is unknown, never throws', async () => {
  const r = await checkListing(
    { id: '3', apply_url: 'https://jobs.example.test/slow' },
    { fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } },
  );
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.status, null);
  assert.equal(r.reason, 'AbortError');
});

test('checkListing: a row with no apply_url is unknown (never fetched)', async () => {
  let called = false;
  const r = await checkListing({ id: '4', apply_url: null }, { fetchImpl: async () => { called = true; return resp(200); } });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.reason, 'no_url');
  assert.equal(called, false);
});

// ── a fake Supabase REST surface for the full-sweep tests ───────────────────────
// Serves: HEAD count, GET stale page, GET each apply_url (liveness), PATCH (captured).
function makeSupabase(rows, liveness) {
  const patches = [];
  const countOf = () => rows.filter((r) => STALE_STATUSES.includes(r.availability_status)).length;
  const fetchImpl = async (u, opts = {}) => {
    const method = opts.method || 'GET';
    const s = String(u);
    if (s.includes('/rest/v1/jobs') && method === 'HEAD') {
      return { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-range' ? `0-0/${countOf()}` : null) } };
    }
    if (s.includes('/rest/v1/jobs') && s.includes('order=id') && method === 'GET') {
      const offset = Number(new URL(s).searchParams.get('offset') || 0);
      const stale = rows.filter((r) => STALE_STATUSES.includes(r.availability_status));
      const page = offset === 0 ? stale : [];
      return { ok: true, status: 200, json: async () => page };
    }
    if (s.includes('/rest/v1/jobs') && method === 'PATCH') {
      patches.push({ url: s, body: JSON.parse(opts.body) });
      return { ok: true, status: 204 };
    }
    // otherwise it's a liveness fetch against an apply_url
    const v = liveness[s] ?? { status: 200, body: 'live' };
    return { status: v.status, url: s, redirected: false, text: async () => v.body || '' };
  };
  return { fetchImpl, patches };
}

const ROWS = [
  { id: 'a', company: 'Acme', title: 'Nurse', apply_url: 'https://src.test/a', availability_status: 'stale' },
  { id: 'b', company: 'Beta', title: 'Cook', apply_url: 'https://src.test/b', availability_status: 'stale' },
  { id: 'c', company: 'Gamma', title: 'Welder', apply_url: 'https://src.test/c', availability_status: 'stale' },
  { id: 'd', company: 'Delta', title: 'Barista', apply_url: 'https://src.test/d', availability_status: 'expired' },
];
const LIVENESS = {
  'https://src.test/a': { status: 200, body: 'Apply now' },     // live → reactivate
  'https://src.test/b': { status: 200, body: 'Apply now' },     // live → reactivate
  'https://src.test/c': { status: 404, body: '' },              // dead → expire
  'https://src.test/d': { status: 403, body: '' },              // unknown → leave
};

test('refreshStaleJobs dry-run: classifies, projects the KPI, writes NOTHING', async () => {
  const { fetchImpl, patches } = makeSupabase(structuredClone(ROWS), LIVENESS);
  const s = await refreshStaleJobs({ url: 'https://db.test', key: 'k', apply: false, concurrency: 2, fetchImpl });
  assert.equal(s.scanned, 4);
  assert.equal(s.kpiBefore, 4);
  assert.equal(s.live, 2);
  assert.equal(s.dead, 1);
  assert.equal(s.unknown, 1);
  assert.equal(s.reactivated, 0);
  assert.equal(s.expired, 0);
  assert.equal(s.kpiProjectedAfter, 2); // 4 stale − 2 reactivated
  assert.equal(patches.length, 0, 'dry-run must not PATCH');
});

test('refreshStaleJobs apply: reactivates live (sticky) + expires dead, leaves unknown', async () => {
  const { fetchImpl, patches } = makeSupabase(structuredClone(ROWS), LIVENESS);
  const s = await refreshStaleJobs({ url: 'https://db.test', key: 'k', apply: true, concurrency: 2, fetchImpl });
  assert.equal(s.reactivated, 2);
  assert.equal(s.expired, 1);
  assert.equal(patches.length, 2, 'one PATCH for the live batch, one for the dead batch');

  const active = patches.find((p) => p.body.availability_status === 'active');
  assert.ok(active, 'a reactivation PATCH was sent');
  // sticky: last_seen_at bumped (or markStaleJobs would re-stale it) + a fresh 14d lease
  assert.ok(active.body.last_seen_at, 'reactivation bumps last_seen_at');
  assert.ok(active.body.last_checked_at, 'reactivation bumps last_checked_at');
  assert.ok(active.body.expires_at, 'reactivation renews expires_at');
  assert.ok(active.url.includes('id=in.'), 'reactivation targets the live ids');

  const expired = patches.find((p) => p.body.availability_status === 'expired');
  assert.ok(expired, 'an expiry PATCH was sent');
  assert.ok(expired.body.expires_at, 'expiry sets expires_at=now so deleteExpired purges it');
});

test('staleCount reads the count=exact content-range header', async () => {
  const { fetchImpl } = makeSupabase(structuredClone(ROWS), LIVENESS);
  assert.equal(await staleCount('https://db.test', 'k', fetchImpl), 4);
});
