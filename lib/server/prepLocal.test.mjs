// Interview Prep with no model (owner decision 2026-10-26): answers are the person's own résumé lines told
// out loud, and nothing in them is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { localPack, storyAnswer, firstPerson, spoken, askThem } from './prepLocal.js';
import { numbersBacked } from './interviewPrep.js';

const FX = new URL('../../scripts/eval/fixtures/', import.meta.url);
const fixtures = readdirSync(FX).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, FX), 'utf8'))).filter((f) => f.resume);

test('a from→to line is told as situation, action, result', () => {
  const s = storyAnswer('Cut shrink from 2.4% to 1.1% in 12 months by tightening the fitting-room and back-door process', { title: 'Assistant Store Manager', company: 'Desert Sun Apparel', current: true });
  assert.equal(s.situation, "At Desert Sun Apparel, where I'm an Assistant Store Manager, shrink was 2.4%.");
  assert.match(s.action, /^I tightened the fitting-room and back-door process\. \[/);
  assert.equal(s.result, 'Within 12 months, shrink was down to 1.1%.');
});

test('first person, the right tense, numbers said out loud', () => {
  assert.deepEqual(firstPerson('Build weekly schedules in Kronos for 900+ labor hours and run the cash office', { current: false }).first, 'I built weekly schedules in Kronos for more than 900 labor hours and ran the cash office');
  assert.equal(firstPerson('Named Crew Member of the Month (Aug 2023)').first, 'I was named Crew Member of the Month (Aug 2023)');
  assert.deepEqual(firstPerson('Hired and trained 22 associates in 2023; 15 were still on staff a year later', { current: true }).rest, ['Of those, 15 were still on staff a year later']);
  assert.match(firstPerson('Serve as charge nurse 2 shifts a week: make assignments, manage admissions', { current: true }).first, /2 shifts a week, where I make assignments/);
  assert.equal(spoken('Care for 5–6 patients on $4.2M volume'), 'Care for 5 to 6 patients on $4.2 million volume');
  assert.equal(firstPerson('Responsible for the front desk'), null);
});

test('every fixture: answers are real résumé lines, every number is the résumé\'s, at most two prompts each', () => {
  for (const fx of fixtures) {
    const resumeText = fx.resume.join('\n');
    const p = localPack({ company: fx.job.company, role: fx.job.title, resumeText, jobText: fx.job.description.join('\n'), stage: 'Interview' });
    assert.equal(p.model, false, fx.id);
    assert.ok(p.answers.length >= 3, `${fx.id}: ${p.answers.length} answers`);
    for (const a of p.answers) {
      const flat = (t) => t.replace(/\s+/g, ' ');
      assert.ok(flat(resumeText).includes(flat(a.resume_fact).replace(/^[•\-\s]+/, '')), `${fx.id}: ${a.resume_fact}`);
      const told = a.answer.replace(/\[[^\]]*\]/g, ' ');
      assert.ok(numbersBacked(told.replace(/\b(\d+) to (\d+)\b/g, '$1–$2').replace(/more than (\d[\d,]*)/g, '$1+').replace(/\$(\d+(?:\.\d+)?) million/g, '$$$1M'), resumeText), `${fx.id}: ${a.answer}`);
      assert.ok((a.answer.match(/\[/g) || []).length <= 2, `${fx.id}: ${a.answer}`);
      assert.doesNotMatch(a.answer, /\bI 'm\b|\bI was was\b|\s\./, `${fx.id}: ${a.answer}`);
    }
    assert.ok(p.ask_them.length >= 3);
    assert.ok(p.questions[0].q === 'Tell me about yourself.', fx.id);
  }
});

test('what the job asks for: proof lines, honest gap answers, lapsed credentials', () => {
  const nurse = fixtures.find((f) => f.id === '05-registered-nurse');
  const p = localPack({ company: nurse.job.company, role: nurse.job.title, resumeText: nurse.resume.join('\n'), jobText: nurse.job.description.join('\n') });
  const acls = p.job_match.find((m) => /ACLS/.test(m.label));
  assert.equal(acls.status, 'expired');
  assert.match(acls.say, /renewed by \[date\]/);
  assert.ok(p.job_match.some((m) => m.status === 'shown' && m.proof));
  assert.ok(p.job_match.some((m) => m.duty && /cardiac rhythms/i.test(m.label)));
  assert.match(askThem('Registered Nurse')[0].q, /patient ratio/);
});

test('round 1 grades: the article stays, the method is kept, coordinated steps share the tense', () => {
  const ig = storyAnswer("Grew the brand's Instagram from 3,100 to 5,400 followers in 10 weeks with a Reels series on how we roast", { title: 'Marketing Intern', company: 'Coastal Coffee', current: false });
  assert.match(ig.situation, /the brand's Instagram stood at 3,100 followers\.$/);
  assert.match(ig.action, /^I used a Reels series/);
  const pick = storyAnswer('Raised pick accuracy from 97.2% to 99.6% in 9 months by re-slotting the 200 fastest-moving SKUs and auditing scans daily', { title: 'Warehouse Lead', company: 'Midwest Parcel', current: true });
  assert.match(pick.action, /^I re-slotted the 200 fastest-moving SKUs and audited scans daily\./);
});
