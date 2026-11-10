// The /jobs "Matched to your résumé" rail (api/jobs.js handleRecommended → lib/server/resumeMatches.js on the
// person's job keys, lib/server/jobKeys.js). Contract:
//   · a signed-in user with a résumé on file is never told to upload one (has_resume says which case it is);
//   · every job carries match_reason, a sentence built from their résumé or applications;
//   · the keys are rebuilt (and written to profiles.job_keys when the column exists) whenever they are missing,
//     old, or built from a different résumé; before the migration the same matches are served from memory;
//   · nothing is padded: zero matches is reason 'no_matches'; a far-away or different-field listing never shows.
// Run: node --test api/jobs.recommended.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.ADZUNA_APP_ID = 'id';
process.env.ADZUNA_APP_KEY = 'key';
delete process.env.SUPABASE_JWT_SECRET; // auth resolves through the (stubbed) Supabase auth API

const UID = '00000000-0000-0000-0000-0000000000aa';
const RESUME = `Jordan Lee
jordan@example.com | 555-010-0000

EXPERIENCE
Valet Attendant — Towne Park | Oct 2022 – Jan 2025
• Safely parked and retrieved high volumes of vehicles for hotel guests.
• Provided front-line customer service in a fast-paced environment.

Membership Specialist — UFC Gym | 2021 – 2022
• Sold and renewed memberships through consultative conversations.

EDUCATION
High School Diploma — Great Oak High School`;
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const FULL = `${'Park and retrieve guest vehicles at a busy hotel entrance and keep the line moving. '.repeat(10)}\nRequirements\n• Valid driver license. Store and retail guests welcome.`;
const jobRow = (i, extra = {}) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, title: `Valet Attendant ${i}`, company: `Hotel ${i}`, location: 'Temecula, CA', salary: null, apply_url: `https://example.com/${i}`, description: FULL, type: 'Full-time', level: 'Entry level', source: 'Seen', score: 60, waste_score: 20, expires_at: FUTURE, lat: null, lng: null, created_at: new Date().toISOString(), availability_status: 'active', ...extra });

let state;
const fresh = () => ({ resumeText: RESUME, city: 'Temecula, CA', profileOk: true, column: true, storedKeys: null, apps: [], jobsRows: [jobRow(1), jobRow(2), jobRow(3)] });
beforeEach(async () => { state = fresh(); (await import('../lib/server/jobKeys.js'))._resetJobKeysProbe(); });

let calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();
  calls.push({ u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/auth/v1/user')) return json({ id: UID });
  if (/adzuna|greenhouse|lever|ashby/i.test(u)) return json({ results: [] });
  if (u.includes('/rest/v1/profiles')) {
    if (method === 'PATCH') { state.storedKeys = JSON.parse(opts.body).job_keys; return new Response('', { status: 204 }); }
    if (u.includes('select=job_keys&limit=1')) return state.column ? json([{ job_keys: null }]) : json({ code: '42703', message: 'column profiles.job_keys does not exist' }, 400);
    if (!state.profileOk) return json({ message: 'boom' }, 500);
    return json([{ resume_text: state.resumeText, resume_updated_at: '2026-10-19T00:00:00Z', city: state.city, ...(state.column ? { job_keys: state.storedKeys } : {}) }]);
  }
  if (u.includes('/rest/v1/applications') || u.includes('/rest/v1/seen_applications')) return json(u.includes('seen_applications') ? [] : state.apps);
  if (u.includes('/rest/v1/jobs')) {
    const t = decodeURIComponent((u.match(/title=ilike\.\*([^&*]+)\*/) || [])[1] || '').toLowerCase();
    return json(state.jobsRows.filter((j) => j.title.toLowerCase().includes(t)));
  }
  if (u.includes('geocode_cache')) return json([]);
  return json([]);
};
const { default: handler } = await import('./jobs.js');

function call() {
  calls = [];
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body: { action: 'recommended' }, headers: { authorization: 'Bearer token-1', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 200)}.1` }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}
const keyWrites = () => calls.filter((c) => c.method === 'PATCH' && c.u.includes('/rest/v1/profiles'));
const jobReads = () => calls.filter((c) => c.u.includes('/rest/v1/jobs'));

test('résumé on file, no keys yet → builds them, writes profiles.job_keys, serves the rail with a reason per job', async () => {
  const res = await call();
  assert.equal(res.code, 200);
  assert.equal(res.body.has_resume, true);
  assert.equal(res.body.reason, null, JSON.stringify(res.body));
  assert.equal(res.body.city, 'Temecula, CA');
  assert.equal(res.body.jobs.length, 3);
  for (const j of res.body.jobs) assert.equal(j.match_reason, 'You were a Valet Attendant at Towne Park (2022–2025).');
  const w = keyWrites();
  assert.equal(w.length, 1, 'one write of the rebuilt keys');
  assert.ok(w[0].body.job_keys.occupations.some((o) => o.occupation === 'valet'));
  assert.ok(w[0].body.job_keys_updated_at);
  assert.ok(jobReads().some((c) => /title\.ilike\.\*valet/i.test(decodeURIComponent(c.u))), 'listings read by the résumé\'s real field');
  assert.ok(jobReads().some((c) => /temecula/i.test(decodeURIComponent(c.u))), 'the local reads are scoped to the profile city');
  assert.ok(!calls.some((c) => c.u.includes('resume_skills')), 'the old cache (missing in prod) is never read');
});

test('fresh stored keys are used as they are; keys built from a different résumé are rebuilt', async () => {
  await call();
  assert.equal(keyWrites().length, 1);
  let res = await call();
  assert.equal(res.body.jobs.length, 3);
  assert.equal(keyWrites().length, 0, 'same résumé, same applications: no rewrite');
  state.resumeText = RESUME.replace('Valet Attendant — Towne Park', 'Parking Attendant — Towne Park');
  res = await call();
  assert.equal(keyWrites().length, 1, 'a changed résumé rewrites the keys');
});

test('before the migration (no job_keys column) → the same matches from memory, nothing written', async () => {
  state.column = false;
  const res = await call();
  assert.equal(res.body.jobs.length, 3);
  assert.equal(keyWrites().length, 0);
});

test('no résumé on the account → has_resume:false, no_resume, no listing reads, stored keys cleared', async () => {
  state.resumeText = '';
  state.storedKeys = { v: 1 };
  const res = await call();
  assert.equal(res.body.has_resume, false);
  assert.equal(res.body.reason, 'no_resume');
  assert.deepEqual(res.body.jobs, []);
  assert.equal(jobReads().length, 0);
  assert.equal(keyWrites().length, 1);
  assert.equal(keyWrites()[0].body.job_keys, null);
});

test('résumé on file but nothing matches → no_matches (never "upload", never padded)', async () => {
  state.jobsRows = [];
  const res = await call();
  assert.equal(res.body.has_resume, true);
  assert.equal(res.body.reason, 'no_matches');
  assert.deepEqual(res.body.jobs, []);
});

test('profile read fails → never claims "no résumé": has_resume:null, reason unavailable, no listing reads', async () => {
  state.profileOk = false;
  const res = await call();
  assert.equal(res.body.has_resume, null);
  assert.equal(res.body.reason, 'unavailable');
  assert.equal(jobReads().length, 0);
});

test('the owner\'s case: an "Account Manager" at a security company never reaches a résumé with no security work', async () => {
  state.city = 'Norwalk, CA';
  state.resumeText = `Jamie Rivera
Norwalk, CA | jamie@example.com

EXPERIENCE
Account Manager — Skymark Solutions | Jan 2025 – Jul 2025
• Managed 40 small-business accounts and renewals.

Operations Manager — Practical Magicka | Apr 2018 – Dec 2023
• Led a team of 6; ran scheduling, purchasing and vendor management.`;
  state.jobsRows = [jobRow(4, { title: 'Account Manager (LA Metro)', company: 'GSG Protective Services', location: 'Culver City, Los Angeles County', lat: 33.995, lng: -118.4,
    description: 'Overview About Us – GSG Protective Services GSG Protective Services is a trusted security provider with a strong presence across the Southwest and Northeast United States. We offer high-quality, full-service security solutions with a commitment to safety, professionalism, and reliability. Our services include physical security, protective services, consulting, technology integration, and specialized training. Led by a seasoned leadership team with decades of experience, we stand by our core val…' })];
  const res = await call();
  assert.deepEqual(res.body.jobs, [], JSON.stringify(res.body.jobs));
  assert.equal(res.body.reason, 'no_matches');
});

const GNC_RESUME = `Jordan Avery
jordan.avery@example.com | 602-555-0100 | Phoenix, AZ

EXPERIENCE
Sales Associate — GNC | Mar 2024 – Present
• Recommended supplements and closed add-on sales at the register.

Membership Specialist — UFC Gym | 2022 – 2024
• Sold and renewed gym memberships.

Valet Attendant — Towne Park | 2021 – 2022
• Parked and retrieved guest vehicles.`;

test('sales-associate résumé in Phoenix vs a hotel AE in Dallas + a SpaceX sales manager → empty rail', async () => {
  state.resumeText = GNC_RESUME; state.city = 'Phoenix, AZ';
  state.jobsRows = [
    jobRow(5, { title: 'Account Executive (Independent Hotel Sales)', company: 'lighthouse', location: 'Dallas-Fort Worth Metroplex', lat: 32.78, lng: -96.8 }),
    jobRow(6, { title: 'Commercial Sales Manager', company: 'SpaceX', location: 'Hawthorne, CA', lat: 33.92, lng: -118.33 }),
  ];
  const res = await call();
  assert.deepEqual(res.body.jobs, [], JSON.stringify(res.body.jobs.map((j) => j.title)));
  assert.equal(res.body.reason, 'no_matches');
});

test('cashier résumé in Phoenix → Phoenix/Glendale cashier rows with reasons, never Austin, never a director', async () => {
  state.resumeText = `Sam Rivera
sam@example.com | 602-555-0101

EXPERIENCE
Cashier — Target | Jun 2023 – Present
• Rang up purchases and handled returns at a busy front end.

Crew Member — Chipotle | 2022 – 2023
• Prepared orders and ran the register.`;
  state.city = 'Phoenix, AZ';
  state.jobsRows = [
    jobRow(1, { title: 'Cosmetics Cashier', company: 'Walmart', location: 'Phoenix, Maricopa County', lat: 33.45, lng: -112.07 }),
    jobRow(2, { title: 'Cosmetics Cashier', company: 'Walmart', location: 'Glendale, Maricopa County', lat: 33.54, lng: -112.19 }),
    jobRow(3, { title: 'Cashier', company: "Fry's", location: 'Phoenix, AZ' }),
    jobRow(7, { title: 'Cashier', company: 'HEB', location: 'Austin, TX', lat: 30.27, lng: -97.74 }),
    jobRow(8, { title: 'Director of Retail Operations', company: 'BigBox', location: 'Phoenix, AZ', lat: 33.45, lng: -112.07 }),
  ];
  const res = await call();
  assert.equal(res.body.reason, null);
  const got = res.body.jobs.map((j) => `${j.title} @ ${j.company}`);
  assert.ok(got.includes("Cashier @ Fry's"), got.join(' | '));
  assert.ok(got.some((g) => /Cosmetics Cashier @ Walmart/.test(g)), 'one Walmart cashier (the same job in two towns is one match)');
  assert.ok(!got.some((g) => /HEB|Director/.test(g)), got.join(' | '));
  assert.ok(res.body.jobs.every((j) => /You're a Cashier at Target \(since 2023\)\./.test(j.match_reason)), JSON.stringify(res.body.jobs.map((j) => j.match_reason)));
});

test('no city on the profile and none on the résumé → no_city, no listing reads', async () => {
  state.city = '';
  const res = await call();
  assert.equal(res.body.has_resume, true);
  assert.equal(res.body.reason, 'no_city');
  assert.equal(jobReads().length, 0);
});

test('no profile city but the résumé states one → the rail uses it (city_source: resume)', async () => {
  state.city = '';
  state.resumeText = GNC_RESUME.replace('jordan.avery@example.com | 602-555-0100 | Phoenix, AZ', 'Phoenix, AZ 85004 · (602) 555-0148 · jordan.avery.jobs@gmail.com');
  state.jobsRows = [jobRow(7, { title: 'Seasonal Sales Associate (Part-Time) - Biltmore Fashion Park', company: 'aloyoga', location: 'Phoenix, Arizona, United States', lat: 33.51, lng: -112.03 })];
  const res = await call();
  assert.equal(res.body.city, 'Phoenix, AZ', JSON.stringify(res.body));
  assert.equal(res.body.city_source, 'resume');
  assert.equal(res.body.jobs.length, 1);
  assert.match(res.body.jobs[0].match_reason, /Sales Associate at GNC/);
});

test('a job the person already applied to is not offered again; an application adds its field', async () => {
  state.apps = [{ job_id: jobRow(1).id, company_name: 'Hotel 1', role: 'Valet Attendant 1', created_at: new Date().toISOString() }];
  const res = await call();
  assert.ok(!res.body.jobs.some((j) => j.id === jobRow(1).id));
  assert.equal(res.body.jobs.length, 2);
});

test('summaries: the rail shows a teaser only for a job the person holds or held at the same level, marked summary_only', async () => {
  // round 8 (director, class 2): the same title at the same level as a job held — even one that ended — may show
  // as a summary, and the reason says the full listing could not be read; a different job type on a summary never.
  state.jobsRows = [jobRow(1, { source: 'Adzuna', description: 'Hotel 1 is hiring a valet attendant to park guest cars at our downtown hotel…' }), jobRow(2, { title: 'Bellhop', source: 'Adzuna', description: 'Hotel 2 is hiring a bellhop for our downtown hotel…' })];
  let res = await call();
  assert.equal(res.body.jobs.length, 1, JSON.stringify(res.body.jobs.map((j) => j.title)));
  assert.equal(res.body.jobs[0].summary_only, true);
  assert.match(res.body.jobs[0].match_reason, /You were a Valet Attendant at Towne Park .*Seen could only read a summary of this listing\./);
  state.resumeText = RESUME.replace('Oct 2022 – Jan 2025', 'Oct 2022 – Present');
  res = await call();
  assert.equal(res.body.jobs.length, 1);
  assert.equal(res.body.jobs[0].summary_only, true);
  assert.match(res.body.jobs[0].match_reason, /You're a Valet Attendant at Towne Park/);
});

test('a current title nothing can place → no_direction with that title, no older field promoted, nothing padded', async () => {
  state.resumeText = `Sam Ortiz\nTemecula, CA\n\nEXPERIENCE\nWorld Builder III — Zentrix Labs | Mar 2025 – Present\n• Owned the quarterly zorbing roadmap across four pods.\n\nValet Attendant — Towne Park | Oct 2022 – Jan 2025\n• Safely parked and retrieved high volumes of vehicles for hotel guests.`;
  const r = await call();
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.no_direction, { title: 'World Builder III', company: 'Zentrix Labs' }, JSON.stringify(r.body));
  assert.ok(!r.body.jobs.some((j) => /valet/i.test(j.title)), 'the older valet field is not promoted');
  if (!r.body.jobs.length) assert.equal(r.body.reason, 'no_direction');
});
