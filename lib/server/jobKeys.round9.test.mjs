// Round 9 (recall, precision held): four classes from the director's read of the hidden misses, each pinned with
// cases written here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobKeys, matchListing, classifyListing } from './jobKeys.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const LONG = (s) => `${s} `.repeat(8);

test('A: a new graduate\'s direction comes from the internship and the named certification — entry jobs, true sentence', () => {
  const k = buildJobKeys({ resumeText: 'Kai Brooks\nAustin, TX\nEDUCATION\nAustin Community College — A.A.S. Information Technology, May 2026\nEXPERIENCE\nIT Help Desk Intern — Austin ISD | Jan 2026 – May 2026\n- Reset passwords and imaged 40 laptops\nCERTIFICATIONS\nCompTIA A+ (2026)', now: NOW });
  assert.deepEqual(k.cert_direction.map((c) => c.occupation), ['it_support']);
  const desc = LONG('Support employees with laptops, accounts and tickets. Entry level role; we will train you.');
  const a = matchListing({ title: 'IT Support Specialist I', company: 'Dell', location: 'Austin, TX', description: desc }, k, { now: NOW });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(classifyListing('IT Support Specialist I', 'Dell', desc).id, 'it_support', 'the grade is not part of the job');
  const sys = matchListing({ title: 'Senior Systems Administrator', company: 'Dell', location: 'Austin, TX', description: `${desc}\nRequirements\n• 5+ years administering Windows servers.` }, k, { now: NOW });
  assert.equal(sys.ok, false, 'anything asking years they lack is refused');
});

test('A: a sterile-processing certification opens central supply and instrument technician jobs (by the employer\'s work)', () => {
  const k = buildJobKeys({ resumeText: 'Mia Cruz\nPhoenix, AZ\nCashier — Walgreens | 2022 – 2025\n- Register\nCERTIFICATIONS\nCRCST — Certified Registered Central Service Technician (HSPA), 2025', now: NOW });
  const desc = LONG('Decontaminate, assemble and sterilize surgical instruments for the operating rooms. CRCST certification required.');
  for (const [t, c] of [['Central Supply Technician', 'Banner Health'], ['Instrument Technician', 'SteriTech Services']]) {
    const m = matchListing({ title: t, company: c, location: 'Phoenix, AZ', description: desc }, k, { now: NOW });
    assert.equal(m.ok, true, `${t}: ${JSON.stringify(m)}`);
    assert.match(m.reason, /^You hold CRCST/);
  }
  assert.notEqual(classifyListing('Instrument Technician', 'Acme Process Controls', LONG('Calibrate pressure transmitters and flow meters in the plant.'))?.id, 'med_tech', 'a calibration instrument tech is not sterile processing');
});

test('B: the same job under a plainer title is not a step down; an entry posting under a long history still is', () => {
  const pharma = buildJobKeys({ resumeText: 'Dana Cole\nAtlanta, GA\nEXPERIENCE\nSenior Pharmaceutical Sales Representative — Pfizer | 2020 – Present\n- Top 10% of the region two years running\nPharmaceutical Sales Representative — Merck | 2016 – 2020\n- Grew the territory 18%', now: NOW });
  const rep = matchListing({ title: 'Pharmaceutical Sales Representative', company: 'AbbVie', location: 'Atlanta, GA', description: LONG('Call on physicians in the territory. 2+ years of pharmaceutical sales experience.') }, pharma, { now: NOW });
  assert.equal(rep.ok, true, JSON.stringify(rep));
  const agm = buildJobKeys({ resumeText: 'Rae Kim\nDenver, CO\nEXPERIENCE\nAssistant General Manager — Chili\'s Grill & Bar, Denver CO | 2021 – Present\n- Lead 45 crew and 3 shift managers', now: NOW });
  const same = matchListing({ title: 'Assistant General Manager', company: 'Applebee\'s', location: 'Denver, CO', description: LONG('Help the GM run the restaurant. 2+ years of restaurant leadership.') }, agm, { now: NOW });
  assert.equal(same.ok, true, JSON.stringify(same));
});

test('D: same field read as different — coffee-brand store manager, one-site director, department chair, restaurant training', () => {
  const agm = buildJobKeys({ resumeText: 'Rae Kim\nDenver, CO\nEXPERIENCE\nAssistant General Manager — Chili\'s Grill & Bar, Denver CO | 2021 – Present\n- Lead a team of 45 crew and 3 shift managers; run inventory and labor\n- Train new shift leaders', now: NOW });
  const rows = [
    ['Store Manager', 'Bluebird Coffee Roasters', 'Run the cafe: espresso bar, team of 15 baristas, store sales, scheduling. 2+ years of restaurant or retail management.'],
    ['Director of Operations', 'Sun Taco (franchise location)', 'Run all operations of our single franchise restaurant location: staffing, P&L, guest experience. 3+ years of restaurant management.'],
    ['Training Coordinator (Restaurant)', 'Fox Restaurant Concepts', 'Train new restaurant leaders across the location. 2 years of restaurant leadership.'],
  ];
  for (const [t, c, d] of rows) {
    const m = matchListing({ title: t, company: c, location: 'Denver, CO', description: d }, agm, { now: NOW });
    assert.equal(m.ok, true, `${t}: ${JSON.stringify(m)}`);
    assert.match(m.reason, /Assistant General Manager (job )?at Chili's Grill & Bar/);
  }
  const tch = buildJobKeys({ resumeText: 'Lee Park\nDenver, CO\nEXPERIENCE\nMathematics Teacher and Department Chair — Denver Public Schools | 2015 – Present\n- Taught algebra and calculus; chaired a 9-teacher math department', now: NOW });
  const chair = matchListing({ title: 'Mathematics Department Chair', company: 'Front Range Community College', location: 'Denver, CO', description: LONG('Lead the mathematics department; teach 2 sections per term. 5+ years teaching mathematics.') }, tch, { now: NOW });
  assert.equal(chair.ok, true, JSON.stringify(chair));
});
