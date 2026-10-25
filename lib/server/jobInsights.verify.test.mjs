// AI job insights must never drop or invent a requirement (willingness-to-pay test, 2026-10-25).
//   • Stripe "Backend Engineer, Core Technology" ("Go, Java, C/C++ etc.", "2–12+ years") produced
//     "Java, C++, Machine Learning, 12+ years experience" — Go dropped, ML invented, years inflated.
//   • A $70k Groupon Social Media role produced "The schedule is fixed — the shift is
//     non-negotiable" off the word "full-time".
// Run: node --test lib/server/jobInsights.verify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobInsights, verifyInsightAgainstPosting } from './jobInsights.js';

const STRIPE = `<h2>Who we are</h2><p><strong>About Stripe</strong></p><p>Stripe is a financial infrastructure platform for businesses. Millions of companies use Stripe to accept payments, grow their revenue, and accelerate new business opportunities. We use machine learning to fight fraud across the network.</p>
<p><strong>About the team</strong></p><p>Core Technology builds the foundational systems every Stripe product runs on.</p>
<h2>What you'll do</h2><ul><li>Design, build, and maintain APIs, services, and systems across Stripe's engineering teams</li><li>Debug production issues across services and multiple levels of the stack</li></ul>
<h2>Who you are</h2><p>We're looking for someone who meets the minimum requirements to be considered for the role.</p>
<p><strong>Minimum requirements</strong></p><ul><li>2–12+ years of professional hands-on software development experience</li><li>Experience in at least one programming language: Go, Java, C/C++ etc.</li><li>Experience designing, building, and maintaining APIs and distributed systems</li></ul>
<p><strong>Preferred qualifications</strong></p><ul><li>Experience writing high quality code in a major programming language</li></ul>
<h2>Benefits</h2><p>Hybrid work, flexible hours, and a generous learning budget.</p>`;

const GROUPON = `About the role: Groupon is hiring a Social Media Manager to own our organic social channels. This is a full-time role with a salary of $70,000 per year.
Responsibilities:
- Plan and publish daily content across Instagram, TikTok, and X.
- Report weekly on engagement and growth.
Requirements:
- 3+ years managing brand social media accounts.
- Strong writing and an eye for trends.
Benefits: flexible hours, remote-friendly, 401(k).`;

const all = (o) => [...o.what_they_want, ...o.hidden_requirements, o.insider_tip].join(' | ');

test('Stripe: Go, Java and C/C++ stay ONE "any of" item; no invented ML; years = the posting\'s minimum', () => {
  const o = buildJobInsights({ title: 'Backend Engineer, Core Technology', company: 'Stripe', description: STRIPE, needsSummary: false });
  assert.ok(o.what_they_want.includes('Any of: Go, Java, C/C++'), JSON.stringify(o.what_they_want));
  assert.ok(!o.what_they_want.some(w => /^(?:Java|C\+\+|Go)$/.test(w)), 'an alternative is never a hard requirement');
  assert.ok(!/machine learning/i.test(o.what_they_want.join(' ')), 'the company blurb is not a requirement');
  assert.ok(o.what_they_want.includes('2+ years experience'), JSON.stringify(o.what_they_want));
  assert.ok(!/12\+ years/.test(all(o)), 'the range is never read as 12+');
  assert.match(o.insider_tip, /any of Go, Java, C\/C\+\+/);
  assert.doesNotMatch(o.insider_tip, /Mirror these exact terms/);
});

test('Groupon: "full-time" is not a shift — no fixed-schedule / non-negotiable-shift claim', () => {
  const o = buildJobInsights({ title: 'Social Media Manager', company: 'Groupon', description: GROUPON, needsSummary: false });
  assert.doesNotMatch(all(o), /shift|schedule is fixed|non-negotiable|non-standard hours/i, all(o));
  assert.ok(o.what_they_want.includes('3+ years experience'), JSON.stringify(o.what_they_want));
});

test('a real shift is still named, worded as what the posting says', () => {
  const o = buildJobInsights({ title: 'Warehouse Associate', company: 'ShipCo', needsSummary: false,
    description: 'Requirements:\n- Must be able to work 2nd shift, 2:30pm - 11pm.\n- Lift up to 50 lbs.\n- Forklift certification preferred.' });
  assert.ok(o.hidden_requirements.some(h => /2nd \(2:30pm–11pm\) shift/.test(h)), JSON.stringify(o.hidden_requirements));
  assert.doesNotMatch(all(o), /non-negotiable/);
});

test('post-check drops any skill or years figure the posting does not contain, and schedule claims without a schedule', () => {
  const desc = 'Requirements: experience with Java and Python; 3 years of experience in backend work.';
  const v = verifyInsightAgainstPosting({
    what_they_want: ['Java', 'Machine Learning', 'Any of: Go, Python', '12+ years experience', '3+ years experience', 'Python (or similar)'],
    hidden_requirements: ['The posting names a night shift — confirm that schedule fits your life before you apply.', 'Communication is graded.'],
    insider_tip: 'State your weekend availability in the very first line.',
  }, desc);
  assert.deepEqual(v.what_they_want, ['Java', 'Python (or similar)', '3+ years experience']);
  assert.deepEqual(v.hidden_requirements, ['Communication is graded.']);
  assert.doesNotMatch(v.insider_tip, /weekend/);
});

test('alternatives: "or" / "/" / "etc." / "like" make a choice; a plain list does not', () => {
  const pick = (req) => buildJobInsights({ title: 'Software Engineer', company: 'Acme', needsSummary: false,
    description: `Requirements:\n- ${req}\n- Experience building and running production web services for real users.` }).what_they_want;
  assert.ok(pick('Experience with Python or Ruby.').includes('Any of: Python, Ruby'));
  assert.ok(pick('Strong Java/Kotlin skills.').includes('Any of: Java, Kotlin'));
  assert.ok(pick('A language like Python.').includes('Python (or similar)'));
  const plain = pick('Experience with Python and PostgreSQL.');
  assert.ok(plain.includes('Python') && plain.includes('PostgreSQL'), JSON.stringify(plain));
  // CI/CD and C/C++ are one skill's name, not a choice
  assert.ok(pick('Experience with Docker and CI/CD.').includes('Docker'));
});
