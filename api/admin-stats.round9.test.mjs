// Round 9: four read-only panels the old admin had, each with a count that says what it counts and is exact past
// PostgREST's 1,000-row cap (the fake caps every read at 1,000 like prod), plus merge sentences in display names.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const { TOP_SEARCH } = await import('../lib/server/admin/system.js');
const { world, RPCS, caller, createFakeRest, uid } = await import('../lib/server/admin/testing/world.mjs');
const C = await import('../lib/server/admin/testing/contract.mjs');

const D = 86400e3;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
async function rig(mut = () => {}, opts = {}) {
  const tables = world();
  mut(tables);
  const fake = createFakeRest({ tables, rpcs: RPCS, ...opts });
  return { fake, call: await caller(handler, fake) };
}

test('top_searched: 2,500 searches this week + old ones → counts over every row of the week, newest-first, case-merged', async () => {
  const { call } = await rig((T) => {
    T.search_logs = [];
    let id = 1;
    for (let i = 0; i < 1500; i++) T.search_logs.push({ id: id++, query: i % 3 ? 'Cashier' : 'cashier ', location: 'Phoenix', result_count: 4, created_at: ago(i * 60e3) });
    for (let i = 0; i < 1000; i++) T.search_logs.push({ id: id++, query: 'Amazon', location: '', result_count: 9, created_at: ago(2 * D + i * 1000) });
    for (let i = 0; i < 700; i++) T.search_logs.push({ id: id++, query: 'Old query', location: '', result_count: 1, created_at: ago(9 * D + i) });
  });
  const r = await call({ action: 'top_searched' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.jsonBody));
  assert.deepEqual(C.checkList ? C.checkList(r.jsonBody) : [], []);
  assert.equal(r.jsonBody.searches_read, 2500, 'every search of the week, past the 1,000 cap');
  assert.equal(r.jsonBody.searches_total, 2500);
  assert.equal(r.jsonBody.complete, true);
  assert.deepEqual(r.jsonBody.rows.map((x) => [x.query, x.count]), [['Cashier', 1500], ['Amazon', 1000]]);
  assert.match(r.jsonBody.label, /last 7 days \(all 2,500\)/);
});

test('top_searched: bounded read says "from the newest N searches", complete:false, and the week total stays exact', async () => {
  const { call } = await rig((T) => {
    T.search_logs = Array.from({ length: 1400 }, (_, i) => ({ id: i + 1, query: i < 600 ? 'Newest' : 'Older', created_at: ago(i * 60e3) }));
  });
  const prev = TOP_SEARCH.max;
  TOP_SEARCH.max = 600;
  try {
    const r = await call({ action: 'top_searched' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.jsonBody.complete, false);
    assert.equal(r.jsonBody.searches_read, 600);
    assert.equal(r.jsonBody.searches_total, 1400);
    assert.match(r.jsonBody.label, /from the newest 600 searches/);
    assert.deepEqual(r.jsonBody.rows.map((x) => x.query), ['Newest'], 'the newest rows, not the oldest');
  } finally { TOP_SEARCH.max = prev; }
});

test('top_searched: search_logs missing → ok, ready:false, no rows (never an error page)', async () => {
  const { call } = await rig(() => {}, { missing: ['search_logs'] });
  const r = await call({ action: 'top_searched' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.jsonBody));
  assert.equal(r.jsonBody.ready, false);
});

test('enrichment_queue_stats: exact counts past 1,000 rows, done today in California time, oldest waiting age', async () => {
  const { call } = await rig((T) => {
    const q = [];
    for (let i = 0; i < 1200; i++) q.push({ company_key: `queued${i}`, company_name: `queued${i}`, status: 'queued', requested_at: ago(i * 1000) });
    q.push({ company_key: 'beacon group', company_name: 'beacon group', status: 'queued', requested_at: ago(3 * 3600e3 + 60e3) });
    for (let i = 0; i < 2; i++) q.push({ company_key: `run${i}`, company_name: `run${i}`, status: 'running', requested_at: ago(60e3) });
    for (let i = 0; i < 5; i++) q.push({ company_key: `done${i}`, company_name: `done${i}`, status: i % 2 ? 'empty' : 'done', requested_at: ago(D), done_at: new Date().toISOString() });
    q.push({ company_key: 'doneold', company_name: 'doneold', status: 'done', requested_at: ago(3 * D), done_at: ago(2 * D) });
    for (let i = 0; i < 3; i++) q.push({ company_key: `err${i}`, company_name: `err${i}`, status: 'error', requested_at: ago(D) });
    T.company_enrichment_queue = q;
  }, { pk: { company_enrichment_queue: 'company_key' } });
  const r = await call({ action: 'enrichment_queue_stats' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.jsonBody));
  const row = r.jsonBody.rows[0];
  assert.equal(row.ready, true);
  assert.equal(row.waiting, 1201);
  assert.equal(row.running, 2);
  assert.equal(row.done_today, 5);
  assert.equal(row.failed, 3);
  assert.equal(row.oldest_waiting_company, 'Beacon Group');
  assert.ok(row.oldest_waiting_age_s >= 3 * 3600 && row.oldest_waiting_age_s < 3 * 3600 + 120, String(row.oldest_waiting_age_s));
  assert.match(r.jsonBody.message, /1,201 waiting · 2 running · 5 done today · 3 failed · oldest waiting 3 hours/);
});

test('enrichment_queue_stats: table missing → ok with ready:false', async () => {
  const { call } = await rig(() => {}, { missing: ['company_enrichment_queue'] });
  const r = await call({ action: 'enrichment_queue_stats' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.jsonBody));
  assert.equal(r.jsonBody.rows[0].ready, false);
});

test('users_list filter free: 1,600 accounts, Pro and purchasers excluded, exact total, label says the definition, pages cover all', async () => {
  const { call } = await rig((T) => {
    T.profiles = Array.from({ length: 1600 }, (_, i) => ({ id: uid(i + 1, '6'), email: `p${i + 1}@example.com`, created_at: ago(i * 60e3) }));
    T.ai_credits = [
      { user_id: uid(1, '6'), balance: 7, pro: false, pro_until: null, comped: false }, // free (balance alone is not paid)
      { user_id: uid(2, '6'), balance: 30, pro: false, pro_until: ago(-5 * D), comped: false }, // active window → not free
      { user_id: uid(3, '6'), balance: 0, pro: false, pro_until: ago(5 * D), comped: false }, // lapsed window → free
      { user_id: uid(4, '6'), balance: 0, pro: true, pro_until: null, comped: false }, // pro flag → not free
    ];
    T.credit_transactions = [];
    let id = 1;
    for (let i = 10; i < 1210; i++) T.credit_transactions.push({ id: id++, user_id: uid(i, '6'), delta: 1, reason: 'welcome_bonus', metadata: {} });
    for (const n of [5, 6, 7]) T.credit_transactions.push({ id: id++, user_id: uid(n, '6'), delta: 20, reason: 'purchase_credits20', metadata: {} });
    T.credit_transactions.push({ id: id++, user_id: uid(8, '6'), delta: 5, reason: 'admin_grant', metadata: {} });
  });
  const r = await call({ action: 'users_list', filter: 'free', limit: 200 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.jsonBody).slice(0, 300));
  assert.equal(r.jsonBody.total, 1600 - 2 - 3, 'Pro window, pro flag and three purchasers excluded');
  assert.match(r.jsonBody.label, /no active Pro window and no credits ever purchased/);
  let seen = r.jsonBody.rows.map((u) => u.id);
  let next = r.jsonBody.next;
  while (next) {
    const p = await call({ action: 'users_list', filter: 'free', limit: 200, after: next });
    seen = seen.concat(p.jsonBody.rows.map((u) => u.id));
    next = p.jsonBody.next;
  }
  assert.equal(seen.length, 1595);
  assert.equal(new Set(seen).size, 1595, 'no account twice across pages');
  for (const n of [2, 4, 5, 6, 7]) assert.ok(!seen.includes(uid(n, '6')), `account ${n} is not free`);
  for (const n of [1, 3, 8]) assert.ok(seen.includes(uid(n, '6')), `account ${n} is free`);
});

test('companies_list: total is the exact company_scores count (1,300 rows), not the page length; search narrows it', async () => {
  const { call } = await rig((T) => {
    T.company_scores = Array.from({ length: 1300 }, (_, i) => ({ id: uid(i + 1, '3'), company_name: `${i < 40 ? 'acme' : 'co'} ${String(i).padStart(4, '0')}`, overall_score: 50, report_count: 3, ghost_rate: 0.2, response_rate: 0.5, created_at: ago(D) }));
  });
  const r = await call({ action: 'companies_list', limit: 50 });
  assert.equal(r.statusCode, 200);
  assert.equal(r.jsonBody.rows.length, 50);
  assert.equal(r.jsonBody.total, 1300);
  assert.equal(r.jsonBody.total_label, 'companies with a score');
  const s = await call({ action: 'companies_list', q: 'acme', limit: 10 });
  assert.equal(s.jsonBody.total, 40);
});

test('merge sentences use display names: activity row and the merge answer', async () => {
  const { fake, call } = await rig((T) => {
    T.admin_audit_log.push({ id: 900001, created_at: new Date().toISOString(), username: 'owner', action: 'merge_companies', target_type: 'company', target_id: 'beacon holdings', metadata: { primary_name: 'beacon holdings', secondary_name: 'beacon group', merge_id: 1 } });
  });
  const r = await call({ action: 'activity_log', filter_action: 'merge_companies' });
  assert.equal(r.statusCode, 200);
  const row = r.jsonBody.rows.find((x) => x.id === '900001');
  assert.equal(row.summary, 'Merged Beacon Group into Beacon Holdings');
  // The merge's own answer, from lower-case stored names.
  fake.tables.company_scores.push({ id: uid(70, '3'), company_name: 'beacon group', overall_score: 50, report_count: 1, ghost_rate: 0.2, response_rate: 0.5, created_at: ago(D) }, { id: uid(71, '3'), company_name: 'beacon holdings', overall_score: 60, report_count: 2, ghost_rate: 0.2, response_rate: 0.5, created_at: ago(D) });
  const m = await call({ action: 'merge', primary: 'beacon holdings', secondary: 'beacon group' });
  assert.equal(m.statusCode, 200, JSON.stringify(m.jsonBody));
  assert.match(m.jsonBody.message, /^Merged Beacon Group into Beacon Holdings · /);
  const logged = await call({ action: 'activity_log', filter_action: 'merge_companies' });
  assert.ok(logged.jsonBody.rows.filter((x) => x.summary === 'Merged Beacon Group into Beacon Holdings').length >= 1);
});
