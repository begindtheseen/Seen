// Employer messages, applicant withdrawal and the exit review — endpoint level, against a mocked
// Supabase + Resend. Run: node --test lib/server/applicationWithdraw.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _resetThreadAvailability, _resetSeenApplyAvailability } from './seenApplyStore.js';
import { isScorableReport } from './reportCounts.js';
import { classifyPlatform } from '../../api/_utils/companyIntel.js';

const SEEN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const TRK_ID = '33333333-3333-4333-8333-333333333333';
const UPDATED = '2026-10-18T01:07:35.957602+00:00';
const DAY = 86400000;

function mockRes() {
  return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://db.example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key-for-test';
  process.env.RESEND_API_KEY = 'resend-test';
  delete process.env.SUPABASE_JWT_SECRET;
  _resetThreadAvailability();
  _resetSeenApplyAvailability();
});

/** fetch mock: `routes` is a list of [predicate(u, method), responder(u, opts)]; everything is logged. */
function mockFetch(t, routes) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const u = decodeURIComponent(String(url)); const method = opts.method || 'GET';
    let body = null; try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
    calls.push({ url: u, method, body });
    for (const [match, respond] of routes) if (match(u, method)) return respond(u, { ...opts, body });
    if (u.startsWith('https://api.resend.com/')) return json({ id: 'em_1' });
    if (u.includes('/rest/v1/rpc/increment_rate_limit')) return json(1);
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('', { status: 404 });
  });
  return calls;
}

test('employer message: appended to the one thread (race-safe), emailed to the applicant', async (t) => {
  const calls = mockFetch(t, [
    [(u) => u.endsWith('/auth/v1/user'), () => json({ id: 'emp-1' })],
    [(u) => u.includes('/rest/v1/employer_company_claims'), () => json([{ company_name: 'seen jobs', company_display_name: 'Seen Jobs' }])],
    [(u, m) => u.includes('/rest/v1/seen_applications') && m === 'GET', () => json([{ id: SEEN_ID, thread: null, updated_at: UPDATED, applicant_email: 'sam@example.com', company_name: 'Seen Jobs', job_title: 'Barista' }])],
    [(u, m) => u.includes('/rest/v1/seen_applications') && m === 'PATCH', (u, o) => json([{ id: SEEN_ID, job_id: JOB_ID, applicant_name: 'Sam', applicant_email: 'sam@example.com', status: 'interviewing', thread: o.body.thread }])],
  ]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'application_message', id: SEEN_ID, text: 'Interview Tue 3pm. Call 555-0100 when you arrive.' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const patch = calls.find((c) => c.url.includes('/rest/v1/seen_applications') && c.method === 'PATCH');
  // Scoped to this company's application, and only if nobody wrote since it was read.
  assert.match(patch.url, new RegExp(`id=eq\\.${SEEN_ID}`));
  assert.match(patch.url, /company_key=eq\.seen jobs/);
  assert.ok(patch.url.includes(`updated_at=eq.${UPDATED}`));
  assert.equal(patch.body.thread.length, 1);
  assert.equal(patch.body.thread[0][0], 'e');
  assert.equal(patch.body.thread[0][2], 'Interview Tue 3pm. Call 555-0100 when you arrive.');
  assert.equal(res.body.application.thread[0].from, 'employer');
  assert.equal(res.body.emailed, true);
  const mail = calls.find((c) => c.url.startsWith('https://api.resend.com/'));
  assert.deepEqual(mail.body.to, ['sam@example.com']);
  assert.match(mail.body.html, /555-0100/);
});

test('employer message: before the migration it is refused, nothing is written', async (t) => {
  const calls = mockFetch(t, [
    [(u) => u.endsWith('/auth/v1/user'), () => json({ id: 'emp-1' })],
    [(u) => u.includes('/rest/v1/employer_company_claims'), () => json([{ company_name: 'seen jobs' }])],
    [(u) => u.includes('seen_applications?select=thread'), () => json({ code: '42703', message: 'column seen_applications.thread does not exist' }, 400)],
  ]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'application_message', id: SEEN_ID, text: 'hi' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.reason, 'unavailable');
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('withdraw (Apply on Seen): employer copy withdrawn with the note, employer notified, tracker updated', async (t) => {
  const calls = mockFetch(t, [
    [(u) => u.endsWith('/auth/v1/user'), () => json({ id: 'applicant-9' })],
    [(u) => u.includes('/auth/v1/admin/users/emp-1'), () => json({ email: 'hiring@seenjobs.io' })],
    [(u, m) => u.includes('/rest/v1/applications') && m === 'GET', () => json([{ id: TRK_ID, job_id: JOB_ID, company_name: 'Seen Jobs', role: 'Barista', status: 'active', events: [{ type: 'application_submitted' }] }])],
    [(u, m) => u.includes('/rest/v1/seen_applications') && m === 'GET', () => json([{ id: SEEN_ID, job_id: JOB_ID, status: 'reviewed', thread: null, updated_at: UPDATED, company_key: 'seen jobs', company_name: 'Seen Jobs', job_title: 'Barista', employer_user_id: 'emp-1', applicant_name: 'Sam' }])],
    [(u, m) => u.includes('/rest/v1/seen_applications') && m === 'PATCH', () => json([{ id: SEEN_ID }])],
    [(u, m) => u.includes('/rest/v1/applications') && m === 'PATCH', () => new Response(null, { status: 204 })],
    [(u, m) => u.includes('/rest/v1/employer_notifications') && m === 'POST', () => new Response(null, { status: 201 })],
  ]);
  const { default: handler } = await import('../../api/apply.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'withdraw', application_id: TRK_ID, message: 'Took another offer — thank you for your time!' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true, seen_application: true, employer_notified: true });

  const seenRead = calls.find((c) => c.url.includes('/rest/v1/seen_applications?job_id') && c.method === 'GET');
  assert.match(seenRead.url, /applicant_user_id=eq\.applicant-9/); // only the caller's own application
  const seenPatch = calls.find((c) => c.url.includes('/rest/v1/seen_applications') && c.method === 'PATCH');
  assert.match(seenPatch.url, /applicant_user_id=eq\.applicant-9/);
  assert.equal(seenPatch.body.status, 'withdrawn');
  assert.deepEqual(seenPatch.body.thread.at(-1).slice(0, 1).concat(seenPatch.body.thread.at(-1).slice(2)), ['a', 'Took another offer — thank you for your time!', 'w']);
  assert.equal(seenPatch.body.thread.length, 1);
  // (Once the employer has written, the note is dropped — lib/server/listingFill.test.mjs.)

  const notif = calls.find((c) => c.url.includes('/rest/v1/employer_notifications'));
  assert.equal(notif.body.kind, 'apply_activity');
  assert.equal(notif.body.meta.event, 'withdrawn');
  assert.equal(notif.body.company_key, 'seen jobs');
  assert.match(notif.body.body, /Took another offer/);
  const mail = calls.find((c) => c.url.startsWith('https://api.resend.com/'));
  assert.deepEqual(mail.body.to, ['hiring@seenjobs.io']);

  const trk = calls.find((c) => c.url.includes('/rest/v1/applications') && c.method === 'PATCH');
  assert.match(trk.url, new RegExp(`id=eq\\.${TRK_ID}`));
  assert.match(trk.url, /user_id=eq\.applicant-9/);
  assert.equal(trk.body.status, 'withdrawn');
  assert.equal(trk.body.events.at(-1).type, 'withdrawn');
});

test('withdraw: an application that already ended is refused', async (t) => {
  mockFetch(t, [
    [(u) => u.endsWith('/auth/v1/user'), () => json({ id: 'applicant-9' })],
    [(u, m) => u.includes('/rest/v1/applications') && m === 'GET', () => json([{ id: TRK_ID, job_id: JOB_ID, status: 'hired', events: [] }])],
  ]);
  const { default: handler } = await import('../../api/apply.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'withdraw', application_id: TRK_ID } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.reason, 'ended');
});

test('exit review: written to reports with the outcome on record, counted, score recomputed', async (t) => {
  const appliedAt = new Date(Date.now() - 12 * DAY).toISOString();
  const interviewAt = Date.now() - 5 * DAY;
  const calls = mockFetch(t, [
    [(u) => u.endsWith('/auth/v1/user'), () => json({ id: 'applicant-9' })],
    [(u, m) => u.includes('/rest/v1/applications') && m === 'GET', () => json([{
      id: TRK_ID, job_id: JOB_ID, company_name: 'Seen Jobs', role: 'Barista', city: 'Austin, TX', status: 'withdrawn', stage: 'Interview',
      employer_stage: 'Interviewing', applied_at: appliedAt,
      events: [{ type: 'application_submitted', date: Date.parse(appliedAt) }, { type: 'interview_received', date: interviewAt, source: 'employer' }, { type: 'withdrawn', date: Date.now() }],
    }])],
    [(u, m) => u.includes('/rest/v1/seen_applications') && m === 'GET', () => json([{ thread: null }])],
    [(u, m) => u.includes('/rest/v1/companies') && m === 'GET', () => json([{ id: 'co-1', name: 'Seen Jobs' }])],
    [(u, m) => u.includes('/rest/v1/company_locations') && m === 'GET', () => json([{ id: 'loc-1' }])],
    [(u, m) => u.includes('/rest/v1/reports') && m === 'POST', () => new Response(null, { status: 201 })],
    [(u, m) => u.includes('/rest/v1/reports?company_name'), () => json([{ outcome: 'interview', platform: 'Seen Apply' }])],
    [(u, m) => u.includes('/rest/v1/company_scores') && m === 'POST', () => new Response(null, { status: 201 })],
    [(u, m) => u.includes('/rest/v1/applications') && m === 'PATCH', () => new Response(null, { status: 204 })],
  ]);
  const { default: handler } = await import('../../api/apply.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'withdraw_review', application_id: TRK_ID, reason: 'other_offer', review: 'Quick to reply and friendly. I took another offer.' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.outcome, 'interview');
  assert.equal(res.body.counted, true);
  assert.equal(res.body.score_updated, true);

  const rep = calls.find((c) => c.url.includes('/rest/v1/reports') && c.method === 'POST');
  assert.equal(rep.body.company_name, 'Seen Jobs');
  assert.equal(rep.body.company_id, 'co-1');
  assert.equal(rep.body.platform, 'Seen Apply');
  assert.equal(rep.body.outcome, 'interview'); // from the employer's status, not typed by the reviewer
  assert.equal(rep.body.wait_days, 7);
  assert.equal(rep.body.rounds, 1);
  assert.equal(rep.body.user_id, 'applicant-9');
  assert.equal(rep.body.report_text, 'Quick to reply and friendly. I took another offer.');
  // It is in the scoring pool at full first-party weight.
  assert.equal(isScorableReport(rep.body), true);
  assert.equal(classifyPlatform(rep.body.platform), 'direct');
  // The company's stored score is rebuilt from its reports right away.
  const score = calls.find((c) => c.url.includes('/rest/v1/company_scores') && c.method === 'POST');
  assert.equal(score.body.company_name, 'seen jobs');
  // And the withdrawal is marked reviewed, with the reason code kept.
  const mark = calls.find((c) => c.url.includes('/rest/v1/applications') && c.method === 'PATCH');
  assert.match(mark.url, /user_id=eq\.applicant-9/);
  assert.equal(mark.body.events.at(-1).rv, 1);
  assert.equal(mark.body.events.at(-1).reason, 'other_offer');
});

test('exit review: refused twice, and refused before withdrawing', async (t) => {
  let status = 'withdrawn';
  let events = [{ type: 'withdrawn', rv: 1 }];
  const calls = mockFetch(t, [
    [(u) => u.endsWith('/auth/v1/user'), () => json({ id: 'applicant-9' })],
    [(u, m) => u.includes('/rest/v1/applications') && m === 'GET', () => json([{ id: TRK_ID, job_id: JOB_ID, company_name: 'Seen Jobs', status, events }])],
  ]);
  const { default: handler } = await import('../../api/apply.js');
  let res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'withdraw_review', application_id: TRK_ID, reason: 'too_slow' } }, res);
  assert.equal(res.statusCode, 409);
  status = 'active'; events = [];
  res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'withdraw_review', application_id: TRK_ID, reason: 'too_slow' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.filter((c) => c.url.includes('/rest/v1/reports') && c.method === 'POST').length, 0);
});
