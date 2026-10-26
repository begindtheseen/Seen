// The zero-API optimizer (owner decision 2026-10-26): the person's answers become résumé language by
// rules, and every line still passes the same checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromFirstPerson, figureFrom, withoutPronouns, localDiagnosis, localRewrite, answerLines, localSummary } from './local.js';
import { buildContext, gapsAfterAnswers, degreeLevel } from './engine.js';

const load = (id) => { const f = JSON.parse(readFileSync(new URL(`../../../scripts/eval/fixtures/${id}.json`, import.meta.url), 'utf8')); return buildContext({ resumeText: f.resume.join('\n'), jobTitle: f.job.title, company: f.job.company, jobDescription: f.job.description.join('\n') }); };

test('answers in first person become résumé lines; a no or a fragment does not', () => {
  assert.equal(fromFirstPerson("Yes, regularly. I run the store on the Store Manager's 2 days off every week", { current: true }), "Run the store on the Store Manager's 2 days off every week");
  assert.equal(fromFirstPerson('I trained my two new cashiers on the register', { current: false }), 'Trained the two new cashiers on the register');
  assert.equal(fromFirstPerson('No, never owned it'), '');
  assert.equal(fromFirstPerson('Not sure'), '');
  assert.equal(figureFrom('About 900–950 hours a week, more in Nov–Dec'), 'about 900–950 hours a week, more in Nov–Dec');
  assert.equal(figureFrom('I think I did it often'), '');
  assert.equal(withoutPronouns('Prep and break down my station and pass every inspection since I started'), 'Prep and break down the station and pass every inspection since starting');
});

test('diagnosis with no model: the posting\'s own nice-to-haves are asked; no verb-led or threshold templates', () => {
  const cook = localDiagnosis(load('13-line-cook'));
  const asks = cook.questions.map((q) => q.ask);
  assert.ok(asks.some((q) => /seafood/i.test(q)), JSON.stringify(asks));
  assert.ok(asks.some((q) => /ServSafe Manager/.test(q)));
  const cs = localDiagnosis(load('04-customer-service'));
  assert.ok(!cs.questions.some((q) => /Type at least|45 WPM/.test(q.ask)), JSON.stringify(cs.questions.map((q) => q.ask)));
});

test('rewrite with no model: pronoun fixes and answer-built lines ship, all checked', () => {
  const ctx = load('13-line-cook');
  const d = localDiagnosis(ctx);
  const sea = d.questions.find((q) => /seafood/i.test(q.ask));
  const r = localRewrite(ctx, d, [{ ...sea, answer: 'Yes. I cook shrimp, redfish and crab cakes on about 40% of my tickets' }]);
  const after = r.proposals.map((p) => p.after);
  // "my" is fixed (the diagnosis flags it, round 9); "our" alone is not a change
  assert.ok(after.includes('Keep ticket times under 14 minutes on the stations during the dinner rush'), JSON.stringify(after));
  assert.ok(!after.some((t) => /the plating guide$/.test(t) && !/\d/.test(t.replace('3 new', ''))), JSON.stringify(after));
  assert.ok(after.some((t) => /since starting$/.test(t)), JSON.stringify(after));
  assert.ok(after.some((t) => /^Cook shrimp, redfish and crab cakes on about 40% of the tickets$/.test(t)), JSON.stringify(after));
});

// Round 8 (two graders, 1.75 and 2.0 of 5): each case below is a defect they quoted.
test('round 8: answers become their own clean lines, never glued on with ";"', () => {
  assert.deepEqual(answerLines('After a deadline scare in 2020 (we caught it a day early) I added a second weekly docket check, and the firm still uses it.', { current: true, posting: 'calendar deadlines docket' }),
    ['Added a second weekly docket check after a deadline scare in 2020, and the firm still uses it']);
  assert.deepEqual(answerLines('Second man the first year, lead installer after that.'), ['Promoted from second man to lead installer after the first year']);
  assert.deepEqual(answerLines("Yes I run the store on the SM's two days off every week, and I ran it alone for 3 weeks in summer 2023 when she was out.", { current: true, titles: ['Store Manager'], posting: 'store manager' })[0], 'Ran the store alone for 3 weeks in summer 2023');
  assert.deepEqual(answerLines('Not sure? I wrote the 12 newsletters myself, if that counts.'), []);
  assert.deepEqual(answerLines('Yes, I picked up the reach-truck cert in 2020 and was one of 3 people the trainer leaned on.'), []);
});

test('round 8: requirement map — bullets with "- " count, degree levels, vendor words', () => {
  const be = localDiagnosis(load('06-backend-engineer'));
  for (const label of ['go', 'kafka', 'postgresql']) {
    const r = be.requirements.find((x) => x.label === label);
    assert.ok(r && r.evidence.length, `${label}: ${JSON.stringify(r)}`);
  }
  assert.equal(degreeLevel('Associate of Applied Science in Business'), 1);
  assert.equal(degreeLevel('B.A. Elementary Education'), 2);
  assert.equal(degreeLevel("Master's in Education"), 3);
  assert.equal(degreeLevel('MS Excel'), 0);
  const teach = localDiagnosis(load('14-teacher'));
  assert.notEqual(teach.requirements.find((r) => /master/i.test(r.label))?.credential, 'held');
  const admin = localDiagnosis(load('10-admin-assistant'));
  assert.equal(admin.requirements.find((r) => /powerpoint/i.test(r.label))?.strength, 'none');
  assert.ok(admin.questions.some((q) => q.ask === 'Have you used PowerPoint?'));
});

test('round 8: no soft-skill gaps, no raw answers handed back, no CPA question for a candidate', () => {
  const cs = localDiagnosis(load('04-customer-service'));
  assert.ok(!cs.gaps.some((g) => /attention to detail|calm phone voice/i.test(g.label)), JSON.stringify(cs.gaps));
  const out = gapsAfterAnswers([{ label: 'Seafood experience', advice: 'x' }], [{ id: 'q1', ask: 'Have you worked with seafood?', answer: 'Yes. Sauté at Magnolia, I clean and portion redfish. Don' }]);
  assert.deepEqual(out, []);
  const acct = localDiagnosis(load('11-accountant'));
  assert.ok(!acct.questions.some((q) => /\bCPA\b/.test(q.ask)), JSON.stringify(acct.questions.map((q) => q.ask)));
  const cashier = localDiagnosis(load('03-cashier-entry'));
  assert.ok(!cashier.questions.some((q) => /worked in retail/i.test(q.ask)));
});

test('round 8: questions are about the posting — its sizes, its duties, its named specifics', () => {
  const asks = (id) => localDiagnosis(load(id)).questions.map((q) => q.ask);
  assert.ok(asks('02-warehouse-lead').some((q) => /15–25 associates; your line says 14/.test(q)));
  assert.ok(asks('04-customer-service').some((q) => /Troubleshoot common product issues/.test(q)));
  assert.ok(asks('05-registered-nurse').includes('Have you worked with cardiac drips?'));
  assert.ok(asks('12-hvac-technician').includes('Have you worked on commercial RTU or chiller systems?'));
  for (const id of ['01-retail-manager', '07-data-analyst', '09-sdr-sales']) assert.ok(!asks(id).some((q) => /what numbers go with it|what came of it/.test(q)), id);
  assert.ok(!asks('14-teacher').some((q) => /650 students/.test(q)), 'the school\'s size is not a class size');
});

test('round 8: the summary names the field, credits no employer, replaces the old one', () => {
  const ctx = load('13-line-cook');
  const s = localSummary(ctx, localDiagnosis(ctx));
  assert.match(s.text, /^Line Cook with about \S+ years in restaurant kitchens/);
  assert.ok(!/Magnolia|Crescent/.test(s.text));
  const nurse = load('05-registered-nurse');
  assert.match(localSummary(nurse, localDiagnosis(nurse)).text, /^Registered Nurse \(BSN\) with/, 'the posting asks for a BSN and she has one');
  // the person's own summary stays when it has its numbers; an objective is replaced, its availability kept
  const retail = load('01-retail-manager');
  assert.equal(localSummary(retail, localDiagnosis(retail)), null);
  const cashier = load('03-cashier-entry');
  const cs = localSummary(cashier, localDiagnosis(cashier));
  assert.match(cs.text, /available weekends/);
  assert.match(cs.replaces, /^Friendly, dependable cashier/);
  // years count the occupation, not every job: an RN's CNA years and an SDR's gym sales are not counted
  assert.match(localSummary(nurse, localDiagnosis(nurse)).text, /with about 8½ years/);
  const sdr = load('09-sdr-sales');
  assert.match(localSummary(sdr, localDiagnosis(sdr)).text, /with about 5½ years in sales/);
});

test('round 9: a yes to a posting duty becomes that duty with the person\'s own details; denied parts stay out', () => {
  const duty = 'Interpret cardiac rhythms and respond to changes and alarms';
  assert.equal(answerLines('Yes, on monitored overflow patients (about 30% of mine) and on roughly 20–25 stepdown float shifts. A central monitor tech watches; I review strips and respond. I recognize A-fib/flutter, SVT, heart blocks, PVCs, V-tach.', { current: true, duty, posting: 'telemetry cardiac rhythms alarms' })[0],
    'Interpret cardiac rhythms and respond to changes and alarms on monitored overflow patients (about 30% of the assignment) and on roughly 20–25 stepdown float shifts');
  assert.deepEqual(answerLines('Electrical and controls yes, daily: contactors, capacitors, control boards, thermostat wiring. Building automation, no.', { current: true, duty: 'Troubleshoot electrical and control problems, including building automation systems' }),
    ['Troubleshoot electrical and control problems daily: contactors, capacitors, control boards and thermostat wiring']);
  assert.deepEqual(answerLines('Yes. About one week a month in summer at Desert Air.', { current: true, duty: 'Take after-hours on-call shifts on a rotation' }), ['Take after-hours on-call shifts on a rotation (about one week a month in summer)']);
  assert.ok(!answerLines('Instagram yes, Facebook only by cross-posting, never LinkedIn.', { duty: 'Plan, write and schedule posts for our Instagram, Facebook and LinkedIn pages' }).some((l) => /LinkedIn/.test(l)));
  assert.deepEqual(answerLines("Some. I see the monthly P&L summary in the manager meeting and explain the shrink and labor lines. I've never owned or built it.", { current: true, posting: 'P&L shrink' }), ['Explain the shrink and labor lines of the monthly P&L summary in the manager meeting']);
  assert.deepEqual(answerLines('Not board meetings. I organize the monthly partner meeting: I send the agenda and take informal notes, not formal minutes.', { current: true, posting: 'meetings agendas' }), ['Organize the monthly partner meeting, send the agenda and take notes']);
});
