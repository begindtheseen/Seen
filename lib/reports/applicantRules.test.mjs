// Run: node --test lib/reports/applicantRules.test.mjs
// Every case is a real sentence from the 2026-10-20 archive sample (Home Depot, Chipotle, Sheetz, Amazon),
// trimmed. The NO cases are ones the old rule wrongly counted as applicant outcomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyApplicantAccount, nameVariants, oneAccountPerVoice, REPORT_OUTCOME } from './applicantRules.js';

const yes = (text, names, outcome, ctx = {}) => {
  const r = classifyApplicantAccount(text, { names, ...ctx });
  assert.equal(r.kind, 'applicant_outcome', `${text} → ${JSON.stringify(r)}`);
  assert.equal(r.outcome, outcome, text);
  // The stored excerpt alone must pass the same rules (Seen re-checks it server-side).
  const again = classifyApplicantAccount(r.excerpt, { names, ...ctx });
  assert.equal(again.kind, 'applicant_outcome', `excerpt fails on its own: ${r.excerpt}`);
  return r;
};
const no = (text, names, ctx = {}) => {
  const r = classifyApplicantAccount(text, { names, ...ctx });
  assert.notEqual(r.kind, 'applicant_outcome', `${text} → ${JSON.stringify(r)}`);
  return r;
};

test('first-hand accounts that name the company are accepted with the right outcome', () => {
  yes('Home Depot interviewed me, then ghosted me.', ['Home Depot'], 'ghosted');
  yes('I’m 18 and really need a job, and I just got a job offer from Home Depot as a Sales Associate.', ['The Home Depot'], 'offer');
  yes('I got a rejection email from Chipotle.', ['Chipotle'], 'rejected');
  yes('Hi I recently got an interview for a corporate position with Home Depot.', ['Home Depot'], 'interview');
  yes('I got hired at a chipotle about a month ago and still haven\'t worked.', ['Chipotle'], 'offer');
  yes('Long-time lurker, first time posting because of something that happened during my interview process for a Contract Manager role at Amazon.', ['Amazon'], 'interview');
  yes('I applied to Sheetz last week. They ghosted me after the phone screen.', ['Sheetz'], 'ghosted');
});

test('an opening post in a thread about the company counts even when the sentence does not repeat the name', () => {
  yes('Either way it doesn’t matter, I got rejected for the job.', ['Chipotle'], 'rejected', { isOp: true, title: 'Chipotle hiring manager never showed up' });
  no('Either way it doesn’t matter, I got rejected for the job.', ['Chipotle'], { isOp: false, title: 'Chipotle hiring manager never showed up' });
});

test('in the company’s own subreddit the company is the context; another or unnamed employer still is not', () => {
  yes('Just got hired, orientation is Monday!', ['Home Depot'], 'offer', { inCompanySub: true, isOp: true, title: 'Finally' });
  no('I just got hired somewhere else, so I put in my two weeks.', ['Home Depot'], { inCompanySub: true });
  no('I got hired to be a shift lead at Taco Bell a month ago.', ['Chipotle'], { inCompanySub: true });
});

test('the old rule’s false positives are rejected', () => {
  // never names the company
  no('I hope so, I got a bachelor’s in Business Administration back in 2015, and I have only been able to get hired for dead-end jobs.', ['Chipotle']);
  // another employer, in a thread about the company
  no('I got hired to be a shift lead at Taco Bell a month ago.', ['Chipotle'], { isOp: true, title: 'Quitting Taco Bell, interview at Chipotle' });
  no('I have either not heard back from them and got rejected from Best Buy and Target.', ['Home Depot'], { isOp: true, title: 'Home Depot application' });
  // many employers / hearsay / advice / hypothetical / a list / an example template
  no('I applied to lots of other tech companies, but almost all rejected me.', ['Amazon'], { isOp: true, title: 'Amazon interview' });
  no('I have even heard of some places that will automatically reject, due to the culture.', ['Amazon'], { isOp: true, title: 'Amazon OA' });
  no('Walk into the store and ask if they’re hiring — you should get an interview at Home Depot that way.', ['Home Depot']);
  no('If Home Depot offers you the job, take it.', ['Home Depot']);
  no('Currently on my blacklist: Sheetz Marathon The local animal shelter All the stores at the mall Five Below Dollar General Kroger Food Lion Goodwill', ['Sheetz'], { isOp: true, title: 'Sheetz' });
  no('Ex : TEXT MESSAGE “Good afternoon, I wanted to let you know that I have received a offer to be a supervisor at a sheetz for 18.50 yesterday.', ['Sheetz']);
  // negation and questions
  no('I never got an offer from Home Depot even after two interviews.', ['Home Depot'].slice(0, 1).concat([]), {}) ;
  no('Did anyone else get ghosted by Home Depot after the interview?', ['Home Depot']);
  // an employee story
  assert.equal(classifyApplicantAccount('I worked at Home Depot for 11 years and they hired me when I was 18.', { names: ['Home Depot'] }).kind, 'employee_review');
});

test('name variants, one account per voice, outcome mapping to the reports table', () => {
  assert.deepEqual(nameVariants(['The Home Depot, Inc.']), ['the home depot', 'thehomedepot', 'home depot', 'homedepot']);
  const accounts = oneAccountPerVoice([
    { voice: 't1:op', outcome: 'interview' }, { voice: 't1:op', outcome: 'rejected' }, { voice: 't1:c9', outcome: 'ghosted' },
  ]);
  assert.deepEqual(accounts.map((a) => a.outcome).sort(), ['ghosted', 'rejected'], 'the OP’s most final outcome; other voices kept');
  assert.equal(REPORT_OUTCOME.assessment, 'interviewing');
  assert.equal(REPORT_OUTCOME.responded, 'human');
});

test('company-subreddit false positives (live r/HomeDepot sample) are rejected; real ones kept', () => {
  const sub = { inCompanySub: true, title: 'Interview tips?' };
  no('We let the person who got the job know *last* so that the people that didn’t get the job don’t hear it from someone else.', ['Home Depot'], sub);
  no('When I was promoted I was informed not to speak of it yet because they still needed to speak to those who didn\'t get the position.', ['Home Depot'], sub);
  no('When I got hired (10 years ago) they tested when I got hired, so they didn\'t test when I got my lift licenses.', ['Home Depot'], sub);
  no('Dress to impress I wore a suit back in the 90ies to my interview and got the job', ['Home Depot'], sub);
  no('I was hired just about 3 years ago, and from what I\'ve heard it\'s the same process currently.', ['Home Depot'], sub);
  no('I am currently a CXM, I applied and interviewed for MASM on February 25th.', ['Home Depot'], { ...sub, isOp: true });
  no('I just got updated in the workforce app that my time of request because I have jury duty was rejected.', ['Home Depot'], { inCompanySub: true, isOp: true, title: 'Jury duty' });
  no('I apply to McDonald\'s, Home Depot etc all the time and get automatically rejected.', ['Home Depot']);
  yes('I went in for an interview for cashier at home depot and I thought it went really well, only to get an email 2 days later saying I didn\'t get the job.', ['Home Depot'], 'rejected');
  yes('I just interviewed yesterday for a pro sales position and got the job offer today, less than 24 hours later.', ['Home Depot'], 'offer', sub);
  yes('I just got hired in the Lumber department at Home Depot, and I start orientation at the end of the month.', ['Home Depot'], 'offer', sub);
  yes('I accepted an offer and submitted all the forms for onboarding a few days ago.', ['Home Depot'], 'offer', { inCompanySub: true, isOp: true, title: 'Onboarding' });
});

test('a rescinded offer is a rejection; long-ago hires are not applicant reports', () => {
  yes('So overall I received an offer then had it given to someone else.', ['Home Depot'], 'rejected', { inCompanySub: true, isOp: true, title: 'Offer pulled' });
  yes('Home Depot rescinded my offer after the background check.', ['Home Depot'], 'rejected');
  no('I got the job and a year later I’m now a supervisor with a comfortable career.', ['Home Depot'], { inCompanySub: true });
});

test('storableAccount picks text that passes the re-check on its own; company subreddits by name', async () => {
  const { storableAccount, isCompanySubreddit, outcomeSentiment } = await import('./applicantRules.js');
  const a = storableAccount('Long story. I applied to Sheetz last week and they ghosted me after the phone screen. Anyway, moving on.', { names: ['Sheetz'] });
  assert.equal(a.outcome, 'ghosted');
  assert.equal(classifyApplicantAccount(a.excerpt, { names: ['Sheetz'] }).kind, 'applicant_outcome');
  assert.equal(storableAccount('They ghost applicants all the time.', { names: ['Sheetz'] }), null);
  assert.equal(isCompanySubreddit('HomeDepot', ['The Home Depot']), true);
  assert.equal(isCompanySubreddit('r/sheetz', ['Sheetz']), true);
  assert.equal(isCompanySubreddit('recruitinghell', ['Sheetz']), false);
  assert.equal(outcomeSentiment('offer'), 'positive');
  assert.equal(outcomeSentiment('ghosted'), 'negative');
});
