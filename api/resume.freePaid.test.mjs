// ONE score for one pair (T3, 2026-11-10): the free check (api/optimizer.js action:optimize) and the paid package
// (api/resume.js tool:optimize) read the same posting through the same function (readPosting → postingTextForReader),
// canonicalise the résumé once, and print the same fit score, band and requirement count — driven through both REAL
// handlers on 30 persona × posting pairs. (The judges saw free 35 vs paid 52: the free path scored a cached flat
// job_facts reading without gates or statements.)
// Run: node --test api/resume.freePaid.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_JWT_SECRET = 'test-secret';
delete process.env.SEENFIT_ENGINE_ENABLED;

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname !== 'db.example') return json({ error: 'unexpected host' }, 500);
  if (u.pathname === '/rest/v1/feature_flags') return json([{ status: 'fully_on' }]);
  if (u.pathname === '/rest/v1/rpc/consume_credit') return json([{ status: 'ok', balance: 99, pro: false }]);
  if (u.pathname === '/rest/v1/optimizer_runs' && (opts.method || 'GET') === 'POST') return new Response(null, { status: 201 });
  return json([]);
};
const { default: resumeHandler } = await import('./resume.js');
const { default: optimizerHandler } = await import('./optimizer.js');

const P = (f) => readFileSync(new URL(`../lib/fixtures/personas/${f}`, import.meta.url), 'utf8');
const POSTINGS = JSON.parse(readFileSync(new URL('../lib/resume/tailor/fixtures/t3-postings.json', import.meta.url), 'utf8'));
const PERSONAS = [P('maria.txt'), P('warehouse.txt'), P('nurse.txt')];

function token(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  const s = createHmac('sha256', 'test-secret').update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
let ip = 40;
const call = async (handler, body, uid) => {
  const res = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io', ...(uid ? { authorization: `Bearer ${token(uid)}` } : {}) }, socket: { remoteAddress: `10.0.2.${ip++ % 250}` }, body, query: {} }, res);
  return res;
};

test('free == paid: one fit score, one band, one requirement count, on 30 real pairs', async () => {
  let compared = 0;
  for (let i = 0; i < 30; i++) {
    const resume = PERSONAS[i % PERSONAS.length];
    const j = POSTINGS[i];
    const free = await call(optimizerHandler, { action: 'optimize', resumeText: resume, jobTitle: j.title, company: j.company, jobDescription: j.description });
    const paid = await call(resumeHandler, { tool: 'optimize', resume, job: j.title, company: j.company, jobDescription: j.description, jobId: `pair-${i}`, fresh: true }, '44444444-4444-4444-8444-444444444444');
    // a posting too thin to score: the free check says "No score" and the paid path refuses it, free — the same reading
    if (paid.code === 422 && paid.body.error === 'no_requirements') { assert.equal(free.body.fit_score, null, `${j.title}: free scored ${free.body.fit_score}`); assert.equal(paid.body.requirement_count, free.body.requirements_listed, j.title); compared++; continue; }
    assert.equal(free.code, paid.code, `${j.title}: free ${free.code} vs paid ${paid.code} ${JSON.stringify(paid.body).slice(0, 200)}`);
    if (free.code !== 200) continue;
    compared++;
    assert.equal(paid.body.fit_score, free.body.fit_score, `${j.title}: free ${free.body.fit_score} vs paid ${paid.body.fit_score}`);
    assert.equal(paid.body.fit_band, free.body.fit_band, j.title);
    assert.equal(paid.body.requirements_listed, free.body.requirements_listed, j.title);
    assert.equal(paid.body.ats_coverage, free.body.ats_coverage, j.title);
    assert.ok(paid.body.posting && free.body.posting, j.title);
  }
  assert.equal(compared, 30, `compared ${compared}`);
});
