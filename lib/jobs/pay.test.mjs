// Run: node --test lib/jobs/pay.test.mjs
// Every phrasing is lifted from a real active Adzuna description in prod (read-only SQL, 2026-10-24)
// or from the audit screenshot ("Hourly Wage: $16 – $29" beside a "$33k" tile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statedHourlyPay, parseHourlyPay, displayPay, isYearlyPayText, isAnnualisedFrom } from './pay.js';

test('statedHourlyPay: reads the hourly figure the listing states, in every real phrasing', () => {
  assert.equal(statedHourlyPay('Hourly Wage: $16 – $29'), '$16–$29/hr');
  assert.equal(statedHourlyPay('from appoximately 8a.m.-5p.m.* Pay: $40/hr Our hospital is a'), '$40/hr');
  assert.equal(statedHourlyPay('Location: Redondo Beach, CA Base Pay: $17.50 per hour, plus tips'), '$17.50/hr');
  assert.equal(statedHourlyPay('Time Type: Part time Pay Range: $18.50 - $19 / hour Why Work Here'), '$18.50–$19/hr');
  assert.equal(statedHourlyPay('USD $16.80 - USD $19.50 /Hr. Do you like home repair projects?'), '$16.80–$19.50/hr');
  assert.equal(statedHourlyPay('Initial offers are made at the hourly base rate of $19. Additional compensation'), '$19/hr');
  assert.equal(statedHourlyPay('based on client requirements. $19/hour NO nights/weekends.'), '$19/hr');
  assert.equal(statedHourlyPay('Job Function: Barista Pay: $21.40 - $24.29 per hour Job Category: Retail'), '$21.40–$24.29/hr');
  assert.equal(statedHourlyPay('Salary: $35 - $45 per hour A bit about us: Our client'), '$35–$45/hr');
  assert.equal(statedHourlyPay('Hourly Pay Range: $25.36 - $38.04 - The hourly pay rate offered is determined'), '$25.36–$38.04/hr');
  assert.equal(statedHourlyPay('Compensation Range: $16.90 to $17.50 Hourly Location: 25290 Jeronimo Rd'), '$16.90–$17.50/hr');
  assert.equal(statedHourlyPay('FLSA Status : Non-Exempt Pay Range : $30-50/hour DOE travel stipends'), '$30–$50/hr');
});

test('statedHourlyPay: never invents one', () => {
  assert.equal(statedHourlyPay('this is a tipped position, the hourly minimum pay listed doesn\'t include tips'), null);
  assert.equal(statedHourlyPay('Salary $65,000 - $75,000 per year, 40 hours a week'), null);
  assert.equal(statedHourlyPay('$1,500 sign-on bonus. Hourly schedule, weekends.'), null);
  assert.equal(statedHourlyPay('great benefits, friendly team'), null);
  assert.equal(statedHourlyPay(''), null);
  assert.equal(statedHourlyPay(null), null);
});

test('displayPay: the stated hourly figure replaces an annualised tile, never a stated yearly salary', () => {
  assert.equal(displayPay({ salary: '$33k', description: 'Cashier wanted. Hourly Wage: $16 – $29. Apply today.' }), '$16–$29/hr');
  assert.equal(displayPay({ salary: '$57k–$80k', description: 'Pay: $27.50 - $38.50/hr' }), '$27.50–$38.50/hr');
  assert.equal(displayPay({ salary: '$128k', description: 'lead client work, great benefits' }), '$128k');
  assert.equal(displayPay({ salary: '$128k', description: 'On-call stipend of $50/hr in addition to base.' }), '$128k', 'a yearly salary that is NOT the hourly aside annualised stays');
  assert.equal(displayPay({ salary: '$40k', description: 'Pay: $19/hour' }), '$19/hr', '19 × 2080 = 39,520 → the "$40k" tile is that wage annualised');
  assert.equal(displayPay({ salary: '$80k', description: 'Pay: $40/hr' }), '$40/hr');
  assert.deepEqual(parseHourlyPay('Hourly Wage: $16 – $29'), { lo: 16, hi: 29, text: '$16–$29/hr' });
  assert.equal(isAnnualisedFrom(33280, 16), true);
  assert.equal(isAnnualisedFrom(33000, 16), true);
  assert.equal(isAnnualisedFrom(128000, 50), false);
  assert.equal(displayPay({ salary: null, description: 'Pay: $19/hour' }), '$19/hr');
  assert.equal(displayPay({ salary: '$18/hr', description: 'Pay: $19/hour' }), '$18/hr', 'a stored hourly figure is already what the listing said');
  assert.equal(displayPay({ salary: null, description: 'no pay here' }), null);
  assert.equal(isYearlyPayText('$33k'), true);
  assert.equal(isYearlyPayText('$57k–$80k'), true);
  assert.equal(isYearlyPayText('$18/hr'), false);
});
