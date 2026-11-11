// Round 12b: (1) THE BASIS RUNG — the basis is the latest of the person's roles in the listing's occupation; a listing
// below its rung, or titled as an earlier rung they moved up from, is no match (rail or email). (2) SCHEDULE — a résumé
// that says ANYTHING about schedule outside its roles (vocabulary only, no parsing) makes every listing-stated condition
// need a POSITIVE agreement to head an email; unknown rides the rail with the condition named. Invented people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobKeys, matchListing, mentionsSchedule, scheduleAgreement, scheduleQuestion } from './jobKeys.js';
import { finalizeMatches } from './resumeMatches.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const L = (s, reqs = []) => `${s} `.repeat(20) + (reqs.length ? `\nRequirements\n${reqs.map((r) => `• ${r}`).join('\n')}` : '');

const LADDERS = [
  { name: 'claims adjuster', city: 'Hartford, CT', hi: 'Claims Adjuster II', lo: 'Claims Adjuster I', co1: 'Travelers', co2: 'The Hartford', duty: 'Investigate and settle property claims; inspect damage and write estimates.', b1: 'Settled 120 auto claims a month', b2: 'Handled 60 open property claims and wrote damage estimates' },
  { name: 'recruiter', city: 'Boise, ID', hi: 'Senior Recruiter', lo: 'Recruiter', co1: 'Micron Technology', co2: 'Albertsons Companies', duty: 'Own full-cycle recruiting for engineering roles: sourcing, screening, interviews and offers.', b1: 'Sourced and screened candidates for 20 open requisitions', b2: 'Ran full-cycle recruiting for 35 engineering requisitions a year and closed offers' },
  { name: 'quality inspector', city: 'Wichita, KS', hi: 'Quality Inspector III', lo: 'Quality Inspector II', co1: 'Spirit AeroSystems', co2: 'Textron Aviation', duty: 'Inspect machined aircraft parts to blueprints with calipers, micrometers and CMM.', b1: 'Inspected machined parts with calipers and micrometers', b2: 'Ran CMM first-article inspections on aircraft parts' },
];
for (const d of LADDERS) {
  test(`basis rung (${d.name}): the old rung at the same employer and elsewhere is no match; the current rung is`, () => {
    const keys = buildJobKeys({ resumeText: `Pat Doe\n${d.city}\nEXPERIENCE\n${d.hi} — ${d.co1} | 2022 – Present\n- ${d.b2}\n${d.lo} — ${d.co1} | 2018 – 2022\n- ${d.b1}`, now: NOW });
    const offer = (title, company, mode) => matchListing({ title, company, location: d.city, description: L(d.duty, ['Attention to detail']) }, keys, { now: NOW, mode });
    for (const mode of ['rail', 'email']) {
      assert.equal(offer(d.lo, d.co1, mode).ok, false, `${mode}: (a) the old rung at the same employer`);
      assert.equal(offer(d.lo, d.co2, mode).ok, false, `${mode}: (b) the old rung at another employer`);
    }
    const c = offer(d.hi, d.co2, 'email');
    assert.equal(c.ok, true, `(c) the current rung: ${JSON.stringify(c)}`);
    assert.equal(c.headlineOk, true, '(c) heads an email');
    assert.ok(c.reason.includes(`${d.hi} at ${d.co1}`), `the current rung is the basis of the reason: ${c.reason}`);
  });
  test(`basis rung (${d.name}) mirror: someone whose only role in the occupation is the lower rung matches it`, () => {
    const keys = buildJobKeys({ resumeText: `Sam Roe\n${d.city}\nEXPERIENCE\n${d.lo} — ${d.co1} | 2021 – Present\n- ${d.b1}`, now: NOW });
    const m = matchListing({ title: d.lo, company: d.co2, location: d.city, description: L(d.duty, ['Attention to detail']) }, keys, { now: NOW });
    assert.equal(m.ok, true, JSON.stringify(m));
  });
}
test('basis rung: a gap after the latest role keeps it as the basis — the older lower rung does not come back', () => {
  const d = LADDERS[0];
  const keys = buildJobKeys({ resumeText: `Pat Doe\n${d.city}\nEXPERIENCE\n${d.hi} — ${d.co1} | 2021 – 2024\n- ${d.b2}\n${d.lo} — ${d.co1} | 2017 – 2021\n- ${d.b1}`, now: NOW });
  assert.equal(matchListing({ title: d.lo, company: d.co2, location: d.city, description: L(d.duty, ['Attention to detail']) }, keys, { now: NOW }).ok, false);
});
test('a neighbouring occupation ("Close to your … job") never heads an email', () => {
  const keys = buildJobKeys({ resumeText: 'Rae Kim\nNorfolk, VA\nEXPERIENCE\nLogistics Specialist Second Class (LS2) — U.S. Navy | 2019 – 2026\n- Managed repair parts inventory in R-Supply\nCERTIFICATIONS: forklift certified', now: NOW });
  const m = matchListing({ title: 'Forklift Operator', company: 'Port Terminal', location: 'Norfolk, VA', description: L('Operate forklifts in the yard and load containers.', ['Forklift certification']) }, keys, { now: NOW });
  if (m.ok) assert.equal(m.headlineOk, false, JSON.stringify(m));
});

// ── schedule: five wishes the parser does not read, against listings that state the condition in the TITLE ──
const WISHES = [
  ['Ivy Nam', 'Phlebotomist', 'Quest Diagnostics', 'Can do about 25 a week.', 'Phlebotomist (Full-Time)', 'Draw blood from patients and label specimens.', 'Performed 40 venipunctures a day'],
  ['Oto Reyes', 'Bank Teller', 'Wells Fargo', 'Looking for something during school hours.', 'Bank Teller - Evenings', 'Process deposits and withdrawals and help customers at the window.', 'Balanced a $20K cash drawer daily'],
  ['Lu Chen', 'Pet Groomer', 'Petco', 'Mornings ideally.', 'Pet Groomer (Weekends)', 'Bathe, brush and trim dogs and cats.', 'Groomed 8 dogs a day'],
  ['Ada Boateng', 'Library Assistant', 'Denver Public Library', 'No more than four days.', 'Library Assistant, Full Time', 'Check materials in and out and shelve books.', 'Shelved and checked out materials for patrons'],
  ['Kai Moana', 'Tutor', 'Sylvan Learning', 'I work around my classes.', 'Math Tutor (Evenings and Weekends)', 'Tutor K-12 students in math.', 'Tutored algebra and geometry students'],
];
for (const [name, role, co, wish, listing, duty, bullet] of WISHES) {
  test(`schedule (${role}): "${wish}" is a mention; "${listing}" is never a headline, and the rail names it`, () => {
    const resume = `${name}\nAustin, TX\n${wish}\nEXPERIENCE\n${role} — ${co} | 2022 – Present\n- ${bullet}`;
    assert.ok(mentionsSchedule(resume), 'vocabulary found');
    const keys = buildJobKeys({ resumeText: resume, now: NOW });
    const job = { id: 'x', title: listing, company: 'Northwind Test Labs', location: 'Austin, TX', description: L(duty, ['Attention to detail']) };
    const a = scheduleAgreement(job, keys.limits);
    assert.notEqual(a.verdict, 'yes', JSON.stringify(a));
    assert.equal(a.affirmed, false);
    const m = matchListing(job, keys, { now: NOW });
    const row = { ...job, _reason: m.reason, _basis: m.basis, _checks: m.checks, _checked: m.checked, _headlineOk: m.headlineOk, _summaryOnly: m.summaryOnly };
    if (m.ok) {
      assert.equal(finalizeMatches([row], resume, { keys, now: NOW, limit: 6, strict: true }).rows.length, 0, 'no email');
      const rail = finalizeMatches([row], resume, { keys, now: NOW, limit: 12 }).rows;
      if (rail.length && a.verdict === 'unknown') assert.match(rail[0]._reason, /you mention .* on your résumé; check it fits\.$/);
    }
  });
}
test('schedule: a bullet inside a role is not a mention; a person who states nothing passes', () => {
  const resume = 'Max Ode\nAustin, TX\nEXPERIENCE\nBank Teller — Chase | 2022 – Present\n- Worked evening and weekend shifts';
  assert.equal(mentionsSchedule(resume), null);
  const keys = buildJobKeys({ resumeText: resume, now: NOW });
  assert.equal(scheduleAgreement({ title: 'Bank Teller (Full-Time)', description: '' }, keys.limits).verdict, 'yes');
  assert.equal(scheduleQuestion({ conditions: [{ word: 'full-time' }, { word: '40 hours' }], mention: 'hours' }), "It's full-time, 40 hours — you mention hours on your résumé; check it fits.");
});
