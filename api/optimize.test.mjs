// Contract tests for /api/optimize with a fake PostgREST. No model API (owner decision 2026-10-26):
// any call to a model host fails the test. Diagnose is free and cached; rewrite needs a diagnosis,
// charges once, reopens free, and turns the person's answers into checked lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_JWT_SECRET = 'test-secret';

const FX = JSON.parse(readFileSync(new URL('../scripts/eval/fixtures/01-retail-manager.json', import.meta.url), 'utf8'));
const RESUME = FX.resume.join('\n');
const JD = Array.isArray(FX.job.description) ? FX.job.description.join('\n') : FX.job.description;
const NO_REQS = 'Join our family! We are a locally owned car wash with 6 locations and we are growing. Weekly pay, free wash membership, paid training and a fun team. Starting pay is $14 – $16 per hour. Apply today and start this week at any of our locations around town.';

const state = { runs: [], charges: 0, modelCalls: [] };
const bullet = (re) => RESUME.split('\n').map((l) => l.replace(/^[•\s]+/, '').trim()).find((l) => re.test(l));
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname === 'api.anthropic.com' || u.hostname === 'api.openai.com') { state.modelCalls.push(String(url)); return json({ error: 'no model API' }, 500); }
  if (u.hostname !== 'db.example') return json({ error: 'unexpected host' }, 500);
  if (u.pathname === '/rest/v1/feature_flags') return json([{ status: 'fully_on' }]);
  if (u.pathname === '/rest/v1/rpc/consume_credit') { state.charges += 1; return json([{ status: 'ok', balance: 4, pro: false }]); }
  if (u.pathname === '/rest/v1/optimizer_runs') {
    if ((opts.method || 'GET') === 'POST') { state.runs.push({ ...JSON.parse(opts.body), created_at: new Date().toISOString() }); return new Response(null, { status: 201 }); }
    const uid = (u.searchParams.get('user_id') || '').replace(/^eq\./, '');
    const jobId = (u.searchParams.get('job_id') || '').replace(/^eq\./, '');
    return json(state.runs.filter((r) => r.user_id === uid && r.job_id === jobId).slice(-1));
  }
  return json([]);
};
const { default: handler } = await import('./optimize.js');

function token(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', 'test-secret').update(`${h}.${p}`).digest('base64url')}`;
}
const mockRes = () => ({ code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end(b) { this.body = b; return this; } });
async function call(body, uid = '11111111-1111-4111-8111-111111111111') {
  const res = mockRes();
  await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io', authorization: `Bearer ${token(uid)}` }, socket: { remoteAddress: `10.0.0.${Math.floor(Math.random() * 250)}` }, body }, res);
  return res;
}
const base = { resume: RESUME, job: FX.job.title, company: FX.job.company, jobDescription: JD };

test('diagnose: free, no model, the step-up and requirement questions, cached', async () => {
  const r = await call({ action: 'diagnose', ...base });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  assert.equal(state.charges, 0);
  const asks = r.body.diagnosis.questions.map((q) => q.ask);
  assert.ok(asks.some((q) => /Store Manager job yourself/.test(q)), JSON.stringify(asks));
  assert.ok(asks.some((q) => /P&L/.test(q)));
  assert.ok(r.body.diagnosis.bullets.length > 5, 'every bullet is on the plan');
  assert.equal(r.body.diagnosis.model, false);
  const again = await call({ action: 'diagnose', ...base });
  assert.equal(again.body.cached, true);
  assert.equal(state.modelCalls.length, 0, 'no model API');
});

test('rewrite: needs a diagnosis; charges once; answers become checked lines; reopen is free; no model', async () => {
  const fresh = await call({ action: 'rewrite', ...base }, '22222222-2222-4222-8222-222222222222');
  assert.equal(fresh.code, 409);
  assert.equal(fresh.body.error, 'diagnose_first');
  const d = await call({ action: 'diagnose', ...base });
  const qs = d.body.diagnosis.questions;
  const step = qs.find((q) => /Store Manager job yourself/.test(q.ask));
  const pl = qs.find((q) => /P&L/.test(q.ask));
  const answers = [{ id: step.id, answer: "Yes, regularly. I run the store on the Store Manager's 2 days off every week" }, { id: pl.id, answer: 'No, never owned it' }];
  const before = state.charges;
  const r = await call({ action: 'rewrite', ...base, answers });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 400));
  assert.equal(state.charges, before + 1);
  assert.equal(r.body.charged, true);
  const texts = r.body.proposals.map((p) => p.after);
  assert.ok(texts.includes("Run the store on the Store Manager's 2 days off every week"), JSON.stringify(texts));
  assert.ok(!texts.some((t) => /P&L/.test(t)), 'a "no" never becomes a line');
  // the summary names the field and its years, credits no result to the wrong employer, and replaces
  // the résumé's own summary instead of sitting beside it
  assert.ok(r.body.summary && /^Assistant Store Manager with about 12½ years in retail; bilingual \(Spanish\)\. Cut shrink/.test(r.body.summary.text), JSON.stringify(r.body.summary));
  assert.match(r.body.summary.replaces, /^Retail leader with 9 years/);
  assert.ok(r.body.gaps.find((g) => /p&l/i.test(g.label)).advice.match(/said you have not/), 'gap advice follows the "no"');
  const reopen = await call({ action: 'rewrite', ...base, answers });
  assert.equal(reopen.body.cached, true);
  assert.equal(state.charges, before + 1, 'a reopen is free');
  assert.equal(state.modelCalls.length, 0, 'no model API');
});

test('a posting that states no requirements is refused free, before any model call', async () => {
  const calls = state.modelCalls.length;
  const r = await call({ action: 'diagnose', ...base, jobDescription: NO_REQS });
  assert.equal(r.code, 422);
  assert.equal(r.body.error, 'no_requirements');
  assert.equal(state.modelCalls.length, calls);
});

test('a posting keeps its lines, so its requirement sections are read (customer-service posting)', async () => {
  const cs = JSON.parse(readFileSync(new URL('../scripts/eval/fixtures/04-customer-service.json', import.meta.url), 'utf8'));
  const r = await call({ action: 'diagnose', resume: cs.resume.join('\n'), job: cs.job.title, company: cs.job.company, jobDescription: cs.job.description.join('\n') });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
});

test('decide records accepted and rejected ids only', async () => {
  const d = await call({ action: 'diagnose', ...base });
  const r = await call({ action: 'decide', key: d.body.key, accepted: ['J1.2', '<script>'], rejected: ['J1.3'] });
  assert.equal(r.code, 200);
  const row = state.runs.find((x) => x.job_id === `${d.body.key}:decision`);
  assert.deepEqual(row.output.accepted, ['J1.2']);
});
