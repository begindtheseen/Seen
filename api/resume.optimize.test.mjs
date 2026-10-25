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
  if (u.pathname === '/rest/v1/rpc/consume_credit') { state.charges += 1; state.balance -= 1; return json([{ status: 'ok', balance: state.balance, pro: false }]); }
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
