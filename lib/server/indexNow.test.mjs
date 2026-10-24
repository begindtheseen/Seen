// IndexNow: key file, batching, the production-only guard, gradeable-only company URLs, and the recompute hook.
// No real submission. Run: node --test lib/server/indexNow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INDEXNOW_KEY, KEY_LOCATION, HOST, INDEXNOW_ENDPOINT, buildBatches, submissionBody, submitUrls, indexableCompanyUrls,
  companyPageUrl, indexNowEnabled, notifyCompanyRecomputed, recentlySubmitted,
} from './indexNow.js';

const PROD = { VERCEL_ENV: 'production', SUPABASE_URL: 'https://sb', SUPABASE_SERVICE_KEY: 'k' };

test('the key is a valid IndexNow key and public/<key>.txt serves exactly it', () => {
  assert.match(INDEXNOW_KEY, /^[a-zA-Z0-9-]{8,128}$/);
  assert.equal(readFileSync(new URL(`../../public/${INDEXNOW_KEY}.txt`, import.meta.url), 'utf8').trim(), INDEXNOW_KEY);
  assert.equal(KEY_LOCATION, `https://seenjobs.io/${INDEXNOW_KEY}.txt`);
  assert.deepEqual(submissionBody(['https://seenjobs.io/']), { host: HOST, key: INDEXNOW_KEY, keyLocation: KEY_LOCATION, urlList: ['https://seenjobs.io/'] });
});

test('batches: ≤10,000 per post, deduped, only https seenjobs.io URLs', () => {
  const urls = Array.from({ length: 10_001 }, (_, i) => `https://seenjobs.io/company/c${i}`);
  const b = buildBatches([...urls, urls[0], 'https://evil.example/x', 'http://seenjobs.io/x', 'not a url', 'https://www.seenjobs.io/x']);
  assert.deepEqual(b.map((x) => x.length), [10_000, 1]);
});

test('production only: tests, previews and dev never send', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { status: 200 }; };
  for (const env of [{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }, { ...PROD, INDEXNOW_DISABLED: '1' }]) {
    assert.equal(indexNowEnabled(env), false);
    assert.equal((await submitUrls(['https://seenjobs.io/'], { env, fetchImpl })).skipped, 'not_production');
    assert.equal(notifyCompanyRecomputed({ company_name: 'target', first_party_report_count: 40 }, { env }), false);
  }
  assert.equal(calls, 0);
});

test('production: one POST per batch with the documented body; accepted URLs are logged', async () => {
  const posts = [], logs = [];
  const fetchImpl = async (url, init) => {
    if (url === INDEXNOW_ENDPOINT) { posts.push(JSON.parse(init.body)); return { status: posts.length === 1 ? 200 : 202 }; }
    logs.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 201 };
  };
  const urls = Array.from({ length: 10_001 }, (_, i) => `https://seenjobs.io/company/c${i}`);
  const r = await submitUrls(urls, { env: PROD, fetchImpl });
  assert.deepEqual({ ok: r.ok, submitted: r.submitted, batches: r.batches, statuses: r.statuses }, { ok: true, submitted: 10_001, batches: 2, statuses: [200, 202] });
  assert.equal(posts[0].host, 'seenjobs.io');
  assert.equal(posts[0].key, INDEXNOW_KEY);
  assert.equal(posts[0].urlList.length, 10_000);
  assert.ok(logs.every((l) => l.url === 'https://sb/rest/v1/search_indexnow_log?on_conflict=url'));
  assert.equal(logs.reduce((n, l) => n + l.body.length, 0), 10_001);
});

test('a 429 or 403 stops the run (never hammer); nothing is logged for refused URLs', async () => {
  let posts = 0, logs = 0;
  const fetchImpl = async (url) => { if (url === INDEXNOW_ENDPOINT) { posts++; return { status: 429 }; } logs++; return { ok: true }; };
  const r = await submitUrls(Array.from({ length: 20_001 }, (_, i) => `https://seenjobs.io/company/c${i}`), { env: PROD, fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(posts, 1);
  assert.equal(logs, 0);
  assert.match(r.error, /429/);
});

test('company URLs: gradeable rows only, one slug scheme', () => {
  const rows = [
    { company_name: 'target', first_party_report_count: 48, mention_count: 0 },
    { company_name: 'coca cola', first_party_report_count: 3, mention_count: 4 },     // 3 + 2 = 5 → gradeable
    { company_name: 'acme', first_party_report_count: 0, mention_count: 40 },         // mentions alone never grade
    { company_name: 'tiny co', first_party_report_count: 2, mention_count: 0 },
    { company_name: "lowe's", report_count: 9, data_source: 'reports' },              // legacy row
  ];
  assert.deepEqual(indexableCompanyUrls(rows), ['https://seenjobs.io/company/target', 'https://seenjobs.io/company/coca-cola', "https://seenjobs.io/company/lowe's"]);
  assert.equal(companyPageUrl('H&M'), 'https://seenjobs.io/company/h%26m');
});

test('recently submitted: read from the log, limited to the asked URLs; no log → none', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [{ url: 'https://seenjobs.io/a' }, { url: 'https://seenjobs.io/other' }] });
  assert.deepEqual([...await recentlySubmitted({ url: 'https://sb', key: 'k', urls: ['https://seenjobs.io/a', 'https://seenjobs.io/b'], fetchImpl })], ['https://seenjobs.io/a']);
  assert.equal((await recentlySubmitted({ url: 'https://sb', key: 'k', urls: ['x'], fetchImpl: async () => ({ ok: false }) })).size, 0);
});

test('recompute hook in production: queued and sent as ONE batched post', async () => {
  const posts = [];
  const real = global.fetch;
  global.fetch = async (url, init) => {
    if (url === INDEXNOW_ENDPOINT) { posts.push(JSON.parse(init.body)); return { status: 200 }; }
    return { ok: true, status: 200, json: async () => [] };
  };
  try {
    assert.equal(notifyCompanyRecomputed({ company_name: 'target', first_party_report_count: 48 }, { env: PROD }), true);
    assert.equal(notifyCompanyRecomputed({ company_name: 'walmart', first_party_report_count: 30 }, { env: PROD }), true);
    assert.equal(notifyCompanyRecomputed({ company_name: 'tiny', first_party_report_count: 1 }, { env: PROD }), false, 'not gradeable');
    await new Promise((r) => setTimeout(r, 1700));
    assert.equal(posts.length, 1, 'one post for the whole burst');
    assert.deepEqual(posts[0].urlList.sort(), ['https://seenjobs.io/company/target', 'https://seenjobs.io/company/walmart']);
  } finally { global.fetch = real; }
});
