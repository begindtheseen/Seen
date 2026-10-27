// The finished answer: the person's typed words replace the [blanks] one for one; nothing else changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAnswer, composeAnswer, isFinished, blankCount } from './prepAnswer.ts';

const A = 'At Target, where I was a Guest Experience Team Lead, I built weekly schedules for more than 40 hours of coverage. [What made it hard, and one thing you did that someone else might not have.] I cut overtime 22% while meeting peak-season staffing.';

test('blanks are found and counted', () => {
  assert.equal(blankCount(A), 1);
  assert.equal(blankCount('[One.] [Two.] [Three.]'), 3);
  assert.deepEqual(splitAnswer('a [b] c').map((p) => ('blank' in p ? `_${p.index}` : p.text)), ['a ', '_0', ' c']);
});

test('a typed sentence takes its blank, tidied; an empty one keeps the prompt', () => {
  const done = composeAnswer(A, ['payroll was cut the week of the back-to-school truck, so I moved the two openers to the truck shift']);
  assert.equal(done, 'At Target, where I was a Guest Experience Team Lead, I built weekly schedules for more than 40 hours of coverage. Payroll was cut the week of the back-to-school truck, so I moved the two openers to the truck shift. I cut overtime 22% while meeting peak-season staffing.');
  assert.equal(composeAnswer(A, ['']), A);
  assert.equal(isFinished(A, ['x']), true);
  assert.equal(isFinished(A, []), false);
  assert.equal(isFinished('No blanks here.', []), true);
});

test('a three-line frame becomes three sentences', () => {
  const f = '[Where you were and what was going on, in one sentence.] [What you did, step by step.] [How it ended — with a number if you have one.]';
  assert.equal(composeAnswer(f, ['we were short two people on a Saturday', 'I split the floor and took the register myself.', 'we closed on time and nobody waited more than five minutes']), 'We were short two people on a Saturday. I split the floor and took the register myself. We closed on time and nobody waited more than five minutes.');
});
