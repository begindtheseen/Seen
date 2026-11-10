// The answer composer (P2, 2026-11-10): every answer a spoken draft with at most one blank, built from the résumé and
// the posting, never a three-blank worksheet. Pinned on the director's trainer case (a support team lead applying to a
// call-center TRAINER job) and six more cases across fields, plus invariants that run over every one of them.
// Run: node --test lib/server/prepCompose.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localPack } from './prepLocal.js';
import { validateDraft, dutySubject, realStatement, vocabulary, dutyBlank } from './prepCompose.js';
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
  { id: 'trainer-2', resume: read(FX, 'support-lead-2.txt'), posting: read(FX, 'trainer-posting-2.txt'), title: 'Call Center Trainer', company: 'Intellipet' },
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

// Coordinator round 2: a confident non-sequitur is worse than a blank.
const BRIDGE_RE = /\b(?:closest|nearest|lines up with|This job asks for|part of my work closest|I'd bring that to|I do this now|I did this|The part of this job I)\b/;
test('round 2: every drafted bridge or "closest" names the link it stands on; no link, no bridge', () => {
  for (const c of CASES) for (const a of run(c).answers.filter((x) => x.draft && x.resume_fact && BRIDGE_RE.test(x.answer))) {
    assert.ok(a.link && a.link.kind && a.link.words && a.link.words.length, `${c.id}: «${a.q}» ${a.answer}`);
  }
  for (const c of CASES) for (const a of run(c).answers) {
    assert.doesNotMatch(a.answer, /It covers what this posting asks for/, a.answer);
    // a bridge never ties a story to a schedule or a condition of the job
    assert.doesNotMatch(a.answer, /(?:lines up with|built around|centres on) [^.[]*\b(?:full-time|schedule|operating hours|on-site|shifts?)\b/i, `${c.id}: ${a.answer}`);
  }
});

test('round 2, the trainer pair: closest for materials is the macros clause; 1:1s are SHOWN for one-on-one feedback; no stray numbers', () => {
  const p = run(CASES.find((c) => c.id === 'trainer-2'));
  const by = (re) => p.answers.find((a) => re.test(a.q));
  const mat = by(/training materials and sales exercises/);
  assert.match(mat.answer, /(?:closest|nearest)[^.]*: I split the Zendesk queue by issue type and added macros|split the Zendesk queue by issue type and added macros/, mat.answer);
  assert.doesNotMatch(mat.answer, /first response time/, mat.answer);
  const fb = by(/one-on-one performance feedback/);
  assert.match(fb.answer, /I run weekly 1:1s and monthly call reviews/, fb.answer);
  assert.doesNotMatch(fb.answer, /closest|nearest/, fb.answer);
  assert.match(fb.answer, /\[what you would listen for first, and how you would say it\]/, fb.answer);
  const vt = by(/virtual training/);
  assert.match(vt.answer, /onboarding calls/, vt.answer);
  assert.doesNotMatch(vt.answer, /lead a team of 8/, vt.answer);
  // "Delivering call center training is work I already do" claimed a job she does not have
  for (const a of p.answers) {
    assert.doesNotMatch(a.answer, /training is work I already do|so this role is a close fit/, a.answer);
    assert.doesNotMatch(a.answer, /trained customers on setup during onboarding calls\. I (?:answered|handled) 40/i, a.answer);
  }
  // no volume-shift question on a trainer's prep; "what do you know" is the posting's own description
  assert.ok(!p.questions.some((q) => /typical busy day/i.test(q.q)), p.questions.map((q) => q.q).join(' | '));
  const know = by(/^What do you know about/);
  if (know) assert.doesNotMatch(know.answer, /is hiring a/, know.answer);
  // why now and the intro's link are the CORE duty, never the schedule line
  assert.doesNotMatch(by(/^Why are you looking/).answer, /full-time|operating hours/, by(/^Why are you looking/).answer);
  assert.doesNotMatch(p.intro, /full-time|operating hours/, p.intro);
});

test('round 2: the blank\'s prompt fits the statement\'s own object and verb', () => {
  const cases = [
    ['Provide specific one-on-one performance feedback to agents after training', /listen for/],
    ['Develop and update training materials and sales exercises', /first piece you would build/],
    ['Facilitate virtual training for new and existing agents', /open the first session/],
    ['Document training outcomes and escalate performance risks to management', /measure first/],
    ['Track trainee progress and report on speed-to-proficiency', /measure first/],
    ['Partner with team leads and quality assurance to find skill gaps', /talk to first/],
    ['Coach agents through live call monitoring and roleplay', /listen for/],
    ['Run daily cycle counts and research inventory variances', /set it up/],
  ];
  for (const [t, re] of cases) assert.match(dutyBlank(t), re, t);
});

test('round 3: same-work object is SHOWN; numbers stay linked; the core is a duty; a second question builds on the first proof', () => {
  const R = read(FX, 'support-lead-3.txt');
  const p = localPack({ company: 'Northline Health', role: 'Call Center Trainer', resumeText: R, jobText: read(FX, 'trainer-posting-3.txt'), stage: 'Interview', nowMs: NOW });
  const by = (re) => p.answers.find((a) => re.test(a.q));
  // (1) weekly 1:1s ARE one-on-one feedback: "I do this now", never "the nearest example"
  const fb = by(/one-on-one performance feedback/);
  assert.match(fb.answer, /^I do this now at Brightwave Telecom: I run weekly 1:1s and monthly call reviews\./, fb.answer);
  // (2) no number from an unlinked line ("40 to 60 tickets a day" under a training answer)
  for (const a of p.answers.filter((x) => /training|train/i.test(x.q))) assert.doesNotMatch(a.answer, /tickets a day/, a.answer);
  // (4) the second training-materials question builds on the first one's proof instead of repeating it
  const first = by(/create or improve training materials/);
  const second = by(/develop and update training materials and sales exercises/);
  assert.match(first.answer, /120 help-center articles/, first.answer);
  assert.match(second.answer, /^Beyond the 120 help-center articles I mentioned, for developing and updating training materials and sales exercises/, second.answer);
  // (3) the core of the role is the first DUTY, never a years/experience requirement
  for (const a of p.answers.filter((x) => /^Why (?:do you want|are you looking)/.test(x.q))) assert.doesNotMatch(a.answer, /built around (?:\d|call center experience|experience)/i, a.answer);
  const q = localPack({ company: 'Northline Health', role: 'Call Center Trainer', resumeText: R, jobText: read(FX, 'trainer-posting-reqonly.txt'), stage: 'Interview', nowMs: NOW });
  for (const a of q.answers.filter((x) => /^Why (?:do you want|are you looking)/.test(x.q))) {
    assert.doesNotMatch(a.answer, /built around|centres on/i, a.answer);
    assert.match(a.answer, /This is a Call Center Trainer role/, a.answer);
  }
});

test('the validator catches the director\'s seams', () => {
  assert.ok(validateDraft('[What you would do first.] [Who you would work with.] [How you would know.]').includes('blanks'));
  assert.ok(validateDraft('I would know the training materials was working [x].').includes('agreement'));
  assert.ok(validateDraft('Who you would work with on on the agents [x].').includes('fragment'));
  assert.ok(validateDraft('I led the the team [x].').includes('doubled'));
});
