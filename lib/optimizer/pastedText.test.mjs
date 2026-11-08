// The way a posting was copied never changes what is read from it (pastedText.js) — the 2026-11-08 paste
// stress formats on one real posting shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPastedPosting } from './pastedText.js';
import { runOptimizer } from './index.js';

const POSTING = `Senior Software Engineer at Axon.

Your Impact
As a senior engineer on the team, you will be involved in architecture decisions that shape this product.

What You'll Do
• Build services that meet high standards on availability and latency
• Mentor engineers on system design

What You Bring
• Bachelor's Degree in Computer Science, Engineering, or related field
• 6+ years of professional software development experience
• Backend service experience in Java, Scala, Go or C#
• Experience with SQL or NoSQL data stores
• Experience with Kubernetes and Terraform

Benefits that Benefit You
• Competitive salary and 401k with employer match`;

const count = (t) => runOptimizer({ resumeText: 'x', jobTitle: 'Senior Software Engineer', company: 'Axon', jobDescription: t }).requirement_count;

test('markdown, an email forward, odd bullets, a LinkedIn copy and one flat line read like the original', () => {
  const base = count(POSTING);
  assert.ok(base >= 6, `base ${base}`);
  const forms = {
    markdown: POSTING.replace(/^• /gm, '- ').replace(/^(Your Impact|What You'll Do|What You Bring|Benefits that Benefit You)$/gm, '## **$1**'),
    email: `---------- Forwarded message ---------\nFrom: Sam <sam@example.com>\nSubject: Role\n\n${POSTING.replace(/^/gm, '> ')}`,
    odd_bullets: POSTING.replace(/^• /gm, 'o ').replace(/\n/g, '\r\n'),
    linkedin: `About the job\n\n${POSTING}\n\n…show more\nShow less\nSee how you compare to 1,247 applicants\nApply\nSave`,
    flat: POSTING.replace(/\s*\n+\s*/g, ' '),
  };
  for (const [name, text] of Object.entries(forms)) assert.ok(count(text) >= base - 1, `${name}: ${count(text)} vs ${base}`);
});

test('the cleaner removes only the copying, never a word of the posting', () => {
  const c = cleanPastedPosting('## **Requirements**\n- 5+ years of [Python](https://python.org)\n> quoted? no, one line only\nApply\nShow more');
  assert.equal(c, 'Requirements\n• 5+ years of Python\n> quoted? no, one line only');
});

test('a hard-wrapped PDF copy is reflowed into its sentences', () => {
  const para = 'We are looking for a warehouse lead who can run a crew of twelve on the night shift and keep the dock moving safely every single night of the week without exception';
  const wrapped = Array.from({ length: 6 }, () => para).join('. ').replace(/(.{60,70}?)\s/g, '$1\n');
  const c = cleanPastedPosting(wrapped);
  assert.ok(c.split('\n').length < wrapped.split('\n').length / 3, 'lines were joined');
});
