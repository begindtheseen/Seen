// THE cross-tool agreement test (X, 2026-11-10). The owner opens one posting and reads the free fit check, the paid
// Optimize, the Studio tailor, Job Insights and Interview Prep one after another: any count, band, score, status, evidence
// line or gate sentence that differs between two of them for the same résumé and posting is a defect. Every assertion
// here is AGREEMENT between tools — never a particular value — so it stays valid while the reader and the scoring change
// what the values are.
//
// Pairs: 4 personas × lib/fixtures/personas/postings-sample.json + 20 public corpus postings across fields
// (lib/fixtures/crosstool/corpus-pairs.json), each with a résumé from its field. Each tool is called the way its handler
// calls it (lib/optimizer/crossToolHarness.mjs).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS } from './crossToolPairs.mjs';
import { allTools, agreementChecks, readOnlyChecks, sampleConfirmations, runFree } from './crossToolHarness.mjs';

const RUNS = [];
before(async () => {
  for (const p of PAIRS) RUNS.push({ id: p.id, r: await allTools(p) });
}, { timeout: 600_000 });

const fmt = (bad) => bad.map((b) => `${b.id}: [${b.tool}] ${b.check} — ${b.detail}`).join('\n');
const failures = (check, tools = ['paid', 'studio', 'insights']) => RUNS.flatMap(({ id, r }) => agreementChecks(r).filter((b) => b.check === check && tools.includes(b.tool)).map((b) => ({ id, ...b })));

test('the pair set is the fixed set (32 persona pairs + 20 corpus pairs)', () => {
  assert.equal(PAIRS.length, 52);
  assert.equal(RUNS.length, PAIRS.length);
});

test('one requirement count: the paid result, the Studio and Job Insights print the fit check\'s requirement_count (Insights: items + conditions = the count)', () => {
  const bad = failures('count');
  assert.equal(bad.length, 0, fmt(bad));
});

test('one verdict: band, score and the verdict sentence are the fit check\'s in the paid result and the Studio', () => {
  const bad = failures('verdict');
  assert.equal(bad.length, 0, fmt(bad));
});

test('one status per statement: every statement a tool shows carries the fit check\'s status', () => {
  const bad = failures('status');
  assert.equal(bad.length, 0, fmt(bad));
});

test('no tool shows a display:false statement or a promise as a requirement row', () => {
  const bad = failures('hidden');
  assert.equal(bad.length, 0, fmt(bad));
});

test('no tool shows a requirement that is not one of the reader\'s statements (Insights items carry their statement id)', () => {
  const bad = failures('unknown');
  assert.equal(bad.length, 0, fmt(bad));
});

test('the evidence line printed for a statement is the fit check\'s line for it', () => {
  const bad = failures('evidence');
  assert.equal(bad.length, 0, fmt(bad));
});

test('years / degree / license sentences are the gate\'s sentence verbatim wherever they appear', () => {
  const bad = failures('gates', ['paid', 'studio']);
  assert.equal(bad.length, 0, fmt(bad));
});

test('paid visibility counts DISPLAYED statements: "of" is the requirement count; every one counted is shown or partly in the fit check', () => {
  for (const { id, r } of RUNS) {
    for (const [name, t] of [['paid', r.paid.tailored], ['studio', r.studio.tailored]]) {
      if (!t || !t.visibility || t.error) continue;
      const v = t.visibility;
      assert.equal(v.of, r.free.requirement_count, `${id} ${name}: of ${v.of} vs ${r.free.requirement_count}`);
      assert.ok(v.before <= v.of && v.after <= v.of, `${id} ${name}: ${JSON.stringify(v)}`);
      const st = new Map((r.free.statements || []).map((s) => [s.id, s]));
      for (const sid of [...(v.ids_before || []), ...(v.ids_after || [])]) {
        const s = st.get(sid);
        assert.ok(s && s.display !== false && ['shown', 'partly'].includes(s.status), `${id} ${name}: ${sid} counted up front but the fit check says ${s && s.status}`);
      }
    }
    // the paid and the Studio result agree on what a credit buys (same rule, same counts)
    if (r.paid.tailored && r.studio.tailored && !r.paid.tailored.error && !r.studio.tailored.error) {
      assert.equal(r.paid.charge.reason, r.studio.charge.reason, `${id}: charge ${r.paid.charge.reason} vs Studio ${r.studio.charge.reason}`);
    }
  }
});

test('strict charge (director 2026-11-10): a credit only when more displayed statements sit up front — pinned on warehouse × Integrity and maria × ConvenientMD', () => {
  for (const { id, r } of RUNS) {
    for (const [name, o] of [['paid', r.paid], ['studio', r.studio]]) {
      const t = o.tailored; const c = o.charge;
      if (!t || !c) continue;
      if (c.charge) assert.ok(t.visibility.after > t.visibility.before, `${id} ${name}: charged with ${JSON.stringify(t.visibility)}`);
    }
  }
  for (const id of ['warehouse×warehouse-associate-integrity', 'maria×medical-receptionist-convenientmd']) {
    const { r } = RUNS.find((x) => x.id === id);
    // T3 round 5: the first-read planner may now find a REAL gain on these pairs (warehouse × Integrity: its cycle-count
    // line moves into the first read, 6 → 7) — then the charge names it; otherwise the result is free and says why
    if (r.paid.charge.charge) { assert.ok(r.paid.tailored.visibility.after > r.paid.tailored.visibility.before, id); assert.match(r.paid.charge.headline, /are now in your first lines; before, \d+/, id); }
    else assert.match(r.paid.charge.sentence, /no credit is used/, id);
  }
});

test('gap questions are asked only about displayed statements the fit check does not show in full', () => {
  for (const { id, r } of RUNS) {
    const st = new Map((r.free.statements || []).map((s) => [s.id, s]));
    for (const q of (r.paid.questions || []).filter((x) => x.kind === 'gap')) {
      const s = st.get(q.statementId);
      assert.ok(s && s.display !== false && ['not_shown', 'partly', 'cannot_tell'].includes(s.status), `${id}: "${q.question}" asks about ${q.statementId} (${s ? `${s.status}, display ${s.display}` : 'no statement'})`);
    }
  }
});

test('a blocked result quotes statement text, never a keyword label', () => {
  for (const { id, r } of RUNS) {
    const b = r.paid.blocked;
    if (!b || b.reason !== 'different_field') continue;
    const texts = new Set((r.free.statements || []).filter((s) => s.display !== false).map((s) => s.text.replace(/[.\s]+$/, '')));
    const quoted = [...String(b.sentence).matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/[.\s]+$/, ''));
    for (const q of quoted) assert.ok(texts.has(q), `${id}: blocked sentence quotes "${q}", which is not a displayed statement`);
  }
});

// Read-only: Interview Prep and matched jobs are their engineers' files this round. Divergences are listed (todo), not
// failed; move each to a hard assertion once its owner lands the fix. (Prep landed its fix in round 6: a not_shown line
// is a gap row, "only you can say" holds cannot_tell only — now a hard assertion.)
test('Interview Prep job match: each statement row says the fit check\'s status', () => {
  const bad = RUNS.flatMap(({ id, r }) => readOnlyChecks(r).filter((b) => b.tool === 'prep').map((b) => ({ id, ...b })));
  assert.equal(bad.length, 0, fmt(bad));
});

test('matched jobs: the reason\'s years figure and the failed gates are the fit check\'s', { todo: 'matched-jobs engineer (lib/server/jobKeys.js sharedGates / matchListing)' }, () => {
  const bad = RUNS.flatMap(({ id, r }) => readOnlyChecks(r).filter((b) => b.tool === 'matched' && b.check !== 'gate_match').map((b) => ({ id, ...b })));
  assert.equal(bad.length, 0, fmt(bad));
});

// becomes a hard test when the matched-jobs engineer's Round 5 lands (director/reports/m-matched.md "Round 5")
test('matched jobs: no rail or emailed match for a pair where a gate of the fit check is not met', { todo: 'matched-jobs Round 5: the final yes comes from the shared gates' }, () => {
  const bad = RUNS.flatMap(({ id, r }) => readOnlyChecks(r).filter((b) => b.check === 'gate_match').map((b) => ({ id, ...b })));
  assert.equal(bad.length, 0, fmt(bad));
});

// The person's answers (lib/optimizer/confirmations.js): with a fixed set, every tool agrees on the changed statuses and
// counts, and every changed line says it came from the person (by:'you'); with none, nothing changes.
const ANSWERED = ['warehouse×warehouse-associate-integrity', 'maria×medical-receptionist-convenientmd', 'accountant×c282', 'nurse×c150', 'dev×c22'];
test('answers: free, paid and Studio agree on every status, count, band, score and sentence; changed lines carry by:"you"', async () => {
  for (const id of ANSWERED) {
    const p = PAIRS.find((x) => x.id === id);
    const plain = RUNS.find((x) => x.id === id).r.free;
    const confirmed = sampleConfirmations(plain);
    const r = await allTools({ ...p, confirmed });
    const bad = agreementChecks(r).filter((b) => ['paid', 'studio'].includes(b.tool));
    assert.equal(bad.length, 0, fmt(bad.map((b) => ({ id, ...b }))));
    assert.ok(r.free.confirmations && r.free.confirmations.applied > 0, `${id}: ${JSON.stringify(r.free.confirmations)}`);
    assert.equal(r.free.confirmations.ignored, 2, `${id}: the two invalid entries are ignored`);
    const mine = (r.free.statements || []).filter((s) => s.by === 'you').map((s) => s.id).sort();
    assert.equal(mine.length, r.free.confirmations.applied - (confirmed.some((c) => c.answer === 'no' && c.line) ? 1 : 0), id);
    for (const tool of ['paid', 'studio']) {
      const by = (r[tool].statements || []).filter((s) => s.by === 'you').map((s) => s.id).sort();
      assert.deepEqual(by, mine, `${id} ${tool}: by:'you' lines`);
    }
    assert.equal(r.free.requirement_count, plain.requirement_count, `${id}: answers never change what the posting lists`);
  }
});

test('answers: none sent → the fit check is byte-identical to a run without the field', () => {
  for (const id of ANSWERED) {
    const p = PAIRS.find((x) => x.id === id);
    assert.equal(JSON.stringify(runFree({ ...p, confirmed: [] })), JSON.stringify(RUNS.find((x) => x.id === id).r.free), id);
  }
});
