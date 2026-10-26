// The Résumé Studio tailor with a credit: deterministic end to end (owner decision 2026-10-26: no model
// API). The old Pro "polish" flag is ignored — the response carries no polish result, and any call to
// a model host fails the test, even with model keys left in the environment.
// Run: node --test api/resume.tailor.noModel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_KEY = 'must-not-be-used';
process.env.LLM_API_KEY = 'must-not-be-used';

const FX = JSON.parse(readFileSync(new URL('../scripts/eval/fixtures/01-retail-manager.json', import.meta.url), 'utf8'));
const RESUME = FX.resume.join('\n');
const JD = Array.isArray(FX.job.description) ? FX.job.description.join('\n') : FX.job.description;

const MODEL_HOSTS = /(^|\.)(anthropic\.com|openai\.com|groq\.com)$/;
const state = { charges: 0, modelCalls: [], outside: [] };
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (MODEL_HOSTS.test(u.hostname)) { state.modelCalls.push(String(url)); return json({ error: 'no model API' }, 500); }
  if (u.hostname !== 'db.example') { state.outside.push(String(url)); return json({ error: 'unexpected host' }, 500); }
  if (u.pathname === '/rest/v1/feature_flags') return json([{ status: 'fully_on' }]);
  if (u.pathname === '/rest/v1/rpc/consume_credit') { state.charges += 1; return json([{ status: 'ok', balance: 4, pro: false }]); }
  if (u.pathname === '/rest/v1/rpc/increment_rate_limit') return json(1);
  return json([]);
};
const { default: handler } = await import('./resume.js');

function token(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', 'test-secret').update(`${h}.${p}`).digest('base64url')}`;
}
const mockRes = () => ({ code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } });
async function call(body) {
  const res = mockRes();
  await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io', authorization: `Bearer ${token('33333333-3333-4333-8333-333333333333')}` }, socket: { remoteAddress: '10.0.0.77' }, body }, res);
  return res;
}

test('tailor: one credit, a full plan and variant, no polish result, no model host — even when asked to polish', async () => {
  const s = await call({ action: 'structure', text: RESUME });
  assert.equal(s.code, 200, JSON.stringify(s.body).slice(0, 300));
  const r = await call({ action: 'tailor', doc: s.body.doc, jobTitle: FX.job.title, company: FX.job.company, jobDescription: JD, polish: true });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  assert.ok(r.body.plan && r.body.variant && r.body.health);
  assert.ok(Array.isArray(r.body.plan.decisions) && r.body.plan.decisions.length > 0);
  assert.equal('polish' in r.body, false, 'no polish result is ever returned');
  assert.equal(state.charges, 1);
  assert.deepEqual(state.modelCalls, [], 'no model API');
  assert.deepEqual(state.outside, [], 'only Seen\'s own database');
});
