// R4 invariant (verdict gold): a plain bullet under a requirements / duties / preferred heading always becomes a
// statement — displayed or hidden — never lost by the reader. (A pay line the section reader re-files as benefits is no
// longer under that heading, so it is outside the invariant.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJobFacts } from './extractJobFacts.js';

const ITEMS = [
  'This role follows a hybrid schedule.',
  'Patient and family education',
  'Interdisciplinary care coordination',
  'Medication administration',
  'Other duties as assigned',
  'Punctual and dependable',
  'Training',
];
const HEADINGS = ['Responsibilities', 'Requirements', 'Preferred Qualifications'];
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

for (const h of HEADINGS) {
  test(`every plain bullet under "${h}" becomes a statement`, () => {
    const text = `Acme Health is hiring a Registered Nurse.\n\n${h}\n${ITEMS.map((i) => `- ${i}`).join('\n')}\n`;
    const { statements = [] } = extractJobFacts(text, { company: 'Acme Health', title: 'Registered Nurse' });
    for (const it of ITEMS) {
      const hit = statements.find((s) => norm(s.source).includes(norm(it)) || norm(it).includes(norm(s.text)) && norm(s.text).length > 4);
      assert.ok(hit, `no statement for "${it}" under ${h}`);
    }
  });
}

test('short noun-phrase duties under a duties heading are displayed as duties; junk items are hidden with a reason', () => {
  const text = `Acme Health is hiring a Registered Nurse.\n\nResponsibilities\n${ITEMS.map((i) => `- ${i}`).join('\n')}\n`;
  const { statements = [] } = extractJobFacts(text, { company: 'Acme Health', title: 'Registered Nurse' });
  const by = (t) => statements.find((s) => norm(s.source).includes(norm(t)));
  for (const t of ['Patient and family education', 'Interdisciplinary care coordination']) {
    const s = by(t);
    assert.equal(s.display, true, t);
    assert.equal(s.shape, 'duty', t);
  }
  const cond = by('This role follows a hybrid schedule');
  assert.equal(cond.display, true);
  assert.equal(cond.shape, 'condition');
  assert.equal(by('Other duties as assigned').display, false);
  assert.match(by('Other duties as assigned').hideReason, /other_duties|not_a_requirement/);
  assert.equal(by('Training').display, false);
});
