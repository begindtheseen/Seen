// Contract tests for /api/optimize (optimizer v3) with a fake PostgREST and a stubbed model:
// diagnose is free and cached; rewrite needs a diagnosis, charges once, reopens free, and only
// ships lines that pass Seen's gates (an invented number and a word swap are dropped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_KEY = 'k';
process.env.ANTHROPIC_QUALITY_MODEL = 'quality-model-x';
delete process.env.LLM_API_KEY;

const FX = JSON.parse(readFileSync(new URL('../scripts/eval/fixtures/01-retail-manager.json', import.meta.url), 'utf8'));
const RESUME = FX.resume.join('\n');
const JD = Array.isArray(FX.job.description) ? FX.job.description.join('\n') : FX.job.description;
const NO_REQS = 'Join our family! We are a locally owned car wash with 6 locations and we are growing. Weekly pay, free wash membership, paid training and a fun team. Starting pay is $14 – $16 per hour. Apply today and start this week at any of our locations around town.';

const state = { runs: [], charges: 0, modelCalls: [] };
const bullet = (re) => RESUME.split('\n').map((l) => l.replace(/^[•\s]+/, '').trim()).find((l) => re.test(l));
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname === 'api.anthropic.com') {
    const body = JSON.parse(opts.body);
    state.modelCalls.push(body);
    const prompt = body.messages[0].content;
    let out;
    if (/diagnose a résumé/.test(body.system)) {
      out = { target: 'Assistant store manager', bullets: [{ id: 'J1.1', level: 2, action: 'rewrite', why: 'scope' }], requirements: [{ label: 'sales', evidence: ['J1.3'], strength: 'strong' }], questions: [{ bullet: 'J1.1', ask: 'About how many hours of payroll did you schedule each week?', why: 'payroll is in the posting', kind: 'scope' }], gaps: [{ label: 'p&l', advice: 'Say in the cover letter which parts of the P&L you have owned.' }] };
    } else if (/best human résumé writer/.test(body.system)) {
      const ids = [...prompt.matchAll(/^\s*(J\d+\.\d+) \[[^\]]*\]: (.+)$/gm)].map((m) => [m[1], m[2]]);
      const shrinkId = ids.find(([, t]) => /shrink/i.test(t))[0];
      const salesId = ids.find(([, t]) => /store sales/i.test(t))[0];
      out = { rewrites: [
        { id: shrinkId, text: 'Tightened the fitting-room and back-door process, cutting shrink from 2.4% to 1.1% in 12 months', uses: [shrinkId], why: 'the process the posting asks about leads' },
        { id: shrinkId, text: 'Cut shrink from 2.4% to 1.1% within 12 months by tightening the fitting-room and back-door process', uses: [shrinkId], why: 'a one-word swap' },
        { id: shrinkId, text: 'Cut shrink from 2.4% to 1.1% in 12 months by tightening the fitting-room and back-door process; trained the team on the new process', uses: [shrinkId], why: 'borrows a fact from another line' },
        { id: salesId, text: 'Grew store sales 9% year over year in 2023 on $4.2M annual volume, ranking 1st of 40 stores', uses: [salesId], why: 'invented rank' },
      ], summary: { text: 'Assistant Store Manager at Desert Sun Apparel who cut shrink from 2.4% to 1.1% and grew store sales 9% in 2023.', uses: [] }, skills: [{ skill: 'Kronos' }, { skill: 'Shrink control' }, { skill: 'Workday' }] };
    } else if (/fix résumé lines that Seen/.test(body.system)) {
      state.repairs = (state.repairs || 0) + 1;
      const ids = [...prompt.matchAll(/^- (J\d+\.\d+) — original: "([^"]+)"/gm)].map((m) => [m[1], m[2]]);
      const sales = ids.find(([, t]) => /store sales/i.test(t));
      out = { rewrites: sales ? [{ id: sales[0], text: 'Grew store sales 9% year over year in 2023 on $4.2M annual volume across apparel, shoes and home', uses: [sales[0], ids.length ? sales[0] : sales[0]], why: 'the departments it covered' }] : [] };
    } else {
      out = { rewrites: [], summary: null };
    }
    return json({ content: [{ type: 'text', text: JSON.stringify(out) }] });
  }
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

test('diagnose: free, questions from the plan, protected questions never asked, cached', async () => {
  const r = await call({ action: 'diagnose', ...base });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  assert.equal(state.charges, 0);
  assert.ok(r.body.diagnosis.questions.some((q) => /payroll/.test(q.ask)), 'the model\'s question is kept');
  assert.ok(r.body.diagnosis.questions.length <= 6);
  assert.ok(r.body.diagnosis.bullets.length > 5, 'every bullet is on the plan');
  assert.ok(state.modelCalls.every((c) => c.model === 'quality-model-x'));
  const again = await call({ action: 'diagnose', ...base });
  assert.equal(again.body.cached, true);
});

test('rewrite: needs a diagnosis; charges once; only lines that pass the gates ship; reopen is free', async () => {
  const fresh = await call({ action: 'rewrite', ...base }, '22222222-2222-4222-8222-222222222222');
  assert.equal(fresh.code, 409);
  assert.equal(fresh.body.error, 'diagnose_first');
  const d = await call({ action: 'diagnose', ...base });
  const qid = d.body.diagnosis.questions[0].id;
  const before = state.charges;
  const r = await call({ action: 'rewrite', ...base, answers: [{ id: qid, answer: 'about 900 hours' }] });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 400));
  assert.equal(state.charges, before + 1);
  assert.equal(r.body.charged, true);
  const texts = r.body.proposals.map((p) => p.after);
  assert.ok(texts.some((t) => /^Tightened the fitting-room and back-door process, cutting shrink/.test(t)), JSON.stringify(r.body.refused));
  assert.ok(!texts.some((t) => /within 12 months/.test(t)), 'a one-word swap never ships');
  assert.ok(!texts.some((t) => /1st of 40/.test(t)), 'an invented rank never ships');
  assert.equal(state.repairs, 1, 'refused lines go back to the writer once');
  assert.ok(r.body.refused.some((x) => /1st of 40/.test(x.text)), 'what was refused is shown with its reason');
  assert.ok(!texts.some((t) => /trained the team/.test(t)), 'a fact borrowed from another bullet never ships');
  assert.equal(r.body.rejected_count >= 1, true);
  assert.ok(r.body.summary && /cut shrink/.test(r.body.summary.text));
  assert.deepEqual(r.body.skills, ['Shrink control'], 'only skills the résumé shows and its skills line does not list yet');
  const reopen = await call({ action: 'rewrite', ...base, answers: [{ id: qid, answer: 'about 900 hours' }] });
  assert.equal(reopen.body.cached, true);
  assert.equal(state.charges, before + 1, 'a reopen is free');
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
