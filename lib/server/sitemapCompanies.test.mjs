import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSitemapCompanies } from './sitemapCompanies.js';
import { _resetScoreColumnProbe } from './scoreColumns.js';

beforeEach(() => _resetScoreColumnProbe());

// A gradeable row by the page's rule (lib/server/reportCounts.js isGradeable): ≥1 real report and
// reports + ½·mentions ≥ 5, with an overall_score.
const graded = (i) => ({ company_name: `co ${String(i).padStart(4, '0')}`, overall_score: 70, first_party_report_count: 5, report_count: 5, data_source: 'reports', mention_count: 0, created_at: '2026-10-01T00:00:00Z', expires_at: '2027-10-01T00:00:00Z' });

function fakeDb(rows, cap = 1000) {
  const calls = [];
  const fetchImpl = async (u) => {
    const q = new URL(u).searchParams;
    if (q.get('select') === 'mention_count') return { ok: true, json: async () => [] }; // column probe
    const limit = Math.min(Number(q.get('limit')), cap);
    const offset = Number(q.get('offset'));
    calls.push(offset);
    return { ok: true, json: async () => rows.slice(offset, offset + limit) };
  };
  return { fetchImpl, calls };
}

test('reads past the 1,000-row server cap', async () => {
  const { fetchImpl, calls } = fakeDb(Array.from({ length: 1736 }, (_, i) => graded(i)));
  const out = await fetchSitemapCompanies({ url: 'https://db.example', key: 'k', fetchImpl });
  assert.equal(out.length, 1736);
  assert.deepEqual(calls, [0, 1000]);
});

test('an exact multiple of the page size ends on the empty page', async () => {
  const { fetchImpl, calls } = fakeDb(Array.from({ length: 2000 }, (_, i) => graded(i)));
  assert.equal((await fetchSitemapCompanies({ url: 'https://db.example', key: 'k', fetchImpl })).length, 2000);
  assert.deepEqual(calls, [0, 1000, 2000]);
});

test('only GRADED companies are listed: the page serves noindex for the rest', async () => {
  const rows = [
    { ...graded(1), company_name: 'walmart', first_party_report_count: 48, mention_count: 32 },
    { ...graded(2), company_name: 'chipotle', first_party_report_count: 2, mention_count: 6 },   // 2 + 3 = 5 → graded
    { ...graded(3), company_name: 'thin co', first_party_report_count: 3, mention_count: 2 },    // 3 + 1 = 4 → not
    { ...graded(4), company_name: 'mentions only', first_party_report_count: 0, mention_count: 40 }, // no real report → not
    { ...graded(5), company_name: 'no score', overall_score: null },
    { ...graded(6), company_name: 'web claim', first_party_report_count: null, report_count: 900, data_source: 'web_search' },
    { ...graded(7), company_name: 'legacy reports', first_party_report_count: null, report_count: 7, data_source: 'reports' },
  ];
  const { fetchImpl } = fakeDb(rows);
  const out = await fetchSitemapCompanies({ url: 'https://db.example', key: 'k', fetchImpl });
  assert.deepEqual(out.map((c) => c.name), ['walmart', 'legacy reports', 'chipotle']); // most reports first
  assert.equal(out[0].lastModified, '2026-10-01T00:00:00.000Z'); // expires_at − 365 d
});

test('the NEWEST row per name decides, as on the page (getScore reads created_at.desc limit 1)', async () => {
  const rows = [
    { ...graded(1), company_name: 'acme', overall_score: null, created_at: '2026-10-20T00:00:00Z' },
    { ...graded(1), company_name: 'acme', created_at: '2026-01-01T00:00:00Z' },
    { ...graded(2), company_name: 'Beta ', first_party_report_count: 1, created_at: '2026-01-01T00:00:00Z' },
    { ...graded(2), company_name: 'beta', created_at: '2026-10-20T00:00:00Z' },
  ];
  const { fetchImpl } = fakeDb(rows);
  assert.deepEqual((await fetchSitemapCompanies({ url: 'https://db.example', key: 'k', fetchImpl })).map((c) => c.name), ['beta']);
});

test('a failed page keeps what was read; no credentials reads nothing; blank names dropped', async () => {
  let n = 0;
  const fetchImpl = async (u) => {
    if (new URL(u).searchParams.get('select') === 'mention_count') return { ok: true, json: async () => [] };
    return n++ === 0
      ? { ok: true, json: async () => [...Array.from({ length: 999 }, (_, i) => graded(i)), { ...graded(0), company_name: '' }] }
      : { ok: false, json: async () => ({}) };
  };
  assert.equal((await fetchSitemapCompanies({ url: 'https://db.example', key: 'k', fetchImpl })).length, 999);
  assert.deepEqual(await fetchSitemapCompanies({ url: '', key: 'k', fetchImpl }), []);
});
