// Round 10 (review rig, round 3): undo sentences say what is true now; the held queue's duplicate check is
// remembered so the bulk count is the same on every load; a long undo is a job that survives a lost answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const system = await import('../lib/server/admin/system.js');
const review = await import('../lib/server/admin/review.js');
const { resetDupMemory } = await import('../lib/server/admin/dupCache.js');
const { undoSentence } = await import('../lib/server/admin/words.js');
const { world, RPCS, caller, createFakeRest, uid } = await import('../lib/server/admin/testing/world.mjs');
const C = await import('../lib/server/admin/testing/contract.mjs');

const D = 86400e3;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
async function rig(mut = () => {}, opts = {}, w = {}) {
  const tables = world(w);
  mut(tables);
  const fake = createFakeRest({ tables, rpcs: RPCS, ...opts });
  return { fake, call: await caller(handler, fake) };
}
const UNDID = /^Undid it/i;

// ── 1. undo sentences ────────────────────────────────────────────────────────────────────────────
test('no admin server source writes an answer starting "Undid it"', () => {
  const dir = new URL('../lib/server/admin/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//'));
    assert.ok(!src.some((l) => /[`'"]Undid it/i.test(l)), `${f} still writes "Undid it"`);
  }
  assert.equal(undoSentence('held_batch_approve', { count: 140 }), '140 reports are back in the review queue.');
  assert.equal(undoSentence('held_batch_approve', { count: 1 }), '1 report is back in the review queue.');
});

test('every undo answer starts with what is true now (bulk, single report, outcome, flag, Pro window, credits, merge)', async () => {
  const { call } = await rig();
  const messages = [];
  const undoOf = async (r) => {
    assert.equal(r.statusCode, 200, JSON.stringify(r.jsonBody));
    assert.ok(r.jsonBody.undo, `no undo offered: ${JSON.stringify(r.jsonBody).slice(0, 200)}`);
    const u = await call({ action: 'undo', ...r.jsonBody.undo.args });
    assert.equal(u.statusCode, 200, JSON.stringify(u.jsonBody));
    messages.push(u.jsonBody.message);
    return u.jsonBody.message;
  };
  const bulk = await undoOf(await call({ action: 'review_held', decision: 'reject', scope: 'all' }));
  assert.match(bulk, /^12 reports are back in the review queue, no longer rejected\.$/);
  await undoOf(await call({ action: 'moderate_report', id: uid(3, '2'), decision: 'hold' }));
  await undoOf(await call({ action: 'correct_report_outcome', id: uid(2, '2'), outcome: 'ghosted' }));
  await undoOf(await call({ action: 'set_flag', flag_name: 'seenfit_engine_enabled', status: 'off' }));
  await undoOf(await call({ action: 'set_pro_window', user_id: uid(1, '6'), until: ago(-10 * D) }));
  assert.equal(await undoOf(await call({ action: 'grant_credits', user_id: uid(1, '6'), amount: 3, request_id: 'r10-grant-0001' })), 'The balance is back to 7.');
  await undoOf(await call({ action: 'merge', primary: 'walmart', secondary: 'walmart inc' }));
  for (const m of messages) {
    assert.ok(!UNDID.test(m), m);
    assert.match(m, /^[A-Z0-9]/, m);
  }
});

// ── 2. duplicate check, remembered ───────────────────────────────────────────────────────────────
function dupWorld(T) {
  // Two held positives copy a live report word for word; the rest are clean.
  T.reports.push({ id: uid(900, '2'), company_name: 'Walmart', outcome: 'interview', role: 'Cashier', platform: 'Seen', source: 'direct', created_at: ago(D), report_text: 'Held account number 4 with its own words for the test', outcome_weight: 1, trust_reason: null, needs_review: false });
  T.reports.push({ id: uid(901, '2'), company_name: 'Walmart', outcome: 'interview', role: 'Cashier', platform: 'Seen', source: 'direct', created_at: ago(D), report_text: 'Held account number 8 with its own words for the test', outcome_weight: 1, trust_reason: null, needs_review: false });
}
const liveReads = (fake) => fake.log.filter((l) => String(l.url || l).includes('/rest/v1/reports?') && String(l.url || l).includes('needs_review=is.false')).length;

test('list: a short budget leaves rows "checking N more" (never a wrong number); the next read finishes and remembers; a cold-budget read after that is complete from the cache with no live reads', async () => {
  resetDupMemory();
  const { fake, call } = await rig(dupWorld);
  const prev = review.LIVE_CHECK.listBudgetMs;
  try {
    review.LIVE_CHECK.listBudgetMs = -1; // no time for any live read
    const cold = (await call({ action: 'list_held_reports' })).jsonBody;
    assert.deepEqual(C.checkList(cold), []);
    assert.equal(cold.checked.complete, false);
    assert.equal(cold.checked.n, 0);
    assert.equal(cold.checked.of, 12);
    assert.match(cold.checked.label, /checked 0 of 12 for copies — checking 12 more/);
    assert.equal(cold.counts.clear_positives, 0, 'nothing unchecked is counted as clear');
    assert.equal(cold.counts.unchecked, 12);

    review.LIVE_CHECK.listBudgetMs = 8000;
    const warm = (await call({ action: 'list_held_reports' })).jsonBody;
    assert.equal(warm.checked.complete, true);
    assert.equal(warm.counts.possible_duplicates, 2);
    assert.ok(warm.counts.clear_positives > 0);
    assert.equal(fake.tables.admin_dup_checks.length, 12, 'every checked row remembered');
    assert.ok(liveReads(fake) > 0, 'the warm read did read published reports (the counter sees them)');

    review.LIVE_CHECK.listBudgetMs = -1;
    const before = liveReads(fake);
    const again = (await call({ action: 'list_held_reports' })).jsonBody;
    assert.equal(liveReads(fake), before, 'answered from the cache — no live reads');
    assert.equal(again.checked.complete, true);
    assert.deepEqual(again.counts, warm.counts, 'the same numbers on every load');

    // Approve all positive with the guard given no time: it falls back to the remembered check → nothing unchecked.
    const gPrev = review.LIVE_CHECK.guardBudgetMs;
    review.LIVE_CHECK.guardBudgetMs = -1;
    try {
      const a = await call({ action: 'review_held', decision: 'approve', scope: 'all', group: 'positive' });
      assert.equal(a.statusCode, 200, JSON.stringify(a.jsonBody));
      assert.equal(a.jsonBody.not_checked, 0);
      assert.equal(a.jsonBody.changed, warm.counts.clear_positives, 'publishes exactly the count the screen showed');
    } finally { review.LIVE_CHECK.guardBudgetMs = gPrev; }
  } finally { review.LIVE_CHECK.listBudgetMs = prev; }
});

test('a company whose reports change loses its remembered checks (a copy of a newly published report is never read clean)', async () => {
  resetDupMemory();
  const { fake, call } = await rig();
  await call({ action: 'list_held_reports' }); // warm: all 12 clean
  const tesla = fake.tables.admin_dup_checks.filter((e) => e.company === 'tesla').length;
  assert.ok(tesla > 0);
  // A live Tesla report with the same words as held row 1 appears, and a Tesla report is moderated (publish path).
  fake.tables.reports.push({ id: uid(950, '2'), company_name: 'Tesla', outcome: 'interview', role: 'x', platform: 'Seen', source: 'direct', created_at: ago(1000), report_text: 'Held account number 1 with its own words for the test', outcome_weight: 1, trust_reason: null, needs_review: false });
  const m = await call({ action: 'moderate_report', id: uid(2, '2'), decision: 'hold' });
  assert.equal(m.statusCode, 200, JSON.stringify(m.jsonBody));
  assert.equal(fake.tables.admin_dup_checks.filter((e) => e.company === 'tesla').length, 0, 'Tesla\'s remembered checks cleared');
  const l = (await call({ action: 'list_held_reports' })).jsonBody;
  const row = l.rows.find((r) => r.id === uid(2, '1'));
  assert.ok(row.review.flags.includes('possible_duplicate'), 'checked again and found');
});

test('cache table missing → the same behaviour from process memory', async () => {
  resetDupMemory();
  const { fake, call } = await rig(dupWorld, { missing: ['admin_dup_checks'] });
  const prev = review.LIVE_CHECK.listBudgetMs;
  try {
    const warm = (await call({ action: 'list_held_reports' })).jsonBody;
    assert.equal(warm.checked.complete, true);
    review.LIVE_CHECK.listBudgetMs = -1;
    const before = liveReads(fake);
    const again = (await call({ action: 'list_held_reports' })).jsonBody;
    assert.equal(liveReads(fake), before);
    assert.deepEqual(again.counts, warm.counts);
  } finally { review.LIVE_CHECK.listBudgetMs = prev; }
});

// ── 3. a long undo is a job ──────────────────────────────────────────────────────────────────────
test('undo of 300 rejections in rounds: a lost round is re-sent with the same number and replays; job_status says what is left; a late re-send after the end says done (not "already undone" as a failure)', async () => {
  const { fake, call } = await rig(() => {}, {}, { held: 300 });
  const heldNow = () => fake.tables.reports.filter((r) => r.needs_review === true && r.trust_reason === 'external_import').length;
  const rj = await call({ action: 'review_held', decision: 'reject', scope: 'all', request_id: '7c1f0a3e-0000-4000-8000-000000000001' });
  assert.equal(rj.statusCode, 200, JSON.stringify(rj.jsonBody).slice(0, 300));
  assert.equal(rj.jsonBody.changed, 300);
  assert.equal(heldNow(), 0);
  const audit = rj.jsonBody.undo.args.audit_id;
  const prev = system.UNDO_TUNING.roundMs;
  system.UNDO_TUNING.roundMs = 1; // one 40-row chunk per round
  try {
    const rid = 'undo-job-r10-0001';
    const send = (round) => call({ action: 'undo', audit_id: audit, request_id: rid, round });
    const r1 = (await send(1)).jsonBody;
    assert.equal(r1.complete, false);
    assert.ok(r1.remaining > 0);
    let counted = r1.changed;
    // Round 2: the server finishes it, the answer is lost.
    await send(2);
    const afterLost = heldNow();
    const st = (await call({ action: 'job_status', kind: 'undo', audit_id: audit })).jsonBody;
    assert.equal(st.remaining, 300 - afterLost, 'job_status reads what is left from the reports themselves');
    assert.equal(st.restored, afterLost);
    const r2 = (await send(2)).jsonBody;
    assert.equal(r2.replayed, true, 'the lost round replays — never run twice, never "failed"');
    assert.equal(heldNow(), afterLost);
    counted += r2.recorded_changed;
    let round = 3, last = r2;
    while (!last.complete && round < 40) { last = (await send(round)).jsonBody; counted += last.changed; round++; }
    assert.equal(last.complete, true);
    assert.equal(last.remaining, 0);
    assert.equal(heldNow(), 300);
    assert.equal(counted, 300, 'each row counted once across rounds');
    assert.equal(last.message, '300 reports are back in the review queue, no longer rejected.');
    // The last round's answer is lost too: re-sent → replay; a later round number → done, not a 409.
    assert.equal((await send(round - 1)).jsonBody.replayed, true);
    const late = await send(round);
    assert.equal(late.statusCode, 200, JSON.stringify(late.jsonBody));
    assert.equal(late.jsonBody.complete, true);
    assert.equal(late.jsonBody.already_undone, true);
    assert.equal(late.jsonBody.message, '300 reports are back in the review queue, no longer rejected.');
    const st2 = (await call({ action: 'job_status', kind: 'undo', audit_id: audit })).jsonBody;
    assert.equal(st2.remaining, 0);
    assert.equal(st2.complete, true);
    assert.equal(st2.undone, true);
  } finally { system.UNDO_TUNING.roundMs = prev; }
});

// ── follow-up: one compare key for the live check and the remembered one ─────────────────────────
const heldRow = (n, company, hoursAgo, extra = {}) => ({ id: uid(n, '61'), company_name: company, outcome: 'interview', role: 'Cashier', platform: 'Indeed', source: 'external', created_at: ago(hoursAgo * 3600e3), report_text: 'Applied online, phone screen in a week, then an in-store interview with the manager', outcome_weight: 0.55, trust_reason: 'external_import', needs_review: true, ...extra });

test('"Home Depot" / "home  depot" held twice: the cached path marks the later copy; approve-all-positive with a no-budget guard publishes one and names the other', async () => {
  resetDupMemory();
  const { fake, call } = await rig((T) => { T.reports = [heldRow(1, 'Home Depot', 5), heldRow(2, 'home  depot', 1)]; }, {}, { held: 0, liveReports: 0 });
  const prev = review.LIVE_CHECK.listBudgetMs, gPrev = review.LIVE_CHECK.guardBudgetMs;
  try {
    await call({ action: 'list_held_reports' }); // warm the cache
    review.LIVE_CHECK.listBudgetMs = -1;
    const l = (await call({ action: 'list_held_reports' })).jsonBody;
    assert.equal(l.checked.complete, true, 'answered from the cache');
    const copy = l.rows.find((r) => r.id === uid(2, '61'));
    const orig = l.rows.find((r) => r.id === uid(1, '61'));
    assert.ok(copy.review.flags.includes('possible_duplicate'), 'the later copy is marked');
    assert.ok(!orig.review.flags.includes('possible_duplicate'), 'the oldest is not');
    assert.equal(l.counts.clear_positives, 1);
    review.LIVE_CHECK.guardBudgetMs = -1;
    const a = await call({ action: 'review_held', decision: 'approve', scope: 'all', group: 'positive' });
    assert.equal(a.statusCode, 200, JSON.stringify(a.jsonBody));
    assert.equal(a.jsonBody.changed, 1);
    assert.equal(a.jsonBody.not_checked, 0);
    assert.deepEqual(a.jsonBody.skipped.filter((s) => s.reason === 'possible_duplicate').map((s) => s.ids), [[uid(2, '61')]]);
    assert.equal(fake.tables.reports.find((r) => r.id === uid(1, '61')).needs_review, false, 'the original is published');
    assert.equal(fake.tables.reports.find((r) => r.id === uid(2, '61')).needs_review, true, 'the copy stays held');
  } finally { review.LIVE_CHECK.listBudgetMs = prev; review.LIVE_CHECK.guardBudgetMs = gPrev; }
});

test('held "home  depot" copying a PUBLISHED "Home Depot" report: the remembered answer equals the live one, and the no-budget guard skips it', async () => {
  resetDupMemory();
  const { call } = await rig((T) => { T.reports = [heldRow(9, 'Home Depot', 9, { needs_review: false, trust_reason: null }), heldRow(3, 'home  depot', 1), heldRow(4, 'Lowe’s', 1, { report_text: 'A different account entirely, with its own words' })]; }, {}, { held: 0, liveReports: 0 });
  const prev = review.LIVE_CHECK.listBudgetMs, gPrev = review.LIVE_CHECK.guardBudgetMs;
  try {
    const live = (await call({ action: 'list_held_reports' })).jsonBody;
    review.LIVE_CHECK.listBudgetMs = -1;
    const cached = (await call({ action: 'list_held_reports' })).jsonBody;
    const flag = (l) => l.rows.find((r) => r.id === uid(3, '61')).review.flags.includes('possible_duplicate');
    assert.equal(flag(live), true, 'the live read finds the published original');
    assert.equal(flag(cached), true, 'the remembered answer is the same answer');
    assert.deepEqual(cached.counts, live.counts);
    review.LIVE_CHECK.guardBudgetMs = -1;
    const a = (await call({ action: 'review_held', decision: 'approve', scope: 'all', group: 'positive' })).jsonBody;
    assert.equal(a.changed, 1, 'only the clean Lowe’s account');
    assert.deepEqual(a.skipped.filter((s) => s.reason === 'possible_duplicate').map((s) => s.ids), [[uid(3, '61')]]);
  } finally { review.LIVE_CHECK.listBudgetMs = prev; review.LIVE_CHECK.guardBudgetMs = gPrev; }
});
