import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digitize, roleHistory, historyBlock, claimsOk, premiseOk, employerOk, durationsOk, stripDurations } from './prepClaims.js';
import { guardPack, fallbackPack, numbersBacked } from './interviewPrep.js';
import { bankQuestions, storyQuestion } from './interviewQuestionBank.js';

const NOW = Date.parse('2026-10-25T20:00:00Z');
const RETAIL = `Dana Ruiz
EXPERIENCE
Assistant Store Manager — Desert Sun Apparel — Apr 2021 – Present
• Cut shrink from 2.4% to 1.1% in 12 months by tightening the fitting-room process
• Hired and trained 22 associates in 2023
Department Supervisor — Valley Home Goods — Jun 2018 – Mar 2021
• Supervised the home and seasonal departments (6 associates)
Sales Associate — Valley Home Goods — Aug 2016 – May 2018
• Opened 35 store credit cards in one quarter, the most in the district`;
const ANALYST = `Priya Shah
EXPERIENCE
Data Analyst — North Loop Retail Co. — May 2022 – Present
• Automated the Monday sales report with Python (pandas), saving the team 6 hours a week
• Own the weekly sales dashboards in Tableau used by 40 store managers
Reporting Analyst — Twin Lakes Credit Union — Jun 2020 – Apr 2022
• Built monthly loan-delinquency reports in Excel and SQL Server
SKILLS
SQL, Python, Tableau, Excel, NetSuite`;
const NURSE = `Rebecca Thornton, BSN, RN
EXPERIENCE
Registered Nurse, Medical-Surgical Unit — St. Aurelia Medical Center — Aug 2020 to Present
• Care for 5–6 adult patients per shift on a 32-bed med-surg unit
• Precepted 7 new graduate nurses through their 12-week orientation
Certified Nursing Assistant — Pinecrest Senior Living — 2015 – 2018
• Helped 12–14 residents a shift with bathing, mobility and meals`;

const ctx = (resumeText, extra = {}) => ({ resumeText, history: roleHistory(resumeText, NOW), company: 'Harborline', role: 'Store Manager', nowMs: NOW, ...extra });

test('digitize: spoken numbers become digits; ordinary "one"/"two" stay words', () => {
  assert.equal(digitize('sixty to seventy calls, ninety-four percent, three and a half years'), '60 to 70 calls, 94 percent, 3.5 years');
  assert.equal(digitize('one thing, two of us, thirty thousand members, a year and a half'), 'one thing, two of us, 30000 members, 1.5 years');
  assert.equal(numbersBacked('I handle sixty to seventy calls a day.', 'Handle 60–70 calls a day'), true);
  assert.equal(numbersBacked('I answered ninety calls a day.', 'Handle 60–70 calls a day'), false, 'a spoken number is still checked');
});

test('role history: lengths from the résumé dates, today in California', () => {
  const h = roleHistory(RETAIL, NOW);
  assert.equal(h[0].months, 66); // Apr 2021 → Oct 2026
  assert.equal(h[1].months, 34); // Jun 2018 – Mar 2021, both end months counted
  assert.match(historyBlock(h, NOW), /Assistant Store Manager — Desert Sun Apparel: Apr 2021 – present \(about 5½ years\)/);
});

test('tenure claims must match the dates (2026-10-25 eval)', () => {
  assert.equal(claimsOk('For the last three and a half years as an Assistant Store Manager I ran the floor.', ctx(RETAIL)), false);
  assert.equal(claimsOk('For the last five and a half years as an Assistant Store Manager I ran the floor.', ctx(RETAIL)), true);
  assert.equal(claimsOk('I have almost four years of experience at St. Aurelia.', ctx(NURSE)), false, '"St." is not a sentence end');
  assert.equal(claimsOk('I have over six years at St. Aurelia.', ctx(NURSE)), true);
  assert.equal(durationsOk('Where do you see yourself in five years?', ctx(RETAIL)), true, 'a future span is not a claim');
  assert.equal(stripDurations('I spent 5 years and 10 months there').replace(/\s+/g, ' '), 'I spent and there');
});

test('"this year" needs a job that starts or ends this year; promotions need the résumé', () => {
  assert.equal(claimsOk("I've been at Desert Sun since April of this year.", ctx(RETAIL)), false);
  assert.equal(claimsOk('I worked my way up from Sales Associate to Department Supervisor at Valley Home Goods.', ctx(RETAIL)), true, 'two titles at one employer');
  assert.equal(claimsOk('I worked my way up from CNA to RN.', ctx(NURSE)), false, 'different employers, no "promoted"');
});

test('a story stays at its own employer; named terms must be the résumé\'s', () => {
  const fact = 'Automated the Monday sales report with Python (pandas), saving the team 6 hours a week';
  const h = roleHistory(ANALYST, NOW);
  assert.equal(employerOk('At Twin Lakes, I was building this Monday sales report by hand.', fact, h), false);
  assert.equal(employerOk('At North Loop, I automated the Monday sales report.', fact, h), true);
  assert.equal(claimsOk("I've already been running the schedules, the hiring, the P&L piece.", ctx(RETAIL)), false);
  assert.equal(claimsOk("I'm excited about owning the P&L in this role.", ctx(RETAIL)), true, 'wanting it is not claiming it');
});

test('questions may not rest on premises the résumé does not state', () => {
  const c = ctx(ANALYST, { company: 'Riverbend', role: 'Data Analyst' });
  assert.equal(premiseOk("You've worked with Tableau and Power BI. Which do you prefer?", c), false);
  assert.equal(premiseOk("You've used NetSuite for 3 years now. How do you use it?", c), false);
  assert.equal(premiseOk("You've built dashboards in Tableau. Which one changed a decision?", c), true);
  assert.equal(premiseOk('Which reporting tools have you used?', c), true);
});

test('guardPack drops a model answer told at the wrong employer and an intro with the wrong tenure', () => {
  const raw = {
    questions: [{ q: 'How do you make reporting faster?', why: 'They want efficiency.' }],
    answers: [
      { q: 'How do you make reporting faster?', resume_fact: 'Automated the Monday sales report with Python (pandas), saving the team 6 hours a week', situation: 'At Twin Lakes the Monday sales report was built by hand.', action: 'I automated the Monday sales report with Python and pandas.', result: 'It saved the team 6 hours a week.' },
      { q: 'Tell me about your dashboards.', resume_fact: 'Own the weekly sales dashboards in Tableau used by 40 store managers', situation: 'At North Loop the store managers needed weekly numbers.', action: 'I own the weekly sales dashboards in Tableau.', result: '40 store managers use them.' },
    ],
    intro: "I've spent the last two years as a Data Analyst at North Loop Retail, where I own the weekly sales dashboards in Tableau used by 40 store managers.",
  };
  const p = guardPack(raw, { company: 'Riverbend', role: 'Data Analyst', resumeText: ANALYST, nowMs: NOW });
  assert.ok(!p.answers.some((a) => !a.coached && /Twin Lakes/.test(a.answer)), 'wrong-employer answer dropped');
  assert.ok(p.answers.some((a) => /Tableau/.test(a.answer)));
  assert.ok(!/two years/.test(p.intro), `intro: ${p.intro}`);
});

test('fallback: field bank by title, stories from job bullets, questions that fit the story', () => {
  const nurse = fallbackPack({ company: 'Summit Ridge', role: 'Registered Nurse – Telemetry (Nights)', resumeText: NURSE });
  assert.equal(nurse.family, 'healthcare_support');
  assert.ok(nurse.questions.some((q) => /night shift/i.test(q.q)));
  assert.ok(!nurse.answers.some((a) => /^Registered Nurse|BSN/.test(a.resume_fact)), 'never a header or license line');
  assert.equal(storyQuestion('Precepted 7 new graduate nurses'), 'Tell me about a time you trained or coached someone.');
  assert.equal(storyQuestion('Checked in 50+ patients a day', new Set(), 'administrative') === 'Tell me about a patient you cared for that you still think about.', false);
  for (const fam of ['retail', 'warehouse', 'software_engineering', 'general', 'skilled_trades']) {
    for (const q of bankQuestions(fam, { role: 'Lead' })) {
      assert.ok(/[?]$|^(Tell|Walk) me\b.*\.$/.test(q.q) && !/\d/.test(q.q) && !/handle handling|showed \w+\.$/.test(q.q), q.q);
      assert.ok(!/\b(she|he|the candidate)\b/i.test(q.why), q.why);
    }
  }
});

test('a length across two employers is checked against both jobs together', () => {
  assert.equal(claimsOk('I have 6 years at Valley Home Goods and Desert Sun Apparel.', ctx(RETAIL)), false); // 4.7 + 5.5 = 10.2
  assert.equal(claimsOk('I have 10 years at Valley Home Goods and Desert Sun Apparel.', ctx(RETAIL)), true);
});

test('guardPack: a story built on a job-title line is dropped; an all-blank answer is coaching', () => {
  const raw = {
    answers: [
      { q: 'Tell me about your unit.', resume_fact: 'Registered Nurse, Medical-Surgical Unit — St. Aurelia Medical Center — Aug 2020 to Present', situation: 'At St. Aurelia I work on a med-surg unit.', action: 'I care for adult patients on a med-surg unit at St. Aurelia Medical Center.', result: '[the result]' },
      { q: 'How do you train new nurses?', resume_fact: 'Precepted 7 new graduate nurses through their 12-week orientation', situation: '[a new nurse you precepted]', action: '[what you did]', result: '[how it ended]' },
      { q: 'Tell me about precepting.', resume_fact: 'Precepted 7 new graduate nurses through their 12-week orientation', situation: 'At St. Aurelia new graduates need a preceptor.', action: 'I precepted 7 new graduate nurses through their 12-week orientation.', result: 'They finished orientation.' },
    ],
  };
  const p = guardPack(raw, { company: 'Summit Ridge', role: 'Registered Nurse', resumeText: NURSE, nowMs: NOW });
  assert.ok(!p.answers.some((a) => /^Registered Nurse, Medical/.test(a.resume_fact)));
  const blank = p.answers.find((a) => a.q === 'How do you train new nurses?');
  if (blank) assert.equal(blank.coached, true);
});
