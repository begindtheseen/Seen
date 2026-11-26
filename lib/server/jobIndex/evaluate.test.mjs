// The job index answers a PostgREST read exactly as PostgREST would (the subset search uses), and says "not mine"
// (null) for anything else so the caller reads the database. Run: node --test lib/server/jobIndex/evaluate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryIndex, parseQuery, compileLike } from './evaluate.js';
import { prepareRow, INDEX_COLUMNS, encodeShard, decodeShard, shardOf, shardBounds, SHARD_COUNT } from './shard.js';

const FUT = '2030-01-01T00:00:00+00:00', PAST = '2020-01-01T00:00:00+00:00';
const base = (o) => ({ id: null, title: null, company: null, location: null, salary: null, salary_min: null, apply_url: null, type: 'Full-time', source: 'Greenhouse', score: 50, waste_score: 10, search_query: null, lat: null, lng: null, created_at: '2026-11-01T00:00:00+00:00', is_employer_posted: false, ats_tenant: null, level: null, expires_at: FUT, last_seen_at: '2026-11-20T00:00:00+00:00', apply_mode: null, ...o });
const RAW = [
  base({ id: '00000000-0000-0000-0000-000000000001', title: 'Registered Nurse', company: 'Banner Health', location: 'Phoenix, AZ', score: 80, lat: 33.45, lng: -112.07 }),
  base({ id: '00000000-0000-0000-0000-000000000002', title: 'Nurse Practitioner', company: 'HonorHealth', location: 'Scottsdale, AZ', score: 80 }),
  base({ id: '00000000-0000-0000-0000-000000000003', title: 'Software Engineer', company: 'Stripe', location: 'Remote', score: null, search_query: 'software engineer' }),
  base({ id: '00000000-0000-0000-0000-000000000004', title: 'Cashier', company: 'Walmart', location: 'Tempe, AZ', score: 40, expires_at: PAST }),
  base({ id: '00000000-0000-0000-0000-000000000005', title: '50% Off Sales_Lead', company: null, location: 'St. Louis, MO', score: 70 }),
  base({ id: 'f0000000-0000-0000-0000-000000000006', title: 'Warehouse Associate', company: 'Amazon', location: null, score: 70, last_seen_at: '2026-11-25T00:00:00+00:00' }),
];
function makeIndex(raw = RAW, missing = []) {
  const rows = raw.map((r) => prepareRow(r));
  // DEFAULT_ORDER: score desc nulls last, id asc
  rows.sort((a, b) => (a.score === b.score ? (a.id < b.id ? -1 : 1) : a.score == null ? 1 : b.score == null ? -1 : b.score - a.score));
  rows.forEach((r, i) => { r._o = i; });
  return { rows, cols: new Set(INDEX_COLUMNS.filter((c) => !missing.includes(c))), missing: new Set(missing), memo: new Map() };
}
const ids = (r) => r.rows.map((x) => x.id.slice(-1));
const NOW = encodeURIComponent('2026-11-26T00:00:00.000Z');

test('ilike: * and % are any run, _ is one character, case-insensitive, NULL never matches', () => {
  const idx = makeIndex();
  assert.deepEqual(ids(queryIndex(idx, `title=ilike.*nurse*&select=id`)), ['1', '2']);
  assert.deepEqual(ids(queryIndex(idx, `title=ilike.nurse*&select=id`)), ['2']);
  assert.deepEqual(ids(queryIndex(idx, `location=ilike.*phoenix_ az*&select=id`)), ['1']);
  assert.deepEqual(ids(queryIndex(idx, `company=ilike.*&select=id`)).sort(), ['1', '2', '3', '4', '6']); // NULL company excluded
  assert.deepEqual(ids(queryIndex(idx, `location=ilike.*st*louis*&select=id`)), ['5']);
  // `\` escapes: a literal % and a literal _ (pgrest.likeLiteral)
  assert.deepEqual(ids(queryIndex(idx, `title=ilike.${encodeURIComponent('*50\\% off*')}&select=id`)), ['5']);
  assert.deepEqual(ids(queryIndex(idx, `title=ilike.${encodeURIComponent('*sales\\_lead*')}&select=id`)), ['5']);
  assert.equal(compileLike('ab\\_c', true)('abxc'), false);
  assert.equal(compileLike('ab_c', true)('abxc'), true);
});

test('timestamps compare by instant; expired rows drop; booleans and numbers compare as values', () => {
  const idx = makeIndex();
  assert.deepEqual(ids(queryIndex(idx, `expires_at=gt.${NOW}&title=ilike.*&select=id`)).sort(), ['1', '2', '3', '5', '6']);
  assert.deepEqual(ids(queryIndex(idx, `lat=gte.33&lat=lte.34&lng=gte.-113&lng=lte.-112&select=id`)), ['1']);
  assert.deepEqual(ids(queryIndex(idx, `is_employer_posted=eq.false&score=gte.80&select=id`)), ['1', '2']);
  assert.deepEqual(ids(queryIndex(idx, `lat=is.null&score=gt.60&select=id`)), ['2', '5', '6']);
  assert.deepEqual(ids(queryIndex(idx, `company=not.is.null&score=lt.50&select=id`)), ['4']);
});

test('logic trees: or=(…, and(…)) nested, two or= params ANDed, not.or', () => {
  const idx = makeIndex();
  assert.deepEqual(ids(queryIndex(idx, `or=${encodeURIComponent('(and(lat.gte.33,lat.lte.34),location.ilike.*scottsdale*)')}&select=id`)), ['1', '2']);
  assert.deepEqual(ids(queryIndex(idx, `or=${encodeURIComponent('(title.ilike.*nurse*,title.ilike.*engineer*)')}&or=${encodeURIComponent('(location.ilike.*az*,location.ilike.*remote*)')}&select=id`)), ['1', '2', '3']);
  assert.deepEqual(ids(queryIndex(idx, `not.or=${encodeURIComponent('(title.ilike.*nurse*,company.is.null)')}&select=id`)).sort(), ['3', '4', '6']);
  assert.deepEqual(ids(queryIndex(idx, `and=${encodeURIComponent('(title.ilike.*nurse*,company.ilike.*banner*)')}&select=id`)), ['1']);
});

test('in.(…) on ids, quoted values; id ranges compare as uuid text', () => {
  const idx = makeIndex();
  assert.deepEqual(ids(queryIndex(idx, `id=in.(00000000-0000-0000-0000-000000000003,f0000000-0000-0000-0000-000000000006)&select=id`)), ['6', '3']);
  assert.deepEqual(ids(queryIndex(idx, `company=in.${encodeURIComponent('("Walmart","Stripe")')}&select=id`)).sort(), ['3', '4']);
  assert.deepEqual(ids(queryIndex(idx, `id=gte.00000000-0000-0000-0000-000000000004&id=lt.10000000-0000-0000-0000-000000000000&select=id`)).sort(), ['4', '5']);
});

test('order: index order by default; desc puts NULLs first unless nullslast; other orders sort; limit/offset; max-rows 1000', () => {
  const idx = makeIndex();
  assert.deepEqual(ids(queryIndex(idx, `order=score.desc.nullslast,id.asc&select=id`)), ['1', '2', '5', '6', '4', '3']);
  assert.deepEqual(ids(queryIndex(idx, `order=score.desc&select=id`)), ['3', '1', '2', '5', '6', '4']);
  assert.deepEqual(ids(queryIndex(idx, `order=score.asc,id.desc&select=id`)), ['4', '6', '5', '2', '1', '3']);
  assert.deepEqual(ids(queryIndex(idx, `order=last_seen_at.desc&limit=1&select=id`)), ['6']);
  assert.deepEqual(ids(queryIndex(idx, `order=score.desc.nullslast,id.asc&limit=2&offset=1&select=id`)), ['2', '5']);
  const many = makeIndex(Array.from({ length: 1500 }, (_, i) => base({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, title: 'x' })));
  assert.equal(queryIndex(many, `title=eq.x&limit=5000&select=id`).rows.length, 1000);
  assert.equal(queryIndex(many, `title=eq.x&select=id`, { uncapped: true }).rows.length, 1500);
});

test('answers carry only the selected columns, as new objects (a caller may change them)', () => {
  const idx = makeIndex();
  const r = queryIndex(idx, `title=ilike.*cashier*&select=id,title,expires_at`).rows[0];
  assert.deepEqual(Object.keys(r), ['id', 'title', 'expires_at']);
  assert.equal(r.expires_at, '2020-01-01T00:00:00.000Z');
  r.title = 'changed';
  assert.equal(queryIndex(idx, `title=ilike.*cashier*&select=title`).rows[0].title, 'Cashier');
  // a memoised condition answers the same the second time
  assert.deepEqual(ids(queryIndex(idx, `title=ilike.*nurse*&select=id`)), ['1', '2']);
});

test('not the index\'s read → null (description, *, an unknown column or operator); a column the DB lacks → 400', () => {
  const idx = makeIndex(RAW, ['apply_mode']);
  assert.equal(queryIndex(idx, `id=in.(00000000-0000-0000-0000-000000000001)&select=id,description`), null);
  assert.equal(queryIndex(idx, `select=*`), null);
  assert.equal(queryIndex(idx, `employer_user_id=not.is.null&select=id`), null);
  assert.equal(queryIndex(idx, `title=fts.nurse&select=id`), null);
  assert.equal(queryIndex(idx, `title=ilike.*nurse*`), null); // no select
  assert.deepEqual(queryIndex(idx, `title=ilike.*nurse*&select=id,apply_mode`), { status: 400 });
  assert.equal(parseQuery('or=(title.ilike.*a*'), null);
});

test('shards: encode → decode keeps every value; ids map to the shard whose range holds them', () => {
  const body = JSON.parse(JSON.stringify(encodeShard(0, RAW)));
  const back = decodeShard(body);
  for (let i = 0; i < RAW.length; i++) {
    for (const c of INDEX_COLUMNS) {
      const want = c === 'expires_at' || c === 'last_seen_at' ? Date.parse(RAW[i][c]) : RAW[i][c];
      assert.deepEqual(back[i][c], want, `${c} of row ${i}`);
    }
  }
  assert.equal(shardOf('00000000-0000-0000-0000-000000000000'), 0);
  assert.equal(shardOf('ffffffff-ffff-ffff-ffff-ffffffffffff'), SHARD_COUNT - 1);
  for (let k = 0; k < SHARD_COUNT; k++) {
    const { lo, hi } = shardBounds(k);
    assert.equal(shardOf(lo), k);
    if (hi) assert.equal(shardOf(hi), k + 1);
  }
});
