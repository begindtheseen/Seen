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

// round 6 (director): the Studio tailor screen receives the SAME statements as the free check — same status, the verdict's
// evidence [{ line, why }] array (never one string), and the same `candidate` ({ line, why }) — and so does the paid result.
test('free == paid == Studio: each statement\'s status, evidence lines and candidate agree', async () => {
  const shape = (sts) => new Map((sts || []).map((s) => [s.id, { status: s.status, evidence: (Array.isArray(s.evidence) ? s.evidence : []).map((e) => e.line), candidate: s.candidate ? s.candidate.line || null : null }]));
  let compared = 0;
  for (let i = 0; i < 7; i++) {
    // round 9: the last pair carries a claim and a settled row through all three tools
    const gold = i === 6;
    const resume = gold ? readFileSync(new URL('../lib/fixtures/crosstool/gold-shift-lead/resume-shift-supervisor.txt', import.meta.url), 'utf8') : PERSONAS[i % PERSONAS.length];
    const j = gold ? { title: 'Shift Lead', company: 'Copper Kettle Kitchen', description: readFileSync(new URL('../lib/fixtures/crosstool/gold-shift-lead/posting-shift-lead.txt', import.meta.url), 'utf8') } : POSTINGS[i];
    const confirmed = gold ? [{ statementId: 's9', answer: 'yes', claim: true }, { statementId: 's5', answer: 'no', claim: true }] : undefined;
    const free = await call(optimizerHandler, { action: 'optimize', resumeText: resume, jobTitle: j.title, company: j.company, jobDescription: j.description, ...(confirmed ? { confirmed } : {}) });
    if (free.code !== 200 || !Array.isArray(free.body.statements) || !free.body.statements.length) continue;
    const paid = await call(resumeHandler, { tool: 'optimize', resume, job: j.title, company: j.company, jobDescription: j.description, jobId: `agree-${i}`, fresh: true, ...(confirmed ? { confirmed } : {}) }, '44444444-4444-4444-8444-444444444444');
    const s = await call(resumeHandler, { action: 'structure', text: resume });
    const studio = await call(resumeHandler, { action: 'tailor', doc: s.body.doc, jobTitle: j.title, company: j.company, jobDescription: j.description, ...(confirmed ? { confirmed } : {}) }, '44444444-4444-4444-8444-444444444444');
    if (gold) {
      for (const [name, b] of [['free', free.body], ['paid', paid.body], ['studio', studio.body]]) {
        const s9 = (b.statements || []).find((x) => x.id === 's9'), s5 = (b.statements || []).find((x) => x.id === 's5');
        assert.ok(s9 && s9.status === 'shown' && s9.by === 'you', `${name}: claim s9 ${JSON.stringify(s9)}`);
        assert.ok(!(s9.evidence || []).some((e) => e && e.line), `${name}: a claim carries no résumé line`);
        assert.ok(s5 && s5.status === 'partly', `${name}: settled s5`);
      }
      assert.ok(paid.body.questions.some((q) => q.kind === 'claim' && q.statementId === 's9'), 'paid asks about the claim');
      assert.ok(!paid.body.questions.some((q) => q.statementId === 's5'), 'paid re-asks a settled row');
    }
    const f = shape(free.body.statements.filter((x) => x.display !== false && x.kind !== 'promise'));
    for (const [name, got] of [['paid', paid.body.statements], ['studio', studio.body && studio.body.statements]]) {
      assert.ok(Array.isArray(got), `${j.title}: ${name} sent no statements`);
      for (const x of got) assert.ok(Array.isArray(x.evidence), `${j.title}: ${name} evidence is an array`);
      assert.deepEqual(shape(got), f, `${j.title}: ${name} statements differ from the free check`);
    }
    // round 7: the same package parts reach every screen — the fit read and what is already right (free, paid, Studio);
    // the tailoring parts (blocked, field match, charge) on both tailoring screens
    const READ_PARTS = ['fit_score', 'fit_band', 'verdict', 'statements', 'matched_requirements', 'unsupported_requirements', 'constraints', 'hard_gates', 'already_right', 'questions_note'];
    const TAILOR_PARTS = ['blocked', 'field_match', 'charge'];
    const has = (b, keys) => keys.filter((k) => b && Object.prototype.hasOwnProperty.call(b, k));
    assert.deepEqual(has(free.body, READ_PARTS), READ_PARTS, `${j.title}: free parts`);
    assert.deepEqual(has(paid.body, [...READ_PARTS, ...TAILOR_PARTS]), [...READ_PARTS, ...TAILOR_PARTS], `${j.title}: paid parts`);
    assert.deepEqual(has(studio.body, [...READ_PARTS, ...TAILOR_PARTS]), [...READ_PARTS, ...TAILOR_PARTS], `${j.title}: Studio parts`);
    // and the same reading of what is already right where none of them is blocked
    const counts = [free.body.already_right, paid.body.already_right, studio.body.already_right].map((x) => (x ? x.count : null));
    if (!paid.body.blocked && !studio.body.blocked && counts.every((c) => c != null)) assert.equal(new Set(counts).size, 1, `${j.title}: already right ${counts.join(' / ')}`);
    compared++;
  }
  assert.ok(compared >= 5, `compared ${compared}`);
});

// the honest different-field line reaches every screen from the one source (free check, probe, paid, Studio)
test('a different-field posting: free, probe, paid and Studio all carry the same questions_note', async () => {
  const { loadPairs } = await import('../lib/fixtures/calibration/load.mjs');
  const { DIFFERENT_FIELD_NOTE } = await import('../lib/server/optimizePackage.js');
  const p = loadPairs().find((x) => x.label === 'different field');
  const j = p.job;
  const uid = '44444444-4444-4444-8444-444444444444';
  const free = await call(optimizerHandler, { action: 'optimize', resumeText: p.resume, jobTitle: j.title, company: j.company, jobDescription: j.description });
  const probe = await call(resumeHandler, { tool: 'optimize', probe: true, resume: p.resume, job: j.title, company: j.company, jobDescription: j.description, jobId: 'df-probe', fresh: true }, uid);
  const paid = await call(resumeHandler, { tool: 'optimize', resume: p.resume, job: j.title, company: j.company, jobDescription: j.description, jobId: 'df-paid', fresh: true }, uid);
  const s = await call(resumeHandler, { action: 'structure', text: p.resume });
  const studio = await call(resumeHandler, { action: 'tailor', doc: s.body.doc, jobTitle: j.title, company: j.company, jobDescription: j.description }, uid);
  for (const [name, b] of [['free', free.body], ['probe', probe.body], ['paid', paid.body], ['studio', studio.body]]) {
    assert.ok(b && Object.prototype.hasOwnProperty.call(b, 'questions_note'), `${name}: no questions_note key`);
    assert.equal(b.questions_note, DIFFERENT_FIELD_NOTE, `${name}: ${b.questions_note}`);
  }
});
