import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionPosting } from './postingSections.js';

test('round 6: a requirement written after the EEO paragraph is a requirement, not legal text', () => {
  const posting = `Marketing Coordinator\nRequirements\n- Experience with HubSpot.\nEqual Opportunity Employer. All qualified candidates will receive consideration for employment without regard to race, color, religion or gender.\nThe collection, use, and handling of your data is described in our Privacy Policy.\n- Experience with Google Analytics and weekly reporting on campaign performance is required.`;
  const secs = sectionPosting(posting);
  const ga = secs.find((s) => /Google Analytics/.test(s.sentence));
  assert.ok(ga, secs.map((s) => `${s.kind}: ${s.sentence.slice(0, 40)}`).join(' | '));
  assert.equal(ga.kind, 'requirements');
  assert.equal(secs.find((s) => /Privacy Policy/.test(s.sentence)).kind, 'eeo');
});
