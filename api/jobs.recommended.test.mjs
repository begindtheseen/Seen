// The /jobs "Matched to your résumé" rail reads the CANONICAL résumé (profiles.resume_text) and
// self-heals the derived resume_skills cache. Contract: a signed-in user with a résumé on file is
// never told to upload one (has_resume says which case it is), and the rail still serves when the
// cache row is missing, stale, or the résumé has no dictionary skills.
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
const jobRow = (i) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, title: `Valet Attendant ${i}`, company: `Hotel ${i}`, location: 'Temecula, CA', salary: null, apply_url: `https://example.com/${i}`, description: 'valet parking, customer service', type: 'Full-time', level: 'Entry level', source: 'Seen', score: 60, waste_score: 20, expires_at: NOW });

const state = { resumeText: RESUME, resumeUpdatedAt: '2026-10-19T00:00:00Z', skillsRow: null, profileOk: true, jobsRows: [jobRow(1), jobRow(2), jobRow(3)] };
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
    return json([{ resume_text: state.resumeText, resume_updated_at: state.resumeUpdatedAt }]);
  }
  if (u.includes('/rest/v1/jobs')) return json(state.jobsRows);
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
  assert.equal(res.body.jobs.length, 3);
  const heal = healPosts();
  assert.equal(heal.length, 1, 'one upsert of the derived row');
  assert.equal(heal[0].body.user_id, UID);
  assert.ok(heal[0].body.top_titles.some((t) => /valet attendant/i.test(t)), JSON.stringify(heal[0].body));
  assert.ok(Array.isArray(heal[0].body.skills));
  assert.ok(jobReads().some((c) => /title=ilike\.\*valet/i.test(c.u)), 'queried listings by the résumé\'s real role');
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

test('profile read fails → never claims "no résumé": has_resume:null, cached row still serves', async () => {
  state.profileOk = false;
  try {
    let res = await call();
    assert.equal(res.body.has_resume, null);
    assert.equal(res.body.reason, 'unavailable');
    assert.deepEqual(res.body.jobs, []);
    state.skillsRow = { skills: ['customer service'], top_titles: ['Valet Attendant'], updated_at: '2026-10-20T00:00:00Z' };
    res = await call();
    assert.equal(res.body.has_resume, null);
    assert.equal(res.body.jobs.length, 3);
    assert.equal(healPosts().length, 0);
  } finally { state.profileOk = true; state.skillsRow = null; }
});
