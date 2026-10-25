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
