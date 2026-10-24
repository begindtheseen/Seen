// Daily search-data cron against stubbed Google / Bing / PostgREST (no real call, nothing written anywhere).
// Run: node --test api/cron-search-data.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

process.env.SUPABASE_URL = 'https://sb.example';
process.env.SUPABASE_SERVICE_KEY = 'svc';
process.env.CRON_SECRET = 'cron';
delete process.env.VERCEL_ENV;
const { default: handler, runSearchData, runIndexNow, recentlyRescored } = await import('./cron-search-data.js');
const { SCORE_TTL_MS } = await import('../lib/server/reportCounts.js');

const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA = JSON.stringify({ client_email: 'seen@p.iam.gserviceaccount.com', private_key: PEM });
const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
const call = async (req) => { const r = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handler(req, r); return r; };

test('auth: cron header or CRON_SECRET bearer; anything else 401', async () => {
  assert.equal((await call({ method: 'GET', headers: {}, query: {} })).code, 401);
  assert.equal((await call({ method: 'POST', headers: {}, query: { secret: 'nope' } })).code, 401);
});

test('no credentials: { ok:true, skipped:"no_credentials" } and not one request (IndexNow is production-only)', async () => {
  let calls = 0;
  const real = global.fetch;
  global.fetch = async () => { calls++; return json([]); };
  try {
    const r = await call({ method: 'GET', headers: { 'x-vercel-cron': '1' }, query: {} });
    assert.equal(r.code, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.skipped, 'no_credentials');
    assert.equal(r.body.indexnow.skipped, 'not_production');
    assert.equal(calls, 0);
  } finally { global.fetch = real; }
});

function world({ missing = false } = {}) {
  const writes = [];
  const fetchImpl = async (u, init = {}) => {
    const url = new URL(u);
    if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'tok' });
    if (url.hostname === 'www.googleapis.com') {
      const b = JSON.parse(init.body);
      return json({ rows: b.startRow ? [] : [
        { keys: ['target application status', 'https://seenjobs.io/company/target', '2026-10-22'], clicks: 1, impressions: 90, position: 11 },
        { keys: ['does amazon ghost', 'https://seenjobs.io/company/amazon', '2026-10-21'], clicks: 3, impressions: 40, position: 6 },
      ] });
    }
    if (url.hostname === 'ssl.bing.com') return json({ d: [] });
    if (url.hostname === 'sb.example') {
      if (url.pathname.endsWith('/search_daily')) {
        if (missing) return json({ code: 'PGRST205', message: 'Could not find the table' }, 404);
        writes.push({ method: init.method, url: u, body: init.body ? JSON.parse(init.body) : null });
        return json(null, init.method === 'DELETE' ? 204 : 201);
      }
      return json([]);
    }
    throw new Error(`unexpected ${u}`);
  };
  return { fetchImpl, writes };
}

test('Google rows are upserted idempotently (same run twice → same payload); old rows pruned', async () => {
  const env = { ...process.env, GSC_SERVICE_ACCOUNT_JSON: SA, GSC_SITE_URL: 'sc-domain:seenjobs.io', BING_WEBMASTER_API_KEY: 'K' };
  const now = new Date('2026-10-24T13:20:00Z');
  const a = world(), b = world();
  const r1 = await runSearchData({ env, fetchImpl: a.fetchImpl, now });
  await runSearchData({ env, fetchImpl: b.fetchImpl, now });
  assert.equal(r1.ok, true);
  assert.equal(r1.google.written, 2);
  assert.deepEqual(r1.google.window, { startDate: '2026-10-20', endDate: '2026-10-22' });
  assert.equal(r1.bing.records, undefined, 'records never echoed in the response');
  const upserts = (w) => w.writes.filter((x) => x.method === 'POST').map((x) => x.body.map(({ fetched_at, ...rest }) => rest));
  assert.deepEqual(upserts(a), upserts(b));
  assert.match(a.writes[0].url, /on_conflict=date,source,query,page/);
  assert.ok(a.writes.some((x) => x.method === 'DELETE' && /date=lt\./.test(x.url)));
});

test('before the migration: the pull runs, the writes no-op and say so', async () => {
  const env = { ...process.env, GSC_SERVICE_ACCOUNT_JSON: SA, GSC_SITE_URL: 'sc-domain:seenjobs.io' };
  const w = world({ missing: true });
  const r = await runSearchData({ env, fetchImpl: w.fetchImpl, now: new Date('2026-10-24T13:20:00Z') });
  assert.equal(r.ok, true);
  assert.equal(r.google.missing_table, true);
  assert.equal(r.google.written, 0);
  assert.equal(r.bing.skipped, 'no_credentials');
});

test('IndexNow in production: changed gradeable companies + hubs + never-submitted static pages; recent ones skipped', async () => {
  const nowMs = Date.parse('2026-10-24T13:20:00Z');
  const posts = [];
  let scoresUrl = '';
  const fetchImpl = async (u, init = {}) => {
    const url = new URL(u);
    if (url.hostname === 'api.indexnow.org') { posts.push(JSON.parse(init.body)); return { status: 200 }; }
    if (url.hostname === 'seenjobs.io') return { status: url.pathname === '/ghosted' ? 404 : 200 };   // HEAD check of new static pages
    if (url.pathname.endsWith('/company_scores')) {
      if (url.searchParams.get('select') === 'mention_count') return json([]);
      scoresUrl = decodeURIComponent(u);
      return json([{ company_name: 'target', first_party_report_count: 48 }, { company_name: 'tiny', first_party_report_count: 1 }]);
    }
    if (url.pathname.endsWith('/search_indexnow_log')) {
      if (init.method === 'POST') return json(null, 201);
      if (url.searchParams.get('url')) return json([...['/', '/companies', '/jobs', '/feed', '/demand', '/resume', '/resume/studio', '/report', '/pricing', '/faq', '/compare', '/reddit'].map((p) => ({ url: `https://seenjobs.io${p}` }))]);
      return json([{ url: 'https://seenjobs.io/feed' }]); // submitted 3 hours ago
    }
    return json([]);
  };
  const r = await runIndexNow({ env: { VERCEL_ENV: 'production', SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_KEY: 'svc' }, fetchImpl, nowMs });
  assert.match(scoresUrl, new RegExp(`expires_at=gte\\.${new Date(nowMs - 24 * 3600_000 + SCORE_TTL_MS).toISOString().replace(/\./g, '\\.')}`), 'written in the last day = expires_at ≥ now − 1d + TTL');
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].urlList.sort(), ['https://seenjobs.io/agencies', 'https://seenjobs.io/companies', 'https://seenjobs.io/company/target'].sort());
  assert.equal(r.static_new, 2, '/agencies and /ghosted were never submitted');
  assert.equal(r.skipped_recent, 1);
});

test('recentlyRescored reports a failed read', async () => {
  const r = await recentlyRescored({ url: 'https://sb.example', key: 'svc', fetchImpl: async (u) => (u.includes('select=mention_count') ? json([]) : json({}, 500)) });
  assert.equal(r.ok, false);
});
