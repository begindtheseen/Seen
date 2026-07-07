import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFact, recordFact } from './writeFact.js';
import { parseFrontmatter, normalizeFacts } from './memoryGraph.js';

const factsOf = (text, note = 'n.md') => normalizeFacts(parseFrontmatter(text).data, note).facts;
const active = (facts) => facts.filter((f) => f.valid_to == null);

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

test('recordFact writes to disk and creates the note if missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-'));
  const r1 = recordFact(dir, 'claude-observations.md', { subject: 'Seen', predicate: 'open_prs', object: '5' }, '2026-07-07');
  assert.equal(r1.written, 1);
  const r2 = recordFact(dir, 'claude-observations.md', { subject: 'Seen', predicate: 'open_prs', object: '5' }, '2026-07-07');
  assert.equal(r2.written, 0, 'second identical write is a no-op');
  assert.match(readFileSync(join(dir, 'claude-observations.md'), 'utf8'), /open_prs/);
  rmSync(dir, { recursive: true, force: true });
});

test('preserves other frontmatter keys and the body (surgical edit)', () => {
  const doc = `---\ntitle: Env\ntags: [deploy]\naliases: [Env Vars]\nfacts: []\n---\n\n# Body heading\n\nprose stays.\n`;
  const out = applyFact(doc, 'environment.md', { subject: 'X', predicate: 'y', object: 'z' }, '2026-07-07');
  assert.match(out, /title: Env/);
  assert.match(out, /aliases: \[Env Vars\]/);
  assert.match(out, /# Body heading/);
  assert.match(out, /prose stays\./);
});
