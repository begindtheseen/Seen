import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFact, appendTimeline, ensureTimelineFrontmatter, recordFact } from './writeFact.js';
import { parseFrontmatter, normalizeFacts } from './memoryGraph.js';

const factsOf = (text, note = 'n.md') => normalizeFacts(parseFrontmatter(text).data, note).facts;
const active = (facts) => facts.filter((f) => f.valid_to == null);

test('appendTimeline repairs a headerless existing day without losing its body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seen-timeline-'));
  try {
    mkdirSync(join(dir, 'timeline'));
    const path = join(dir, 'timeline', '2026-08-14.md');
    writeFileSync(path, '## Existing\n\nkept verbatim\n');
    appendTimeline(dir, '2026-08-14', 'New', 'added');
    const text = readFileSync(path, 'utf8');
    assert.match(text, /^type: daily$/m);
    assert.match(text, /^date: 2026-08-14$/m);
    assert.match(text, /## Existing\n\nkept verbatim/);
    assert.match(text, /## New\n\nadded/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('timeline header repair leaves malformed frontmatter unchanged', () => {
  const malformed = '---\ntitle: broken\n## body\n';
  assert.equal(ensureTimelineFrontmatter(malformed, '2026-08-14'), malformed);
});

test('applyFact appends a well-formed bi-temporal fact to an empty note (scaffold)', () => {
  const out = applyFact('', 'claude-observations.md', { subject: 'Seen', predicate: 'mrr', object: '$0' }, '2026-07-07');
  const f = factsOf(out);
  assert.equal(f.length, 1);
  assert.deepEqual({ s: f[0].subject, p: f[0].predicate, o: f[0].object, vf: f[0].valid_from, vt: f[0].valid_to }, { s: 'Seen', p: 'mrr', o: '$0', vf: '2026-07-07', vt: null });
});

test('idempotent — recording the same value again is a no-op (returns null)', () => {
  const first = applyFact('', 'n.md', { subject: 'Seen', predicate: 'mrr', object: '$0' }, '2026-07-07');
  const again = applyFact(first, 'n.md', { subject: 'Seen', predicate: 'mrr', object: '$0' }, '2026-07-08');
  assert.equal(again, null);
});

test('supersede-not-overwrite — a changed value closes the old fact and appends a new active one', () => {
  const first = applyFact('', 'n.md', { subject: 'Seen', predicate: 'mrr', object: '$0' }, '2026-07-07');
  const second = applyFact(first, 'n.md', { subject: 'Seen', predicate: 'mrr', object: '$49' }, '2026-07-08');
  const f = factsOf(second);
  assert.equal(f.length, 2, 'both facts retained (history preserved)');
  const act = active(f);
  assert.equal(act.length, 1, 'exactly one active');
  assert.equal(act[0].object, '$49');
  const closed = f.find((x) => x.valid_to != null);
  assert.equal(closed.object, '$0');
  assert.equal(closed.valid_to, '2026-07-08');
  assert.equal(closed.invalidated, '2026-07-08', 'transaction-time closed too');
});

test('serializer round-trips special chars (wiki-link source, spaces, colon)', () => {
  const out = applyFact('', 'n.md', { subject: 'RESEND_KEY', predicate: 'status', object: 'live (noreply@seenjobs.io verified)', confidence: 'high', source: '[[environment]]' }, '2026-07-07');
  const f = factsOf(out)[0];
  assert.equal(f.object, 'live (noreply@seenjobs.io verified)');
  assert.equal(f.source, '[[environment]]');
  assert.equal(f.confidence, 'high');
});

// --- provenance (recorded_at / by / change / supersedes) — parity with command-os #124 ---

test('provenance — applyFact stamps recorded_at and carries by/change', () => {
  const out = applyFact('', 'n.md', { subject: 'Seen', predicate: 'free_tier', object: '1 credit/day', by: 'claude:test', change: 'set the launch tier' }, '2026-07-31', '2026-07-31T10:00:00.000Z');
  const f = factsOf(out)[0];
  assert.equal(f.recorded_at, '2026-07-31T10:00:00.000Z');
  assert.equal(f.by, 'claude:test');
  assert.equal(f.change, 'set the launch tier');
});

test('provenance — supersede links the new fact to the one it replaced via `supersedes`', () => {
  const first = applyFact('', 'n.md', { subject: 'Seen', predicate: 'free_tier', object: '3/day' }, '2026-07-30', '2026-07-30T00:00:00.000Z');
  const second = applyFact(first, 'n.md', { subject: 'Seen', predicate: 'free_tier', object: '1/day', by: 'claude:test', change: 'cut 3 to 1 to protect margin' }, '2026-07-31', '2026-07-31T00:00:00.000Z');
  const f = factsOf(second);
  const act = active(f)[0];
  const closed = f.find((x) => x.valid_to != null);
  assert.equal(act.object, '1/day');
  assert.equal(act.supersedes, closed.id, 'new fact points at the replaced fact');
  assert.equal(act.change, 'cut 3 to 1 to protect margin');
  assert.equal(act.by, 'claude:test');
});

test('provenance — absent by/change/supersedes emit no lines (stays clean on disk)', () => {
  const out = applyFact('', 'n.md', { subject: 'Seen', predicate: 'x', object: 'y' }, '2026-07-31', '2026-07-31T00:00:00.000Z');
  assert.ok(!/^\s*by:/m.test(out), 'no by: line when absent');
  assert.ok(!/^\s*change:/m.test(out), 'no change: line when absent');
  assert.ok(!/^\s*supersedes:/m.test(out), 'no supersedes: line on a first fact');
});

test('recordFact writes to disk and creates the note if missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'));
  const r1 = recordFact(dir, 'claude-observations.md', { subject: 'Seen', predicate: 'open_prs', object: '5' }, '2026-07-07');
  assert.equal(r1.written, 1);
  const r2 = recordFact(dir, 'claude-observations.md', { subject: 'Seen', predicate: 'open_prs', object: '5' }, '2026-07-07');
  assert.equal(r2.written, 0, 'second identical write is a no-op');
  assert.match(readFileSync(join(dir, 'claude-observations.md'), 'utf8'), /open_prs/);
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Serializer round-trip idempotence — the compounding-escape corruption regression.
//
// The old writer JSON-escaped double-quoted scalars while the parser stripped the quotes WITHOUT
// unescaping, so parse(write(x)) !== x. Since applyFact re-emits the WHOLE facts block on every
// write, one write of ANY fact re-escaped every neighbour: backslashes before a quote compounded
// n → 2n+1 per cycle (1, 3, 7, 15 … 1023). These tests pin both required properties:
//   parse(write(x)) === x            (the writer and parser are exact inverses)
//   write(parse(write(x))) === write(x)  (byte-level fixed point — no drift across cycles)
// ---------------------------------------------------------------------------

const HOSTILE = [
  ['double quotes + unicode middot', 'The "Optimized with Seen · seenjobs.io" PDF footer is mandatory'],
  ['single quotes', "it's a 'quoted' phrase"],
  ['windows path backslashes', 'C:\\Users\\brandon\\resume.pdf'],
  ['backslash immediately before a quote', 'a\\"b'],
  ['colons + em dash', 'ratio: 3:1 — measured on 2026-07-29'],
  ['brackets / wiki-link shape', '[[environment]] and [array, like]'],
  ['newlines-as-spaces', 'line one line two line three'],
  ['real newline + tab', 'newline\nliteral\ttab'],
  ['unicode accents + check', 'café ✓ — résumé · naïve'],
  ['leading hash (comment bait)', '# not a comment'],
  ['trailing space', 'trailing space '],
  ['leading space', '  leading space'],
  ['digit string', '42'],
  ['bool string', 'true'],
  ['null string', 'null'],
  ['empty string', ''],
  ['json blob', '{"json":"blob","n":[1,2]}'],
  ['hash AND quote together', 'has # hash and "quote" together'],
  ['lone backslash', '\\'],
  ['double backslash', '\\\\'],
  ['fully quoted value', '"fully quoted"'],
];

const objectOf = (text, predicate = 'p') =>
  factsOf(text).find((f) => f.predicate === predicate).object;

for (const [label, value] of HOSTILE) {
  test(`round-trip: parse(write(x)) === x — ${label}`, () => {
    const out = applyFact('', 'n.md', { subject: 'S', predicate: 'p', object: value }, '2026-07-01');
    assert.equal(objectOf(out), value);
  });

  test(`round-trip: stable across 5 write cycles (no escape compounding) — ${label}`, () => {
    let text = applyFact('', 'n.md', { subject: 'S', predicate: 'p', object: value }, '2026-07-01');
    const firstBlock = text;
    for (let i = 1; i <= 4; i++) {
      // A write of a DIFFERENT fact re-serializes the neighbour — the exact corruption vector.
      text = applyFact(text, 'n.md', { subject: 'S', predicate: `neighbour_${i}`, object: 'x' }, `2026-07-0${i + 1}`) ?? text;
      assert.equal(objectOf(text), value, `drifted on cycle ${i}`);
    }
    // write(parse(write(x))) === write(x): re-emitting the untouched fact reproduces the same bytes.
    // (Byte equality is the strongest form of "no drift" — it forbids escape growth by construction.)
    const line = (t) => t.split('\n').find((l) => l.trim().startsWith('object:'));
    assert.equal(line(text), line(firstBlock), 'serialized bytes drifted');
  });
}

test('regression: recording a quoted value 20 times never grows a backslash run', () => {
  const value = 'The "Optimized with Seen · seenjobs.io" PDF footer is mandatory';
  let text = applyFact('', 'claude-observations.md', { subject: 'Seen resume PDF export', predicate: 'watermark_policy', object: value }, '2026-07-01');
  for (let i = 1; i <= 20; i++) {
    text = applyFact(text, 'claude-observations.md', { subject: 'Seen', predicate: `session_${i}`, object: 'ran' }, '2026-07-02') ?? text;
  }
  assert.equal(objectOf(text, 'watermark_policy'), value);
  // The value holds two quotes and no backslashes, so the note must hold exactly two escapes
  // (`\"` per quote) forever — under the old serializer this reached 1022 after 8 sessions.
  assert.equal((text.match(/\\/g) || []).length, 2, 'escapes multiplied');
  assert.ok(!/\\{2,}/.test(text), 'a compounded backslash run appeared');
});

test('preserves other frontmatter keys and the body (surgical edit)', () => {
  const doc = `---\ntitle: Env\ntags: [deploy]\naliases: [Env Vars]\nfacts: []\n---\n\n# Body heading\n\nprose stays.\n`;
  const out = applyFact(doc, 'environment.md', { subject: 'X', predicate: 'y', object: 'z' }, '2026-07-07');
  assert.match(out, /title: Env/);
  assert.match(out, /aliases: \[Env Vars\]/);
  assert.match(out, /# Body heading/);
  assert.match(out, /prose stays\./);
});
