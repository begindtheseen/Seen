// Run: node --test lib/server/jobSources.pay.test.mjs
// Adzuna annualises an employer-stated hourly wage (live audit 2026-10-23: "$33k SALARY" beside
// "Hourly Wage: $16 – $29"); cleanDescription keeps paragraphs and caps at a sentence end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adzunaPay, cleanDescription } from './jobSources.js';

test('adzunaPay: the hourly figure the posting states replaces its annualisation; a real yearly salary stays', () => {
  assert.equal(adzunaPay({ salary_min: 33280, salary_max: 33280 }, 'Cashier. Hourly Wage: $16 – $29. Apply.').salary, '$16–$29/hr');
  assert.equal(adzunaPay({ salary_min: 33280, salary_max: 33280 }, 'Cashier. Hourly Wage: $16 – $29. Apply.').salaryMin, 33280, 'the scorer still sees disclosed pay');
  assert.equal(adzunaPay({ salary_min: 57200, salary_max: 80080 }, 'Pay: $27.50 - $38.50/hr').salary, '$27.50–$38.50/hr');
  assert.equal(adzunaPay({ salary_min: 128000, salary_max: 128000 }, 'On-call stipend of $50/hr.').salary, '$128k');
  assert.equal(adzunaPay({ salary_min: 128000, salary_max: 128000 }, 'no pay words').salary, '$128k');
  assert.equal(adzunaPay({ salary_min: 41683.01, salary_max: 41683.01, salary_is_predicted: '1' }, 'Pay: $20/hr').salary, null, 'an estimate is never shown, hourly text or not');
  assert.equal(adzunaPay({}, 'Pay: $20/hr').salary, null, 'no Adzuna figure → nothing to annualise; display-time displayPay handles the text');
});

test('cleanDescription: block tags end lines, entities decode once, spaces collapse, sentence-end cap', () => {
  const out = cleanDescription('<p>SpaceX was founded.</p><h2>RESPONSIBILITIES:</h2><ul><li>Work &amp; lead</li><li>Build &lt;things&gt; &#8217;now&#8217;</li></ul><p>Tail &amp;lt;b&amp;gt; stays escaped</p>');
  assert.equal(out, 'SpaceX was founded.\nRESPONSIBILITIES:\n\n• Work & lead\n\n• Build <things> ’now’\n\nTail &lt;b&gt; stays escaped');
  assert.equal(cleanDescription('a   b \t c'), 'a b c');
  assert.equal(cleanDescription('line one<br>line two<br/><br/><br/>line three'), 'line one\nline two\n\nline three');
  const long = Array.from({ length: 500 }, (_, i) => `Sentence ${i} about the role.`).join(' ');
  const capped = cleanDescription(long);
  assert.ok(capped.length <= 12000 && capped.length > 10500, `${capped.length}`);
  assert.match(capped, /role\.$/, 'never mid-word');
});
