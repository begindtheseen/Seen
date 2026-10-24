// Bing Webmaster ingestion against a stubbed API (no real call). Run: node --test lib/server/bingWebmaster.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBingDate, bingRowsToRecords, pullBing, BING_API } from './bingWebmaster.js';

test('Bing /Date(ms-0700)/ dates parse to the instant; Pacific day stored', () => {
  assert.equal(parseBingDate('/Date(1316156400000-0700)/').toISOString(), '2011-09-16T07:00:00.000Z');
  assert.equal(parseBingDate('nonsense'), null);
  const [r] = bingRowsToRecords([{ Query: 'is robert half legit', Date: '/Date(1316156400000-0700)/', Clicks: 15, Impressions: 100, AvgImpressionPosition: 17, AvgClickPosition: 18 }]);
  assert.deepEqual(r, { date: '2011-09-16', source: 'bing', query: 'is robert half legit', page: '', clicks: 15, impressions: 100, ctr: 0.15, position: 17 });
});

test('no key → skipped, no request', async () => {
  let calls = 0;
  assert.deepEqual(await pullBing({ env: {}, fetchImpl: async () => { calls++; } }), { ok: true, skipped: 'no_credentials' });
  assert.equal(calls, 0);
});

test('site queries + top pages + per-page queries; page passed as a JSON string literal; old buckets dropped', async () => {
  const now = new Date('2026-10-24T13:20:00Z');
  const recent = `/Date(${Date.parse('2026-10-19T07:00:00Z')}-0700)/`, old = `/Date(${Date.parse('2025-01-01T08:00:00Z')}-0800)/`;
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(u);
    const url = new URL(u), m = url.pathname.split('/').pop();
    assert.equal(url.searchParams.get('apikey'), 'K');
    assert.equal(url.searchParams.get('siteUrl'), 'https://seenjobs.io/');
    const d = m === 'GetQueryStats' ? [{ Query: 'insight global reviews', Date: recent, Clicks: 1, Impressions: 50, AvgImpressionPosition: 6 }, { Query: 'stale', Date: old, Clicks: 0, Impressions: 9 }]
      : m === 'GetPageStats' ? [{ Query: 'https://seenjobs.io/company/insight-global', Date: recent, Impressions: 80 }, { Query: 'https://seenjobs.io/', Date: recent, Impressions: 5 }]
        : [{ Query: 'insight global reviews', Date: recent, Clicks: 1, Impressions: 30, AvgImpressionPosition: 5 }];
    return { ok: true, status: 200, json: async () => ({ d }) };
  };
  const r = await pullBing({ env: { BING_WEBMASTER_API_KEY: 'K' }, now, fetchImpl, pages: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.pages, 1, 'only the most-seen page');
  assert.ok(urls.every((u) => u.startsWith(BING_API)));
  const pq = new URL(urls.find((u) => u.includes('GetPageQueryStats')));
  assert.equal(pq.searchParams.get('page'), '"https://seenjobs.io/company/insight-global"');
  assert.deepEqual(r.records.map((x) => [x.query, x.page, x.impressions]), [['insight global reviews', '', 50], ['insight global reviews', 'https://seenjobs.io/company/insight-global', 30]]);
});

test('a failed site-level call fails the pull; a failed page call is reported, not fatal', async () => {
  const bad = await pullBing({ env: { BING_WEBMASTER_API_KEY: 'K' }, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ Message: 'Invalid API key' }) }) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /GetQueryStats: HTTP 401 Invalid API key/);
  const recent = `/Date(${Date.now() - 86_400_000})/`;
  const partial = await pullBing({ env: { BING_WEBMASTER_API_KEY: 'K' }, fetchImpl: async (u) => {
    const m = new URL(u).pathname.split('/').pop();
    if (m === 'GetPageQueryStats') return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ d: m === 'GetPageStats' ? [{ Query: 'https://seenjobs.io/x', Date: recent, Impressions: 3 }] : [] }) };
  } });
  assert.equal(partial.ok, true);
  assert.match(partial.errors[0], /GetPageQueryStats: HTTP 500/);
});
