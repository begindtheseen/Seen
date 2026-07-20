import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UUID_RE,
  CLOSE_REASONS,
  isCloseReason,
  sanitizeCompanyName,
  expireListingPatch,
  buildCloseIssue,
  listEmployerListings,
  closeEmployerListing,
} from './employerListings.js';

const JID = '123e4567-e89b-12d3-a456-426614174000';
const ok = (json, status = 200) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });

// A fetchImpl that scripts responses per URL substring and records every call.
function fakeDb(routes) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    for (const [needle, resp] of routes) if (url.includes(needle)) return typeof resp === 'function' ? resp() : resp;
    throw new Error(`unrouted fetch: ${url}`);
  };
  return { impl, calls };
}

// ── pure helpers ────────────────────────────────────────────────────────────────
test('sanitizeCompanyName: strips wildcard + injection chars and caps length', () => {
  assert.equal(sanitizeCompanyName('  Acme Corp  '), 'Acme Corp');
  // % and * would widen a PostgREST ilike into a substring scan — must be stripped
  assert.equal(sanitizeCompanyName('Meta%'), 'Meta');
  assert.equal(sanitizeCompanyName('*cme <b>`'), 'cme b');
  assert.equal(sanitizeCompanyName(null), '');
  assert.equal(sanitizeCompanyName('x'.repeat(300)).length, 100);
});

test('expireListingPatch: exactly the admin delete_listing write, inside the CHECK vocabulary', () => {
  const now = '2026-07-19T00:00:00.000Z';
  assert.deepEqual(expireListingPatch(now), {
    availability_status: 'expired', // CHECK allows active/stale/expired/unknown only
    expires_at: now,                // search filters expires_at > now() → gone immediately
    last_checked_at: now,
  });
  assert.ok(['active', 'stale', 'expired', 'unknown'].includes(expireListingPatch().availability_status));
});

test('close reasons: UI vocabulary is filled/closed and never a DB status', () => {
  assert.deepEqual(CLOSE_REASONS, ['filled', 'closed']);
  assert.ok(isCloseReason('filled') && isCloseReason('closed'));
  assert.ok(!isCloseReason('expired') && !isCloseReason(''));
});

test('buildCloseIssue: lands in the existing report_issue vocabulary with caps applied', () => {
  const row = buildCloseIssue({
    job: { company: 'Acme', title: 'Sr Engineer', apply_url: 'https://a.test/j/1' },
    jobId: JID, reason: 'filled', verdict: 'live',
  });
  assert.equal(row.type, 'broken_listing');
  assert.equal(row.target_type, 'job');
  assert.equal(row.target_name, 'Acme — Sr Engineer');
  assert.match(row.notes, /filled/);
  assert.match(row.notes, /"live"/);
  assert.match(row.notes, /NOT auto-removed/);
  // Anchored match, not a substring probe — `includes()` on a URL trips CodeQL's
  // incomplete-url-substring-sanitization rule (and an anchored assert is stricter anyway).
  assert.match(row.notes, /https:\/\/a\.test\/j\/1(\s|$|")/);
  assert.ok(row.notes.length <= 500 && row.target_name.length <= 200);
});

test('buildCloseIssue: falls back to the job id and neutral reason on junk input', () => {
  const row = buildCloseIssue({ job: {}, jobId: JID, reason: 'DROP TABLE', verdict: 'unknown' });
  assert.equal(row.target_name, JID);
  assert.match(row.notes, /closed/);
  assert.match(row.notes, /"unknown"/);
});

test('UUID_RE: accepts a real uuid, rejects ephemeral search ids', () => {
  assert.ok(UUID_RE.test(JID));
  assert.ok(!UUID_RE.test('j_1no2squ') && !UUID_RE.test(''));
});

// ── listEmployerListings ────────────────────────────────────────────────────────
test('listEmployerListings: 400 on a missing/emptied name, no DB hit', async () => {
  const { impl, calls } = fakeDb([]);
  const r = await listEmployerListings({ url: 'https://db.test', key: 'k', company: '  %* ', fetchImpl: impl });
  assert.equal(r.http, 400);
  assert.equal(calls.length, 0);
});

test('listEmployerListings: exact-insensitive match on live listings only, mapped shape', async () => {
  const { impl, calls } = fakeDb([
    ['/rest/v1/jobs?', ok([{ id: JID, title: 'Sr Engineer', location: 'Austin, TX', source: 'Adzuna', availability_status: 'active', created_at: '2026-07-01T00:00:00Z', apply_url: 'https://a.test/j/1', extra: 'never leaks' }])],
  ]);
  const r = await listEmployerListings({ url: 'https://db.test', key: 'k', company: 'Acme Corp', fetchImpl: impl });
  assert.equal(r.http, 200);
  assert.equal(r.body.company, 'Acme Corp');
  assert.deepEqual(r.body.listings, [{
    id: JID, title: 'Sr Engineer', location: 'Austin, TX', source: 'Adzuna',
    availability_status: 'active', created_at: '2026-07-01T00:00:00Z', apply_url: 'https://a.test/j/1',
  }]);
  // exact ilike (no wildcards) + the same expires_at>now filter the public search uses
  assert.match(calls[0].url, /company=ilike\.Acme%20Corp&/);
  assert.ok(!calls[0].url.includes('*'));
  assert.match(calls[0].url, /expires_at=gt\./);
});

test('listEmployerListings: DB failure is a 500, not a crash', async () => {
  const { impl } = fakeDb([['/rest/v1/jobs?', ok({ msg: 'boom' }, 500)]]);
  const r = await listEmployerListings({ url: 'https://db.test', key: 'k', company: 'Acme', fetchImpl: impl });
  assert.equal(r.http, 500);
});

// ── closeEmployerListing ────────────────────────────────────────────────────────
const jobRow = (over = {}) => [{
  id: JID, company: 'Acme', title: 'Sr Engineer', apply_url: 'https://a.test/j/1',
  availability_status: 'active', expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), ...over,
}];

test('closeEmployerListing: non-uuid ids 400 before any IO', async () => {
  const { impl, calls } = fakeDb([]);
  const r = await closeEmployerListing({ url: 'https://db.test', key: 'k', jobId: 'j_1no2squ', fetchImpl: impl });
  assert.equal(r.http, 400);
  assert.equal(calls.length, 0);
});

test('closeEmployerListing: unknown listing 404s', async () => {
  const { impl } = fakeDb([['/rest/v1/jobs?id=eq.', ok([])]]);
  const r = await closeEmployerListing({ url: 'https://db.test', key: 'k', jobId: JID, fetchImpl: impl });
  assert.equal(r.http, 404);
});

test('closeEmployerListing: already-expired rows short-circuit idempotently (no liveness check)', async () => {
  const { impl, calls } = fakeDb([['/rest/v1/jobs?id=eq.', ok(jobRow({ availability_status: 'expired' }))]]);
  let checked = 0;
  const r = await closeEmployerListing({
    url: 'https://db.test', key: 'k', jobId: JID, fetchImpl: impl,
    checkImpl: async () => { checked += 1; return { verdict: 'dead' }; },
  });
  assert.deepEqual(r, { http: 200, body: { ok: true, closed: true, already: true } });
  assert.equal(checked, 0);
  assert.equal(calls.length, 1); // the read only — no writes
});

test('closeEmployerListing: a past expires_at also counts as already gone', async () => {
  const { impl } = fakeDb([['/rest/v1/jobs?id=eq.', ok(jobRow({ expires_at: '2020-01-01T00:00:00Z' }))]]);
  const r = await closeEmployerListing({ url: 'https://db.test', key: 'k', jobId: JID, fetchImpl: impl });
  assert.equal(r.body.already, true);
});

test('closeEmployerListing: source-confirmed dead → expire write + suppression, closed:verified', async () => {
  const { impl, calls } = fakeDb([
    ['/rest/v1/jobs?id=eq.', () => ok(jobRow())],
    ['/rest/v1/suppressed_listings', ok([])],
  ]);
  // PATCH and GET share the jobs?id=eq. prefix — route by scripting: first call read, later PATCH ok.
  const r = await closeEmployerListing({
    url: 'https://db.test', key: 'k', jobId: JID, reason: 'filled', fetchImpl: impl,
    checkImpl: async (job) => { assert.equal(job.apply_url, 'https://a.test/j/1'); return { verdict: 'dead' }; },
  });
  assert.deepEqual(r.body, { ok: true, closed: true, verified: true });
  const patch = calls.find(c => c.method === 'PATCH');
  assert.ok(patch, 'expire PATCH must fire');
  assert.equal(patch.body.availability_status, 'expired');
  assert.ok(patch.body.expires_at && patch.body.last_checked_at);
  const sup = calls.find(c => c.url.includes('suppressed_listings'));
  assert.ok(sup, 'apply_url must be suppressed so re-ingest cannot resurrect it');
  assert.equal(sup.body.reason, 'employer_closed');
  assert.equal(sup.body.apply_url, 'https://a.test/j/1');
  assert.equal(sup.body.stable_job_id, JID);
});

for (const verdict of ['live', 'unknown']) {
  test(`closeEmployerListing: ${verdict} verdict never touches the jobs row — queues for review`, async () => {
    const { impl, calls } = fakeDb([
      ['/rest/v1/jobs?id=eq.', ok(jobRow())],
      ['/rest/v1/user_issues', ok([])],
    ]);
    const r = await closeEmployerListing({
      url: 'https://db.test', key: 'k', jobId: JID, reason: 'filled', fetchImpl: impl,
      checkImpl: async () => ({ verdict }),
    });
    assert.deepEqual(r.body, { ok: true, closed: false, queued: true, verdict });
    assert.ok(!calls.some(c => c.method === 'PATCH'), 'no write on an unverified claim');
    const iss = calls.find(c => c.url.includes('user_issues'));
    assert.equal(iss.body.type, 'broken_listing');
    assert.match(iss.body.notes, /filled/);
  });
}

test('closeEmployerListing: failed expire write reports 500 (never a false "closed")', async () => {
  let reads = 0;
  const { impl } = fakeDb([
    ['/rest/v1/jobs?id=eq.', () => { reads += 1; return reads === 1 ? ok(jobRow()) : ok({ msg: 'nope' }, 500); }],
  ]);
  const r = await closeEmployerListing({
    url: 'https://db.test', key: 'k', jobId: JID, fetchImpl: impl,
    checkImpl: async () => ({ verdict: 'dead' }),
  });
  assert.equal(r.http, 500);
});

test('closeEmployerListing: failed queue insert reports 500 (the claim is never dropped silently)', async () => {
  const { impl } = fakeDb([
    ['/rest/v1/jobs?id=eq.', ok(jobRow())],
    ['/rest/v1/user_issues', ok({ msg: 'nope' }, 500)],
  ]);
  const r = await closeEmployerListing({
    url: 'https://db.test', key: 'k', jobId: JID, fetchImpl: impl,
    checkImpl: async () => ({ verdict: 'live' }),
  });
  assert.equal(r.http, 500);
});
