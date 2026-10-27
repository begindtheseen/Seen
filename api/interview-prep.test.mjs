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

function installFetch({ pro = false, cached = null, resume = RESUME, failWrites = false } = {}) {
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
    if (u.pathname === '/rest/v1/interview_preps' && method === 'POST' && failWrites) return mockResponse({ message: 'statement timeout' }, { ok: false, status: 500 });
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

test('build: Seen\'s own engine — no model call even with a key; every answer is a résumé line told aloud', async () => {
  process.env.ANTHROPIC_KEY = 'must-not-be-used';
  try {
    const calls = installFetch({ pro: true });
    const modelCalls = installModel(calls);
    const res = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', refresh: true });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(modelCalls.length, 0, 'no model call (owner decision 2026-10-26)');
    assert.equal(res.body.pack.model, false);
    assert.ok(res.body.pack.answers.length >= 2);
    for (const a of res.body.pack.answers) {
      if (a.script || a.frame) continue; // drafted from dates / a frame to finish: no single line
      assert.ok(RESUME.includes(a.resume_fact), a.resume_fact);
      assert.match(a.answer, /\bI\b/, 'told in first person');
    }
    assert.ok(Array.isArray(res.body.pack.ask_them) && res.body.pack.ask_them.length >= 3);
  } finally { delete process.env.ANTHROPIC_KEY; }
});

// ── The free preview before the ask (owner decisions 2026-10-25) ───────────────────────────────────────
test('preview: signed in, no gate, no model — 2 role questions and 1 coached story from the résumé', async () => {
  process.env.ANTHROPIC_KEY = 'must-not-be-used';
  try {
    const calls = installFetch({ pro: false });
    const res = await call({ action: 'preview', company: 'Ross Stores', role: 'Assistant Store Manager', stage: 'Interview' });
    assert.equal(res.code, 200);
    assert.equal(res.body.has_resume, true);
    // 2 role questions — 3 when Seen has a guide for the company, whose own question comes first
    assert.ok(res.body.questions.length >= 2 && res.body.questions.length <= 3, JSON.stringify(res.body.questions));
    if (res.body.guide) { assert.equal(res.body.questions[0].company, true); assert.ok(res.body.guide.format.length > 60); }
    for (const q of res.body.questions) {
      assert.ok(q.q.endsWith('?') && q.why, JSON.stringify(q));
      assert.doesNotMatch(q.q, /^Tell me about yourself|^Why do you want to work at/, 'role questions, not the generic openers');
    }
    assert.ok(res.body.answer && RESUME.includes(res.body.answer.resume_fact), 'the story is a real résumé line');
    assert.ok(calls.every((c) => c.path.startsWith('/rest/v1/') || c.path === '/auth/v1/user'), 'no model call');
    assert.ok(!calls.some((c) => c.path === '/rest/v1/ai_credits' || c.path === '/rest/v1/credit_transactions'), 'no credit read or charge');
    assert.ok(!calls.some((c) => c.method !== 'GET' && c.path !== '/rest/v1/rpc/increment_rate_limit'), 'writes nothing but the rate-limit counter');
  } finally { delete process.env.ANTHROPIC_KEY; }
});

test('preview without a résumé: questions only, has_resume false', async () => {
  installFetch({ resume: 'short' });
  const res = await call({ action: 'preview', company: 'Ross Stores', role: 'Assistant Store Manager' });
  assert.equal(res.code, 200);
  assert.equal(res.body.has_resume, false);
  assert.equal(res.body.answer, null);
  assert.ok(res.body.questions.length >= 2 && res.body.questions.length <= 3);
});

test('preview needs sign-in and a company', async () => {
  installFetch();
  assert.equal((await call({ action: 'preview', company: 'Ross' }, { auth: false })).code, 401);
  assert.equal((await call({ action: 'preview', company: '' })).code, 400);
});

test('event carries surface and sku; checkout steps cannot be posted by a browser', async () => {
  const calls = installFetch();
  assert.equal((await call({ action: 'event', event: 'offer_clicked', surface: 'company_page', sku: 'interview', company: 'Ross' })).code, 200);
  assert.equal((await call({ action: 'event', event: 'pricing_view' }, { auth: false })).code, 200);
  assert.equal((await call({ action: 'event', event: 'checkout_completed', sku: 'pass30' })).code, 400);
  const rows = calls.filter((c) => c.path === '/rest/v1/funnel_events').map((c) => JSON.parse(c.body));
  assert.deepEqual(rows, [
    { user_id: UID, event: 'offer_clicked', company: 'Ross', surface: 'company_page', sku: 'interview' },
    { user_id: null, event: 'pricing_view', company: null },
  ]);
});

// ── Round 4: the person finishes each answer in their own words; the words stay with the prep ──────────
test('fill: saves the typed blanks on the prep, refuses an unknown question, needs sign-in', async () => {
  const cached = { company: 'Ross Stores', questions: [{ q: 'How do you keep shrink down?' }], answers: [{ q: 'How do you keep shrink down?', answer: 'At Target, I trained 30 new team members on loss prevention. [One time it mattered.]', resume_fact: 'Trained 30 new team members on register, returns and loss prevention' }] };
  const calls = installFetch({ pro: false, cached });
  const r = await call({ action: 'fill', company: 'Ross Stores', role: 'Assistant Store Manager', q: 'How do you keep shrink down?', values: ['A new hire let a friend through with a bad coupon; I caught it on the audit and we retrained the lane.'] });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const patch = calls.find((c) => c.path === '/rest/v1/interview_preps' && c.method === 'PATCH');
  assert.ok(patch, 'the prep row is updated');
  const saved = JSON.parse(patch.body).pack;
  assert.equal(saved.fills['How do you keep shrink down?'][0], 'A new hire let a friend through with a bad coupon; I caught it on the audit and we retrained the lane.');
  assert.equal(saved.answers.length, 1, 'nothing else on the pack changes');
  assert.ok(!calls.some((c) => c.path === '/rest/v1/ai_credits'), 'no credit or Pro check for typing your own words');
  assert.equal((await call({ action: 'fill', company: 'Ross Stores', role: 'Assistant Store Manager', q: 'Not a question here?', values: ['x'] })).code, 400);
  assert.equal((await call({ action: 'fill', company: 'Ross Stores', role: 'Assistant Store Manager', q: 'How do you keep shrink down?', values: ['x'] }, { auth: false })).code, 401);
});

test('a rebuild keeps the posting; a typed blank stays only with the sentence it finished, else it becomes a note', async () => {
  // the cached answer's sentence is not the rebuilt one → the person's words are kept as a note, never stitched on
  const cached = { company: 'Ross Stores', job_text: 'Assistant Store Manager at Ross Stores\nRequirements\nShrink control\nScheduling to a payroll budget', fills: { 'How do you keep shrink down?': ['kept'] }, answers: [{ q: 'How do you keep shrink down?', answer: 'x [y]' }] };
  const calls = installFetch({ pro: true, cached });
  const r = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', refresh: true });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.cached, false);
  assert.match(r.body.pack.job_text, /Shrink control/, 'the pasted posting is reused');
  assert.deepEqual(r.body.pack.fills, {});
  assert.deepEqual(r.body.pack.notes, { 'How do you keep shrink down?': ['kept'] });
  assert.ok(r.body.pack.job_match.length >= 1, 'what the job asks for, from the kept posting');
  assert.ok(calls.some((c) => c.path === '/rest/v1/interview_preps' && c.method === 'POST'));
  // the same sentence on both sides → the fill rides along (round 4, Dev: a rebuild moved a finished story onto
  // another employer and kept the typed middle)
  const same = r.body.pack.answers.find((a) => /\[/.test(a.answer));
  installFetch({ pro: true, cached: { ...r.body.pack, fills: { [same.q]: ['mine'] } } });
  const r2 = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', refresh: true });
  assert.deepEqual(r2.body.pack.fills, { [same.q]: ['mine'] });
  // the earlier note is still the person's writing: it rides along until they type over it
  assert.deepEqual(r2.body.pack.notes, { 'How do you keep shrink down?': ['kept'] });
});

test('the posting pasted before checkout is kept on the server and used by the first build', async () => {
  const calls = installFetch({ pro: true, cached: null });
  const st = await call({ action: 'stash', company: 'Ross Stores', role: 'Assistant Store Manager', application_id: 'app1', job_text: 'Assistant Store Manager at Ross Stores\nRequirements\nShrink control\nScheduling to a payroll budget' });
  assert.equal(st.code, 200, JSON.stringify(st.body));
  assert.equal(st.body.kept, true);
  const w = calls.find((c) => c.path.startsWith('/rest/v1/interview_preps') && c.method === 'POST');
  assert.ok(w && JSON.parse(w.body).pack.pending === true, 'stored as a stash, not a prep');
  // the stash is not a prep: `mine` says so and hands the posting back
  installFetch({ pro: true, cached: { pending: true, job_text: 'Assistant Store Manager at Ross Stores\nRequirements\nShrink control\nScheduling to a payroll budget' } });
  const mine = await call({ action: 'mine', company: 'Ross Stores', role: 'Assistant Store Manager' });
  assert.equal(mine.body.pack, null);
  assert.match(mine.body.pending_job_text, /Shrink control/);
  // the build with no job_text of its own reads the stash
  const b = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager' });
  assert.equal(b.code, 200, JSON.stringify(b.body));
  assert.equal(b.body.cached, false);
  assert.match(b.body.pack.job_text, /Shrink control/);
  assert.ok(b.body.pack.job_match.length >= 1);
  assert.equal((await call({ action: 'stash', company: 'Ross Stores', role: 'Assistant Store Manager', job_text: 'x'.repeat(300) }, { auth: false })).code, 401);
});

test('round 7: a build whose row write is refused says saved:false (and tried twice); a kept one says saved:true', async () => {
  const bad = installFetch({ pro: true, failWrites: true });
  const res = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', application_id: 'app_1' });
  assert.equal(res.code, 200);
  assert.equal(res.body.cached, false);
  assert.equal(res.body.saved, false, 'the card is told the rebuild was not kept');
  assert.equal(bad.filter((c) => c.path === '/rest/v1/interview_preps' && c.method === 'POST').length, 2, 'one retry');
  installFetch({ pro: true });
  const ok = await call({ action: 'build', company: 'Ross Stores', role: 'Assistant Store Manager', application_id: 'app_1' });
  assert.equal(ok.body.saved, true);
});
