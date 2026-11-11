// R4 (G4 item 3): the reader raises a constraint for every class the gates are ready for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJobFacts } from './extractJobFacts.js';
import { extractConstraints } from './postingSections.js';

const read = (line) => extractJobFacts(`Requirements:\n• ${line}\n• Experience with Excel\n• Strong communication skills\n• Bachelor's degree in a related field`, { jobTitle: 'Supervisor' })
  .filter((f) => f.factType === 'constraint' && f.kind !== 'degree');

test('years with a gerund subject and no word "experience"', () => {
  const [y] = read('2+ years supervising warehouse teams');
  assert.equal(y.kind, 'years'); assert.equal(y.value, 2); assert.match(y.alternatives[0].field, /supervising warehouse teams/);
});
test('years after a label and colon', () => {
  const [y] = read('Proven SaaS quota-carrying success: 5+ years closing complex Enterprise deals');
  assert.equal(y.kind, 'years'); assert.equal(y.value, 5); assert.match(y.alternatives[0].field, /closing complex Enterprise deals/);
});
test('a named state certification "or higher"', () => {
  const [c] = read('Current California Residential Electrician Certification or higher electrical certification');
  assert.equal(c.kind, 'certification'); assert.equal(c.label, 'California Residential Electrician Certification'); assert.equal(c.state, 'California'); assert.equal(c.gate, true);
});
test('a credential named with its acronym in parentheses', () => {
  const [c] = read('Registered Professional Engineer (PE) certification required');
  assert.equal(c.kind, 'certification'); assert.equal(c.label, 'Registered Professional Engineer (PE) certification'); assert.equal(c.gate, true);
});
test('a licence by its state alone, with a prospective alternative kept on the sentence', () => {
  const [c] = read('Must hold active license in the state of CA or have submitted application for licensure prior');
  assert.equal(c.kind, 'certification'); assert.equal(c.state, 'California'); assert.match(c.evidence || c.sentence, /submitted application/);
});
test('an endorsement, a permit and another state\'s licence are credentials', () => {
  const labels = (line) => extractConstraints(`Requirements:\n• ${line}`).filter((c) => c.kind === 'certification').map((c) => c.label);
  assert.ok(labels('Class A CDL with hazmat and tanker endorsements').includes('hazmat and tanker endorsements'));
  assert.ok(labels('Valid food handler permit').some((l) => /food handler permit/i.test(l)));
  assert.ok(labels('Active Texas or Oklahoma RN license').some((l) => /RN license/.test(l)));
});
test('preferred or "a plus" wording never gates a named credential', () => {
  const [c] = read('California Residential Electrician Certification is a plus');
  assert.ok(!c || c.gate === false);
});
test('linear time: credential and years patterns on 5,000 repetitions', () => {
  for (const u of ['Abc ', 'Abc Def (PE) ', 'license in the state of ', 'hazmat and ', '2 years supervising ']) {
    const t0 = Date.now();
    extractConstraints(`Requirements:\n• ${u.repeat(5000)}certification`);
    assert.ok(Date.now() - t0 < 5000, `"${u}" took ${Date.now() - t0} ms`);
  }
});
