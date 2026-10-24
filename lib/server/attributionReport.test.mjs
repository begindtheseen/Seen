// lib/server/attributionReport.js — grouping rules (pure) and the loader (paged reads, Stripe outcomes),
// plus the admin GET ?action=signup_attribution route through the real api/admin-stats.js handler.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
delete process.env.STRIPE_SECRET_KEY;
const { landingGroup, referrerGroup, companyFromPath, aggregateAttribution, loadAttributionReport, clampDays } = await import('./attributionReport.js');
const { installFakePostgrest, fakeDb } = await import('./fakePostgrest.test-helper.mjs');
const { default: adminStats } = await import('../../api/admin-stats.js');

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-24T20:00:00Z');
const recent = (h = 1) => new Date(NOW.getTime() - h * 3600e3).toISOString();

test('landing pages collapse into the owner\'s groups', () => {
  const cases = {
    '/': 'home', '': 'home', '/company/walmart': 'company', '/company/coca-cola/reports': 'company', '/companies': 'other',
    '/jobs': 'jobs', '/jobs/123': 'jobs', '/agencies': 'agencies', '/agencies/insight-global': 'agencies', '/pricing': 'pricing',
    '/faq': 'faq', '/faq/ghosting': 'faq', '/data': 'data', '/lists/best-employers': 'lists', '/lists': 'lists', '/dashboard': 'other', '/database': 'other',
  };
  for (const [p, g] of Object.entries(cases)) assert.equal(landingGroup(p), g, p);
  assert.deepEqual(companyFromPath('/company/coca-cola'), { slug: 'coca-cola', name: 'coca cola' });
  assert.deepEqual(companyFromPath('/company/Home%20Depot'), { slug: 'home depot', name: 'home depot' });
  assert.equal(companyFromPath('/jobs'), null);
});

test('referrers: search engines, Reddit, AI assistants, social, direct', () => {
  const cases = {
    'www.google.com': 'google', 'google.co.uk': 'google', 'news.google.com': 'google', 'com.google.android.googlequicksearchbox': 'google',
    'www.bing.com': 'bing', 'cn.bing.com': 'bing', 'old.reddit.com': 'reddit', 'out.reddit.com': 'reddit', 'redd.it': 'reddit',
    'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', 'www.perplexity.ai': 'perplexity', 'perplexity.ai': 'perplexity',
    'www.tiktok.com': 'tiktok', 'www.linkedin.com': 'linkedin', 'lnkd.in': 'linkedin', 't.co': 'x', 'x.com': 'x', 'mobile.twitter.com': 'x',
    'duckduckgo.com': 'other', 'notgoogle.com': 'other', 'google.evil.example': 'other',
  };
  for (const [h, g] of Object.entries(cases)) assert.equal(referrerGroup(h), g, h);
  assert.equal(referrerGroup(null), 'direct');
  assert.equal(referrerGroup(''), 'direct');
});

test('aggregation counts each sign-up once per dimension, with what they did next', () => {
  const rows = [
    { user_id: 'a', landing_path: '/company/walmart', referrer_host: 'www.google.com', utm_source: null, utm_campaign: null, ref_code: null },
    { user_id: 'b', landing_path: '/company/walmart', referrer_host: 'chatgpt.com', utm_source: 'Reddit', utm_campaign: 'Ghost', ref_code: 'abcd2345' },
    { user_id: 'c', landing_path: '/company/target', referrer_host: null, utm_source: 'reddit', utm_campaign: null, ref_code: null },
    { user_id: 'd', landing_path: '/agencies', referrer_host: 'duckduckgo.com', utm_source: null, utm_campaign: null, ref_code: null },
  ];
  const out = aggregateAttribution(rows, { tracked: new Set(['a', 'b']), pro: new Set(['b', 'd']), paid: new Set(['b']) });
  assert.deepEqual(out.total, { signups: 4, tracked: 2, pro_or_trial: 2, paid: 1 });
  assert.deepEqual(out.by_landing.map((g) => [g.key, g.signups, g.tracked, g.pro_or_trial, g.paid]), [['company', 3, 2, 1, 1], ['agencies', 1, 0, 1, 0]]);
  assert.deepEqual(out.top_companies.map((c) => [c.slug, c.signups]), [['walmart', 2], ['target', 1]]);
  assert.deepEqual(Object.fromEntries(out.by_referrer.map((g) => [g.key, g.signups])), { google: 1, chatgpt: 1, direct: 1, other: 1 });
  assert.deepEqual(out.other_referrers.map((h) => h.key), ['duckduckgo.com']);
  assert.deepEqual(out.by_utm_source.map((g) => [g.key, g.signups]), [['reddit', 2], ['(none)', 2]].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])));
  assert.deepEqual(out.by_invite.map((g) => [g.key, g.signups, g.paid]), [['invite', 1, 1], ['no_invite', 3, 0]]);
  // Paid unknown → every paid count is null, never 0.
  const unknown = aggregateAttribution(rows, { tracked: new Set(), pro: new Set(['b']), paid: null });
  assert.equal(unknown.total.paid, null);
  assert.ok(unknown.by_landing.every((g) => g.paid === null));
});

test('top companies: at most 20, most sign-ups first', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ user_id: `u${i}`, landing_path: `/company/co-${i % 25}` }));
  const out = aggregateAttribution(rows);
  assert.equal(out.top_companies.length, 20);
  assert.equal(out.top_companies[0].signups, 2);
});

test('clampDays: 1…365, default 30', () => {
  assert.equal(clampDays(undefined), 30);
  assert.equal(clampDays('7'), 7);
  assert.equal(clampDays('0'), 30);
  assert.equal(clampDays('9999'), 365);
  assert.equal(clampDays('abc'), 30);
});

test('loader pages past 1,000 sign-ups and reads outcomes only for those accounts', async () => {
  const n = 1205;
  const signups = Array.from({ length: n }, (_, i) => ({ user_id: uid(i), landing_path: i % 2 ? '/jobs' : '/', referrer_host: null, account_created_at: recent(2) }));
  signups.push({ user_id: uid(9999), landing_path: '/pricing', account_created_at: new Date(NOW.getTime() - 60 * 86400e3).toISOString() }); // outside the window
  const f = installFakePostgrest({
    tables: {
      signup_attribution: signups,
      applications: [{ id: 'x1', user_id: uid(0) }, { id: 'x2', user_id: uid(0) }, { id: 'x3', user_id: uid(1100) }, { id: 'x4', user_id: uid(9999) }],
      ai_credits: [{ user_id: uid(3), pro: true, comped: false }, { user_id: uid(4), pro: true, comped: true }, { user_id: uid(5), pro: false, pro_until: '2099-01-01T00:00:00Z' }],
      credit_transactions: [{ id: 1, user_id: uid(6), reason: 'purchase_interview_sprint' }, { id: 2, user_id: uid(7), reason: 'welcome_bonus' }],
    },
  });
  const out = await loadAttributionReport(fakeDb(), { days: 30, now: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.total.signups, n, 'every page read, the old sign-up left out');
  assert.equal(out.total.tracked, 2, 'two accounts tracked (one with two applications)');
  assert.equal(out.total.pro_or_trial, 2, 'Stripe Pro flag + one-time buy; a comp and reward days are not conversions');
  assert.equal(out.paid_known, false);
  assert.equal(out.total.paid, null);
  assert.match(out.paid_note, /Pro \(incl\. trial\)/);
  assert.ok(f.log.some((l) => l.includes('signup_attribution') && l.includes('offset=1000')));
});

test('with Stripe: any subscription = trial/plan started; a paid invoice or a one-time buy = paid', async () => {
  const signups = [1, 2, 3, 4].map((i) => ({ user_id: uid(i), landing_path: '/company/walmart', referrer_host: 'old.reddit.com', account_created_at: recent(5) }));
  installFakePostgrest({
    tables: {
      signup_attribution: signups,
      ai_credits: [{ user_id: uid(1), pro: false, stripe_customer_id: 'cus_trial' }, { user_id: uid(2), pro: true, stripe_customer_id: 'cus_paid' }, { user_id: uid(3), stripe_customer_id: 'cus_other' }],
      credit_transactions: [{ id: 9, user_id: uid(4), reason: 'purchase_credit_pack' }],
    },
  });
  const stripeCalls = [];
  const stripe = async (url) => {
    stripeCalls.push(url);
    const u = new URL(url);
    if (u.pathname === '/v1/subscriptions') return Response.json({ data: [{ id: 'sub_1', customer: 'cus_trial', status: 'canceled' }, { id: 'sub_2', customer: 'cus_paid', status: 'active' }, { id: 'sub_3', customer: 'cus_stranger', status: 'active' }], has_more: false });
    if (u.pathname === '/v1/invoices') return Response.json({ data: [{ id: 'in_1', customer: 'cus_paid', amount_paid: 900 }, { id: 'in_0', customer: 'cus_trial', amount_paid: 0 }], has_more: false });
    return new Response('{}', { status: 404 });
  };
  const out = await loadAttributionReport(fakeDb(), { days: 30, now: NOW, stripeKey: 'sk_test', fetchImpl: stripe });
  assert.equal(out.paid_known, true);
  assert.deepEqual(out.total, { signups: 4, tracked: 0, pro_or_trial: 3, paid: 2 });
  assert.equal(out.by_referrer[0].key, 'reddit');
  assert.equal(out.top_companies[0].slug, 'walmart');
  assert.ok(stripeCalls.every((u) => new URL(u).hostname === 'api.stripe.com'));
  // Stripe refuses → paid unknown, never a guessed number.
  const down = await loadAttributionReport(fakeDb(), { days: 30, now: NOW, stripeKey: 'sk_test', fetchImpl: async () => new Response('{}', { status: 500 }) });
  assert.equal(down.paid_known, false);
  assert.equal(down.total.paid, null);
  assert.match(down.paid_note, /Stripe could not be read/);
});

test('before the migration the report says not ready; a failed read is an error, not zeros', async () => {
  installFakePostgrest({ missing: ['signup_attribution'] });
  assert.deepEqual((({ ok, ready }) => ({ ok, ready }))(await loadAttributionReport(fakeDb(), { now: NOW })), { ok: true, ready: false });
  installFakePostgrest({ tables: { signup_attribution: [{ user_id: uid(1), landing_path: '/', account_created_at: recent() }] }, missing: ['applications'] });
  const r = await loadAttributionReport(fakeDb(), { now: NOW });
  assert.equal(r.ok, false);
});

function adminCall(req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); },
    };
    adminStats({ url: '/api/admin-stats', body: null, ...req, headers: { origin: 'https://seenjobs.io', ...(req.headers || {}) } }, res);
  });
}

test('admin GET ?action=signup_attribution: admin session required, then the report', async () => {
  installFakePostgrest({
    tables: {
      admin_sessions: [{ token: 'tok', admin_id: 'adm', role: 'moderator', expires_at: '2099-01-01T00:00:00Z' }],
      signup_attribution: [{ user_id: uid(1), landing_path: '/agencies', referrer_host: 'www.perplexity.ai', account_created_at: new Date().toISOString() }],
    },
  });
  const anon = await adminCall({ method: 'GET', query: { action: 'signup_attribution' } });
  assert.equal(anon.status, 401);
  const r = await adminCall({ method: 'GET', query: { action: 'signup_attribution', days: '7' }, headers: { 'x-admin-token': 'tok' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ready, true);
  assert.equal(r.body.days, 7);
  assert.deepEqual(r.body.by_referrer.map((g) => g.key), ['perplexity']);
  assert.deepEqual(r.body.by_landing.map((g) => g.key), ['agencies']);
});
