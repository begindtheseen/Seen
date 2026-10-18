// Listing edits, "we hired — close this listing", the no-reply rule and retention.
// Run: node --test lib/server/listingFill.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { planFill, defaultDeclineMessage, declineTemplates, buildListingEditPatch } from './seenApply.js';
import { applicantMayNote } from './applicationThread.js';
import { purgeDecidedApplications, purgePatch, daysUntilCleared, retentionCutoffISO, RETENTION_DAYS } from './applicationRetention.js';
import { _resetThreadAvailability, _resetSeenApplyAvailability, _resetLifecycleAvailability } from './seenApplyStore.js';

const JOB = '22222222-2222-4222-8222-222222222222';
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const DAY = 86400000;

// ── pure ──────────────────────────────────────────────────────────────────────────────────────
test('planFill: hires are never messaged; everyone still waiting is declined once', () => {
  const rows = [
    { id: id(1), status: 'new' }, { id: id(2), status: 'interviewing' }, { id: id(3), status: 'reviewed' },
    { id: id(4), status: 'hired' }, { id: id(5), status: 'rejected' }, { id: id(6), status: 'withdrawn' },
  ];
  const p = planFill(rows, [id(2)]);
  assert.equal(p.ok, true);
  assert.deepEqual(p.hire.map((r) => r.id), [id(2)]);
  assert.deepEqual(p.decline.map((r) => r.id), [id(1), id(3)]);
  assert.deepEqual(p.keep, { hired: 1, declined: 1, withdrawn: 1 });
  // Nobody hired from Seen: everyone waiting is declined.
  assert.equal(planFill(rows, []).decline.length, 3);
  // A previously declined applicant can still be hired.
  assert.deepEqual(planFill(rows, [id(5)]).hire.map((r) => r.id), [id(5)]);
  // Refuses ids that aren't on this listing, and people who withdrew.
  assert.equal(planFill(rows, [id(99)]).ok, false);
  assert.equal(planFill(rows, [id(6)]).ok, false);
});

test('default decline message names the role and company', () => {
  const m = defaultDeclineMessage({ title: 'Barista', company: 'Seen Jobs' });
  assert.match(m, /Barista role at Seen Jobs/);
  assert.match(m, /filled the position/);
  assert.match(defaultDeclineMessage({}), /this role/);
});

test('recommended decline messages: three for closing a filled role, two for a single decline', () => {
  const filled = declineTemplates({ title: 'Barista', company: 'Seen Jobs' }, 'filled');
  assert.deepEqual(filled.map((t) => t.id), ['filled', 'another', 'interviewed']);
  const single = declineTemplates({ title: 'Barista', company: 'Seen Jobs' }, 'single');
  assert.deepEqual(single.map((t) => t.id), ['another', 'interviewed']);
  // A single decline never claims the role is filled; none promises to keep a résumé on file.
  assert.equal(single.some((t) => /filled/i.test(t.text)), false);
  assert.equal([...filled, ...single].some((t) => /on file/i.test(t.text)), false);
  for (const t of [...filled, ...single]) assert.ok(t.text.length <= 600 && t.text.includes('Barista'), t.id);
  assert.equal(defaultDeclineMessage({ title: 'Barista' }), declineTemplates({ title: 'Barista' })[0].text);
});

test('edit patch keeps post/expiry dates and stamps edited_at', () => {
  const p = buildListingEditPatch({ title: 'Lead Barista', location: 'Austin, TX', salary: '$20/hr', description: 'x', apply_url: null, apply_mode: 'seen', type: 'Part-time' }, { nowISO: '2026-10-18T03:00:00.000Z', withApplyMode: true });
  assert.equal(p.edited_at, '2026-10-18T03:00:00.000Z');
  assert.equal(p.city, 'Austin, TX');
  assert.equal(p.remote, false);
  assert.equal(p.apply_mode, 'seen');
  assert.equal('created_at' in p || 'expires_at' in p, false);
  const r = buildListingEditPatch({ title: 't', location: 'Remote', type: 'Full-time' }, { nowISO: 'x', withApplyMode: false });
  assert.equal(r.remote, true); assert.equal(r.city, null); assert.equal('apply_mode' in r, false);
});

test('no replies: an applicant may only add a note before the employer has written', () => {
  assert.equal(applicantMayNote(null), true);
  assert.equal(applicantMayNote([['a', 1, '', 'w']]), true);
  assert.equal(applicantMayNote([['e', 1, 'Interview Tuesday?']]), false);
});

test('retention: 30 days after a decline or withdrawal; never for hires or open applications', () => {
  const now = Date.UTC(2026, 10, 30);
  assert.equal(RETENTION_DAYS, 30);
  assert.equal(daysUntilCleared({ status: 'rejected', decided_at: new Date(now - 10 * DAY).toISOString() }, now), 20);
  assert.equal(daysUntilCleared({ status: 'withdrawn', decided_at: new Date(now - 40 * DAY).toISOString() }, now), 0);
  assert.equal(daysUntilCleared({ status: 'hired', decided_at: new Date(now).toISOString() }, now), null);
  assert.equal(daysUntilCleared({ status: 'interviewing' }, now), null);
  assert.equal(retentionCutoffISO(now), new Date(now - 30 * DAY).toISOString());
  const p = purgePatch('2026-11-30T00:00:00.000Z');
  for (const k of ['resume_text', 'resume_path', 'applicant_phone', 'note']) assert.equal(p[k], null, k);
  assert.equal(p.applicant_email, '');
  assert.equal('thread' in p || 'status' in p, false, 'the conversation and status stay');
});

test('retention sweep: files first; a storage failure keeps the row for the next run', async () => {
  const calls = [];
  const rows = [{ id: id(1), resume_path: 'u/a.pdf' }, { id: id(2), resume_path: null }];
  const db = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (!opts.method) return new Response(JSON.stringify(rows), { status: 200 });
    return new Response(null, { status: 204 });
  };
  const ok = await purgeDecidedApplications({ db, deleteFiles: async (paths) => { calls.push({ files: paths }); return true; }, nowMs: Date.UTC(2026, 10, 30) });
  assert.deepEqual(ok, { scanned: 2, cleared: 2, fileErrors: 0 });
  assert.match(calls[0].path, /purged_at=is\.null/);
  assert.match(calls[0].path, /status=in\.\(rejected,withdrawn\)/);
  assert.deepEqual(calls[1].files, ['u/a.pdf']);
  assert.match(calls[2].path, new RegExp(`id=in\\.\\(${id(1)},${id(2)}\\)`));
  assert.equal(calls[2].body.resume_text, null);

  calls.length = 0;
  const failed = await purgeDecidedApplications({ db, deleteFiles: async () => false, nowMs: Date.UTC(2026, 10, 30) });
  assert.deepEqual(failed, { scanned: 2, cleared: 1, fileErrors: 1 });
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch.path.includes(`id=in.(${id(2)})`), 'only the row without a file is cleared');
});

// ── endpoints ─────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://db.example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key-for-test';
  process.env.RESEND_API_KEY = 'resend-test';
  delete process.env.SUPABASE_JWT_SECRET;
  _resetThreadAvailability(); _resetSeenApplyAvailability(); _resetLifecycleAvailability();
});

function mockFetch(t, routes) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const u = decodeURIComponent(String(url)); const method = opts.method || 'GET';
    let body = null; try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
    calls.push({ url: u, method, body });
    for (const [match, respond] of routes) if (match(u, method)) return respond(u, { ...opts, body });
    if (u.startsWith('https://api.resend.com/')) return json({ id: 'em_1' });
    if (u.includes('/rest/v1/rpc/')) return json(1);
    if (u.includes('/rest/v1/')) return json([]);
    return new Response('', { status: 404 });
  });
  return calls;
}
const employer = [
  [(u) => u.endsWith('/auth/v1/user'), () => json({ id: 'emp-1' })],
  [(u) => u.includes('/rest/v1/employer_company_claims'), () => json([{ company_name: 'seen jobs', company_display_name: 'Seen Jobs' }])],
];
const ownJob = (extra = {}) => [(u, m) => u.includes(`/rest/v1/jobs?id=eq.${JOB}&select=`) && m === 'GET', () => json([{ id: JOB, title: 'Barista', company: 'Seen Jobs', is_employer_posted: true, employer_user_id: 'emp-1', expires_at: '2099-01-01T00:00:00Z', location: 'Austin, TX', ...extra }])];

test('update: edits only your own listing, dated, keeping its post date', async (t) => {
  const calls = mockFetch(t, [...employer, ownJob(),
    [(u, m) => u.includes('/rest/v1/jobs?id=') && m === 'PATCH', (u, o) => json([{ id: JOB, ...o.body }])],
  ]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'update', job_id: JOB, title: 'Lead Barista', location: 'Austin, TX', apply_mode: 'seen', type: 'Full-time' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const patch = calls.find((c) => c.url.includes('/rest/v1/jobs?id=') && c.method === 'PATCH');
  assert.match(patch.url, /is_employer_posted=eq\.true/);
  assert.match(patch.url, /employer_user_id=eq\.emp-1/);
  assert.equal(patch.body.title, 'Lead Barista');
  assert.ok(patch.body.edited_at);
  assert.equal('created_at' in patch.body || 'expires_at' in patch.body, false);
});

test('update: someone else’s listing is refused', async (t) => {
  const calls = mockFetch(t, [...employer, ownJob({ employer_user_id: 'emp-2' })]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'update', job_id: JOB, title: 'Hijack', apply_mode: 'seen' } }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('fill_listing: needs the "I selected everyone I hired" confirmation', async (t) => {
  const calls = mockFetch(t, [...employer, ownJob()]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'fill_listing', job_id: JOB, hired_ids: [] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.reason, 'confirm_required');
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('fill_listing: hires marked, the rest get one message, hires and the withdrawn are never messaged, listing closed', async (t) => {
  const apps = [
    { id: id(1), job_id: JOB, status: 'new', thread: null, applicant_user_id: 'u1', applicant_email: 'one@example.com', company_name: 'Seen Jobs', job_title: 'Barista' },
    { id: id(2), job_id: JOB, status: 'interviewing', thread: [['e', 1, 'Tue 3pm?']], applicant_user_id: 'u2', applicant_email: 'two@example.com', company_name: 'Seen Jobs', job_title: 'Barista' },
    { id: id(3), job_id: JOB, status: 'withdrawn', thread: null, applicant_user_id: 'u3', applicant_email: 'three@example.com', company_name: 'Seen Jobs', job_title: 'Barista' },
    { id: id(4), job_id: JOB, status: 'hired', thread: null, applicant_user_id: 'u4', applicant_email: 'four@example.com', company_name: 'Seen Jobs', job_title: 'Barista' },
  ];
  const calls = mockFetch(t, [...employer, ownJob(),
    [(u, m) => u.includes(`/rest/v1/seen_applications?job_id=eq.${JOB}`) && m === 'GET', () => json(apps)],
    [(u, m) => u.includes('/rest/v1/seen_applications?id=eq.') && m === 'PATCH', (u, o) => json([{ id: 'x', ...o.body }])],
    [(u, m) => u.includes('/rest/v1/applications?user_id=') && m === 'GET', () => json([{ id: 'trk', status: 'active', stage: 'Applied', events: [] }])],
    [(u, m) => u.includes('/rest/v1/applications?id=') && m === 'PATCH', () => new Response(null, { status: 204 })],
    [(u, m) => u.includes('/rest/v1/jobs?id=') && m === 'PATCH', () => new Response(null, { status: 204 })],
  ]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  const msg = 'Thanks for applying — we filled the role.';
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'fill_listing', job_id: JOB, hired_ids: [id(2)], message: msg, confirm_hired: true } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.hired, 1);
  assert.equal(res.body.declined, 1);
  assert.equal(res.body.closed, true);

  const patches = calls.filter((c) => c.url.includes('/rest/v1/seen_applications?id=eq.') && c.method === 'PATCH');
  const hire = patches.find((c) => c.url.includes(id(2)));
  assert.equal(hire.body.status, 'hired');
  assert.ok(hire.body.decided_at);
  assert.equal(hire.body.thread, undefined, 'a hire gets no message');
  const decline = patches.find((c) => c.url.includes(id(1)));
  assert.equal(decline.body.status, 'rejected');
  assert.match(decline.url, /status=in\.\(new,reviewed,interviewing\)/, 'skips anyone who withdrew a moment ago');
  assert.deepEqual(decline.body.thread.at(-1).filter((_, i) => i !== 1), ['e', msg]);
  assert.equal(patches.some((c) => c.url.includes(id(3)) || c.url.includes(id(4))), false, 'withdrawn and already-hired untouched');

  const mails = calls.filter((c) => c.url.startsWith('https://api.resend.com/'));
  const toDeclined = mails.find((m) => m.body.to[0] === 'one@example.com');
  assert.ok(toDeclined.body.html.includes(msg), 'the decline email carries the message');
  assert.equal(mails.some((m) => ['three@example.com', 'four@example.com'].includes(m.body.to[0])), false);

  const close = calls.find((c) => c.url.includes('/rest/v1/jobs?id=') && c.method === 'PATCH');
  assert.match(close.url, /employer_user_id=eq\.emp-1/);
  assert.equal(close.body.status, 'filled');
  assert.equal(close.body.availability_status, 'expired');
});

test('withdraw: once the employer has written, the applicant’s note is dropped (no replies)', async (t) => {
  const TRK = '33333333-3333-4333-8333-333333333333';
  const calls = mockFetch(t, [
    [(u) => u.endsWith('/auth/v1/user'), () => json({ id: 'applicant-9' })],
    [(u, m) => u.includes('/rest/v1/applications') && m === 'GET', () => json([{ id: TRK, job_id: JOB, status: 'active', events: [] }])],
    [(u, m) => u.includes('/rest/v1/seen_applications') && m === 'GET', () => json([{ id: id(1), job_id: JOB, status: 'interviewing', thread: [['e', 1, 'See you Tuesday']], updated_at: 'x', company_key: 'seen jobs', employer_user_id: 'emp-1', applicant_name: 'Sam' }])],
    [(u, m) => u.includes('/rest/v1/seen_applications') && m === 'PATCH', () => json([{ id: id(1) }])],
    [(u, m) => u.includes('/rest/v1/applications') && m === 'PATCH', () => new Response(null, { status: 204 })],
  ]);
  const { default: handler } = await import('../../api/apply.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'withdraw', application_id: TRK, message: 'Actually, about that interview…' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const patch = calls.find((c) => c.url.includes('/rest/v1/seen_applications') && c.method === 'PATCH');
  assert.deepEqual(patch.body.thread.at(-1).filter((_, i) => i !== 1), ['a', '', 'w']);
  assert.ok(patch.body.decided_at);
  const mail = calls.find((c) => c.url.startsWith('https://api.resend.com/'));
  assert.equal(String(mail?.body?.html || '').includes('about that interview'), false);
});

test('single decline with a message: added to the conversation (race-safe) and carried in the email', async (t) => {
  const UPDATED = '2026-10-18T03:00:00.000000+00:00';
  const calls = mockFetch(t, [...employer,
    [(u, m) => u.includes(`/rest/v1/seen_applications?id=eq.${id(1)}`) && m === 'GET', () => json([{ status: 'interviewing', updated_at: UPDATED, thread: [['e', 1, 'Tue 3pm?']] }])],
    [(u, m) => u.includes(`/rest/v1/seen_applications?id=eq.${id(1)}`) && m === 'PATCH', (u, o) => json([{ id: id(1), job_id: JOB, status: 'rejected', thread: o.body.thread, applicant_user_id: 'u1', applicant_email: 'one@example.com', applicant_name: 'Sam', company_name: 'Seen Jobs', job_title: 'Barista' }])],
    [(u, m) => u.includes('/rest/v1/applications?user_id=') && m === 'GET', () => json([{ id: 'trk', status: 'active', stage: 'Interview', events: [] }])],
    [(u, m) => u.includes('/rest/v1/applications?id=') && m === 'PATCH', () => new Response(null, { status: 204 })],
  ]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  const msg = 'Thanks for interviewing — we went another way.';
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'application_status', id: id(1), status: 'rejected', message: msg } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const patch = calls.find((c) => c.url.includes('/rest/v1/seen_applications?id=') && c.method === 'PATCH');
  assert.ok(patch.url.includes(`updated_at=eq.${UPDATED}`));
  assert.equal(patch.body.status, 'rejected');
  assert.equal(patch.body.thread.length, 2, 'appended after the earlier message');
  assert.deepEqual(patch.body.thread.at(-1).filter((_, i) => i !== 1), ['e', msg]);
  assert.equal(res.body.application.thread.at(-1).text, msg);
  const mail = calls.find((c) => c.url.startsWith('https://api.resend.com/'));
  assert.deepEqual(mail.body.to, ['one@example.com']);
  assert.ok(mail.body.html.includes(msg));
});

test('a message is only accepted with a decline', async (t) => {
  const calls = mockFetch(t, [...employer,
    [(u, m) => u.includes(`/rest/v1/seen_applications?id=eq.${id(1)}`) && m === 'GET', () => json([{ status: 'new', updated_at: 'x' }])],
    [(u, m) => u.includes(`/rest/v1/seen_applications?id=eq.${id(1)}`) && m === 'PATCH', (u, o) => json([{ id: id(1), job_id: JOB, ...o.body }])],
  ]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'application_status', id: id(1), status: 'reviewed', message: 'sneaky' } }, res);
  assert.equal(res.statusCode, 200);
  const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('seen_applications'));
  assert.equal(patch.body.thread, undefined);
});

// ── Take Seen applications on an aggregated listing ───────────────────────────────────────────
import { claimListingPatch } from './seenApply.js';
const isHttp = (u) => /^https?:\/\//.test(String(u || ''));
const keyOf = (c) => String(c || '').toLowerCase().trim();
const adzuna = { id: JOB, title: 'Barista', company: 'Seen Jobs', apply_url: 'https://www.adzuna.com/details/1', is_employer_posted: false, employer_user_id: null, expires_at: new Date(Date.UTC(2026, 9, 25)).toISOString(), availability_status: 'active' };
const NOW = Date.UTC(2026, 9, 18);

test('claim rule: converts in place to an employer-managed listing taking Seen applications', () => {
  const v = claimListingPatch(adzuna, { mode: 'both', uid: 'emp-1', companyKey: 'seen jobs', companyOf: keyOf, nowMs: NOW, isHttpUrl: isHttp });
  assert.equal(v.ok, true);
  assert.equal(v.patch.is_employer_posted, true); // never swept as stale; shown ahead; editable
  assert.equal(v.patch.employer_user_id, 'emp-1');
  assert.equal(v.patch.apply_mode, 'both');
  assert.equal(v.patch.expires_at, new Date(NOW + 60 * DAY).toISOString(), 'gets an employer listing lifetime');
  for (const k of ['title', 'description', 'apply_url', 'company']) assert.equal(k in v.patch, false, `${k} untouched`);
});

test('claim rule: refusals', () => {
  const base = { uid: 'emp-1', companyKey: 'seen jobs', companyOf: keyOf, nowMs: NOW, isHttpUrl: isHttp };
  assert.equal(claimListingPatch(adzuna, { ...base, mode: 'external' }).reason, 'mode');
  assert.equal(claimListingPatch({ ...adzuna, company: 'Other Co' }, { ...base, mode: 'seen' }).reason, 'company');
  assert.equal(claimListingPatch({ ...adzuna, employer_user_id: 'emp-2' }, { ...base, mode: 'seen' }).reason, 'owned');
  assert.equal(claimListingPatch({ ...adzuna, availability_status: 'expired' }, { ...base, mode: 'seen' }).reason, 'closed');
  assert.equal(claimListingPatch({ ...adzuna, apply_url: null }, { ...base, mode: 'both' }).reason, 'no_link');
  assert.equal(claimListingPatch({ ...adzuna, apply_url: null }, { ...base, mode: 'seen' }).ok, true, 'Seen-only needs no link');
  assert.equal(claimListingPatch(null, { ...base, mode: 'seen' }).reason, 'missing');
});

test('claim_listing endpoint: guarded PATCH on the same row, refused for another company', async (t) => {
  const calls = mockFetch(t, [...employer,
    [(u, m) => u.includes(`/rest/v1/jobs?id=eq.${JOB}&select=`) && m === 'GET', () => json([adzuna])],
    [(u, m) => u.includes(`/rest/v1/jobs?id=eq.${JOB}&or=`) && m === 'PATCH', (u, o) => json([{ ...adzuna, ...o.body }])],
  ]);
  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'claim_listing', job_id: JOB, apply_mode: 'seen' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/jobs'));
  assert.match(patch.url, /or=\(employer_user_id\.is\.null,employer_user_id\.eq\.emp-1\)/);
  assert.equal(patch.body.apply_mode, 'seen');
  assert.equal(res.body.listing.is_employer_posted, true);
});
