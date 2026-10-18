// Apply on Seen: apply_mode validation, the applicant form rules, the employer inbox's ownership
// scoping, the duplicate-apply answer, and the not-migrated fallback (code ships before the
// migration). Run: node --test lib/server/seenApply.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeApplyMode, effectiveApplyMode, allowsSeenApply, allowsExternalApply, isNotMigrated,
  validateSeenApplication, base64Bytes, resumeObject, buildTrackerRow, buildSeenApplicationRow, isDuplicate, inboxItem,
} from './seenApply.js';
import { validateNewListing, buildEmployerListingRow, annotateListings } from './employerPostings.js';
import { _resetSeenApplyAvailability } from './seenApplyStore.js';

const JOB_ID = '12920e55-f15d-450e-af6e-379a57359ab4';
const APP_ID = '22222222-2222-4222-8222-222222222222';

test('apply_mode: employer form validation', () => {
  // website (default) + both need a link; Seen-only needs none
  assert.equal(validateNewListing({ title: 'Cook' }).ok, false);
  assert.equal(validateNewListing({ title: 'Cook', apply_mode: 'both' }).ok, false);
  assert.match(validateNewListing({ title: 'Cook', apply_mode: 'both' }).error, /On Seen/);
  const seen = validateNewListing({ title: 'Cook', apply_mode: 'seen' });
  assert.equal(seen.ok, true);
  assert.equal(seen.listing.apply_mode, 'seen');
  assert.equal(seen.listing.apply_url, null);
  const both = validateNewListing({ title: 'Cook', apply_mode: 'both', apply_url: 'https://acme.com/apply' });
  assert.equal(both.listing.apply_mode, 'both');
  assert.equal(both.listing.apply_url, 'https://acme.com/apply');
  // junk mode → external (today's behaviour), still needs the link
  assert.equal(validateNewListing({ title: 'Cook', apply_mode: 'evil', apply_url: 'https://a.com' }).listing.apply_mode, 'external');
  assert.equal(normalizeApplyMode(undefined), 'external');
});

test('apply_mode: the jobs row only carries apply_mode when it is not the default', () => {
  const opts = { uid: 'u', company: 'Acme', companyKey: 'acme', nowISO: 'n', expiresISO: 'e' };
  // External rows must insert cleanly BEFORE the migration (no apply_mode column yet).
  assert.equal('apply_mode' in buildEmployerListingRow(validateNewListing({ title: 'Cook', apply_url: 'https://a.com' }).listing, opts), false);
  assert.equal(buildEmployerListingRow(validateNewListing({ title: 'Cook', apply_mode: 'seen' }).listing, opts).apply_mode, 'seen');
  assert.equal(annotateListings([{ id: 'j', is_employer_posted: true, apply_mode: 'both' }])[0].apply_mode, 'both');
  assert.equal(annotateListings([{ id: 'j' }])[0].apply_mode, 'external');
});

test('only employer-posted listings can take Seen applications', () => {
  assert.equal(effectiveApplyMode({ apply_mode: 'seen' }), 'external'); // aggregated listing
  assert.equal(allowsSeenApply({ is_employer_posted: true, apply_mode: 'seen' }), true);
  assert.equal(allowsSeenApply({ employer_posted: true, apply_mode: 'both' }), true);
  assert.equal(allowsSeenApply({ is_employer_posted: true, apply_mode: 'external' }), false);
  assert.equal(allowsExternalApply({ is_employer_posted: true, apply_mode: 'seen', apply_url: 'https://a.com' }), false);
  assert.equal(allowsExternalApply({ is_employer_posted: true, apply_mode: 'both', apply_url: 'https://a.com' }), true);
  assert.equal(allowsExternalApply({ apply_url: 'https://a.com' }), true);
});

test('isNotMigrated recognises missing column / table errors', () => {
  assert.equal(isNotMigrated(400, '{"code":"42703","message":"column jobs.apply_mode does not exist"}'), true);
  assert.equal(isNotMigrated(400, '{"code":"PGRST204","message":"Could not find the \'apply_mode\' column of \'jobs\' in the schema cache"}'), true);
  assert.equal(isNotMigrated(404, '{"code":"42P01","message":"relation \\"public.seen_applications\\" does not exist"}'), true);
  assert.equal(isNotMigrated(400, '{"code":"23502","message":"null value in column \\"title\\""}'), false);
});

test('applicant form validation', () => {
  const ok = validateSeenApplication({ job_id: JOB_ID, name: '  Ada  Lovelace ', email: 'ada@example.com', resume_source: 'saved', consent: true, note: '  Hi  ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.application.name, 'Ada Lovelace');
  assert.equal(ok.application.note, 'Hi');
  assert.equal(validateSeenApplication({ job_id: 'nope', name: 'Ada', email: 'a@b.co', resume_source: 'saved', consent: true }).ok, false);
  assert.equal(validateSeenApplication({ job_id: JOB_ID, name: 'Ada', email: 'bad', resume_source: 'saved', consent: true }).ok, false);
  assert.equal(validateSeenApplication({ job_id: JOB_ID, name: 'Ada', email: 'a@b.co', resume_source: 'saved' }).ok, false); // no consent
  assert.equal(validateSeenApplication({ job_id: JOB_ID, name: 'Ada', email: 'a@b.co', resume_source: 'upload', consent: true }).ok, false); // no file
  assert.equal(validateSeenApplication({ job_id: JOB_ID, name: 'Ada', email: 'a@b.co', resume_source: 'saved', consent: true, phone: 'call me' }).ok, false);
  assert.equal(base64Bytes(Buffer.from('hello world').toString('base64')), 11);
  assert.equal(base64Bytes('data:application/pdf;base64,' + Buffer.from('abcd').toString('base64')), 4);
  // storage path is never built from user input beyond the extension
  assert.deepEqual(resumeObject({ applicantId: 'u1', jobId: JOB_ID, fileName: '../../etc/passwd.PDF', nowMs: 5 }), { path: `u1/${JOB_ID}-5.pdf`, mime: 'application/pdf' });
  assert.equal(resumeObject({ applicantId: 'u1', jobId: JOB_ID, fileName: 'cv.docx', nowMs: 5 }).path, `u1/${JOB_ID}-5.docx`);
});

test('tracker row matches the applications table shape', () => {
  const row = buildTrackerRow({ job: { id: JOB_ID, company: 'Seen Jobs', title: 'Software Engineer', location: 'Remote' }, applicantId: 'u1', nowMs: Date.UTC(2026, 9, 17) });
  assert.equal(row.platform, 'Seen');
  assert.equal(row.stage, 'Applied');
  assert.equal(row.status, 'active');
  assert.equal(row.job_id, JOB_ID);
  assert.equal(row.events[0].type, 'application_submitted');
  const app = buildSeenApplicationRow({ job_id: JOB_ID, name: 'Ada', email: 'a@b.co', phone: null, note: null }, { job: { company: 'Seen Jobs', title: 'SE', employer_user_id: 'emp' }, applicantId: 'u1', companyKey: 'seen jobs', resumeText: 'x'.repeat(70000) });
  assert.equal(app.resume_text.length, 60000);
  assert.equal(app.status, 'new');
  assert.equal(isDuplicate(409, ''), true);
  assert.equal(isDuplicate(400, 'duplicate key value violates unique constraint "seen_applications_one_per_applicant"'), true);
  assert.equal(inboxItem({ id: 'a', status: 'weird', resume_path: 'p' }).status, 'new');
});

// ── endpoints with fetch mocked ────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
function env() {
  process.env.SUPABASE_URL = 'https://db.example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key-for-test';
  delete process.env.SUPABASE_JWT_SECRET;
  delete process.env.RESEND_KEY; delete process.env.RESEND_API_KEY;
  _resetSeenApplyAvailability();
}
const json = (b, status = 200) => new Response(JSON.stringify(b), { status });

test('not migrated: inbox says unavailable, a Seen-only listing is refused, the list never selects apply_mode', async (t) => {
  env();
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url); urls.push(u);
    if (u.endsWith('/auth/v1/user')) return json({ id: 'emp-1' });
    if (u.includes('/rest/v1/employer_company_claims')) return json([{ company_name: 'acme' }]);
    if (u.includes('/rest/v1/seen_applications')) return json({ code: '42P01', message: 'relation "public.seen_applications" does not exist' }, 404);
    if (u.includes('select=apply_mode')) return json({ code: '42703', message: 'column jobs.apply_mode does not exist' }, 400);
    return json([]);
  });
  const { default: handler } = await import('../../api/employer-listings.js');

  const inbox = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'applications' } }, inbox);
  assert.equal(inbox.statusCode, 200);
  assert.equal(inbox.body.available, false);

  const create = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'create', title: 'Cook', apply_mode: 'seen' } }, create);
  assert.equal(create.statusCode, 400);
  assert.equal(create.body.reason, 'seen_apply_unavailable');

  const list = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'list' } }, list);
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.seen_apply_available, false);
  const jobsList = urls.find((u) => u.includes('/rest/v1/jobs?company=ilike'));
  assert.ok(jobsList && !jobsList.includes('apply_mode'), 'list must not select apply_mode before the migration');

  // Applicant side degrades too: status → available:false, submit → 400 unavailable.
  const { default: apply } = await import('../../api/apply.js');
  const st = mockRes();
  await apply({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'seen_apply_status', job_id: JOB_ID } }, st);
  assert.equal(st.statusCode, 200);
  assert.equal(st.body.available, false);
  const sub = mockRes();
  await apply({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'seen_apply', job_id: JOB_ID, name: 'Ada', email: 'a@b.co', resume_source: 'saved', consent: true } }, sub);
  assert.equal(sub.statusCode, 400);
  assert.equal(sub.body.reason, 'unavailable');
});

test('inbox ownership: every read/write is filtered to the caller’s company_key', async (t) => {
  env();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const u = String(url); calls.push({ u, method: opts.method || 'GET' });
    if (u.endsWith('/auth/v1/user')) return json({ id: 'emp-1' });
    if (u.includes('/rest/v1/employer_company_claims')) return json([{ company_name: 'acme', company_display_name: 'Acme' }]);
    if (u.includes('/rest/v1/seen_applications') && (opts.method || 'GET') === 'PATCH') return json([]); // 0 rows: not ours
    if (u.includes('/rest/v1/seen_applications')) return json([]);
    if (u.includes('select=apply_mode')) return json([]);
    return json([]);
  });
  const { default: handler } = await import('../../api/employer-listings.js');

  const inbox = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'applications', job_id: JOB_ID } }, inbox);
  assert.equal(inbox.statusCode, 200);
  assert.equal(inbox.body.available, true);
  const read = calls.find((c) => c.u.includes('/rest/v1/seen_applications?company_key='));
  assert.ok(read, 'inbox read must be company-scoped');
  assert.match(read.u, /company_key=eq\.acme&job_id=eq\./);

  const patch = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'application_status', id: APP_ID, status: 'interviewing' } }, patch);
  assert.equal(patch.statusCode, 404); // another company's application matches 0 rows
  // It is refused at the company-scoped read, before anything is written.
  assert.ok(calls.some((c) => c.method === 'GET' && c.u.includes(`seen_applications?id=eq.${APP_ID}&company_key=eq.acme`)));
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);

  const badStatus = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'application_status', id: APP_ID, status: 'ghosted' } }, badStatus);
  assert.equal(badStatus.statusCode, 400);

  const resume = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'application_resume', id: APP_ID } }, resume);
  assert.equal(resume.statusCode, 404);
  assert.ok(calls.some((c) => c.u.includes(`seen_applications?id=eq.${APP_ID}&company_key=eq.acme`)));
});

test('seen_apply: duplicate apply → friendly 409; external-only listing refused; success writes app + tracker + notification', async (t) => {
  env();
  let existing = [];
  let insertStatus = 201;
  const writes = [];
  const JOB = { id: JOB_ID, title: 'Software Engineer', company: 'Seen Jobs', location: 'Remote', apply_url: null, is_employer_posted: true, employer_user_id: 'emp-1', apply_mode: 'seen', expires_at: '2099-01-01T00:00:00Z', availability_status: 'active' };
  let job = JOB;
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const u = String(url); const m = opts.method || 'GET';
    if (u.endsWith('/auth/v1/user')) return json({ id: 'seeker-1' });
    if (u.includes('/auth/v1/admin/users/')) return json({ email: 'boss@seenjobs.io' });
    if (u.includes('/rest/v1/rpc/')) return json(1); // rate limiter
    if (u.includes('/rest/v1/seen_applications?select=id&limit=1')) return json([]); // availability probe
    if (u.includes('/rest/v1/jobs?select=apply_mode')) return json([]);
    if (u.includes('/rest/v1/jobs?id=eq.')) return json([job]);
    if (u.includes('/rest/v1/profiles')) return json([{ resume_text: 'Ada Lovelace — engineer. '.repeat(10), resume_file_name: 'ada.pdf' }]);
    if (u.includes('/rest/v1/seen_applications?job_id=')) return json(existing);
    if (u.endsWith('/rest/v1/seen_applications') && m === 'POST') { writes.push('seen_applications'); return insertStatus === 409 ? json({ code: '23505' }, 409) : json([{ id: APP_ID }], 201); }
    if (u.includes('/rest/v1/applications?user_id=')) return json([]);
    if (u.endsWith('/rest/v1/applications') && m === 'POST') { writes.push('applications'); return new Response(null, { status: 201 }); }
    if (u.endsWith('/rest/v1/employer_notifications') && m === 'POST') { writes.push('employer_notifications'); return new Response(null, { status: 201 }); }
    return json([]);
  });
  const { default: apply } = await import('../../api/apply.js');
  const body = { action: 'seen_apply', job_id: JOB_ID, name: 'Ada Lovelace', email: 'ada@example.com', resume_source: 'saved', consent: true };

  const ok = mockRes();
  await apply({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, ok);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.application_id, APP_ID);
  assert.deepEqual(writes, ['seen_applications', 'applications', 'employer_notifications']);

  existing = [{ id: APP_ID }];
  const dup = mockRes();
  await apply({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, dup);
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.body.reason, 'already_applied');

  existing = []; insertStatus = 409; // race: the unique index catches it
  const race = mockRes();
  await apply({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, race);
  assert.equal(race.statusCode, 409);
  assert.equal(race.body.reason, 'already_applied');

  job = { ...JOB, apply_mode: 'external', apply_url: 'https://acme.com' };
  const ext = mockRes();
  await apply({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, ext);
  assert.equal(ext.statusCode, 400);
  assert.equal(ext.body.reason, 'external_only');

  const anon = mockRes();
  await apply({ method: 'POST', headers: {}, body }, anon);
  assert.equal(anon.statusCode, 401);
});

// ── Employer status → applicant tracker (owner request 2026-10-18) ──
import { trackerUpdateForEmployerStatus, EMPLOYER_STATUS_TRACKER } from './seenApply.js';

test('employer status moves the applicant tracker forward with an employer-sourced event', () => {
  const now = Date.UTC(2026, 9, 18);
  const applied = { status: 'active', stage: 'Applied', events: [{ type: 'application_submitted', source: 'seen_apply' }] };
  const iv = trackerUpdateForEmployerStatus(applied, 'interviewing', now);
  assert.equal(iv.stage, 'Interview');
  assert.equal(iv.status, 'active');
  assert.equal(iv.employer_stage, 'Interviewing');
  assert.equal(iv.events.at(-1).type, 'interview_received');
  assert.equal(iv.events.at(-1).source, 'employer');
  assert.equal(iv.events.length, 2); // keeps the applicant's own history

  const hired = trackerUpdateForEmployerStatus({ ...applied, stage: 'Interview' }, 'hired', now);
  assert.equal(hired.status, 'hired');
  assert.equal(hired.stage, 'Offer');
  assert.equal(hired.events.at(-1).type, 'offer_received');

  const rej = trackerUpdateForEmployerStatus(applied, 'rejected', now);
  assert.equal(rej.status, 'rejected');
  assert.equal(rej.stage, 'Rejected');
  assert.equal(rej.employer_stage, 'Not selected');
});

test('never moves the applicant backwards, never duplicates, and "new" changes nothing', () => {
  const now = Date.UTC(2026, 9, 18);
  const atInterview = { status: 'active', stage: 'Interview', events: [] };
  const viewed = trackerUpdateForEmployerStatus(atInterview, 'reviewed', now);
  assert.equal(viewed.stage, undefined);          // stays at Interview
  assert.equal(viewed.employer_stage, 'Reviewed'); // badge still shows the employer's status
  assert.equal(viewed.events.at(-1).type, 'application_viewed');

  const twice = trackerUpdateForEmployerStatus({ status: 'active', stage: 'Interview', events: [{ type: 'interview_received', source: 'employer' }] }, 'interviewing', now);
  assert.equal(twice.events, undefined);           // no second copy of the same employer event

  assert.equal(trackerUpdateForEmployerStatus(atInterview, 'new', now), null);
  assert.equal(trackerUpdateForEmployerStatus(null, 'hired', now), null);
  assert.equal(EMPLOYER_STATUS_TRACKER.reviewed.email, false); // only decisions email the applicant
});
