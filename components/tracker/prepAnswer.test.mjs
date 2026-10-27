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

test('an email keeps its lines; a blank inside a sentence takes no stop and keeps its case (round 5, Tasha)', () => {
  const email = "Hi [interviewer's name],\n\nThank you for taking the time to talk with me about the Marketing Coordinator role at Grubhub. I enjoyed hearing about [one thing they told you], and it made me even more interested in the job.\n\nTasha Green";
  const done = composeAnswer(email, ['Ms. Okafor', 'the diner loyalty work your team is planning for next year']);
  assert.equal(done, "Hi Ms. Okafor,\n\nThank you for taking the time to talk with me about the Marketing Coordinator role at Grubhub. I enjoyed hearing about the diner loyalty work your team is planning for next year, and it made me even more interested in the job.\n\nTasha Green");
  // the intro's last bracket ends the sentence, so it gets its stop; a lowercase start stays lowercase mid-sentence
  const intro = "I also work as a Barista at Starbucks. I'm interested in the Marketing Coordinator role at Grubhub because [the one thing that drew you to this job].";
  assert.equal(composeAnswer(intro, ['I use Grubhub every week in the Loop']), "I also work as a Barista at Starbucks. I'm interested in the Marketing Coordinator role at Grubhub because I use Grubhub every week in the Loop.");
  assert.equal(composeAnswer('Why now? [one plain sentence on why] I am looking.', ['the contract ended']), 'Why now? The contract ended. I am looking.');
});
