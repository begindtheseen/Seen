// Round 8: the director's own read (a coffee-shop shift supervisor) and the seven rule classes found on the hidden
// half, each pinned with cases written here (not the hidden rows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobKeys, matchListing, placeMatch, classifyListing } from './jobKeys.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const SUP = `Rosa Vega
Tempe AZ | rosa.vega@example.com

EXPERIENCE

Shift Supervisor, Black Bear Coffee Co - Tempe, AZ   2022 - present
- Run the morning shift with 5 to 7 baristas on a busy drive-thru
- Count the drawers and make the nightly deposit
- Train every new hire on bar, window and the register
- Weekly order for milk and cups; cut waste by adjusting pars

Barista, Black Bear Coffee Co   2020 - 2022
- Bar and window; promoted to trainer after 9 months

Cashier, Safeway, Tempe   2018-2020
- Register and self checkout

EDUCATION
Corona del Sol High School 2018`;
const sup = () => buildJobKeys({ resumeText: SUP, profile: { city: 'Tempe, AZ' }, now: NOW });
const both = (job, keys) => ['rail', 'email'].map((mode) => matchListing(job, keys, { now: NOW, mode }));

test('own read #1: a years ask IN A NAMED ROLE is met only by that role — never by "leading people"; a job that manages managers is two up', () => {
  const k = sup();
  const gm = { title: 'General Manager', company: 'Cactus Burrito Co', location: 'Tempe, AZ', description: 'Run a $2M restaurant: P&L, hiring, and developing 25 crew and 3 managers. 3+ years as a restaurant general manager required.' };
  for (const m of both(gm, k)) assert.equal(m.ok, false, JSON.stringify(m));
  // the same years ask on a long posting, with no manager reports: still refused by the role ask
  const gm2 = { ...gm, description: `${'Own the restaurant: guests, food quality, the schedule and the numbers. '.repeat(12)}\nRequirements\n• 3+ years as a restaurant general manager.` };
  const m2 = matchListing(gm2, k, { now: NOW, mode: 'email' });
  assert.equal(m2.ok, false, JSON.stringify(m2));
  assert.match(String(m2.why), /^(years_as_title|level|management|level_years)/);
});

test('own read #2: the rail and the email give ONE decision on the same listing', () => {
  const k = sup();
  const rows = [
    { title: 'Shift Supervisor', company: 'Dutch Ridge Coffee', location: 'Mesa, AZ', description: 'Lead the shift, handle cash and the deposit, coach baristas. 6 months of experience with customers.' },
    { title: 'General Manager', company: 'Cactus Burrito Co', location: 'Tempe, AZ', description: 'Own the P&L, hire and develop 25 crew and 3 managers. 3+ years as a restaurant general manager required.' },
    { title: 'Retail Sales Associate', company: 'Ross', source: 'Adzuna', location: 'Tempe, AZ', description: 'Ross is hiring sales associates for our store…' },
  ];
  for (const r of rows) {
    const [rail, email] = both(r, k);
    assert.ok(!(email.ok && !rail.ok), `${r.title}: the email accepts what the rail refuses (${rail.why})`);
  }
  assert.equal(matchListing(rows[0], k, { now: NOW }).ok, true, 'the same title at the same level on a short posting belongs on the rail');
});

test('own read #3: a generic title takes its field from the employer and the first lines (one rung up, with the years)', () => {
  const k = sup();
  const am = { title: 'Assistant Manager', company: 'Wok Express', location: 'Chandler, AZ', description: 'Help the general manager run the restaurant: scheduling, ordering, food safety, training associates. 1 year of restaurant leadership experience.' };
  for (const m of both(am, k)) { assert.equal(m.ok, true, JSON.stringify(m)); assert.match(m.reason, /Shift Supervisor at Black Bear Coffee Co/); }
});

test('own read #4: when the posting names the person\'s field as qualifying, the field gate is answered by the posting', () => {
  const k = sup();
  const sm = { title: 'Store Manager', company: 'QuikStop', location: 'Tempe, AZ', description: 'Manage the store: staffing, cash, inventory, vendors. 2 years of retail or restaurant supervisory experience.' };
  const m = matchListing(sm, k, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.reason, /The posting counts retail or restaurant supervisory experience/);
  // a tool list joined by "or" is not a list of fields
  const plc = { title: 'Controls Engineer', company: 'X', location: 'Tempe, AZ', description: '3+ years programming experience in PLC or industrial controllers. '.repeat(3) };
  assert.equal(matchListing(plc, k, { now: NOW }).ok, false);
});

test('own read #5: the rung under the job she holds now is reported as a step down, not a field left', () => {
  const k = sup();
  const m = matchListing({ title: 'Barista', company: 'Sunrise Coffee', location: 'Tempe, AZ', description: 'Make drinks, take orders, keep the bar clean. No experience needed.' }, k, { now: NOW });
  assert.equal(m.ok, false);
  assert.match(String(m.why), /^step_down/);
});

test('class 1: an explicitly US-remote row is in range for every US résumé; a state-tied or foreign one is not', () => {
  const home = { city: 'Omaha, NE', point: { lat: 41.2565, lng: -95.9345 } };
  const geo = { geocodePlace: (s) => (/omaha/i.test(s) ? { lat: 41.2565, lng: -95.9345, state: 'NE' } : null), distanceMiles: () => 9999 };
  assert.equal(placeMatch({ title: 'Claims Specialist (Remote, US)', location: 'Remote - US', description: '' }, home, geo).ok, true);
  assert.equal(placeMatch({ title: 'Claims Specialist', location: 'US Remote', description: '' }, home, geo).ok, true);
  assert.equal(placeMatch({ title: 'Claims Specialist', location: 'Remote, United States', description: '' }, home, geo).ok, true);
  assert.equal(placeMatch({ title: 'Claims Specialist (Remote within Texas)', location: 'Remote', description: '' }, home, geo).ok, false);
  assert.equal(placeMatch({ title: 'Warehouse Lead (Remote)', location: 'Remote', description: '' }, home, geo).ok, false, 'a bare "Remote" still needs a job type done remotely');
});

test('class 3: the person\'s own job (or licence) inside the listing title is their field; the extra words are a level', () => {
  const k = buildJobKeys({ resumeText: 'Pat Lee\nPhoenix, AZ\nEXPERIENCE\nLicensed Practical Nurse — Banner Health, Phoenix AZ   2019 – Present\n- Med pass for 20 residents; supervised 4 CNAs on night shift\nLICENSES\nLPN — Arizona, active', now: NOW });
  const m = matchListing({ title: 'LPN Charge Nurse', company: 'Desert Care', location: 'Phoenix, AZ', description: 'Lead the unit as charge nurse on nights: assign CNAs and oversee the med pass. Requirements: active Arizona LPN license, 2+ years LPN experience. '.repeat(6) }, k, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.equal(classifyListing('Store Manager', 'Bean Street Coffee', 'Lead the store team of baristas and shift supervisors; espresso and drink quality.').id, 'food_crew');
});

test('class 5: a listing below every job held in the last five years is a step down', () => {
  const k = buildJobKeys({ resumeText: 'Jo Park\nDenver, CO\nEXPERIENCE\nSenior Account Executive — Salesloft | Mar 2021 – Present\n• Closed $1.4M ARR.\nAccount Executive — Outreach | 2018 – 2021\n• Closed mid-market deals.', now: NOW });
  const m = matchListing({ title: 'Sales Development Representative', company: 'Acme', description: 'Prospect and book meetings for the AEs. '.repeat(30) }, k, { now: NOW });
  assert.equal(m.ok, false);
  assert.match(String(m.why), /^step_down/);
});

test('class 6: a stated exit is honoured — "after 8 years in hospitality" never gets hospitality listings', () => {
  const k = buildJobKeys({ resumeText: 'Lee Ortiz\nAustin, TX\nAfter 8 years in hospitality, I am pursuing a career in IT support. CompTIA A+ certified.\nEXPERIENCE\nFront Desk Manager — Hilton Austin | 2018 – Present\n• Led a team of 9 agents; resolved guest issues.\nCERTIFICATIONS\nCompTIA A+ (2026)', now: NOW });
  const m = matchListing({ title: 'Front Desk Manager', company: 'Marriott', location: 'Austin, TX', description: 'Lead the front desk team of a 300-room hotel. 3+ years of hotel front desk leadership. '.repeat(8) }, k, { now: NOW });
  assert.equal(m.ok, false, JSON.stringify(m));
});

test('class 7: a director of a function manages managers — two up from a store manager; one site is one up', () => {
  const k = buildJobKeys({ resumeText: 'Sam Reyes\nDallas, TX\nEXPERIENCE\nStore Manager — Kohl\'s | 2021 – Present\n• P&L for an $18M store; 60 associates and 4 managers.\nAssistant Store Manager — Target | 2018 – 2021\n• Led softlines.', now: NOW });
  const fn = matchListing({ title: 'Director of Merchandising', company: 'Big Retail Corp', location: 'Dallas, TX', description: 'Lead the merchandising function across 400 stores; manage 6 merchandising managers. '.repeat(8) }, k, { now: NOW });
  assert.equal(fn.ok, false, JSON.stringify(fn));
});
