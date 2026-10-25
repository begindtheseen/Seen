// AI polish safety, with the model stubbed (an OpenAI-compatible fake on globalThis.fetch — no
// network, no model). 2026-10-25: the polish removed "Python" from Dev's bullet and came
// pre-accepted; it turned Maria's "per shift" into "daily"; and its firewall rejected every lead-verb
// swap, so some résumés got nothing (harness).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_API_KEY = 'test-key';
delete process.env.ANTHROPIC_KEY;
const { polishBullets } = await import('./polish.js');

function stubModel(changes) {
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ changes }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('a polish that drops a skill, changes a rate or a number is rejected; a neutral verb swap passes', async () => {
  const bullets = [
    { id: 'dev', text: 'Wrote Python (FastAPI) services for equity grant workflows; designed Postgres schema with row-level security for 900 customer orgs.' },
    { id: 'maria', text: 'Processed returns, exchanges and 200+ transactions per shift with accurate cash handling.' },
    { id: 'ovt', text: 'Built weekly schedules for 40+ hours of coverage; cut overtime 22% while meeting peak-season staffing.' },
    { id: 'tasha', text: 'Ran tabling and social posts for 10+ campus events a semester; event sign-ups grew about 30% year over year.' },
  ];
  stubModel([
    { id: 'dev', text: 'Wrote FastAPI services for equity grant workflows and designed a Postgres schema with row-level security for 900 customer orgs.', reason: 'tighter' },
    { id: 'maria', text: 'Processed returns, exchanges and 200+ daily transactions with accurate cash handling.', reason: 'tighter' },
    { id: 'ovt', text: 'Built weekly schedules for 40+ hours of coverage; cut overtime 20% while meeting peak-season staffing.', reason: 'tighter' },
    { id: 'tasha', text: 'Organized tabling and social posts for 10+ campus events a semester; event sign-ups grew about 30% year over year.', reason: 'clearer verb' },
  ]);
  const r = await polishBullets(bullets, { allowedKeywords: [], resumeText: bullets.map((b) => b.text).join('\n'), jobTitle: 'Coordinator' });
  const rejected = Object.fromEntries(r.rejected.map((x) => [x.id, x.reason]));
  assert.match(rejected.dev, /removed_term:python/i);
  assert.match(rejected.maria, /changed_rate:per shift/);
  assert.equal(rejected.ovt, 'changed_number');
  assert.deepEqual(r.changes.map((c) => c.id), ['tasha'], JSON.stringify(r));
});

test('the server returns polish edits as proposals — the variant keeps the person\'s words', async () => {
  const { tailorAction } = await import('../../server/resumeStudio.js');
  const { parseResume } = await import('../parse/index.js');
  const doc = parseResume({ text: 'Ana Ruiz\nana@example.com\nEXPERIENCE\nCampus Ambassador — Student Activities Office | Aug 2024 – May 2026\n• Ran tabling and social posts for 10+ campus events a semester; event sign-ups grew about 30% year over year.', source: 'text' });
  const id = doc.experience[0].bullets[0].id;
  stubModel([{ id, text: 'Organized tabling and social posts for 10+ campus events a semester; event sign-ups grew about 30% year over year.', reason: 'clearer verb' }]);
  const out = await tailorAction({ doc, jobTitle: 'Event Coordinator', jobDescription: 'Event Coordinator. Plan campus events, run tabling, post on social media, grow event sign-ups. 1+ years of event experience required.', polish: true }, { pro: true, allowPolish: true });
  assert.equal(out.polish.applied, 0);
  assert.equal(out.polish.proposed, out.polish.changes.length);
  assert.ok(out.variant.experience[0].bullets.every((b) => !/^Organized/.test(b.text)), 'not applied until accepted');
});
