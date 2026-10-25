// Contract tests for /api/interview-prep (fake PostgREST + auth, no model).
//   • record: free, no sign-in, reads scorable reports + listings, returns the $9.99 offer
//   • build: refused for a free user with the interview offer; built for Pro from the résumé (no
//     model configured → the coached pack), cached, and read back from the cache
//   • event: allow-listed names only
// Run: node --test api/interview-prep.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.SUPABASE_JWT_SECRET;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_KEY;

const UID = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';
const RESUME = `Maria Lopez\nPhoenix, AZ\nEXPERIENCE\nTeam Lead, Target — Phoenix, AZ · 2016 – 2026\n• Resolved guest complaints without a manager 95% of the time across 40 shifts a month\n• Raised guest survey scores from 78% to 91% in one year by coaching a team of 12\n• Trained 30 new team members on register, returns and loss prevention\n• Opened and closed the store as key holder on weekends for three years straight\nSKILLS\nCustomer service, scheduling, cash handling, bilingual English/Spanish, inventory counts, merchandising`;

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

function installFetch({ pro = false, cached = null, resume = RESUME } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = opts.method || 'GET';
    calls.push({ path: u.pathname, search: decodeURIComponent(u.search), method, body: opts.body });
    if (u.pathname === '/auth/v1/user') return mockResponse({ id: UID });
    if (u.pathname === '/rest/v1/feature_flags') return mockResponse([{ status: 'on' }]);
    if (u.pathname === '/rest/v1/ai_credits' && method === 'GET') {
      return mockResponse([{ user_id: UID, balance: 3, purchased_credits: 0, daily_earned: 0, last_reset: '2026-10-25', pro: false, pro_until: pro ? new Date(Date.now() + 5 * 86400e3).toISOString() : null }]);
    }
    if (u.pathname === '/rest/v1/reports') {
      return mockResponse([
        { outcome: 'offer', report_text: 'Two interviews then an offer a week later.', rounds: 2, wait_days: 7 },
        { outcome: 'ghosted', report_text: 'Had a phone screen and an on-site interview, then nothing.', rounds: 2 },
        { outcome: 'rejected', report_text: 'Rejected after the final round interview.', rounds: 3 },
        { outcome: 'ghosted', report_text: 'Applied and never heard back.' },
      ]);
    }
    if (u.pathname === '/rest/v1/jobs') return mockResponse([{ title: 'Assistant Store Manager', salary_min: 45000, salary_max: 55000 }, { title: 'Assistant Store Manager', salary_min: 48000, salary_max: 58000 }, { title: 'Store Manager', salary_min: 60000, salary_max: 70000 }]);
    if (u.pathname === '/rest/v1/interview_preps' && method === 'GET') return mockResponse(cached ? [{ pack: cached }] : []);
    if (u.pathname === '/rest/v1/profiles') return mockResponse([{ resume_text: resume, name: 'Maria Lopez' }]);
    return mockResponse(null, { status: 201 });
  };
  return calls;
}

const { default: handler } = await import('./interview-prep.js');
function mockRes() {
  return { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end(b) { this.body = b; return this; } };
}
async function call(body, { auth = true } = {}) {
  const res = mockRes();
  const headers = { origin: 'https://seenjobs.io', ...(auth ? { authorization: 'Bearer tok' } : {}) };
  await handler({ method: 'POST', headers, socket: { remoteAddress: '10.0.0.' + Math.floor(Math.random() * 250) }, body }, res);
  return res;
}

test('record is free, needs no sign-in, and reads only scorable reports', async () => {
  const calls = installFetch();
  const res = await call({ action: 'record', company: 'Ross Stores, Inc.', role: 'Assistant Store Manager' }, { auth: false });
  assert.equal(res.code, 200);
  assert.equal(res.body.record.accounts, 3);
  assert.equal(res.body.record.after.offer, 1);
  assert.equal(res.body.pay.unit, 'year');
  assert.deepEqual(res.body.offer, { sku: 'interview', name: 'Interview Prep', amount_cents: 999, pro_days: 14 });
  const rep = calls.find((c) => c.path === '/rest/v1/reports');
  assert.match(rep.search, /company_name=in\.\("ross stores, inc\.","ross stores"\)/);
  assert.match(rep.search, /trust_reason/, 'the scorable filter is applied');
  assert.ok(!calls.some((c) => c.path === '/auth/v1/user'), 'no sign-in read');
});

test('build refuses a free user and names the $9.99 offer — nothing generated', async () => {
  const calls = installFetch({ pro: false });
  const res = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager' });
  assert.equal(res.code, 402);
  assert.equal(res.body.pro_required, true);
  assert.equal(res.body.offer, 'interview');
  assert.ok(!calls.some((c) => c.path === '/rest/v1/profiles'), 'the résumé is not even read');
});

test('build for Pro uses only résumé lines, adds the record and emails, and caches it', async () => {
  const calls = installFetch({ pro: true });
  const res = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', application_id: 'app_1' });
  assert.equal(res.code, 200);
  const p = res.body.pack;
  assert.ok(p.questions.length >= 5);
  assert.ok(p.answers.length >= 2);
  for (const a of p.answers) assert.ok(RESUME.includes(a.resume_fact), a.resume_fact);
  assert.match(p.emails.thankYou.body, /Ross Stores/);
  assert.match(p.emails.followUp.body, /Maria Lopez$/);
  assert.equal(p.record.accounts, 3);
  const save = calls.find((c) => c.path === '/rest/v1/interview_preps' && c.method === 'POST');
  assert.ok(save, 'cached');
  assert.equal(JSON.parse(save.body).application_id, 'app_1');
  assert.ok(calls.some((c) => c.path === '/rest/v1/funnel_events' && JSON.parse(c.body).event === 'prep_built'));
});

test('build reads the cache before generating', async () => {
  const calls = installFetch({ pro: true, cached: { company: 'Ross Stores', questions: [{ q: 'Cached?' }] } });
  const res = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager' });
  assert.equal(res.code, 200);
  assert.equal(res.body.cached, true);
  assert.ok(!calls.some((c) => c.path === '/rest/v1/profiles'));
});

test('build without a résumé asks for one', async () => {
  installFetch({ pro: true, resume: '' });
  const res = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager' });
  assert.equal(res.code, 409);
  assert.equal(res.body.need_resume, true);
});

test('event accepts only the allow-listed funnel names', async () => {
  const calls = installFetch();
  assert.equal((await call({ action: 'event', event: 'prep_offer_shown', company: 'Ross' }, { auth: false })).code, 200);
  assert.equal((await call({ action: 'event', event: 'drop table' }, { auth: false })).code, 400);
  const ev = calls.filter((c) => c.path === '/rest/v1/funnel_events');
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].body).user_id, null);
});

test('a prep someone has is returned on any device and after Pro ends — before the Pro gate (round 2)', async () => {
  const calls = installFetch({ pro: false, cached: { company: 'Ross Stores', questions: [{ q: 'Cached?' }] } });
  const mine = await call({ action: 'mine', company: 'Ross Stores', role: 'Assistant Store Manager' });
  assert.equal(mine.code, 200);
  assert.equal(mine.body.pack.company, 'Ross Stores');
  const built = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager' });
  assert.equal(built.code, 200, 'no 402 for a pack already owned');
  assert.equal(built.body.cached, true);
  assert.ok(!calls.some((c) => c.path === '/rest/v1/ai_credits'), 'the Pro gate is not even consulted');
});

test('mine without sign-in is an empty answer, never an error', async () => {
  installFetch();
  const r = await call({ action: 'mine', company: 'Ross Stores', role: 'Assistant Store Manager' }, { auth: false });
  assert.equal(r.code, 200);
  assert.equal(r.body.pack, null);
});

test('build reads the card\'s own listing when given its job id, and orders a phone screen\'s staples first', async () => {
  const calls = installFetch({ pro: true });
  const r = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', job_id: 'job_123', stage: 'Phone Screen' });
  assert.equal(r.code, 200);
  assert.ok(calls.some((c) => c.path === '/rest/v1/jobs' && /id=eq\.job_123/.test(c.search)), 'listing read by id');
  const qs = r.body.pack.questions.map((q) => q.q);
  assert.ok(qs.findIndex((q) => /pay expectations/.test(q)) < 7, 'pay question early on a phone screen');
  assert.ok(r.body.pack.intro, 'an intro is always there (résumé-built when no model)');
});

// The paid build: draft → fact-check → guard, both model calls on the quality model.
function installModel(calls, { verifyStatus = 200 } = {}) {
  const base = globalThis.fetch;
  const modelCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (new URL(String(url)).hostname === 'api.anthropic.com') {
      const body = JSON.parse(opts.body);
      modelCalls.push(body);
      const draft = {
        questions: [{ q: 'How do you handle an upset guest?', why: 'They check you stay calm.' }],
        answers: [{ q: 'How do you handle an upset guest?', bullet: 'J1.1', situation: 'At Target guests came to the desk upset.', action: 'I resolved guest complaints without a manager 95% of the time across 40 shifts a month. I always offer a 20% coupon first.', result: 'Most left happy.' }],
        intro: "I'm a team lead at Target.",
      };
      if (modelCalls.length === 1) return mockResponse({ content: [{ type: 'text', text: JSON.stringify(draft) }] });
      if (verifyStatus !== 200) return mockResponse({ error: 'bad' }, { ok: false, status: verifyStatus });
      const checked = { ...draft, answers: [{ ...draft.answers[0], action: 'I resolved guest complaints without a manager 95% of the time across 40 shifts a month.', result: '[How did the guest leave?]' }] };
      return mockResponse({ content: [{ type: 'text', text: JSON.stringify(checked) }] });
    }
    return base(url, opts);
  };
  return modelCalls;
}

test('build: draft then fact-check on the quality model; an invented practice never reaches the pack', async () => {
  process.env.ANTHROPIC_KEY = 'k'; process.env.ANTHROPIC_QUALITY_MODEL = 'quality-model-x';
  try {
    const calls = installFetch({ pro: true });
    const modelCalls = installModel(calls);
    const res = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', refresh: true });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(modelCalls.length, 2);
    assert.ok(modelCalls.every((c) => c.model === 'quality-model-x'));
    assert.match(modelCalls[1].messages[0].content, /DRAFT PACK/);
    const a = res.body.pack.answers.find((x) => !x.coached);
    assert.ok(a && /95% of the time/.test(a.answer), JSON.stringify(res.body.pack.answers));
    assert.ok(!res.body.pack.answers.some((x) => /coupon/.test(x.answer)));
  } finally { delete process.env.ANTHROPIC_KEY; delete process.env.ANTHROPIC_QUALITY_MODEL; }
});

test('build: when the fact-check call fails, the guard still cuts the draft\'s invented sentence', async () => {
  process.env.ANTHROPIC_KEY = 'k'; process.env.ANTHROPIC_QUALITY_MODEL = 'quality-model-x';
  try {
    const calls = installFetch({ pro: true });
    installModel(calls, { verifyStatus: 400 });
    const res = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', refresh: true });
    assert.equal(res.code, 200);
    assert.ok(!res.body.pack.answers.some((x) => /20% coupon/.test(x.answer)), JSON.stringify(res.body.pack.answers));
  } finally { delete process.env.ANTHROPIC_KEY; delete process.env.ANTHROPIC_QUALITY_MODEL; }
});
