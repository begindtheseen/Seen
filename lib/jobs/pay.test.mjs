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
  assert.equal(displayPay({ salary: '$128k', description: 'lead client work, great benefits' }), '$128k/yr');
  assert.equal(displayPay({ salary: '$128k', description: 'On-call stipend of $50/hr in addition to base.' }), '$128k/yr', 'a yearly salary that is NOT the hourly aside annualised stays');
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

// Real rows from the 2026-10-24 audit (scratchpad audit3/jobs/matrix.json, 2,659 unique jobs): what
// the API served → what Seen now shows. Titles are the listings' own.
test('C2: weekly, monthly and mixed pay is never relabelled hourly', () => {
  const show = (salary, title, description = '') => displayPay({ salary, title, description });
  assert.equal(show('$8760/hr', 'Travel Nurse RN - Medical-Surgical - $2,125 to $2,190 per week in Phoenix, AZ'), '$2,125–$2,190/wk');
  assert.equal(show('$9530/hr', 'Travel Nurse RN - Wound/Ostomy - $2,383 per week in Riverside, CA'), '$2,383/wk');
  assert.equal(show('$12k', 'Travel Nurse RN - Pediatric Intensive Care Unit - $2,700 to $3,000 per week in Phoenix, AZ'), '$2,700–$3,000/wk', 'the old "$12k" was 3,000 × 4');
  assert.equal(show('$13k', 'Travel Nurse RN - Medical-Surgical in Phoenix, AZ'), '$13,000', 'a figure fitting no period is shown raw');
  assert.equal(show('$9050.83/hr', 'Travel Nurse RN - Endoscopy in Glendale, AZ'), '$9,051');
  assert.equal(show('$988/hr–$1040/hr', 'Warehouse Associate', 'Weekly pay! Full time, 40 hours a week.'), '$988–$1,040/wk');
  assert.equal(show('$988/hr–$1040/hr', 'Warehouse Associate', 'Load trucks.'), '$988–$1,040', 'no period word → raw, never "/hr"');
  assert.equal(show('$228/hr', 'Warehouse/Distribution: FT Stocker /Associate/Fulfillment'), '$228');
  assert.equal(show('$124/hr–$99k', 'Software Engineer II'), '$124–$99,000', 'a range never mixes units');
  assert.equal(show('$33k', 'Cosmetics Cashier', 'Hourly Wage: $16 - $29 per/hour'), '$16–$29/hr');
  assert.equal(show('$13k–$14k', 'Peoplesoft Business Analyst', 'Rate: $13,000 - $14,000 per month'), '$13,000–$14,000/mo');
  assert.equal(show('$10k–$50k', 'Enterprise Sales Development Representative'), '$10,000–$50,000');
  assert.equal(show('$416k–$728k', 'Owner Operators'), '$416k–$728k/yr');
});

test('C2: every source phrasing renders in one format', () => {
  const show = (salary) => displayPay({ salary });
  assert.equal(show('$18 - $22 an hour'), '$18–$22/hr');
  assert.equal(show('$17.5 - $19.25 an hour'), '$17.50–$19.25/hr');
  assert.equal(show('From $18 an hour'), 'From $18/hr');
  assert.equal(show('$52,000 - $68,000 a year'), '$52k–$68k/yr');
  assert.equal(show('$45k – $60k / year'), '$45k–$60k/yr');
  assert.equal(show('$17 – $19 / hour'), '$17–$19/hr');
  assert.equal(show('120K'), '$120k/yr');
  assert.equal(show('$57k–$80k'), '$57k–$80k/yr');
  assert.equal(show('$1,040/wk'), '$1,040/wk');
  assert.equal(show('$3,900/mo'), '$3,900/mo');
  assert.equal(show('$52k–$68k/yr'), '$52k–$68k/yr', 'idempotent');
  assert.equal(show('Competitive + bonus'), 'Competitive + bonus', 'free text an employer typed is shown as written');
  assert.equal(show('401k match'), '401k match');
  assert.equal(displayPay({ salary: null, description: 'Stipend: $3,900 per month while training.' }), '$3,900/mo');
  assert.equal(displayPay({ salary: null, description: 'Earn $1,040/wk plus overtime.' }), '$1,040/wk');
  assert.equal(displayPay({ salary: null, description: '$228 per day, paid weekly' }), null, 'a daily rate states no period Seen renders');
});

test('C2: normalizePay — writers store one string and a yearly equivalent', async () => {
  const { normalizePay, payFields } = await import('./pay.js');
  assert.deepEqual(payFields({ min: 8760, max: 8760, text: 'Travel Nurse RN - $2,125 to $2,190 per week' }), { salary: '$2,125–$2,190/wk', salaryMin: 110500, salaryMax: 113880 });
  assert.deepEqual(payFields({ min: 33280, max: 33280, text: 'Hourly Wage: $16 – $29' }), { salary: '$16–$29/hr', salaryMin: 33280, salaryMax: 60320 });
  assert.deepEqual(payFields({ min: 988, max: 1040, text: 'paid weekly' }), { salary: '$988–$1,040/wk', salaryMin: 51376, salaryMax: 54080 });
  assert.deepEqual(payFields({ min: 228, max: 228, text: '' }), { salary: '$228', salaryMin: 0, salaryMax: 0 }, 'unknown period → yearly 0, never a guess');
  assert.deepEqual(payFields({ min: 52000, max: 68000 }), { salary: '$52k–$68k/yr', salaryMin: 52000, salaryMax: 68000 });
  assert.equal(normalizePay({ min: 3900, period: 'month' }).text, '$3,900/mo');
  assert.equal(normalizePay({ min: 25, period: 'year' }).text, '$25/hr', 'a declared period the figure cannot be in yields to magnitude');
  assert.equal(normalizePay({ min: 2000, max: 2000, text: '6-month contract, weekly pay' }).text, '$2,000', 'week AND month both possible → raw');
  assert.equal(normalizePay({ min: 150, max: 180, period: 'day' }).text, '$150–$180', 'a declared day rate is raw, not "/hr"');
  assert.equal(normalizePay({}), null);
});

test('payLabel names the period the tile shows', async () => {
  const { payLabel } = await import('./pay.js');
  assert.equal(payLabel('$16–$29/hr'), 'Hourly pay');
  assert.equal(payLabel('$1,040/wk'), 'Weekly pay');
  assert.equal(payLabel('$3,900/mo'), 'Monthly pay');
  assert.equal(payLabel('$52k–$68k/yr'), 'Salary');
  assert.equal(payLabel('$8,760'), 'Pay', 'a raw figure is never called a salary');
});
