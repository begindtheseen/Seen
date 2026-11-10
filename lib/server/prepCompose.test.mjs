// The answer composer (P2, 2026-11-10): every answer a spoken draft with at most one blank, built from the résumé and
// the posting, never a three-blank worksheet. Pinned on the director's trainer case (a support team lead applying to a
// call-center TRAINER job) and six more cases across fields, plus invariants that run over every one of them.
// Run: node --test lib/server/prepCompose.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localPack } from './prepLocal.js';
import { validateDraft, dutySubject, realStatement, vocabulary } from './prepCompose.js';
import { prepEmails } from './interviewPrep.js';
import { gerundPhrase, firstPerson, resultSentence, agree, aAn, joinList } from '../text/voice.js';

const FX = new URL('./fixtures/prep/', import.meta.url);
const PER = new URL('../fixtures/personas/', import.meta.url);
const read = (u, f) => fs.readFileSync(new URL(f, u), 'utf8');
const NOW = Date.parse('2026-11-10T18:00:00Z');
const CASES = [
  { id: 'trainer', resume: read(FX, 'support-lead.txt'), posting: read(FX, 'trainer-posting.txt'), title: 'Call Center Trainer', company: 'Meridian Health Partners' },
  { id: 'rn-navigator', resume: read(PER, 'rn-home-health.txt'), posting: read(FX, 'rn-navigator-posting.txt'), title: 'RN Patient Navigator - Cardiology', company: 'Desert Heart Institute' },
  { id: 'warehouse-inventory', resume: read(PER, 'warehouse.txt'), posting: read(FX, 'warehouse-inventory-posting.txt'), title: 'Inventory Control Specialist', company: 'Ridgeline Supply' },
  { id: 'new-grad', resume: read(FX, 'new-grad.txt'), posting: read(FX, 'analyst-posting.txt'), title: 'Junior Data Analyst', company: 'Harbor Health Plans' },
  { id: 'career-changer', resume: read(FX, 'career-changer.txt'), posting: read(FX, 'instructional-designer-posting.txt'), title: 'Instructional Designer', company: 'Clearwater Logistics' },
  { id: 'wrong-field', resume: read(PER, 'electrician.txt'), posting: read(FX, 'frontend-posting.txt'), title: 'Frontend Engineer', company: 'Brightline' },
  { id: 'maria-ross', resume: read(PER, 'maria.txt'), posting: read(PER, 'maria-frys-jd.txt'), title: 'Assistant Store Manager', company: "Fry's Food Stores" },
];
const built = new Map();
const run = (c) => { if (!built.has(c.id)) built.set(c.id, localPack({ company: c.company, role: c.title, resumeText: c.resume, jobText: c.posting, stage: 'Interview', nowMs: NOW })); return built.get(c.id); };
const blanks = (t) => (String(t || '').match(/\[[^\]]*\]/g) || []).length;
const given = (t) => String(t || '').replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
const answerOf = (p, q) => (/^Tell me about yourself/.test(q.q) ? { answer: p.intro } : p.answers.find((a) => a.q === q.q));
const vocab = (c, p) => vocabulary({ resumeText: c.resume, jobDescription: c.posting, jobTitle: c.title, company: c.company }, p.questions.map((q) => q.q).join(' '));

test('every pack: at least 80% of questions get a spoken draft with at most one blank; no three-blank worksheets', () => {
  for (const c of CASES) {
    const p = run(c);
    const qs = p.questions.filter((q) => !q.exercise);
    const drafts = qs.filter((q) => { const a = answerOf(p, q); return a && blanks(a.answer) <= 1 && given(a.answer) >= 8; });
    assert.ok(drafts.length / qs.length >= 0.8, `${c.id}: ${drafts.length}/${qs.length} drafted`);
    const three = p.answers.filter((a) => blanks(a.answer) >= 3);
    assert.ok(three.length <= 2, `${c.id}: ${three.map((a) => a.q).join(' | ')}`);
  }
});

test('every drafted answer passes the validator: agreement, no fragments, short sentences, and only résumé / posting / connective words', () => {
  for (const c of CASES) {
    const p = run(c);
    const v = vocab(c, p);
    for (const a of p.answers.filter((x) => x.draft)) assert.deepEqual(validateDraft(a.answer, v), [], `${c.id}: «${a.q}» ${a.answer}`);
    assert.deepEqual(validateDraft(p.intro, v, { maxBlanks: 1 }), [], `${c.id} intro: ${p.intro}`);
  }
});

test('a told answer names its résumé line word for word, and no two answers open the same way or say the same thing', () => {
  for (const c of CASES) {
    const p = run(c);
    const flat = (t) => String(t).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/\s+/g, ' ').trim();
    for (const a of p.answers.filter((x) => x.resume_fact)) assert.ok(flat(c.resume).includes(flat(a.resume_fact)), `${c.id}: ${a.resume_fact}`);
    const told = p.answers.filter((a) => a.resume_fact && a.draft && a.draft !== 'frame1').map((a) => a.answer.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    assert.equal(new Set(told).size, told.length, `${c.id}: repeated opener ${told.join(' | ')}`);
    const texts = p.answers.map((a) => a.answer).filter(Boolean);
    assert.equal(new Set(texts).size, texts.length, `${c.id}: a repeated answer`);
  }
});

test('the trainer case (director, 2026-11-10): drafts built on the call-review line, a promotion said as one, the register from the posting', () => {
  const c = CASES[0];
  const p = run(c);
  const coach = p.answers.find((a) => /coach agents through live call monitoring/i.test(a.q));
  assert.ok(coach, p.questions.map((q) => q.q).join(' | '));
  // her 1:1s and call reviews are the proof of coaching on live calls (it used to hint "Lead a team of 8…")
  assert.match(coach.resume_fact, /1:1s and monthly call reviews/, coach.answer);
  assert.equal(blanks(coach.answer), 1, coach.answer);
  assert.match(coach.answer, /coaching agents through live call monitoring and roleplay/);
  // never the old worksheet seams
  for (const a of p.answers) {
    assert.doesNotMatch(a.answer, /\b(?:materials|modules|agents) was\b/, a.answer);
    assert.doesNotMatch(a.answer, /work with on the agents|Closest to “/, a.answer);
  }
  // the intro: what she does, the promotion as a promotion, one link to this job
  assert.match(p.intro, /^I'm a Customer Support Team Lead at BrightPay Software, where I /);
  assert.match(p.intro, /I started there as a Customer Support Specialist in 2019 and moved up to Team Lead in 2022/);
  assert.match(p.intro, /\b94%/);
  assert.match(p.intro, /What draws me to this role is delivering new-hire training/);
  assert.ok(p.intro.split(/(?<=\.)\s+(?=[A-Z])/).length <= 4, p.intro);
  // why now is promotion-aware
  assert.match(p.answers.find((a) => /^Why are you looking/.test(a.q)).answer, /since 2019, and I moved up from Customer Support Specialist to Team Lead/);
  // the register comes from the POSTING (a trainer), never the résumé's field ("a mock call")
  assert.match(p.format, /teach-back/);
  assert.doesNotMatch(p.format, /mock call/);
  // job match: whole posting lines with the reader's status; no fragment rows; "observable behaviors" is never a row
  assert.ok(!p.job_match.some((r) => /^observable behaviors$/i.test(r.label)), p.job_match.map((r) => r.label).join(' | '));
  const review = p.job_match.find((r) => /call review and side-by-side/i.test(r.label));
  assert.ok(review && review.status !== 'gap' && /call reviews/.test(review.proof || ''), JSON.stringify(review));
  // ask-them: whole questions, no quoted fragment
  for (const q of p.ask_them) assert.doesNotMatch(q.q, /[“”"]/, q.q);
  assert.ok(p.ask_them.some((q) => /new-hire training/.test(q.q)), p.ask_them.map((q) => q.q).join(' | '));
  // the thank-you names the role and one real duty, with one blank for what was discussed (plus the name)
  const em = prepEmails({ company: c.company, role: p.role_said, name: 'Dana Whitfield', focus: p.email_focus, focus2: p.email_focus2 });
  assert.match(em.thankYou.body, /Call Center Trainer role at Meridian Health Partners/);
  assert.ok(p.email_focus && em.thankYou.body.includes(p.email_focus), em.thankYou.body);
  assert.equal(blanks(em.thankYou.body), 2, em.thankYou.body);
});

test('a "partly" or an unjudged duty is never told as "hasn\'t been part of my job"; a change of field claims nothing it cannot show', () => {
  for (const c of CASES) for (const a of run(c).answers) assert.doesNotMatch(a.answer, /hasn't been a formal part of my job/, `${c.id}: ${a.answer}`);
  const wf = run(CASES.find((c) => c.id === 'wrong-field'));
  assert.equal(wf.field_match, 'different');
  assert.ok(wf.notice, 'the change of field is said up front');
  // an electrician's "pull wire" is never the closest thing to "pull requests"
  for (const a of wf.answers) assert.doesNotMatch(a.answer, /closest[^.]*pull requests[^.]*pull wire/i, a.answer);
  for (const a of wf.answers) assert.doesNotMatch(a.answer, /I do this now|I did this/, a.answer);
});

test('the RN navigator: patient teaching proves "educate patients and families"; credentials keep their honest scripts', () => {
  const p = run(CASES[1]);
  const edu = p.job_match.find((r) => /^Educate patients and families/.test(r.label));
  assert.ok(edu && edu.status === 'shown' && /patient teaching/.test(edu.proof || ''), JSON.stringify(edu));
  const acls = p.job_match.find((r) => /ACLS/.test(r.label));
  assert.ok(acls && acls.status === 'gap' && /I hold a BLS certification/.test(acls.say), JSON.stringify(acls));
  assert.match(p.format, /clinical scenarios/);
});

test('the new graduate: the intro leads with the degree; "experience with SQL" is told from the SQL line', () => {
  const p = run(CASES[3]);
  assert.match(p.intro, /^I just finished a B\.S\. in Statistics and Data Science/);
  const sql = p.answers.find((a) => /experience with SQL/i.test(a.q));
  if (sql) assert.match(sql.resume_fact || '', /SQL/, sql.answer);
  // a past internship is "did", never "already do"
  for (const a of p.answers) assert.doesNotMatch(a.answer, /already do at Lone Star/, a.answer);
});

test('the warehouse lead: cycle counts are told from the cycle-count line; the licence is said as a licence', () => {
  const p = run(CASES[2]);
  const cc = p.answers.find((a) => /cycle counts/i.test(a.q));
  assert.match(cc.resume_fact || '', /cycle counts/i, cc.answer);
  const el = run(CASES.find((c) => c.id === 'wrong-field'));
  assert.doesNotMatch(el.intro, /Journeyman Electrician certification/, el.intro);
});

test('voice helpers: tense, person, agreement and the posting duty said as -ing', () => {
  assert.equal(gerundPhrase('Create or improve training materials, job aids and e-learning modules'), 'creating or improving training materials, job aids and e-learning modules');
  assert.equal(gerundPhrase('Track trainee progress and report on speed-to-proficiency'), 'tracking trainee progress and reporting on speed-to-proficiency');
  assert.equal(gerundPhrase('Follow up with, execute, and properly document doctors\' orders'), "following up with, executing, and properly documenting doctors' orders");
  assert.equal(gerundPhrase('Clean driving history and a valid license'), 'clean driving history and a valid license');
  assert.deepEqual(firstPerson('Ran the register and the service desk; returns, refunds and money orders'), { first: 'I ran the register and the service desk', rest: ['Returns, refunds and money orders'] });
  assert.equal(firstPerson('Wound care, ostomy care, post-op care'), null);
  assert.equal(resultSentence('Team CSAT held at 94% for 6 straight quarters'), "My team's CSAT held at 94% for 6 straight quarters");
  assert.equal(agree('the training materials, job aids and e-learning modules', 'was'), 'were');
  assert.equal(agree('trainee progress', 'was'), 'was');
  assert.equal(aAn('RN'), 'an'); assert.equal(aAn('Store Manager'), 'a'); assert.equal(aAn('HVAC technician'), 'an');
  assert.equal(joinList(['A', 'B', 'C']), 'A, B and C');
  assert.equal(dutySubject('Deliver new-hire training for classes of 10-15 customer service agents, from day one through nesting', 8), 'delivering new-hire training');
  assert.equal(dutySubject('Partner with team leads and quality assurance to find skill gaps and build refresher sessions'), 'partnering with team leads and quality assurance');
  assert.equal(dutySubject('Build and ship React features end to end with the product team', 9), 'building and shipping React features end-to-end');
  assert.equal(dutySubject('Talent Pipeline: Interview and hire across all three cafes', 8), 'interviewing and hiring across all three cafes');
  assert.equal(realStatement('observable behaviors'), true); // a phrase — but never a ROW on its own (the trainer test pins it)
  assert.equal(realStatement('Samsara (NYSE: IOT) sits at the center of hardware, software, AI, and the physical world'), false);
  assert.equal(realStatement('$2000 Retention Bonus for 36 hours per week commitment'), false);
});

test('the intro\'s link to the job is a whole clause or a plain blank — never a clipped duty fragment inside the prompt', () => {
  for (const c of CASES) {
    const p = run(c);
    assert.doesNotMatch(p.intro, /\[the one thing about|for example, the part about/, `${c.id}: ${p.intro}`);
    assert.ok(blanks(p.intro) <= 1, `${c.id}: ${p.intro}`);
  }
  // Tasha's posting (coordinator, 2026-11-10): the certification the posting values stays in the intro
  const tasha = localPack({ company: 'Grubhub', role: 'Marketing Coordinator', resumeText: read(PER, 'tasha.txt'), jobText: read(PER, 'tasha-topstep-jd.txt'), stage: 'Phone Screen', nowMs: NOW });
  assert.match(tasha.intro, /I hold a Social Media Marketing certification from HubSpot Academy\./, tasha.intro);
  assert.doesNotMatch(tasha.intro, /\[the one thing about/, tasha.intro);
});

test('the validator catches the director\'s seams', () => {
  assert.ok(validateDraft('[What you would do first.] [Who you would work with.] [How you would know.]').includes('blanks'));
  assert.ok(validateDraft('I would know the training materials was working [x].').includes('agreement'));
  assert.ok(validateDraft('Who you would work with on on the agents [x].').includes('fragment'));
  assert.ok(validateDraft('I led the the team [x].').includes('doubled'));
});
