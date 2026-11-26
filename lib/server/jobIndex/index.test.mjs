// The job index loader: loads every shard through the CDN, builds a shard from the database itself when the CDN
// cannot answer, takes new listings from the database every minute (and at once for a `fresh` read), and never
// serves a partial index. Run: node --test lib/server/jobIndex/index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.JOB_INDEX_BASE = 'https://cdn.example';
const { encodeShard, shardBounds, shardOf, SHARD_COUNT, FORMAT } = await import('./shard.js');
const { getJobIndex, indexRead, jobIndexStatus, indexToken, _clearIndexForTest, _reloadForTest } = await import('./index.js');

const FUT = new Date(Date.now() + 7 * 86_400_000).toISOString();
const mk = (n, extra = {}) => {
  // spread ids across the uuid space so every shard holds rows
  const hex = ((n * 2654435761) >>> 0).toString(16).padStart(8, '0');
  return { id: `${hex}-0000-4000-8000-${String(n).padStart(12, '0')}`, title: `Job ${n} ${n % 2 ? 'Nurse' : 'Driver'}`, company: `Co ${n % 7}`, location: 'Phoenix, AZ', salary: null, salary_min: null, apply_url: `https://x.example/${n}`, type: 'Full-time', source: 'Greenhouse', score: n % 100, waste_score: 5, search_query: null, lat: null, lng: null, created_at: new Date(Date.UTC(2026, 10, 1) + n * 1000).toISOString().replace('Z', '+00:00'), is_employer_posted: false, ats_tenant: null, level: null, expires_at: FUT, last_seen_at: FUT, apply_mode: null, ...extra };
};
let DB = Array.from({ length: 400 }, (_, i) => mk(i));
let cdnDown = new Set();
let cdnStale = null; // { id, builtAt }: the CDN copy of that row's shard predates the row
const calls = { cdn: 0, dbShard: 0, delta: 0 };

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.host === 'cdn.example') {
    calls.cdn++;
    assert.equal(u.searchParams.get('k'), indexToken());
    assert.equal(u.searchParams.get('v'), String(FORMAT));
    const k = Number(u.searchParams.get('shard'));
    if (cdnDown.has(k)) return json({ error: 'down' }, 503);
    const { lo, hi } = shardBounds(k);
    const stale = cdnStale && shardOf(cdnStale.id) === k;
    const rows = DB.filter((r) => r.id >= lo && (!hi || r.id < hi) && !(stale && r.id === cdnStale.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
    return json(encodeShard(k, rows, stale ? { builtAt: cdnStale.builtAt } : {}));
  }
  if (u.host === 'db.example' && u.pathname === '/rest/v1/jobs') {
    const p = u.searchParams;
    if (p.get('created_at')) { // the delta read
      calls.delta++;
      const since = Date.parse(p.get('created_at').slice(3));
      return json(DB.filter((r) => Date.parse(r.created_at) > since).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)));
    }
    calls.dbShard++; // a shard built here: id=gte/gt + id=lt keyset
    const ge = p.getAll('id');
    let rows = DB.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const f of ge) {
      const [op, v] = [f.slice(0, f.indexOf('.')), f.slice(f.indexOf('.') + 1)];
      rows = rows.filter((r) => (op === 'gte' ? r.id >= v : op === 'gt' ? r.id > v : op === 'lt' ? r.id < v : true));
    }
    return json(rows.slice(0, Number(p.get('limit')) || 1000));
  }
  return json([]);
};

const now = () => encodeURIComponent(new Date().toISOString());
const count = (q) => indexRead(`${q}&expires_at=gt.${now()}&select=id&limit=5000`, { uncapped: true }).rows.length;

test('loads every shard through the CDN; a shard the CDN cannot give is built from the database', async () => {
  _clearIndexForTest();
  cdnDown = new Set([3, 17]);
  const idx = await getJobIndex({ waitMs: 10_000 });
  assert.ok(idx, 'loaded');
  assert.equal(idx.size, DB.length);
  const st = jobIndexStatus();
  assert.equal(st.shards, SHARD_COUNT);
  assert.ok(st.via.local >= 2, JSON.stringify(st));
  assert.ok(calls.dbShard >= 2);
  assert.equal(count('title=ilike.*nurse*'), 200);
  cdnDown = new Set();
});

test('a new listing is searchable after the next delta read (at once for a fresh read)', async () => {
  const fresh = mk(5000, { title: 'Lighthouse Keeper', created_at: new Date().toISOString().replace('Z', '+00:00') });
  DB = [...DB, fresh];
  assert.equal(count('title=ilike.*lighthouse*'), 0);
  await getJobIndex({ fresh: true });
  assert.equal(count('title=ilike.*lighthouse*'), 1);
  assert.ok(calls.delta >= 1);
  // Still there after the shards are re-read from a CDN copy made before the row existed.
  cdnStale = { id: fresh.id, builtAt: Date.now() - 600_000 };
  await _reloadForTest();
  assert.equal(count('title=ilike.*lighthouse*'), 1, 'kept from the delta over an older shard copy');
  cdnStale = null;
});

test('no index until every shard is in: a first load with a shard nobody can give serves nothing (the database answers)', async () => {
  _clearIndexForTest();
  cdnDown = new Set([5]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = new URL(String(url));
    if (u.host === 'db.example' && u.pathname === '/rest/v1/jobs' && !u.searchParams.get('created_at')) return new Response('down', { status: 500 });
    return realFetch(url, opts);
  };
  const idx = await getJobIndex({ waitMs: 10_000 });
  assert.equal(idx, null);
  assert.equal(indexRead(`title=ilike.*nurse*&select=id`), null);
  globalThis.fetch = realFetch;
  cdnDown = new Set();
});
