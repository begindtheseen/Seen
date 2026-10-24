// Search opportunity engine on fixture data + the loaders against a stubbed PostgREST.
// Run: node --test lib/server/searchOpportunities.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedCtr, addDays, windowOf, aggregate, queryTotals, strikingDistance, lowCtrPages, intentSummary, demandTargetsFrom,
  intentsForCompanyFrom, buildDigest, computeOpportunities, buildCompanyIndex, searchDemandTargets, topIntentsForCompany,
  loadSearchOpportunities, CTR_CURVE,
} from './searchOpportunities.js';

const P = (slug) => `https://seenjobs.io/company/${slug}`;
const row = (date, query, page, impressions, clicks, position, source = 'google') => ({ date, source, query, page, impressions, clicks, position });
const COMPANIES = [
  { company_name: 'target', first_party_report_count: 48, mention_count: 0 },
  { company_name: 'walmart', first_party_report_count: 2, mention_count: 0 },
  { company_name: 'robert half', first_party_report_count: 12, mention_count: 2 },
  { company_name: 'insight global', first_party_report_count: 0, mention_count: 0 },
];
const IDX = buildCompanyIndex(COMPANIES);

// 28 days ending 2026-10-22; one older row outside the window.
function fixture() {
  const rows = [];
  for (let d = 0; d < 28; d++) {
    const date = addDays('2026-10-22', -d);
    rows.push(row(date, 'target application status', P('target'), 10, 0, 11.2));           // striking distance, 280 impr.
    rows.push(row(date, 'walmart application status', P('walmart'), 5, 0, 14));            // striking, ungraded company
    rows.push(row(date, 'is robert half legit', P('robert-half'), 20, 0, 3.1));            // position 3, CTR 0 → low CTR
    rows.push(row(date, 'seen jobs', 'https://seenjobs.io/', 3, 2, 1));
  }
  rows.push(row('2026-09-01', 'target application status', P('target'), 999, 0, 12));     // outside the window
  // Bing: a site-level row AND a page row for the same query must not double count.
  rows.push(row('2026-10-19', 'insight global reviews', '', 50, 1, 6, 'bing'));
  rows.push(row('2026-10-19', 'insight global reviews', P('insight-global'), 30, 1, 5, 'bing'));
  // This week only: a new query (mover + new striking distance).
  rows.push(row('2026-10-21', 'does target ghost', P('target'), 9, 0, 9.5));
  return rows;
}

test('expected CTR: the cited curve, interpolated, page two small, nonsense → null', () => {
  assert.equal(expectedCtr(1), 0.276);
  assert.equal(expectedCtr(10), CTR_CURVE[9]);
  assert.ok(Math.abs(expectedCtr(1.5) - (0.276 + 0.158) / 2) < 1e-9);
  assert.ok(expectedCtr(15) < expectedCtr(10) && expectedCtr(15) > 0);
  assert.equal(expectedCtr(0), null);
  assert.equal(CTR_CURVE.slice(0, 3).reduce((a, b) => a + b, 0).toFixed(3), '0.544', 'top three = 54.4% (the study)');
});

test('window anchors on the newest stored day (Search Console lags); aggregation weights position by impressions', () => {
  const rows = fixture();
  assert.deepEqual(windowOf(rows), { from: '2026-09-25', to: '2026-10-22' });
  const agg = aggregate(rows, windowOf(rows));
  const t = agg.find((a) => a.query === 'target application status');
  assert.equal(t.impressions, 280, 'the September row is outside the window');
  assert.equal(t.position, 11.2);
  const weighted = aggregate([row('2026-10-01', 'q', 'p', 10, 0, 2), row('2026-10-02', 'q', 'p', 30, 0, 10)], null)[0];
  assert.equal(weighted.position, 8);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('Bing: a site-level total is never added to its own page rows', () => {
  const qt = queryTotals(aggregate(fixture(), null));
  assert.equal(qt.find((t) => t.query === 'insight global reviews').impressions, 50);
});

test('striking distance: position 8–20 with enough impressions; advice says when the page has no data yet', () => {
  const s = strikingDistance(aggregate(fixture(), windowOf(fixture())), IDX);
  const byQ = Object.fromEntries(s.map((x) => [x.query, x]));
  assert.ok(byQ['target application status']);
  assert.equal(byQ['target application status'].intent, 'application_status');
  assert.equal(byQ['target application status'].company, 'target');
  assert.match(byQ['target application status'].advice, /response rate and the average wait/);
  assert.equal(byQ['walmart application status'].graded, false);
  assert.match(byQ['walmart application status'].advice, /walmart needs 3 more reports for a grade/);
  assert.ok(!byQ['is robert half legit'], 'position 3 is not striking distance');
  assert.ok(!byQ['does target ghost'], 'too few impressions');
});

test('low CTR: high impressions, CTR far under the expected CTR for the position', () => {
  const low = lowCtrPages(aggregate(fixture(), windowOf(fixture())));
  assert.deepEqual(low.map((p) => p.page), [P('robert-half')], 'page-two pages are a ranking problem, not a snippet one');
  const rh = low[0];
  assert.equal(rh.impressions, 560);
  assert.ok(rh.expected_ctr > 0.1 && rh.ctr === 0);
  assert.deepEqual(rh.top_intents, ['is_legit']);
  assert.ok(!low.find((p) => p.page === 'https://seenjobs.io/'), 'CTR 67% at position 1 is fine');
});

test('intents + demand targets: companies people search for, thin ones flagged', () => {
  const agg = aggregate(fixture(), windowOf(fixture()));
  const sum = intentSummary(agg);
  assert.equal(sum.application_status.impressions, 420);
  assert.equal(sum.is_legit.impressions, 560 + 50);
  const demand = demandTargetsFrom(agg, IDX);
  assert.deepEqual(demand.map((d) => d.company), ['robert half', 'target', 'walmart', 'insight global']);
  const by = Object.fromEntries(demand.map((d) => [d.company, d]));
  assert.equal(by.target.thin, false);
  assert.equal(by['robert half'].thin, false, '12 reports + graded');
  assert.equal(by.walmart.thin, true);
  assert.equal(by['insight global'].graded, false);
  assert.deepEqual(by.target.intents, ['application_status', 'does_ghost']);
  // A company Seen does not know, reached only through its page URL, is a missing page.
  const missing = demandTargetsFrom(aggregate([row('2026-10-20', 'zzz corp interview', P('zzz-corp'), 40, 0, 9)], null), IDX);
  assert.deepEqual(missing.map((d) => [d.company, d.known]), [['zzz corp', false]]);
});

test('intents for one company: labels only, other dropped, minimum impressions', () => {
  const rows = fixture();
  assert.deepEqual(intentsForCompanyFrom(rows, 'target', IDX).map((e) => e.intent), ['application_status', 'does_ghost']);
  assert.deepEqual(intentsForCompanyFrom(rows, 'target', IDX, { minImpressions: 10 }).map((e) => e.intent), ['application_status']);
  const out = intentsForCompanyFrom(rows, 'target', IDX);
  assert.ok(out.every((e) => Object.keys(e).sort().join() === 'clicks,impressions,intent'), 'never a query string');
});

test('digest: movers, new striking-distance queries, low-CTR pages, thin demand', () => {
  const d = buildDigest(fixture(), IDX);
  assert.deepEqual(d.week, { from: '2026-10-16', to: '2026-10-22' });
  assert.ok(d.top_movers.find((m) => m.query === 'does target ghost' && m.impressions_change === 9));
  assert.deepEqual(d.new_striking_distance.map((s) => s.query), ['does target ghost']);
  assert.ok(d.low_ctr_pages.length >= 1);
  assert.deepEqual(d.demand_targets.map((x) => x.company), ['walmart', 'insight global']);
  assert.equal(buildDigest([], IDX), null);
});

test('computeOpportunities on no rows is an empty, well-formed result', () => {
  const out = computeOpportunities([], COMPANIES);
  assert.equal(out.window, null);
  assert.deepEqual(out.striking_distance, []);
  assert.equal(out.intents.other.impressions, 0);
});

// ── loaders ─────────────────────────────────────────────────────────────────────────────────────
const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
function stub(rows, { missing = false } = {}) {
  const calls = [];
  const fetchImpl = async (u) => {
    calls.push(decodeURIComponent(u));
    const url = new URL(u);
    if (url.pathname.endsWith('/search_daily')) {
      if (missing) return json({ code: 'PGRST205' }, 404);
      if (url.searchParams.get('select') === 'date') return json([{ date: '2026-10-22' }]);
      const page = url.searchParams.get('page'), q = url.searchParams.get('query');
      let out = rows.map((r, i) => ({ id: i + 1, ...r }));
      if (page) out = out.filter((r) => r.page === page.replace(/^eq\./, ''));
      if (q) { const words = q.replace(/^ilike\./, '').split('*').filter(Boolean); out = out.filter((r) => words.every((w) => r.query.includes(w))); }
      const after = Number((url.searchParams.get('id') || 'gt.0').slice(3));
      return json(out.filter((r) => r.id > after).slice(0, 1000));
    }
    if (url.pathname.endsWith('/company_scores')) return url.searchParams.get('select') === 'mention_count' ? json([]) : json(Number(url.searchParams.get('offset') || 0) ? [] : COMPANIES);
    return json([]);
  };
  return { fetchImpl, calls };
}

test('topIntentsForCompany: page rows + rows naming the company, labels only; [] on missing table / no creds', async () => {
  const { fetchImpl, calls } = stub(fixture());
  const out = await topIntentsForCompany('Target', { url: 'https://sb', key: 'k', fetchImpl, now: new Date('2026-10-24T13:20:00Z') });
  assert.deepEqual(out.map((e) => e.intent), ['application_status', 'does_ghost']);
  assert.ok(calls.some((c) => c.includes('page=eq.https://seenjobs.io/company/target')));
  assert.ok(calls.some((c) => c.includes('query=ilike.*target*')));
  assert.deepEqual(await topIntentsForCompany('Target', { url: 'https://sb', key: 'k', fetchImpl: stub([], { missing: true }).fetchImpl }), []);
  assert.deepEqual(await topIntentsForCompany('Target', { url: '', key: '' }), []);
  assert.deepEqual(await topIntentsForCompany('Target', { url: 'https://sb', key: 'k', fetchImpl: async () => { throw new Error('down'); } }), []);
});

test('searchDemandTargets: ordered by demand; not ready without data', async () => {
  const r = await searchDemandTargets({ url: 'https://sb', key: 'k', fetchImpl: stub(fixture()).fetchImpl, now: new Date('2026-10-24T13:20:00Z') });
  assert.equal(r.ready, true);
  assert.equal(r.companies[0].company, 'robert half');
  assert.deepEqual(await searchDemandTargets({ url: 'https://sb', key: 'k', fetchImpl: stub([], { missing: true }).fetchImpl }), { ready: false, companies: [] });
});

test('loadSearchOpportunities: freshness + engine; before the migration ready:false', async () => {
  const out = await loadSearchOpportunities({ url: 'https://sb', key: 'k', fetchImpl: stub(fixture()).fetchImpl, now: new Date('2026-10-24T13:20:00Z') });
  assert.equal(out.ok, true);
  assert.equal(out.ready, true);
  assert.equal(out.freshness.google, '2026-10-22');
  assert.equal(out.freshness.google_age_days, 2);
  assert.equal(out.freshness.stale, false);
  assert.ok(out.striking_distance.length > 0 && out.digest);
  const before = await loadSearchOpportunities({ url: 'https://sb', key: 'k', fetchImpl: stub([], { missing: true }).fetchImpl });
  assert.deepEqual({ ok: before.ok, ready: before.ready }, { ok: true, ready: false });
});
