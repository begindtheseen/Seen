// exactTop (api/jobs.js) reads a posting only where it can change the first K rows, and must give EXACTLY the first
// K rows of ranking every posting (filterAndRank's order; with a place key in front, corpusRelevant's order).
// Randomised over titles, postings, stored scores, queries (one word, several, with a family) and a searcher's fit.
// Run: node --test api/jobs.exactTop.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'k';
const { exactTop, mergeTop, geoChunks, MAX_OR_PATTERNS, placeScopeClause, placeScopeParts } = await import('./jobs.js');
const { filterAndRank, isRelevant, tokenize } = await import('./_utils/jobRelevance.js');

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const TITLES = ['Store Manager', 'Assistant Store Manager', 'Retail Sales Associate', 'Cashier', 'Senior Software Engineer', 'Software Developer', 'Registered Nurse', 'Nurse Manager', 'Customer Service Representative', 'Team Lead', 'Shift Supervisor', 'Warehouse Associate', 'Data Analyst', 'Director of Sales'];
const WORDS = ['store', 'manager', 'retail', 'software', 'engineer', 'nurse', 'customer', 'service', 'team', 'lead', 'warehouse', 'data', 'cashier', 'patients', 'python', 'forklift', 'guests', 'remote'];
const QUERIES = ['store manager', 'cashier', 'software engineer', 'nurse', 'customer service', 'team lead', 'warehouse', 'manager', 'data analyst engineer'];
const FITS = [null, { families: ['retail'], industry: 'retail' }, { families: [], industry: 'tech' }, { families: ['clinical'], industry: 'healthcare' }];

function corpus(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    title: pick(TITLES), company: pick(['Walmart', 'Acme', 'Target', 'Stripe', 'Banner Health']),
    description: Array.from({ length: 4 + Math.floor(rnd() * 30) }, () => pick(WORDS)).join(' '),
    search_query: rnd() < 0.3 ? pick(QUERIES) : null,
    score: rnd() < 0.15 ? null : Math.floor(rnd() * 8) * 10,
    location: pick(['Phoenix, AZ', 'Mesa, AZ', 'Austin, TX', '']),
  }));
}

test('exactTop = the first K rows of ranking every posting, reading postings only for rows that can reach K', async () => {
  let hydrated = 0, total = 0;
  for (let round = 0; round < 120; round++) {
    const rows = corpus(40 + Math.floor(rnd() * 160));
    const query = pick(QUERIES), fit = pick(FITS), K = pick([5, 10, 60]);
    const synonyms = rnd() < 0.5 ? [query] : [];
    const canonical = query;
    const want = filterAndRank(rows, query, { synonyms, canonical, fit }).slice(0, K).map((j) => j.id);
    const hasQuery = tokenize(query).length > 0;
    const light = rows.map(({ description, ...j }) => j);
    const byId = new Map(rows.map((j) => [j.id, j.description]));
    const items = light.map((j, idx) => ({ j, idx })).filter((x) => !hasQuery || isRelevant(x.j, query, { synonyms, canonical }));
    const got = await exactTop(items, K, { query, synonyms, canonical, fit, hydrate: async (need) => { hydrated += need.length; for (const j of need) j.description = byId.get(j.id); } });
    total += items.length;
    assert.deepEqual(got.slice(0, K).map((x) => x.j.id), want, `round ${round} q=${query} K=${K} fit=${JSON.stringify(fit)}`);
    assert.equal(got.length, items.length, 'every relevant row is still counted');
  }
  assert.ok(hydrated < total, `postings read for ${hydrated} of ${total} candidate rows`);
});

test('with a place key in front (corpusRelevant): nearest first, relevance order as the tiebreak', async () => {
  for (let round = 0; round < 60; round++) {
    const rows = corpus(80);
    const query = pick(QUERIES), fit = pick(FITS), K = 20;
    const dist = new Map(rows.map((j) => [j.id, rnd() < 0.2 ? Infinity : Math.floor(rnd() * 5)]));
    const rel = filterAndRank(rows, query, { synonyms: [], canonical: query, fit });
    const want = rel.map((j, i) => ({ j, d: dist.get(j.id), i })).sort((a, b) => (a.d - b.d) || (a.i - b.i)).slice(0, K).map((x) => x.j.id);
    const byId = new Map(rows.map((j) => [j.id, j.description]));
    const items = rows.map(({ description, ...j }, idx) => ({ j, idx })).filter((x) => isRelevant(x.j, query, { synonyms: [], canonical: query }));
    const got = await exactTop(items, K, { query, synonyms: [], canonical: query, fit, primary: (x) => dist.get(x.j.id), hydrate: async (need) => { for (const j of need) j.description = byId.get(j.id); } });
    assert.deepEqual(got.slice(0, K).map((x) => x.j.id), want, `round ${round}`);
  }
});

test('a long geo OR is split into reads of ≤ 15 patterns, and the merged rows equal one read of the union', () => {
  const parts = placeScopeParts({ lat: 33.45, lng: -112.07 }, 25, 'phoenix');
  assert.ok(parts.length > MAX_OR_PATTERNS, `${parts.length} parts`);
  const chunks = geoChunks(parts);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(decodeURIComponent(c).split(',location.').length <= MAX_OR_PATTERNS + 1);
  assert.equal(geoChunks(parts.slice(0, 5))[0], `&or=${encodeURIComponent(`(${parts.slice(0, 5).join(',')})`)}`);
  assert.equal(placeScopeClause({ lat: 33.45, lng: -112.07 }, 25, 'phoenix'), `&or=${encodeURIComponent(`(${parts.join(',')})`)}`, 'the one-read clause is unchanged');
  // top-N of a union = top-N of the union of each part's top-N (score desc nulls last, id asc)
  const rows = corpus(300);
  const order = (a, b) => (a.score === b.score ? (a.id < b.id ? -1 : 1) : a.score == null ? 1 : b.score == null ? -1 : b.score - a.score);
  const A = rows.filter((_, i) => i % 3 !== 0), B = rows.filter((_, i) => i % 2 === 0);
  const union = [...new Map([...A, ...B].map((r) => [r.id, r])).values()].sort(order).slice(0, 61).map((r) => r.id);
  const got = mergeTop([[...A].sort(order).slice(0, 61), [...B].sort(order).slice(0, 61)], 61).map((r) => r.id);
  assert.deepEqual(got, union);
});
