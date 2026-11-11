// "Is this job still open?" — every branch, with a fake database and a fake source. No network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkLiveness, probeSource, workdayReqId, needsCheck, pageSaysClosed, redirectedAway, checkableId, _resetLiveness, HOST_MAX_PER_MIN, LIVENESS_TTL_MS } from './listingLiveness.js';
import { fetchFullPosting } from './fullPosting.js';

const ID = '652fa866-6e34-4bbe-b161-c0a759ee2f49';
const ADZ = 'https://www.adzuna.com/land/ad/5949779993?se=jK2&utm_medium=api&utm_source=be8427c6&v=3C8F';
const OLD = new Date(Date.now() - 3 * 86400000).toISOString();

function fakeDb(row, { patchOk = true } = {}) {
  const calls = [];
  const db = async (path, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET') return { ok: true, status: 200, async json() { return row ? [row] : []; } };
    return patchOk ? { ok: true, status: 204 } : { ok: false, status: 500 };
  };
  return { db, calls, writes: () => calls.filter((c) => c.method !== 'GET') };
}

function res(status, { body = '', json = undefined, location = null } = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) },
    async text() { return body; },
    async json() { if (json === undefined) throw new Error('not json'); return json; },
  };
}
/** A source that answers from a table of URL → response (or a function), recording each request. */
function fakeSource(answer) {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return typeof answer === 'function' ? answer(url, init) : answer; };
  return { fetchImpl, seen };
}
const row = (extra = {}) => ({ id: ID, apply_url: ADZ, availability_status: 'active', last_checked_at: OLD, expires_at: null, is_employer_posted: false, ...extra });

beforeEach(() => _resetLiveness());

test('Adzuna open: one request to its /details page (partner tag kept), last_checked_at bumped, nothing else written', async () => {
  const { db, writes } = fakeDb(row());
  const src = fakeSource(res(200, { body: '<html><script type="application/ld+json">{"@type":"JobPosting"}</script>Event Supervisor</html>' }));
  const got = await checkLiveness({ jobId: ID, db, fetchImpl: src.fetchImpl });
  assert.equal(got.state, 'open'); assert.equal(got.fresh, true); assert.equal(got.saved, true);
  assert.equal(src.seen.length, 1);
  assert.match(src.seen[0].url, /^https:\/\/www\.adzuna\.com\/details\/5949779993\?utm_medium=api&utm_source=be8427c6$/);
  assert.equal(writes().length, 1);
  assert.deepEqual(Object.keys(writes()[0].body), ['last_checked_at']);
});

// The real 410 body Adzuna served for ad 5949787103 on 2026-11-10 (visible text, trimmed).
const ADZ_410 = '<html><title>Outside Sales Representative Job in The Gap, IL</title><body>What? Where? Search Advanced <h2>Unfortunately, this job is no longer available</h2> Outside Sales Representative Location: The Gap, IL</body></html>';

test('Adzuna 410 whose page says the job is no longer available: gone — hidden at once with the dead-listing write, never on an employer post, never a DELETE', async () => {
  const { db, writes } = fakeDb(row());
  const got = await checkLiveness({ jobId: ID, db, fetchImpl: fakeSource(res(410, { body: ADZ_410 })).fetchImpl });
  assert.equal(got.state, 'gone'); assert.equal(got.via, 'page'); assert.equal(got.saved, true);
  const w = writes();
  assert.equal(w.length, 1); assert.equal(w[0].method, 'PATCH');
  assert.match(w[0].path, /id=eq\.652fa866-[^&]+&is_employer_posted=eq\.false$/);
  assert.equal(w[0].body.availability_status, 'expired');
  assert.equal(w[0].body.expires_at, w[0].body.last_checked_at, 'expires now: search reads expires_at > now');
  assert.equal(got.checked_at, w[0].body.last_checked_at);
});

test('404 on a page that says the job was removed is gone too', async () => {
  const { db } = fakeDb(row({ apply_url: 'https://careers.example.com/job/123-welder' }));
  const got = await checkLiveness({ jobId: ID, db, fetchImpl: fakeSource(res(404, { body: '<h1>Job not found</h1><p>This position has been filled.</p>' })).fetchImpl });
  assert.equal(got.state, 'gone');
});

test('a bare 404/410 never closes a job: empty, a challenge page or a generic error is unknown and writes nothing', async () => {
  const bodies = [
    '',
    '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing www.adzuna.com. Enable JavaScript and cookies to continue.</body></html>',
    '<html><body><h1>Gone</h1><p>The requested resource is no longer available on this server.</p></body></html>',
    '<html><body>Something went wrong. Please try again later.</body></html>',
  ];
  for (const status of [410, 404]) {
    for (const body of bodies) {
      _resetLiveness();
      const { db, writes } = fakeDb(row());
      const got = await checkLiveness({ jobId: ID, db, fetchImpl: fakeSource(res(status, { body })).fetchImpl });
      assert.equal(got.state, 'unknown', `${status} ${body.slice(0, 40)}`);
      assert.equal(got.via, 'bare_status');
      assert.equal(writes().length, 0);
    }
  }
});

test('an ATS link asks the ATS API, not the page: Greenhouse 404 = gone, 200 = open', async () => {
  const gh = 'https://boards.greenhouse.io/acme/jobs/4012345';
  const s1 = fakeSource(res(404));
  const g1 = await checkLiveness({ jobId: ID, db: fakeDb(row({ apply_url: gh })).db, fetchImpl: s1.fetchImpl });
  assert.equal(g1.state, 'gone'); assert.equal(g1.via, 'ats-api:greenhouse');
  assert.equal(s1.seen[0].url, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345');
  _resetLiveness();
  const g2 = await checkLiveness({ jobId: ID, db: fakeDb(row({ apply_url: gh })).db, fetchImpl: fakeSource(res(200, { json: { title: 'Welder', content: 'x' } })).fetchImpl });
  assert.equal(g2.state, 'open');
});

test('Oracle answers 200 with no items for a closed requisition: gone', async () => {
  const url = 'https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/98765';
  const s = fakeSource(res(200, { json: { items: [] } }));
  const got = await checkLiveness({ jobId: ID, db: fakeDb(row({ apply_url: url })).db, fetchImpl: s.fetchImpl });
  assert.equal(got.state, 'gone'); assert.equal(got.via, 'ats-api:oracle');
  assert.match(s.seen[0].url, /recruitingCEJobRequisitionDetails/);
});

test('Ashby: a board that no longer lists the job is gone; one that lists it is open', async () => {
  const jid = '0b3c9f4e-1111-2222-3333-444455556666';
  const url = `https://jobs.ashbyhq.com/acme/${jid}`;
  const gone = await probeSource(url, { fetchImpl: fakeSource(res(200, { json: { jobs: [{ id: 'other' }] } })).fetchImpl });
  assert.equal(gone.state, 'gone');
  _resetLiveness();
  const open = await probeSource(url, { fetchImpl: fakeSource(res(200, { json: { jobs: [{ id: jid }] } })).fetchImpl });
  assert.equal(open.state, 'open');
});

test('a redirect to an error page is gone (Jobvite 303 → ?error=404)', async () => {
  const url = 'https://jobs.jobvite.com/acme/job/oAbC123';
  const src = fakeSource((u) => (u === url ? res(303, { location: '/acme/jobs?error=404' }) : res(200, { body: 'jobs list' })));
  const got = await probeSource(url, { fetchImpl: src.fetchImpl });
  assert.equal(got.state, 'gone'); assert.equal(got.via, 'redirect');
  assert.equal(src.seen.length, 1, 'the error hop is the answer; it is not fetched');
});

test('a 200 page that says the job is no longer available is gone; a posting with that phrase in a footer is not', async () => {
  const url = 'https://careers.example.com/job/123-welder';
  const closed = await probeSource(url, { fetchImpl: fakeSource(res(200, { body: '<h1>Sorry</h1><p>This job is no longer available.</p>' })).fetchImpl });
  assert.equal(closed.state, 'gone'); assert.equal(closed.via, 'closed-page');
  _resetLiveness();
  const open = await probeSource(url, { fetchImpl: fakeSource(res(200, { body: '<script type="application/ld+json">{"@type": "JobPosting"}</script><footer>Page not found? Contact us</footer>' })).fetchImpl });
  assert.equal(open.state, 'open');
  assert.equal(pageSaysClosed('<script>var t="job not found"</script><p>Welder wanted</p>'), false, 'script text is not page text');
});

test('a redirect away from the job (the careers home) is no answer either way', async () => {
  const url = 'https://careers.example.com/job/123-welder';
  const src = fakeSource((u) => (u === url ? res(302, { location: 'https://careers.example.com/' }) : res(200, { body: 'Welcome to our careers' })));
  const got = await probeSource(url, { fetchImpl: src.fetchImpl });
  assert.equal(got.state, 'unknown'); assert.equal(got.via, 'redirect_away');
  assert.equal(redirectedAway('https://a.com/job/1', 'https://a.com/careers/'), true);
  assert.equal(redirectedAway('https://a.com/job/1', 'https://a.com/en/job/1-welder'), false);
});

test('walls, server errors and timeouts are unknown and write nothing', async () => {
  for (const status of [401, 403, 405, 429, 500, 503]) {
    _resetLiveness();
    const { db, writes } = fakeDb(row());
    const got = await checkLiveness({ jobId: ID, db, fetchImpl: fakeSource(res(status)).fetchImpl });
    assert.equal(got.state, 'unknown', `HTTP ${status}`);
    assert.equal(writes().length, 0, `HTTP ${status} writes nothing`);
  }
  _resetLiveness();
  const t1 = fakeDb(row());
  const thrown = await checkLiveness({ jobId: ID, db: t1.db, fetchImpl: async () => { throw new Error('timeout'); } });
  assert.equal(thrown.state, 'unknown'); assert.equal(thrown.via, 'timeout'); assert.equal(t1.writes().length, 0);
  _resetLiveness();
  const t2 = fakeDb(row());
  const hung = await checkLiveness({ jobId: ID, db: t2.db, fetchImpl: () => new Promise(() => {}), timeoutMs: 30 });
  assert.equal(hung.state, 'unknown'); assert.equal(t2.writes().length, 0);
  _resetLiveness();
  const t3 = fakeDb(row());
  const refused = await checkLiveness({ jobId: ID, db: t3.db, fetchImpl: async () => { throw new Error('blocked_url:private_address'); } });
  assert.equal(refused.state, 'unknown'); assert.equal(refused.via, 'unreachable');
});

test('a wall is not asked again from this instance for an hour', async () => {
  const { db } = fakeDb(row());
  const src = fakeSource(res(403));
  await checkLiveness({ jobId: ID, db, fetchImpl: src.fetchImpl });
  const again = await checkLiveness({ jobId: ID, db, fetchImpl: src.fetchImpl });
  assert.equal(src.seen.length, 1); assert.equal(again.state, 'unknown'); assert.equal(again.fresh, false);
});

test('two opens at the same moment share one request and one write', async () => {
  const { db, writes } = fakeDb(row());
  let release;
  const gate = new Promise((r) => { release = r; });
  const src = fakeSource(async () => { await gate; return res(410, { body: ADZ_410 }); });
  const a = checkLiveness({ jobId: ID, db, fetchImpl: src.fetchImpl });
  const b = checkLiveness({ jobId: ID, db, fetchImpl: src.fetchImpl });
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.state, 'gone'); assert.equal(rb, ra);
  assert.equal(src.seen.length, 1); assert.equal(writes().length, 1);
});

test('a row checked in the last 24 h is answered from the row; an employer post and a search-only id are never fetched', async () => {
  const recent = new Date(Date.now() - 3600_000).toISOString();
  const src = fakeSource(() => { throw new Error('must not fetch'); });
  const r1 = fakeDb(row({ last_checked_at: recent }));
  const got = await checkLiveness({ jobId: ID, db: r1.db, fetchImpl: src.fetchImpl });
  assert.deepEqual(got, { state: 'open', checked_at: recent, via: 'recent', fresh: false });
  const r2 = fakeDb(row({ is_employer_posted: true }));
  const emp = await checkLiveness({ jobId: ID, db: r2.db, fetchImpl: src.fetchImpl });
  assert.equal(emp.via, 'employer'); assert.equal(r2.writes().length, 0);
  const r3 = fakeDb(row());
  const live = await checkLiveness({ jobId: 'j_ab12cd', db: r3.db, fetchImpl: src.fetchImpl });
  assert.equal(live.via, 'no_row'); assert.equal(r3.calls.length, 0);
  assert.equal(src.seen.length, 0);
  assert.equal(checkableId(ID.toUpperCase()), ID);
});

test('needsCheck: expired rows always, active rows after 24 h, never an employer post', () => {
  const now = Date.now();
  assert.equal(needsCheck(row({ last_checked_at: new Date(now - LIVENESS_TTL_MS + 60_000).toISOString() }), now), false);
  assert.equal(needsCheck(row({ last_checked_at: new Date(now - LIVENESS_TTL_MS).toISOString() }), now), true);
  assert.equal(needsCheck(row({ last_checked_at: null }), now), true);
  assert.equal(needsCheck(row({ availability_status: 'expired', last_checked_at: new Date(now).toISOString() }), now), true);
  assert.equal(needsCheck(row({ is_employer_posted: true, last_checked_at: null }), now), false);
});

test('an expired row is re-checked on open, then remembered for a day on this instance', async () => {
  const { db, writes } = fakeDb(row({ availability_status: 'expired', last_checked_at: new Date().toISOString() }));
  const src = fakeSource(res(410, { body: ADZ_410 }));
  const first = await checkLiveness({ jobId: ID, db, fetchImpl: src.fetchImpl });
  const second = await checkLiveness({ jobId: ID, db, fetchImpl: src.fetchImpl });
  assert.equal(first.state, 'gone'); assert.equal(second.state, 'gone'); assert.equal(second.fresh, false);
  assert.equal(src.seen.length, 1); assert.equal(writes().length, 1);
});

test('a failed write is reported (saved:false, logged), never thrown and never hidden', async () => {
  const { db } = fakeDb(row(), { patchOk: false });
  const logged = [];
  const orig = console.error; console.error = (m) => logged.push(m);
  try {
    const got = await checkLiveness({ jobId: ID, db, fetchImpl: fakeSource(res(410, { body: ADZ_410 })).fetchImpl });
    assert.equal(got.state, 'gone'); assert.equal(got.saved, false);
  } finally { console.error = orig; }
  assert.ok(logged.some((m) => /\[liveness\] gone write failed/.test(m)));
});

test('one host is asked at most HOST_MAX_PER_MIN times a minute from an instance', async () => {
  let t = 1_000_000;
  const now = () => t;
  const src = fakeSource(res(200, { body: 'ok' }));
  const states = [];
  for (let i = 0; i < HOST_MAX_PER_MIN + 2; i++) {
    t += 1500; // past the per-request gap, inside the minute
    states.push((await probeSource('https://careers.example.com/job/1', { fetchImpl: src.fetchImpl, now })).via);
  }
  assert.equal(src.seen.length, HOST_MAX_PER_MIN);
  assert.equal(states.at(-1), 'rate_limited');
  t += 61_000;
  assert.equal((await probeSource('https://careers.example.com/job/1', { fetchImpl: src.fetchImpl, now })).state, 'open');
});

test('the posting fetcher records a job the source says is gone (one write), and never for an employer post', async () => {
  const teaser = `Event Security Supervisor ${'x '.repeat(200)}…`;
  const base = { id: ID, title: 'Event Supervisor', company: 'BEST', source: 'Adzuna', description: teaser, apply_url: ADZ, is_employer_posted: false };
  const resolve = async () => ({ fields: { description: '' }, rungs: [{ rung: 'direct', status: 410 }, { rung: 'closed', status: 410 }], blocked: true });
  const d1 = fakeDb(base);
  const got = await fetchFullPosting({ jobId: ID, db: d1.db, resolve });
  assert.equal(got.reason, 'gone');
  const w = d1.writes();
  assert.equal(w.length, 1);
  assert.equal(w[0].body.availability_status, 'expired');
  assert.match(w[0].path, /is_employer_posted=eq\.false/);
  const d2 = fakeDb({ ...base, is_employer_posted: true });
  await fetchFullPosting({ jobId: ID, db: d2.db, resolve });
  assert.equal(d2.writes().length, 0);
  const d3 = fakeDb(base);
  await fetchFullPosting({ jobId: ID, db: d3.db, resolve: async () => { throw new Error('unreachable'); } });
  assert.equal(d3.writes().length, 0, 'unreachable is not gone');
});

test('a company jobs page that picks the job by query (…/careers?gh_jid=…) is not asked: it answers 200 either way', async () => {
  const src = fakeSource(res(200, { body: 'Open roles' }));
  for (const u of ['https://jobs.bayada.com/en/jobs?gh_jid=8838191002', 'https://www.compass.com/careers?gh_jid=8262023', 'https://acme.com/']) {
    _resetLiveness();
    const got = await probeSource(u, { fetchImpl: src.fetchImpl });
    assert.equal(got.state, 'unknown', u); assert.equal(got.via, 'not_a_job_page');
  }
  assert.equal(src.seen.length, 0);
});

// The site's own search, answered by adventisthealthcare.wd1.myworkdayjobs.com on 2026-11-10 (facets trimmed).
const WD_SEARCH_GONE = { total: 0, jobPostings: [], userAuthenticated: false };
const WD_SEARCH_LISTED = { total: 1, jobPostings: [{ title: 'Registered Nurse (RN), Day Shift, Medicine', externalPath: '/job/Rockville-MD/Registered-Nurse--RN---Day-Shift--Medicine_R-041405-1', timeType: 'Full time', locationsText: 'Rockville, MD', bulletFields: ['Regular', 'R-041405'] }] };
const WD = 'https://adventisthealthcare.wd1.myworkdayjobs.com/AdventistHealthCareCareers/job/Registered-Nurse--RN---Day-Shift--Med-Surg-Oncology_R-040536-1';

test('Workday 403 is confirmed with the site\'s own search by requisition id: total 0 = gone, a hit = unknown', async () => {
  assert.equal(workdayReqId('https://x.wd1.myworkdayjobs.com/wday/cxs/x/S/job/Registered-Nurse--RN-_R26098252-1'), 'R26098252');
  assert.equal(workdayReqId('https://x.wd1.myworkdayjobs.com/wday/cxs/x/S/job/Registered-Nurse_JR101064'), 'JR101064');
  const answer = (search) => (u, init) => (init?.method === 'POST' ? res(200, { json: search }) : res(403, { json: {} }));
  const s1 = fakeSource(answer(WD_SEARCH_GONE));
  const gone = await probeSource(WD, { fetchImpl: s1.fetchImpl });
  assert.equal(gone.state, 'gone'); assert.equal(gone.via, 'ats-api:workday-search');
  assert.equal(s1.seen.length, 2);
  assert.match(s1.seen[0].url, /\/wday\/cxs\/adventisthealthcare\/AdventistHealthCareCareers\/job\/Registered-Nurse--RN---Day-Shift--Med-Surg-Oncology_R-040536-1$/);
  assert.equal(s1.seen[1].url, 'https://adventisthealthcare.wd1.myworkdayjobs.com/wday/cxs/adventisthealthcare/AdventistHealthCareCareers/jobs');
  assert.deepEqual(JSON.parse(s1.seen[1].init.body), { appliedFacets: {}, limit: 5, offset: 0, searchText: 'R-040536' });
  _resetLiveness();
  const listed = await probeSource(WD, { fetchImpl: fakeSource(answer(WD_SEARCH_LISTED)).fetchImpl });
  assert.equal(listed.state, 'unknown');
  _resetLiveness();
  const walled = await probeSource(WD, { fetchImpl: fakeSource((u, init) => (init?.method === 'POST' ? res(403) : res(403))).fetchImpl });
  assert.equal(walled.state, 'unknown');
});

test('page text for the closed check drops script/style blocks however their end tag is written, and every tag', async () => {
  const { visibleText, logSafe } = await import('./listingLiveness.js');
  assert.equal(visibleText('<p>Welder</p><script >var t="job not found"</script ><style media="x">p{}</style\n>').trim(), 'Welder');
  assert.equal(visibleText('<scr<script>x</script>ipt>alert(1)</script>').includes('<'), false);
  assert.equal(pageSaysClosed('<p>Welder wanted</p><SCRIPT type="x">"job not found"</SCRIPT  >'), false);
  assert.equal(logSafe('a\nb\rc ' + 'x'.repeat(200)).length, 120);
  assert.equal(/\n|\r/.test(logSafe('a\nb\r')), false);
});

test('"until the position is filled" is a live posting\'s sentence, not a closed page; a real closed line still counts', () => {
  assert.equal(pageSaysClosed('<p>Applications are accepted until the position is filled.</p>'), false);
  assert.equal(pageSaysClosed('<p>We review applications until the position is filled. This job is no longer available.</p>'), true);
});
