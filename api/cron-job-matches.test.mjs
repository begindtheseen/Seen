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
const FULL_TEXT = `${'Run the register, greet guests, keep the front end moving and the store clean. '.repeat(10)}\nRequirements\n• No experience required — we train.`;
const listing = (id, title, company, extra = {}) => ({ id, title, company, location: 'Norwalk, CA', salary: '$18/hr', apply_url: `https://apply.example/${id}`, description: FULL_TEXT, type: 'Full-time', level: 'Entry level', source: 'Seen', score: 60, waste_score: 20, expires_at: FUTURE, lat: null, lng: null, ats_tenant: null, created_at: '2026-10-23T00:00:00Z', ...extra });

let st;
beforeEach(() => {
  st = {
    resume: resumeFor('Cashier'), resumeUpdatedAt: '2026-10-24T00:00:00Z', city: 'Norwalk, CA',
    email: 'jordan@example.com', confirmed: true,
    jobs: [listing('j1', 'Cashier', 'walmart'), listing('j2', 'Cashier - Part Time', 'target'), listing('j3', 'Warehouse Associate', 'amazon')],
    log: [], prefs: [], alertPrefs: [], alertColumns: true, apps: [], saved: [], scores: [], logReadable: true, resendStatus: 200,
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
    if (path.includes('sent_at=gte.')) { const since = Date.parse(u.searchParams.get('sent_at').replace(/^gte\./, '')); return json(st.log.filter((r) => Date.parse(r.sent_at) >= since)); }
    return json([...st.log].sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)));
  }
  if (table === 'profiles') {
    if (method === 'PATCH') { st.keyWrites = (st.keyWrites || 0) + 1; return new Response('', { status: 204 }); }
    if (path.includes('select=job_keys&limit=1')) return json([{ job_keys: null }]);
    if (path.includes('resume_text=not.is.null')) return json(st.resume ? [{ id: UID }] : []);
    return json([{ resume_text: st.resume, resume_updated_at: st.resumeUpdatedAt, city: st.city }]);
  }
  if (table === 'email_prefs') {
    if (path.includes('job_match_mode=eq.alerts')) return st.alertColumns ? json(st.alertPrefs) : json({ code: '42703', message: 'column email_prefs.job_match_mode does not exist' }, 400);
    return json(st.prefs);
  }
  if (table === 'applications' || table === 'seen_applications') return json(table === 'applications' ? st.apps : []);
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
const { default: handler, makeHandler } = await import('./cron-job-matches.js');

// lib/geo/usPlaces.js interface, stubbed (tiny place table + great-circle miles).
const PLACES = { 'phoenix, az': { lat: 33.4484, lng: -112.074, name: 'Phoenix', state: 'AZ' }, 'tempe, az': { lat: 33.4255, lng: -111.94, name: 'Tempe', state: 'AZ' }, 'tucson, az': { lat: 32.2226, lng: -110.9747, name: 'Tucson', state: 'AZ' } };
const mi = (a, b) => { const r = (d) => (d * Math.PI) / 180; const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 2 * 3958.76 * Math.asin(Math.sqrt(h)); };
const geo = {
  geocodePlace: (t) => PLACES[String(t || '').toLowerCase().trim()] || null,
  distanceMiles: mi,
  withinMiles: (loc, o, m) => { const p = geo.geocodePlace(loc); return p ? mi(p, o) <= m : null; },
};
const alertsHandler = makeHandler({ loadGeo: async () => geo });
const PHX_ALERT = { keywords: 'cashier', place: 'Phoenix, AZ', remote: false, miles: 25, lat: 33.4484, lng: -112.074 };

function run({ auth = 'Bearer cron-secret', query = {}, method = 'GET', headers = {}, h = handler } = {}) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
  return h({ method, query, headers: { ...(auth ? { authorization: auth } : {}), ...headers } }, res).then(() => res);
}

test('only Vercel\'s bearer (or the secret / an admin) runs it; the spoofable header does not', async () => {
  assert.equal((await run({ auth: null })).code, 401);
  assert.equal((await run({ auth: null, headers: { 'x-vercel-cron': '1' } })).code, 401);
  assert.equal(st.sends.length, 0);
});

test('sends ONE email for the best match (plus another employer\'s match under it), with reasons from the résumé, and claims both first', async () => {
  const res = await run();
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.sent, 1, JSON.stringify(res.body));
  assert.equal(st.sends.length, 1);
  const mail = st.sends[0];
  assert.deepEqual(mail.to, ['jordan@example.com']);
  assert.match(mail.html, /https:\/\/seenjobs\.io\/jobs\/j1\?utm_source=email/);
  assert.equal(mail.subject, 'Cashier at Walmart, Norwalk', 'role, employer, city — nothing promised');
  assert.match(mail.text, /You're a Cashier at Target \(since 2022\)\./, 'the reason names her own job');
  assert.match(mail.text, /Also a fit:\n- Cashier - Part Time · Target/);
  assert.match(mail.html, /\/jobs\/j2\?utm_source=email/);
  assert.ok(!/great fit|perfect|matches your résumé/i.test(mail.subject));
  assert.match(mail.headers['List-Unsubscribe'], /list=job_matches/);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.deepEqual(st.claims.map((c) => c.job_id), ['j1', 'j2'], 'the extra item is claimed too: never sent twice');
  assert.ok(!/warehouse/i.test(JSON.stringify(st.sends)), 'a role the résumé does not name is never sent');
});

test('the next run the same day respects the 4-hour gap; never the same job twice', async () => {
  await run();
  const second = await run();
  assert.equal(second.body.sent, 0);
  assert.equal(second.body.skipped.user_limit, 1);
  // Five hours later: both cashier jobs were already sent and the warehouse job is not her field → nothing.
  for (const r of st.log) r.sent_at = new Date(Date.now() - 5 * 3600e3).toISOString();
  const third = await run();
  assert.equal(third.body.sent, 0, JSON.stringify(third.body));
  assert.equal(third.body.skipped.no_good_match, 1, JSON.stringify(third.body));
  // A new cashier listing then goes out on its own.
  st.jobs.push(listing('j4', 'Cashier', 'ralphs grocery'));
  const fourth = await run();
  assert.equal(fourth.body.sent, 1, JSON.stringify(fourth.body));
  assert.match(st.sends[1].html, /\/jobs\/j4\?/);
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
  assert.equal(st.deletes, 2, 'the main claim and the extra item\'s claim');
  assert.equal(st.log.length, 0);
});

test('?dry=1 picks without claiming or sending; it is refused to an unauthenticated caller', async () => {
  const res = await run({ query: { dry: '1', secret: 'cron-secret' }, auth: null });
  assert.equal(res.body.dry, true);
  assert.equal(res.body.picked[0].job_id, 'j1');
  assert.match(res.body.picked[0].reason, /Cashier at Target/);
  assert.ok(res.body.picked[0].matches.every((m) => m.reason), 'every match it would send carries its reason');
  assert.ok(!res.body.picked[0].matches.some((m) => /warehouse/i.test(m.title)));
  assert.match(res.body.picked[0].text, /View and apply on Seen/);
  assert.ok(res.body.picked[0].keys.occupations.some((o) => /cashier/i.test(o)));
  assert.equal(st.sends.length, 0);
  assert.equal(st.claims.length, 0);
  assert.ok(!st.keyWrites, 'a dry run writes no keys');
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

test('alerts mode: only listings whose title has the words AND sit inside the radius; no résumé needed', async () => {
  st.resume = null;
  st.alertPrefs = [{ user_id: UID, job_match_mode: 'alerts', job_match_opt_out: false, job_alerts: [PHX_ALERT] }];
  st.jobs = [
    listing('far', 'Cashier', 'walmart', { location: 'Tucson, AZ' }),
    listing('unplaced', 'Cashier', 'kroger', { location: 'Somewhere' }),
    listing('remote', 'Cashier', 'chewy', { location: 'Remote' }),
    listing('other', 'Stocker', 'target', { location: 'Tempe, AZ' }),
    listing('near', 'Cashier - Part Time', 'target', { location: 'Tempe, AZ' }),
  ];
  const res = await run({ h: alertsHandler });
  assert.equal(res.body.sent, 1, JSON.stringify(res.body));
  assert.equal(res.body.alert_users, 1);
  const mail = st.sends[0];
  assert.match(mail.text, /\/jobs\/near\?utm_source=email&utm_medium=job_match&utm_campaign=job_alert/);
  assert.equal(mail.subject, 'New cashier job within 25 mi of Phoenix, AZ: Cashier - Part Time at Target');
  assert.match(mail.text, /Matches your job alert “cashier”/);
  assert.match(mail.text, /8 miles from Phoenix, AZ/);
  assert.match(mail.text, /seenjobs\.io\/profile\?.*#alerts/);
  assert.ok(!/résumé lists/.test(mail.text), 'never claims a résumé match');
  assert.match(mail.headers['List-Unsubscribe'], /list=job_matches/, 'the same unsubscribe still works');
  // Next eligible run: the far / unplaced / remote / non-matching listings are never sent.
  st.log[0].sent_at = new Date(Date.now() - 5 * 3600e3).toISOString();
  const again = await run({ h: alertsHandler });
  assert.equal(again.body.sent, 0);
  assert.equal(again.body.skipped.no_good_match, 1, 'only the already-sent listing matched');
});

test('alerts mode: a Remote alert takes remote listings; a résumé user beside them is unchanged', async () => {
  st.alertPrefs = [{ user_id: UID, job_match_mode: 'alerts', job_match_opt_out: false, job_alerts: [{ keywords: 'cashier', place: 'Remote', remote: true, miles: null }] }];
  st.jobs = [listing('j1', 'Cashier', 'walmart'), listing('rem', 'Cashier', 'chewy', { location: 'Remote - US' })];
  const res = await run({ h: alertsHandler });
  assert.equal(res.body.sent, 1, JSON.stringify(res.body));
  assert.match(st.sends[0].html, /\/jobs\/rem\?/);
  assert.match(st.sends[0].subject, /^New remote cashier job: Cashier at Chewy$/);
});

test('alerts mode with no alerts sends nothing; no geo module sends nothing', async () => {
  st.alertPrefs = [{ user_id: UID, job_match_mode: 'alerts', job_match_opt_out: false, job_alerts: [] }];
  assert.equal((await run({ h: alertsHandler })).body.skipped.no_alerts, 1);
  st.alertPrefs = [{ user_id: UID, job_match_mode: 'alerts', job_match_opt_out: false, job_alerts: [PHX_ALERT] }];
  const noGeo = makeHandler({ loadGeo: async () => null });
  assert.equal((await run({ h: noGeo })).body.skipped.geo_unavailable, 1);
  assert.equal(st.sends.length, 0);
});

test('before the alerts migration (no columns) everyone stays on résumé matches', async () => {
  st.alertColumns = false;
  const res = await run({ h: alertsHandler });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.alerts_ready, false);
  assert.equal(res.body.sent, 1);
  assert.equal(st.sends[0].subject, 'Cashier at Walmart, Norwalk');
});

test('the owner\'s case: a security company\'s "Account Manager" teaser is never emailed to a résumé with no security work', async () => {
  st.resume = `Jamie Rivera
Norwalk, CA 90650 | jamie@example.com

EXPERIENCE
Account Manager — Skymark Solutions | Jan 2025 – Jul 2025
• Managed 40 small-business accounts and renewals.

Operations Manager — Practical Magicka | Apr 2018 – Dec 2023
• Led a team of 6; ran scheduling, purchasing and vendor management.`;
  st.jobs = [listing('gsg', 'Account Manager (LA Metro)', 'GSG Protective Services', { location: 'Culver City, Los Angeles County', lat: 33.995, lng: -118.4,
    description: 'Overview About Us – GSG Protective Services GSG Protective Services is a trusted security provider with a strong presence across the Southwest and Northeast United States. We offer high-quality, full-service security solutions with a commitment to safety, professionalism, and reliability. Our services include physical security, protective services, consulting, technology integration, and specialized training. Led by a seasoned leadership team with decades of experience, we stand by our core val…' })];
  const res = await run();
  assert.equal(res.body.sent, 0, JSON.stringify(res.body));
  assert.equal(res.body.skipped.no_matches, 1);
  assert.equal(st.sends.length, 0);
  assert.equal(st.claims.length, 0);
});

test('?dry=1&user=<id>&all=1 checks one account even after today\'s emails, and never sends', async () => {
  await run();
  assert.equal(st.sends.length, 1);
  const other = await run({ query: { dry: '1', secret: 'cron-secret', user: '00000000-0000-0000-0000-0000000000bb' }, auth: null });
  assert.equal(other.body.users, 0, 'another id: nobody is checked');
  const res = await run({ query: { dry: '1', secret: 'cron-secret', user: UID, all: '1' }, auth: null });
  assert.equal(res.body.users, 1);
  assert.ok(!res.body.skipped.user_limit, JSON.stringify(res.body));
  assert.equal(st.sends.length, 1, 'the dry run sent nothing');
  assert.ok(res.body.picked[0].keys, JSON.stringify(res.body.picked));
});

test('?dry=1 with the cron bearer is still a dry run (a check never sends)', async () => {
  const res = await run({ query: { dry: '1' } });
  assert.equal(res.body.dry, true);
  assert.equal(st.sends.length, 0);
  assert.equal(st.claims.length, 0);
});

// ── Round 2: a listing is emailed only when its requirements were read from the full posting ────────
const AM_RESUME = `Jamie Rivera
Norwalk, CA 90650 | jamie@example.com

EXPERIENCE
Account Manager — Skymark Solutions | Jan 2024 – Present
• Manage 40 small-business accounts and renewals.

Operations Manager — Practical Magicka | Apr 2018 – Dec 2023
• Led a team of 6; ran scheduling, purchasing and vendor management.`;
// GSG-shaped, with an employer name that says nothing about security.
const NEUTRAL_TEASER = 'Summit Services Group is hiring an Account Manager for the Los Angeles metro. Join a growing team that values professionalism, reliability and great client relationships. Apply today to learn more about this exciting…';
const NEUTRAL_FULL = `${'Summit Services Group supports client sites across Los Angeles. You will manage client relationships and site operations. '.repeat(5)}
Minimum Qualifications
• Minimum three (3) years of related security or operations experience.
• Minimum two (2) years of supervisory experience within the security industry.
• Maintain valid registration as a security guard throughout employment.`;
const neutralRow = () => listing('sum1', 'Account Manager (LA Metro)', 'Summit Services Group', { source: 'Adzuna', description: NEUTRAL_TEASER, location: 'Downey, CA' });

test('teaser hole: a neutral-name teaser passes on its summary, fails on the full posting → not emailed', async () => {
  st.resume = AM_RESUME;
  st.jobs = [neutralRow()];
  const reads = [];
  const h = makeHandler({ fetchFull: async ({ jobId }) => { reads.push(jobId); return { ok: true, description: NEUTRAL_FULL, fetched: true }; } });
  const res = await run({ h });
  assert.deepEqual(reads, ['sum1'], 'the full posting was read');
  assert.equal(res.body.sent, 0, JSON.stringify(res.body));
  assert.equal(res.body.skipped.teaser_full_posting, 1);
  assert.equal(st.sends.length, 0);
});

test('teaser hole: a closed or unreadable source → not emailed; a full posting that still matches → emailed with its reason', async () => {
  st.resume = AM_RESUME;
  st.jobs = [neutralRow()];
  let res = await run({ h: makeHandler({ fetchFull: async () => ({ ok: false, reason: 'gone' }) }) });
  assert.equal(res.body.sent, 0);
  assert.equal(res.body.skipped.teaser_gone, 1);
  st.jobs = [listing('sum2', 'Account Manager', 'Northwind Supply', { source: 'Adzuna', description: 'Northwind Supply is hiring an Account Manager to grow small-business accounts…', location: 'Downey, CA' })];
  const full = `${'Grow and renew small-business accounts for an office-supply distributor. '.repeat(12)}\nRequirements\n• 1+ year of account management experience.`;
  res = await run({ h: makeHandler({ fetchFull: async () => ({ ok: true, description: full, fetched: true }) }) });
  assert.equal(res.body.sent, 1, JSON.stringify(res.body));
  assert.match(st.sends[0].text, /You're an Account Manager at Skymark Solutions \(since 2024\)\. They ask for 1\+ year; you have about 3 years as an Account Manager\./);
});

test('teaser hole: a dry run reads the posting but writes nothing back', async () => {
  st.resume = AM_RESUME;
  st.jobs = [{ ...neutralRow(), id: 'sum3' }];
  let wrote = 0;
  const h = makeHandler({ fetchFull: async ({ db }) => { const r = await db('jobs?id=eq.sum3', { method: 'PATCH', body: '{}' }); if (r.status === 204) wrote++; return { ok: true, description: NEUTRAL_FULL }; } });
  const res = await run({ h, query: { dry: '1', secret: 'cron-secret' }, auth: null });
  assert.equal(res.body.dry, true);
  assert.equal(wrote, 1, 'the reader was answered');
  assert.ok(!st.jobs[0].description.includes('security industry'), 'nothing reached the database');
  assert.equal(res.body.picked[0].reason, 'no_readable_match');
});

test('limits count emails, not log rows: one email with two extra jobs is one of the two a day', async () => {
  const { countEmails } = await import('./cron-job-matches.js');
  const t0 = Date.parse('2026-11-10T16:05:00Z');
  const rows = [0, 2, 3].map((s) => ({ user_id: 'u', sent_at: new Date(t0 + s * 1000).toISOString() }));
  assert.equal(countEmails(rows), 1);
  assert.equal(countEmails([...rows, { user_id: 'u', sent_at: new Date(t0 + 5 * 3600e3).toISOString() }, { user_id: 'v', sent_at: new Date(t0).toISOString() }]), 3);
});
