// Contract tests for the paid optimizer (api/resume.js tool:optimize) and the free diagnosis
// (api/optimizer.js action:optimize) — the 2026-10-24 audits' money defects:
//   D2  a ≤520-char preview posting is 422 preview_only and NEVER charged;
//   C2  the result is cached per (user, job, posting, résumé) for 7 days and a reopen is free;
//   C3  the free response carries none of the paid fields; the paid one is a strict superset;
//   E6  a probe never charges.
// A fake PostgREST (optimizer_runs + feature_flags + rpc/consume_credit) records every charge.
// Run: node --test api/resume.optimize.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_JWT_SECRET = 'test-secret';
delete process.env.SEENFIT_ENGINE_ENABLED;

const FX = JSON.parse(readFileSync(new URL('../lib/optimizer/fixtures/expert-postings.json', import.meta.url), 'utf8'));
const RESUME = FX.resume;
const A = FX.postings.A;
const WALMART = FX.postings.walmart;

const state = { runs: [], charges: 0, balance: 5 };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname !== 'db.example') return json({ error: 'unexpected host' }, 500);
  if (u.pathname === '/rest/v1/feature_flags') return json([{ status: 'fully_on' }]);
  // one graded company for the one-score test (a low process grade moves the fit score)
  if (u.pathname === '/rest/v1/company_scores') return json(/gradedco/i.test(u.search) ? [{ overall_score: 20, report_count: 40, first_party_report_count: 40, web_report_count: 0, data_source: 'reports' }] : []);
  if (u.pathname === '/rest/v1/rpc/consume_credit') {
    // a Pro account is never charged (consume_credit answers 999 and pro:true)
    if (state.pro) return json([{ status: 'ok', balance: 999, pro: true }]);
    state.charges += 1; state.balance -= 1; return json([{ status: 'ok', balance: state.balance, pro: false }]);
  }
  if (u.pathname === '/rest/v1/optimizer_runs') {
    if ((opts.method || 'GET') === 'POST') { const row = JSON.parse(opts.body); state.runs.push({ ...row, created_at: new Date().toISOString() }); return new Response(null, { status: 201 }); }
    const uid = (u.searchParams.get('user_id') || '').replace(/^eq\./, '');
    const jobId = (u.searchParams.get('job_id') || '').replace(/^eq\./, '');
    return json(state.runs.filter((r) => r.user_id === uid && r.job_id === jobId).slice(-1));
  }
  return json([]);
};
const { default: resumeHandler } = await import('./resume.js');
const { default: optimizerHandler } = await import('./optimizer.js');
const { PAID_FIELDS } = await import('../lib/server/optimizePackage.js');
const { parseResume } = await import('../lib/resume/parse/index.js');
const DOC = () => parseResume({ text: RESUME, source: 'text' });

function token(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  const s = createHmac('sha256', 'test-secret').update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function mockRes() {
  return { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
}
let ip = 20;
const call = async (handler, body, uid) => {
  const res = mockRes();
  // a fresh client address per call keeps the in-memory rate limiter out of the way
  await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io', ...(uid ? { authorization: `Bearer ${token(uid)}` } : {}) }, socket: { remoteAddress: `10.0.1.${ip++}` }, body, query: {} }, res);
  return res;
};
const optimize = (extra, uid = '11111111-1111-4111-8111-111111111111') => call(resumeHandler, { tool: 'optimize', job: A.title, company: A.company, resume: RESUME, jobDescription: A.jd, jobId: 'job-a', ...extra }, uid);

test('D2: a preview-only posting is 422 preview_only and charges nothing', async () => {
  const before = state.charges;
  const r = await optimize({ jobDescription: WALMART.jd, jobSource: 'adzuna', jobId: 'job-w' });
  assert.equal(r.code, 422, JSON.stringify(r.body));
  assert.equal(r.body.error, 'preview_only');
  assert.equal(r.body.message, 'This listing only has a summary. Paste the full posting to optimize for it.');
  assert.equal(state.charges, before);
  // the same teaser without a source is still a preview (≤520 chars ending in an ellipsis)
  assert.equal((await optimize({ jobDescription: WALMART.jd, jobId: 'job-w' })).code, 422);
  // the full posting pasted for the same Adzuna listing is optimized
  const pasted = await optimize({ jobDescription: A.jd, jobSource: 'adzuna', postingPasted: true, jobId: 'job-w' });
  assert.equal(pasted.code, 200, JSON.stringify(pasted.body));
  assert.equal(state.charges, before + 1);
});

test('E6: a probe never charges; C2: the first run charges once and every reopen is free', async () => {
  const uid = '22222222-2222-4222-8222-222222222222';
  const before = state.charges;
  const probe = await optimize({ probe: true }, uid);
  assert.equal(probe.code, 200);
  assert.deepEqual([probe.body.cached, probe.body.charged, probe.body.price], [false, false, 1]);
  assert.equal(state.charges, before);

  const first = await optimize({}, uid);
  assert.equal(first.code, 200, JSON.stringify(first.body));
  assert.equal(first.body.charged, true);
  assert.equal(first.body.cached, false);
  assert.equal(state.charges, before + 1);

  const again = await optimize({}, uid);
  assert.equal(again.body.cached, true);
  assert.equal(again.body.charged, false);
  assert.equal(state.charges, before + 1, 'reopening the same job with the same résumé is free');
  assert.equal(again.body.verdict.sentence, first.body.verdict.sentence);
  const probeAfter = await optimize({ probe: true }, uid);
  assert.equal(probeAfter.body.cached, true);

  // a changed résumé is a new input — it costs a credit
  const changed = await optimize({ resume: RESUME + '\n• Balanced a cash drawer every shift for 20 months' }, uid);
  assert.equal(changed.body.charged, true);
  assert.equal(state.charges, before + 2);
  // another user never sees this user's cached result
  const other = await optimize({ probe: true }, '33333333-3333-4333-8333-333333333333');
  assert.equal(other.body.cached, false);
});

test('a corrupted résumé or a signed-out caller is refused before any credit is spent', async () => {
  const before = state.charges;
  assert.equal((await optimize({ resume: '%%%% ÿÿÿÿ ### ' .repeat(10) })).code, 400);
  assert.equal((await optimize({}, null)).code, 401);
  assert.equal(state.charges, before);
});

test('C3: the free diagnosis has none of the paid fields; the paid package is a strict superset', async () => {
  const free = await call(optimizerHandler, { action: 'optimize', resumeText: RESUME, jobTitle: A.title, company: A.company, jobDescription: A.jd });
  assert.equal(free.code, 200, JSON.stringify(free.body).slice(0, 300));
  for (const f of PAID_FIELDS) assert.ok(!(f in free.body), `free response carries paid field "${f}"`);
  assert.equal(free.body.tier, 'free');
  // free = the verdict (score, band, sentence, gate) + matched / missing + constraints
  for (const f of ['verdict', 'fit_score', 'fit_band', 'matched_requirements', 'unsupported_requirements', 'constraints', 'hard_gates']) assert.ok(f in free.body, `free response lacks ${f}`);

  const paid = await optimize({}, '44444444-4444-4444-8444-444444444444');
  assert.equal(paid.body.tier, 'paid');
  for (const f of ['verdict', 'fit_score', 'matched_requirements', 'unsupported_requirements', 'constraints', 'hard_gates']) assert.ok(f in paid.body, `paid response lacks the free field ${f}`);
  assert.equal(paid.body.verdict.sentence, free.body.verdict.sentence, 'one verdict on both surfaces');
  for (const f of ['rewrite_plan', 'reorder', 'questions', 'availability', 'summary', 'optimized_bullets', 'application_message']) assert.ok(f in paid.body, `paid response lacks ${f}`);
  // the availability line is built from the posting's schedule and must be confirmed
  assert.match(paid.body.availability.text, /^Available: .*weekends/);
  assert.equal(paid.body.availability.needs_confirmation, true);
  // every rewrite proposal is grounded and off by default
  for (const r of paid.body.rewrite_plan) assert.equal(r.accepted, false);
});

test('D2: the free path answers a preview the same way (one paste box for both)', async () => {
  const r = await call(optimizerHandler, { action: 'optimize', resumeText: RESUME, jobTitle: WALMART.title, jobDescription: WALMART.jd });
  assert.equal(r.code, 422);
  assert.equal(r.body.error, 'preview_only');
});

// Willingness-to-pay test 2026-10-25: the modal said "No score: this listing does not state its
// requirements" and then spent a credit on the optimize. A posting with nothing to measure is now
// refused free — probe or not — before gateAI.
const NO_REQS_JD = `Join the Northwind family! Northwind has proudly served our community for over forty years, and we believe great people make a great company. Our team members enjoy a welcoming culture, a beautiful campus, and leaders who care. We celebrate wins together, give back through volunteer days, and host seasonal events for families. Northwind is an equal opportunity employer and values a diverse workplace. We look forward to meeting you and hearing your story. Apply today to start your journey with one of the region's best places to work. Benefits include medical, dental, vision, paid time off, and an employee discount program.`;
test('a listing that states no requirements is never charged: probe and press both answer no_requirements', async () => {
  const uid = '55555555-5555-4555-8555-555555555555';
  const before = state.charges;
  const body = { jobDescription: NO_REQS_JD, job: 'Team Member', company: 'Northwind', jobId: 'job-noreq' };
  const probe = await optimize({ ...body, probe: true }, uid);
  assert.equal(probe.code, 422, JSON.stringify(probe.body).slice(0, 300));
  assert.equal(probe.body.error, 'no_requirements');
  assert.equal(probe.body.requirement_count, 0);
  assert.equal(probe.body.message, "This listing doesn't list its requirements, so there's nothing to optimize against — no credit used.");
  assert.equal(probe.body.charged, false);
  const press = await optimize(body, uid);
  assert.equal(press.code, 422);
  assert.equal(press.body.error, 'no_requirements');
  assert.equal(state.charges, before, 'no credit consumed');
  // the free diagnosis agrees: no score for the same posting
  const free = await call(optimizerHandler, { action: 'optimize', resumeText: RESUME, jobTitle: 'Team Member', company: 'Northwind', jobDescription: NO_REQS_JD });
  assert.equal(free.body.fit_score, null);
  assert.match(free.body.verdict.sentence, /^No score: this listing does not state its requirements/);
});

// ── 2026-10-25 writing-tools fixes ─────────────────────────────────────────────────────────────
test('stale cache: a result stored under an older engine key is never served; fresh:true re-runs', async () => {
  const uid = '66666666-6666-4666-8666-666666666666';
  const { createHash } = await import('node:crypto');
  const { textHash, CACHE_PREFIX, CACHE_VERSION } = await import('../lib/server/optimizeCache.js');
  assert.match(CACHE_VERSION, /resume_parser_v\d+/);
  assert.match(CACHE_VERSION, /optimizer_v\d+/);
  // the key the pre-fix build wrote (no versions in it), holding Tasha's old summary
  const oldKey = CACHE_PREFIX + createHash('sha256').update([uid, 'job-a', textHash(A.jd), textHash(RESUME)].join('|')).digest('hex').slice(0, 48);
  state.runs.push({ user_id: uid, job_id: oldKey, output: { summary: { text: 'including (1,800 subscribers).' } }, created_at: new Date().toISOString() });
  const first = await optimize({}, uid);
  assert.equal(first.body.cached, false, 'the old row is not served');
  assert.ok(!/1,800 subscribers\)\./.test(JSON.stringify(first.body)));
  const reopen = await optimize({}, uid);
  assert.equal(reopen.body.cached, true);
  const before = state.charges;
  const rerun = await optimize({ fresh: true }, uid);
  assert.equal(rerun.body.cached, false, 'Re-run builds a new package');
  assert.equal(state.charges, before + 1, 'a re-run for a free user is a new credit');
});

test('Pro: charged is false and the response says pro — the UI never prints "1 credit used"', async () => {
  state.pro = true;
  try {
    const before = state.charges;
    const r = await optimize({}, '77777777-7777-4777-8777-777777777777');
    assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
    assert.equal(r.body.charged, false);
    assert.equal(r.body.pro, true);
    assert.equal(state.charges, before);
    const t = await call(resumeHandler, { action: 'tailor', doc: DOC(), jobTitle: A.title, company: A.company, jobDescription: A.jd }, '77777777-7777-4777-8777-777777777777');
    assert.equal(t.code, 200, JSON.stringify(t.body).slice(0, 200));
    assert.equal(t.body.charged, false);
    assert.equal(t.body.pro, true);
  } finally { state.pro = false; }
});

test('tailor and scanner refuse a no-requirements posting free, before the credit gate', async () => {
  const uid = '88888888-8888-4888-8888-888888888888';
  const before = state.charges;
  const t = await call(resumeHandler, { action: 'tailor', doc: DOC(), jobTitle: 'Team Member', company: 'Northwind', jobDescription: NO_REQS_JD }, uid);
  assert.equal(t.code, 422, JSON.stringify(t.body).slice(0, 200));
  assert.equal(t.body.error, 'no_requirements');
  assert.equal(t.body.charged, false);
  const sc = await call(resumeHandler, { tool: 'scanner', resume: RESUME, job: 'Team Member', company: 'Northwind', jobDescription: NO_REQS_JD }, uid);
  assert.equal(sc.code, 422, JSON.stringify(sc.body).slice(0, 200));
  assert.equal(sc.body.error, 'no_requirements');
  assert.equal(state.charges, before, 'nothing charged');
});

test('one score: the free check, the paid package and the Studio tailor print the same number (graded company, remote posting)', async () => {
  const uid = '99999999-9999-4999-8999-999999999999';
  const jd = A.jd + '\nThis role is remote-friendly.';
  // the client's own remote guess and location are not what the score uses
  const free = await call(optimizerHandler, { action: 'optimize', resumeText: RESUME, jobTitle: A.title, company: 'GradedCo', jobDescription: jd, remoteOk: false, jobLocation: 'Phoenix, AZ', desiredLocation: 'Boston, MA' }, uid);
  assert.equal(free.code, 200, JSON.stringify(free.body).slice(0, 200));
  const paid = await call(resumeHandler, { tool: 'optimize', job: A.title, company: 'GradedCo', resume: RESUME, jobDescription: jd, jobId: 'job-one-score' }, uid);
  assert.equal(paid.code, 200, JSON.stringify(paid.body).slice(0, 200));
  const studio = await call(resumeHandler, { action: 'tailor', doc: DOC(), jobTitle: A.title, company: 'GradedCo', jobDescription: jd }, uid);
  assert.equal(studio.code, 200, JSON.stringify(studio.body).slice(0, 200));
  assert.ok(typeof free.body.fit_score === 'number');
  assert.equal(paid.body.fit_score, free.body.fit_score, 'paid = free');
  assert.equal(paid.body.verdict.score, free.body.fit_score);
  assert.equal(studio.body.plan.score.before, free.body.fit_score, 'Studio = free');
});

// The strategy plan and the scanner read the posting's requirements: a posting that states none
// is refused BEFORE the credit gate (it charged a credit for a plan about "pay and charlotte").
test('advantage / scanner on a posting with no requirements: 422 no_requirements, never charged', async () => {
  const CAR_WASH = 'Join the Sunbelt Express Car Wash family! We are a locally owned express car wash with 6 locations around Charlotte, and we are growing. Weekly pay, free unlimited wash membership, paid training and a fun, friendly team. Starting pay is $14 – $16 per hour. Apply today!';
  for (const tool of ['advantage', 'coach', 'proposal', 'scanner']) {
    const before = state.charges;
    const r = await call(resumeHandler, { tool, job: 'Team Member', company: 'Sunbelt Express', resume: RESUME, jobDescription: CAR_WASH }, '33333333-3333-4333-8333-333333333333');
    assert.equal(r.code, 422, `${tool}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'no_requirements');
    assert.equal(r.body.charged, false);
    assert.equal(state.charges, before, `${tool} charged a credit`);
  }
  // a real posting still runs (and is charged as before)
  const before = state.charges;
  const ok = await call(resumeHandler, { tool: 'advantage', job: A.title, company: A.company, resume: RESUME, jobDescription: A.jd }, '33333333-3333-4333-8333-333333333333');
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(state.charges, before + 1);
});
