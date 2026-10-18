// Employer moves a Seen application → the applicant's own tracker row follows (owner request
// 2026-10-18). Endpoint-level: POST /api/employer-listings { action: 'application_status' }.
// Run: node --test lib/server/employerTrackerSync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const APP_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

function mockRes() {
  return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
}

test('application_status: syncs the applicant tracker row and emails them on a decision', async (t) => {
  process.env.SUPABASE_URL = 'https://db.example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key-for-test';
  process.env.RESEND_API_KEY = 'resend-test';
  delete process.env.SUPABASE_JWT_SECRET;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const u = String(url); const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.endsWith('/auth/v1/user')) return json({ id: 'emp-1' });
    if (u.includes('/rest/v1/employer_company_claims')) return json([{ company_name: 'seen jobs', company_display_name: 'Seen Jobs' }]);
    if (u.includes('/rest/v1/seen_applications') && method === 'GET') return json([{ id: APP_ID, status: 'new' }]);
    if (u.includes('/rest/v1/seen_applications') && method === 'PATCH') return json([{ id: APP_ID, job_id: JOB_ID, status: 'interviewing', company_key: 'seen jobs', company_name: 'Seen Jobs', job_title: 'Software Engineer', applicant_user_id: 'applicant-9', applicant_name: 'Sam', applicant_email: 'sam@example.com' }]);
    if (u.includes('/rest/v1/applications') && method === 'GET') return json([{ id: 'trk-1', status: 'active', stage: 'Applied', events: [{ type: 'application_submitted', source: 'seen_apply' }] }]);
    if (u.includes('/rest/v1/applications') && method === 'PATCH') return new Response(null, { status: 204 });
    if (u.startsWith('https://api.resend.com/')) return json({ id: 'em_1' });
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('', { status: 404 });
  });

  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'application_status', id: APP_ID, status: 'interviewing' } }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.tracker, { synced: true, reason: 'updated' });
  // Only that applicant's row for that listing is read and written.
  const read = calls.find((c) => c.url.includes('/rest/v1/applications') && c.method === 'GET');
  assert.match(read.url, /user_id=eq\.applicant-9/);
  assert.match(read.url, new RegExp(`job_id=eq\\.${JOB_ID}`));
  const write = calls.find((c) => c.url.includes('/rest/v1/applications') && c.method === 'PATCH');
  assert.match(write.url, /id=eq\.trk-1/);
  assert.match(write.url, /user_id=eq\.applicant-9/);
  assert.equal(write.body.stage, 'Interview');
  assert.equal(write.body.employer_stage, 'Interviewing');
  assert.equal(write.body.events.at(-1).type, 'interview_received');
  assert.equal(write.body.events.at(-1).source, 'employer');
  // Interviewing is a decision worth an email; it goes to the applicant's consented address.
  const mail = calls.find((c) => c.url.startsWith('https://api.resend.com/'));
  assert.deepEqual(mail.body.to, ['sam@example.com']);
  assert.match(mail.body.subject, /Software Engineer/);
});
