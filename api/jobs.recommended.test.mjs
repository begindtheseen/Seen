// The /jobs "Matched to your résumé" rail reads the CANONICAL résumé (profiles.resume_text) and
// self-heals the derived resume_skills cache. Contract: a signed-in user with a résumé on file is
// never told to upload one (has_resume says which case it is), and the rail still serves when the
// cache row is missing, stale, or the résumé has no dictionary skills.
// Match bar (live audit 2026-10-23): a listing must share a title FAMILY with a résumé role AND
// be near the profile city (or remote); without a city the rail says so (reason 'no_city').
// Run: node --test api/jobs.recommended.test.mjs
import { test } from 'node:test';
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
const NOW = new Date(Date.now() + 86_400_000).toISOString();
const jobRow = (i) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, title: `Valet Attendant ${i}`, company: `Hotel ${i}`, location: 'Temecula, CA', salary: null, apply_url: `https://example.com/${i}`, description: 'valet parking, customer service', type: 'Full-time', level: 'Entry level', source: 'Seen', score: 60, waste_score: 20, expires_at: NOW, lat: null, lng: null });

const state = { resumeText: RESUME, resumeUpdatedAt: '2026-10-19T00:00:00Z', city: 'Temecula, CA', skillsRow: null, profileOk: true, jobsRows: [jobRow(1), jobRow(2), jobRow(3)] };
let calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();
  calls.push({ u, method, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/auth/v1/user')) return json({ id: UID });
  if (/adzuna|greenhouse|lever|ashby/i.test(u)) return json({ results: [] });
  if (u.includes('/rest/v1/resume_skills')) {
    if (method === 'POST') return new Response('', { status: 201 });
    return json(state.skillsRow ? [state.skillsRow] : []);
  }
  if (u.includes('/rest/v1/profiles')) {
    if (!state.profileOk) return json({ message: 'boom' }, 500);
    return json([{ resume_text: state.resumeText, resume_updated_at: state.resumeUpdatedAt, city: state.city }]);
  }
  if (u.includes('/rest/v1/jobs')) return json(state.jobsRows);
  // geocode_cache: Phoenix only (Temecula stays un-geocoded → the rail falls back to city text)
  if (u.includes('geocode_cache')) return json(/phoenix/i.test(decodeURIComponent(u)) ? [{ lat: 33.4484, lng: -112.074 }] : []);
  return json([]);
};
const { default: handler } = await import('./jobs.js');

function call() {
  calls = [];
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body: { action: 'recommended' }, headers: { authorization: 'Bearer token-1', 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 200)}.1` }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}
const healPosts = () => calls.filter((c) => c.method === 'POST' && c.u.includes('/rest/v1/resume_skills'));
const jobReads = () => calls.filter((c) => c.u.includes('/rest/v1/jobs'));

test('résumé on file but no resume_skills row → derives the signal now, serves the rail, heals the cache', async () => {
  const res = await call();
  assert.equal(res.code, 200);
  assert.equal(res.body.has_resume, true);
  assert.equal(res.body.reason, null);
  assert.equal(res.body.city, 'Temecula, CA');
  assert.equal(res.body.jobs.length, 3);
  const heal = healPosts();
  assert.equal(heal.length, 1, 'one upsert of the derived row');
  assert.equal(heal[0].body.user_id, UID);
  assert.ok(heal[0].body.top_titles.some((t) => /valet attendant/i.test(t)), JSON.stringify(heal[0].body));
  assert.ok(Array.isArray(heal[0].body.skills));
  assert.ok(jobReads().some((c) => /title=ilike\.\*valet/i.test(c.u)), 'queried listings by the résumé\'s real role');
  assert.ok(jobReads().some((c) => /location=ilike\.\*temecula\*/i.test(c.u)), 'the local reads are scoped to the profile city');
});

test('no résumé on the account → has_resume:false, no_resume, and no listing queries at all', async () => {
  state.resumeText = '';
  try {
    const res = await call();
    assert.equal(res.code, 200);
    assert.equal(res.body.has_resume, false);
    assert.equal(res.body.reason, 'no_resume');
    assert.deepEqual(res.body.jobs, []);
    assert.equal(jobReads().length, 0);
    assert.equal(healPosts().length, 0);
  } finally { state.resumeText = RESUME; }
});

test('résumé on file but nothing matches → has_resume:true with reason no_matches (never "upload")', async () => {
  state.jobsRows = [];
  try {
    const res = await call();
    assert.equal(res.body.has_resume, true);
    assert.equal(res.body.reason, 'no_matches');
    assert.deepEqual(res.body.jobs, []);
  } finally { state.jobsRows = [jobRow(1), jobRow(2), jobRow(3)]; }
});

test('a fresh cache row is used as is; a row older than the résumé is re-derived', async () => {
  state.skillsRow = { skills: ['customer service'], seniority: 'junior', function: 'ops', years_exp: 2, top_titles: ['Valet Attendant'], updated_at: '2026-10-20T00:00:00Z' };
  try {
    let res = await call();
    assert.equal(res.body.has_resume, true);
    assert.equal(res.body.jobs.length, 3);
    assert.equal(healPosts().length, 0, 'fresh row: no re-derive');
    state.skillsRow = { ...state.skillsRow, updated_at: '2026-01-01T00:00:00Z' };
    res = await call();
    assert.equal(res.body.jobs.length, 3);
    assert.equal(healPosts().length, 1, 'stale row: re-derived and healed');
  } finally { state.skillsRow = null; }
});

test('profile read fails → never claims "no résumé": has_resume:null; with no known city the rail asks for one', async () => {
  state.profileOk = false;
  try {
    let res = await call();
    assert.equal(res.body.has_resume, null);
    assert.equal(res.body.reason, 'unavailable');
    assert.deepEqual(res.body.jobs, []);
    state.skillsRow = { skills: ['customer service'], top_titles: ['Valet Attendant'], updated_at: '2026-10-20T00:00:00Z' };
    res = await call();
    assert.equal(res.body.has_resume, null);
    // The city lives on the profile; without it we never show far-away jobs as "matches".
    assert.equal(res.body.reason, 'no_city');
    assert.deepEqual(res.body.jobs, []);
    assert.equal(jobReads().length, 0);
    assert.equal(healPosts().length, 0);
  } finally { state.profileOk = true; state.skillsRow = null; }
});

// ── The audit case: a Phoenix sales-associate résumé must NOT get a Dallas hotel AE ─────────────
const GNC_RESUME = `Jordan Avery
jordan.avery@example.com | 602-555-0100 | Phoenix, AZ

EXPERIENCE
Sales Associate — GNC | Mar 2024 – Present
• Recommended supplements and closed add-on sales at the register.

Membership Specialist — UFC Gym | 2022 – 2024
• Sold and renewed gym memberships.

Valet Attendant — Towne Park | 2021 – 2022
• Parked and retrieved guest vehicles.`;
const WRONG_SALES = [
  { id: '20000000-0000-0000-0000-000000000001', title: 'Account Executive (Independent Hotel Sales)', company: 'lighthouse', location: 'Dallas-Fort Worth Metroplex', apply_url: 'https://example.com/ae', description: 'sell to independent hotels', type: 'Full-time', source: 'Greenhouse', score: 94, waste_score: 10, expires_at: NOW, lat: 32.78, lng: -96.8 },
  { id: '20000000-0000-0000-0000-000000000002', title: 'Commercial Sales Manager', company: 'SpaceX', location: 'Hawthorne, CA', apply_url: 'https://example.com/spacex', description: 'commercial sales of launch services', type: 'Full-time', source: 'Greenhouse', score: 90, waste_score: 12, expires_at: NOW, lat: 33.92, lng: -118.33 },
];

test('sales-associate résumé in Phoenix vs a hotel AE in Dallas + a SpaceX sales manager → empty rail (no_matches)', async () => {
  state.resumeText = GNC_RESUME; state.city = 'Phoenix, AZ'; state.jobsRows = WRONG_SALES;
  try {
    const res = await call();
    assert.equal(res.code, 200);
    assert.equal(res.body.has_resume, true);
    assert.deepEqual(res.body.jobs, [], JSON.stringify(res.body.jobs.map((j) => j.title)));
    assert.equal(res.body.reason, 'no_matches');
    assert.ok(!jobReads().some((c) => /title=ilike\.\*sales\*/i.test(c.u)), 'the bare skill word "sales" is never a title query');
  } finally { state.resumeText = RESUME; state.city = 'Temecula, CA'; state.jobsRows = [jobRow(1), jobRow(2), jobRow(3)]; }
});

const CASHIER_RESUME = `Sam Rivera
sam@example.com | 602-555-0101

EXPERIENCE
Cashier — Target | Jun 2023 – Present
• Rang up purchases and handled returns at a busy front end.

Crew Member — Chipotle | 2022 – 2023
• Prepared orders and ran the register.`;
const CASHIER_ROWS = [
  { id: '30000000-0000-0000-0000-000000000001', title: 'Cosmetics Cashier', company: 'Walmart', location: 'Phoenix, Maricopa County', apply_url: 'https://example.com/w1', description: 'cashier', type: 'Part-time', source: 'Adzuna', score: 55, waste_score: 30, expires_at: NOW, lat: 33.45, lng: -112.07 },
  { id: '30000000-0000-0000-0000-000000000002', title: 'Cosmetics Cashier', company: 'Walmart', location: 'Glendale, Maricopa County', apply_url: 'https://example.com/w2', description: 'cashier', type: 'Part-time', source: 'Adzuna', score: 55, waste_score: 30, expires_at: NOW, lat: 33.54, lng: -112.19 },
  { id: '30000000-0000-0000-0000-000000000003', title: 'Cashier', company: 'Fry\'s', location: 'Phoenix, AZ', apply_url: 'https://example.com/f1', description: 'cashier', type: 'Part-time', source: 'Greenhouse', score: 50, waste_score: 35, expires_at: NOW, lat: null, lng: null },
  { id: '30000000-0000-0000-0000-000000000004', title: 'Cashier', company: 'HEB', location: 'Austin, TX', apply_url: 'https://example.com/heb', description: 'cashier', type: 'Part-time', source: 'Adzuna', score: 80, waste_score: 10, expires_at: NOW, lat: 30.27, lng: -97.74 },
  { id: '30000000-0000-0000-0000-000000000005', title: 'Director of Retail Operations', company: 'BigBox', location: 'Phoenix, AZ', apply_url: 'https://example.com/dir', description: 'lead stores', type: 'Full-time', source: 'Adzuna', score: 85, waste_score: 10, expires_at: NOW, lat: 33.45, lng: -112.07 },
];

test('cashier résumé in Phoenix vs Walmart cashier rows in Phoenix/Glendale → those rows, never the Austin one', async () => {
  state.resumeText = CASHIER_RESUME; state.city = 'Phoenix, AZ'; state.jobsRows = CASHIER_ROWS;
  try {
    const res = await call();
    assert.equal(res.code, 200);
    assert.equal(res.body.reason, null);
    assert.equal(res.body.city, 'Phoenix, AZ');
    const got = res.body.jobs.map((j) => `${j.title} @ ${j.location}`);
    assert.ok(got.includes('Cosmetics Cashier @ Phoenix, Maricopa County'), got.join(' | '));
    assert.ok(got.includes('Cosmetics Cashier @ Glendale, Maricopa County'), 'Glendale is within the rail radius of Phoenix');
    assert.ok(got.includes('Cashier @ Phoenix, AZ'), 'a coordinate-less row whose text says Phoenix counts');
    assert.ok(!got.some((g) => /Austin/.test(g)), 'the Austin cashier is far away');
    assert.ok(res.body.jobs.length >= 3, 'enough for the page to show the rail');
    assert.ok(res.body.jobs.every((j) => j.level !== 'Mid level'));
  } finally { state.resumeText = RESUME; state.city = 'Temecula, CA'; state.jobsRows = [jobRow(1), jobRow(2), jobRow(3)]; }
});

test('no city on the profile → reason no_city, no listing reads, nothing far away offered', async () => {
  state.city = '';
  try {
    const res = await call();
    assert.equal(res.code, 200);
    assert.equal(res.body.has_resume, true);
    assert.equal(res.body.reason, 'no_city');
    assert.deepEqual(res.body.jobs, []);
    assert.equal(jobReads().length, 0);
  } finally { state.city = 'Temecula, CA'; }
});


test('no profile city but the résumé states one → the rail uses the résumé\'s city (city_source: resume)', async () => {
  const saved = { ...state };
  state.city = '';
  state.skillsRow = null;
  state.resumeText = `Jordan Avery
Phoenix, AZ 85004 · (602) 555-0148 · jordan.avery.jobs@gmail.com · linkedin.com/in/jordanavery

SUMMARY
Customer-focused retail and front-desk professional with 5+ years of experience.

EXPERIENCE
Sales Associate — GNC | 2021 – Present
• Sold supplements and built repeat business with regulars.

Valet Attendant — Towne Park | Oct 2019 – Jan 2021
• Parked and retrieved vehicles for hotel guests.`;
  state.jobsRows = [{ ...jobRow(7), title: 'Seasonal Sales Associate (Part-Time) - Biltmore Fashion Park', company: 'aloyoga', location: 'Phoenix, Arizona, United States', lat: 33.51, lng: -112.03 }];
  try {
    const res = await call();
    assert.equal(res.code, 200);
    assert.notEqual(res.body.reason, 'no_city', JSON.stringify(res.body));
    assert.equal(res.body.city, 'Phoenix, AZ');
    assert.equal(res.body.city_source, 'resume');
    assert.equal(res.body.jobs.length, 1, 'one Phoenix sales associate match is a match');
    assert.ok(jobReads().some((c) => /phoenix/i.test(decodeURIComponent(c.u))), 'the local reads are scoped to the résumé city');
  } finally { Object.assign(state, saved); }
});

test('no city anywhere → still an honest no_city', async () => {
  const saved = { ...state };
  state.city = '';
  state.skillsRow = null;
  try {
    const res = await call();
    assert.equal(res.body.reason, 'no_city');
    assert.equal(res.body.has_resume, true);
  } finally { Object.assign(state, saved); }
});
