import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkListing,
  staleCount,
  refreshStaleJobs,
  STALE_STATUSES,
} from './staleRefresh.js';
import { _resetLiveness } from './listingLiveness.js';

test('exports: the stale set is exactly stale+expired', () => {
  assert.deepEqual(STALE_STATUSES, ['stale', 'expired']);
});

// ── checkListing: IO isolated behind an injected fetch ──────────────────────────
function resp(status, { body = '', url = 'https://example.test/final', location = null } = {}) {
  return { status, url, redirected: false, headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) }, text: async () => body };
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

test('checkListing: a 404 apply_url whose page says the job is gone is dead', async () => {
  const r = await checkListing(
    { id: '2', apply_url: 'https://jobs.example.test/gone' },
    { fetchImpl: async () => resp(404, { body: '<p>This job is no longer available.</p>' }) },
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
  assert.equal(r.reason, 'timeout');
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
  'https://src.test/c': { status: 404, body: 'This job is no longer available' }, // dead → expire
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

// security audit 2026-11-01: apply_url is stored data; with the real fetch the probe goes through
// safeFetch and never requests a private / metadata address.
test('checkListing with the real fetch refuses a private apply_url without requesting it', async (t) => {
  let called = false;
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async () => { called = true; return new Response('', { status: 200 }); };
  const r = await checkListing({ id: 'm', apply_url: 'http://169.254.169.254/latest/meta-data/' }, { fetchImpl: globalThis.fetch });
  assert.equal(r.verdict, 'unknown');
  assert.equal(called, false);
});

// ── round 2: the revive / expire decision is probeSource's (lib/server/listingLiveness.js) ─────────────
test('checkListing: a bare 404/410 (no closed text) is unknown — never dead', async () => {
  for (const status of [404, 410]) {
    _resetLiveness();
    const r = await checkListing({ id: 'b' + status, apply_url: 'https://jobs.example.test/x/1' }, { fetchImpl: async () => resp(status, { body: '<h1>Error</h1>' }) });
    assert.equal(r.verdict, 'unknown', `bare ${status}`);
  }
});

test('checkListing: a 200 page saying the posting is gone is dead; the word "expired" in a description is not', async () => {
  _resetLiveness();
  const dead = await checkListing({ id: 'c1', apply_url: 'https://jobs.example.test/x/2' }, { fetchImpl: async () => resp(200, { body: 'Sorry, this job has expired.' }) });
  assert.equal(dead.verdict, 'dead');
  _resetLiveness();
  const live = await checkListing({ id: 'c2', apply_url: 'https://jobs.example.test/x/3' }, { fetchImpl: async () => resp(200, { body: 'Must renew any expired certification within 30 days.' }) });
  assert.equal(live.verdict, 'live');
});

test('checkListing never revives on a redirect to a front door (an Adzuna /land/ad link forwarding to a home page)', async () => {
  _resetLiveness();
  const src = 'https://careers.example.test/job/123-welder';
  const r = await checkListing({ id: 'r1', apply_url: src }, { fetchImpl: async (u) => (u === src ? resp(302, { location: 'https://careers.example.test/' }) : resp(200, { body: 'Welcome' })) });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.reason, 'redirect_away');
});

test('checkListing for an Adzuna row asks its /details page: 410 with "no longer available" is dead, 200 is live', async () => {
  const land = 'https://www.adzuna.com/land/ad/5949787103?se=x&utm_medium=api&utm_source=be8427c6&v=9';
  const seen = [];
  _resetLiveness();
  const dead = await checkListing({ id: 'z1', apply_url: land }, { fetchImpl: async (u) => { seen.push(u); return resp(410, { body: '<h2>Unfortunately, this job is no longer available</h2>' }); } });
  assert.equal(dead.verdict, 'dead');
  assert.equal(seen[0], 'https://www.adzuna.com/details/5949787103?utm_medium=api&utm_source=be8427c6');
  _resetLiveness();
  const live = await checkListing({ id: 'z2', apply_url: land }, { fetchImpl: async () => resp(200, { body: '<script type="application/ld+json">{"@type":"JobPosting"}</script>' }) });
  assert.equal(live.verdict, 'live');
});

test('checkListing: walls and server errors are unknown', async () => {
  for (const status of [401, 403, 405, 429, 500, 503]) {
    _resetLiveness();
    const r = await checkListing({ id: 'w' + status, apply_url: 'https://jobs.example.test/x/9' }, { fetchImpl: async () => resp(status) });
    assert.equal(r.verdict, 'unknown', `HTTP ${status}`);
  }
});
