// Alternatives in a posting are ONE requirement, met by any member (willingness-to-pay test,
// 2026-10-25): the free fit check told a Go engineer "Missing required skill: java" for a Stripe
// posting that asked for "at least one programming language: Go, Java, C/C++ etc.".
// Run: node --test lib/optimizer/alternatives.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOptimizer } from './index.js';
import { extractJobFacts } from './extractJobFacts.js';

const STRIPE_JD = `Who we are
About Stripe
Stripe is a financial infrastructure platform for businesses. Millions of companies use Stripe to accept payments and grow their revenue.
What you'll do
- Design, build, and maintain APIs, services, and systems across Stripe's engineering teams
- Debug production issues across services and multiple levels of the stack
Who you are
Minimum requirements
- 2–12+ years of professional hands-on software development experience
- Experience in at least one programming language: Go, Java, C/C++ etc.
- Experience designing, building, and maintaining APIs and distributed systems
Preferred qualifications
- Experience with Kubernetes and Docker`;
const TITLE = 'Backend Engineer, Core Technology';
const resumeWith = (lang) => `Alex Kim
alex@example.com
EXPERIENCE
Software Engineer | Acme Payments | Jan 2020 - Present
• Built payment APIs in ${lang} serving 2M requests per day
• Designed distributed systems for ledger reconciliation using PostgreSQL
• Debugged production incidents across services
SKILLS
${lang}, PostgreSQL, Docker, Kubernetes, distributed systems, APIs`;

const run = (resume) => runOptimizer({ resumeText: resume, jobTitle: TITLE, company: 'Stripe', jobDescription: STRIPE_JD });
const said = (o) => [o.verdict.sentence, ...o.risk_flags.map((f) => f.message), ...o.missing_keywords, ...o.unsupported_requirements.map((m) => m.surface)].join(' | ');

test('the choice list is extracted as one anyOf group', () => {
  const skills = extractJobFacts(STRIPE_JD, { jobTitle: TITLE }).filter((f) => f.factType === 'skill');
  const go = skills.find((f) => f.normalizedLabel === 'go');
  const java = skills.find((f) => f.normalizedLabel === 'java');
  assert.ok(go && java, JSON.stringify(skills.map((f) => f.normalizedLabel)));
  assert.ok(go.anyOf && go.anyOf === java.anyOf, 'Go and Java are alternatives');
});

test('a Go engineer is never told Java is a missing required skill', () => {
  const o = run(resumeWith('Go'));
  assert.doesNotMatch(said(o), /\bjava\b/i, said(o));
  assert.ok(!o.risk_flags.some((f) => f.code === 'missing_required_skills'), JSON.stringify(o.risk_flags));
});

test('a Java engineer is never told Go is missing either', () => {
  const o = run(resumeWith('Java'));
  assert.doesNotMatch(said(o), /\bgo\b/i, said(o));
});

test('with none of the alternatives, ONE row names the set as a choice', () => {
  const o = run(resumeWith('Ruby'));
  const flag = o.risk_flags.find((f) => f.code === 'missing_required_skills');
  assert.ok(flag, JSON.stringify(o.risk_flags));
  // C/C++ is read as one of the choices since 2026-10-25 (it was invisible to the reader before)
  assert.match(flag.message, /Missing 1 required skill\(s\): one of (?:go, java, c\+\+|java, go, c\+\+|go, java)\./);
  assert.ok(!o.missing_keywords.some((k) => /^(?:java|go)$/.test(k)), JSON.stringify(o.missing_keywords));
});

test('a plain list with "or" elsewhere in the sentence stays a list of requirements', () => {
  const facts = extractJobFacts('Requirements:\n- Customer service and cash handling experience required, and the ability to work weekends or holidays.', { jobTitle: 'Cashier' })
    .filter((f) => f.factType === 'skill');
  assert.ok(facts.length >= 2, JSON.stringify(facts.map((f) => f.normalizedLabel)));
  assert.ok(facts.every((f) => !f.anyOf), JSON.stringify(facts.map((f) => [f.normalizedLabel, f.anyOf])));
});
