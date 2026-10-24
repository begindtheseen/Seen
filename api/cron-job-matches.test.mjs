// End-to-end: the job-match cron against a fake PostgREST, auth admin API and Resend.
// Run: node --test api/cron-job-matches.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.CRON_SECRET = 'cron-secret';
process.env.RESEND_KEY = 're_test';
delete process.env.JOB_MATCH_DAILY_CAP;
delete process.env.JOB_MATCH_SKIP_DOMAINS;

const UID = '00000000-0000-0000-0000-0000000000aa';
const resumeFor = (title) => `Jordan Lee
Norwalk, CA 90650 | jordan@example.com | 555-010-0000

EXPERIENCE
${title} — Target | Oct 2022 – Present
• Helped guests and ran the register in a busy store.

${title} — Ralphs | 2020 – 2022
• Kept lines short and the drawer balanced.

EDUCATION
High School Diploma — Norwalk High School`;
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const listing = (id, title, company, extra = {}) => ({ id, title, company, location: 'Norwalk, CA', salary: '$18/hr', apply_url: `https://apply.example/${id}`, description: 'register, customer service', type: 'Full-time', level: 'Entry level', source: 'Seen', score: 60, waste_score: 20, expires_at: FUTURE, lat: null, lng: null, ats_tenant: null, created_at: '2026-10-23T00:00:00Z', ...extra });

let st;
beforeEach(() => {
  st = {
    resume: resumeFor('Cashier'), resumeUpdatedAt: '2026-10-24T00:00:00Z', city: 'Norwalk, CA',
    email: 'jordan@example.com', confirmed: true,
    jobs: [listing('j1', 'Cashier', 'walmart'), listing('j2', 'Cashier - Part Time', 'target'), listing('j3', 'Warehouse Associate', 'amazon')],
    log: [], prefs: [], apps: [], saved: [], scores: [], logReadable: true, resendStatus: 200,
    sends: [], claims: [], deletes: 0,
  };
});

const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const method = (opts.method || 'GET').toUpperCase();
  const path = decodeURIComponent(u.pathname + u.search);
  if (u.hostname === 'api.resend.com') { st.sends.push(JSON.parse(opts.body)); return json({ id: 'em_1' }, st.resendStatus); }
  if (u.hostname === 'nominatim.openstreetmap.org') return json([]);
  if (u.hostname !== 'db.example') throw new Error(`unexpected host ${u.hostname}`);
  if (u.pathname.startsWith('/auth/v1/admin/users/')) return json({ id: UID, email: st.email, email_confirmed_at: st.confirmed ? '2026-10-01T00:00:00Z' : null });
  const table = u.pathname.replace('/rest/v1/', '');
  if (table === 'job_match_email_log') {
    if (!st.logReadable) return json({ message: 'relation does not exist' }, 404);
    if (method === 'POST') {
      const row = JSON.parse(opts.body);
      if (st.log.some((r) => r.user_id === row.user_id && r.job_key === row.job_key)) return json({ code: '23505' }, 409);
      st.claims.push(row); st.log.push({ ...row, sent_at: new Date().toISOString() });
      return new Response('', { status: 201 });
    }
    if (method === 'DELETE') { st.deletes++; const key = u.searchParams.get('job_key').replace(/^eq\./, ''); st.log = st.log.filter((r) => r.job_key !== key); return new Response('', { status: 204 }); }
    if (path.includes('sent_at=gte.')) return json([], 200, { 'content-range': `0-0/${st.log.length}` });
    return json([...st.log].sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)));
  }
  if (table === 'profiles') {
    if (path.includes('resume_text=not.is.null')) return json(st.resume ? [{ id: UID }] : []);
    return json([{ resume_text: st.resume, resume_updated_at: st.resumeUpdatedAt, city: st.city }]);
  }
  if (table === 'email_prefs') return json(st.prefs);
  if (table === 'applications') return json(st.apps);
  if (table === 'saved_jobs') return json(st.saved);
  if (table === 'company_scores') return json(st.scores);
  if (table === 'resume_skills') return method === 'POST' ? new Response('', { status: 201 }) : json([]);
  if (table === 'geocode_cache') return json([]);
  if (table === 'company_sources') return json([]);
  if (table === 'jobs') {
    const t = (u.searchParams.get('title') || '').replace(/^ilike\.\*|\*$/g, '').toLowerCase();
    return json(st.jobs.filter((j) => j.title.toLowerCase().includes(t)));
  }
  return json([]);
};
const { default: handler } = await import('./cron-job-matches.js');

function run({ auth = 'Bearer cron-secret', query = {}, method = 'GET', headers = {} } = {}) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
  return handler({ method, query, headers: { ...(auth ? { authorization: auth } : {}), ...headers } }, res).then(() => res);
}

test('only Vercel\'s bearer (or the secret / an admin) runs it; the spoofable header does not', async () => {
  assert.equal((await run({ auth: null })).code, 401);
  assert.equal((await run({ auth: null, headers: { 'x-vercel-cron': '1' } })).code, 401);
  assert.equal(st.sends.length, 0);
});

test('sends ONE email for the best match, with the Seen link, and claims it first', async () => {
  const res = await run();
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.sent, 1, JSON.stringify(res.body));
  assert.equal(st.sends.length, 1);
  const mail = st.sends[0];
  assert.deepEqual(mail.to, ['jordan@example.com']);
  assert.match(mail.html, /https:\/\/seenjobs\.io\/jobs\/j1\?utm_source=email/);
  assert.match(mail.subject, /^Cashier at Walmart matches your résumé$/);
  assert.match(mail.headers['List-Unsubscribe'], /list=job_matches/);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(st.claims.length, 1);
  assert.equal(st.claims[0].job_id, 'j1');
  assert.ok(!/warehouse/i.test(JSON.stringify(st.sends)), 'a role the résumé does not name is never sent');
});

test('the next run the same day respects the 4-hour gap; never the same job twice', async () => {
  await run();
  const second = await run();
  assert.equal(second.body.sent, 0);
  assert.equal(second.body.skipped.user_limit, 1);
  // Five hours later the second email goes out — a different listing.
  st.log[0].sent_at = new Date(Date.now() - 5 * 3600e3).toISOString();
  const third = await run();
  assert.equal(third.body.sent, 1, JSON.stringify(third.body));
  assert.match(st.sends[1].html, /\/jobs\/j2\?/);
});

test('a changed résumé brings new matches', async () => {
  st.resume = resumeFor('Warehouse Associate');
  st.resumeUpdatedAt = new Date().toISOString();
  const res = await run();
  assert.equal(res.body.sent, 1, JSON.stringify(res.body));
  assert.match(st.sends[0].html, /\/jobs\/j3\?/);
});

test('skips: opted out, unconfirmed address, test domain, no good match', async () => {
  st.prefs = [{ user_id: UID }];
  assert.equal((await run()).body.skipped.opted_out, 1);
  st.prefs = []; st.confirmed = false;
  assert.equal((await run()).body.skipped.no_confirmed_email, 1);
  st.confirmed = true; st.email = 'audit@seenjobs.io';
  assert.equal((await run()).body.skipped.test_domain, 1);
  st.email = 'jordan@example.com'; st.jobs = [listing('j3', 'Warehouse Associate', 'amazon')];
  assert.equal((await run()).body.skipped.no_matches, 1, 'no listing names a résumé role');
  st.jobs = [listing('j1', 'Cashier', 'badco')];
  st.scores = [{ company_name: 'badco', overall_score: 40, response_rate: 0.3, first_party_report_count: 8, mention_count: 0 }];
  assert.equal((await run()).body.skipped.no_good_match, 1, 'a D-graded employer is never emailed about');
  assert.equal(st.sends.length, 0);
  assert.equal(st.claims.length, 0, 'nothing is claimed for a skipped user');
});

test('a failed send releases the claim so a later run retries', async () => {
  st.resendStatus = 500;
  const res = await run();
  assert.equal(res.body.sent, 0);
  assert.equal(res.body.skipped.send_500, 1);
  assert.equal(st.deletes, 1);
  assert.equal(st.log.length, 0);
});

test('?dry=1 picks without claiming or sending; it is refused to an unauthenticated caller', async () => {
  const res = await run({ query: { dry: '1', secret: 'cron-secret' }, auth: null });
  assert.equal(res.body.dry, true);
  assert.equal(res.body.picked[0].job_id, 'j1');
  assert.equal(st.sends.length, 0);
  assert.equal(st.claims.length, 0);
});

test('before the migration (no log table) nothing is sent', async () => {
  st.logReadable = false;
  const res = await run();
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'log_unreadable');
  assert.equal(st.sends.length, 0);
});

test('the daily cap across all users holds', async () => {
  process.env.JOB_MATCH_DAILY_CAP = '0';
  try {
    const res = await run();
    assert.equal(res.body.skipped.daily_cap, 1);
    assert.equal(st.sends.length, 0);
  } finally { delete process.env.JOB_MATCH_DAILY_CAP; }
});
