import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

let notes = [];
global.fetch = async () => ({ ok: true, async text() { return JSON.stringify(notes); } });

const { briefing, BRIEFING_CAPS } = await import('./brainStore.js');
const { renderBriefingData } = await import('../../scripts/memory-status.mjs');

const note = (path, facts) => ({
  path,
  content: `---\ntitle: ${path}\nfacts:\n${facts.map((f) => `  - id: ${f.id}\n    subject: ${f.subject}\n    predicate: p\n    object: o\n    valid_from: ${f.recorded}\n    recorded: ${f.recorded}${f.invalidated ? `\n    valid_to: ${f.invalidated}\n    invalidated: ${f.invalidated}` : ''}`).join('\n')}\n---\n`,
});

// The live failure shape (2026-09-18): the OLD changes live in an early-sorting note, TODAY's in a
// late-sorting one. Index order is path order, so an unsorted cap kept the old and cut today.
const older = Array.from({ length: 9 }, (_, i) => ({ id: `old-${i}`, subject: `Old ${i}`, recorded: '2026-09-03' }));
const todays = Array.from({ length: 3 }, (_, i) => ({ id: `new-${i}`, subject: `Today ${i}`, recorded: '2026-09-18' }));

test('a capped briefing keeps the NEWEST changes and declares what it cut', async () => {
  notes = [note('a-early.md', older), note('z-late.md', todays)];
  const b = await briefing({ today: '2026-09-18', since: '2026-09-03' });

  assert.equal(b.changed.added.length, BRIEFING_CAPS.added);
  assert.deepEqual(b.changed.added.slice(0, 3).map((f) => f.recorded), ['2026-09-18', '2026-09-18', '2026-09-18'],
    "today's facts lead the list — they are never the ones a cap drops");
  assert.equal(b.totals.added, 12, 'the uncapped size crosses the wire');
  assert.deepEqual(b.truncated, ['added']);

  const text = renderBriefingData(b, '2026-09-18');
  assert.match(text, /12 added · 0 retired, newest first/);
  assert.match(text, /… 4 more not shown/, 'the session is TOLD the view is partial');
  assert.ok(text.indexOf('Today 0') < text.indexOf('Old 0'));
});

test('an uncut briefing claims no truncation, and retired facts sort by when they were retired', async () => {
  notes = [note('a.md', [
    { id: 'r1', subject: 'Retired early', recorded: '2026-08-01', invalidated: '2026-09-04' },
    { id: 'r2', subject: 'Retired late', recorded: '2026-08-01', invalidated: '2026-09-17' },
  ])];
  const b = await briefing({ today: '2026-09-18', since: '2026-09-03' });
  assert.deepEqual(b.truncated, []);
  assert.deepEqual(b.totals, { added: 0, invalidated: 2, openThreads: 0, contradictions: 0, lowConfidence: b.totals.lowConfidence });
  assert.deepEqual(b.changed.invalidated.map((f) => f.id), ['r2', 'r1'],
    'a fact recorded before `since` but retired inside it belongs here — bi-temporal, not a bug');
  assert.doesNotMatch(renderBriefingData(b, '2026-09-18'), /more not shown/);
});
