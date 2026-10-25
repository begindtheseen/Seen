// How Seen's paid tools READ A POSTING — regression tests built from the real production postings
// the Pro test users read on 2026-10-25 (fixtures/paid-tool-postings.json: Kunai "Senior Backend
// Engineer (Golang)", Stripe "Backend Engineer, Core Technology", Groupon "Social Media Specialist",
// Topstep "CRM & Lifecycle Marketing Coordinator", stored exactly as in public.jobs — one flat line).
// Run: node --test lib/optimizer/paidToolReading.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractJobFacts } from './extractJobFacts.js';
import { sectionPosting, splitPostingSentences, extractConstraints } from './postingSections.js';
import { runOptimizer } from './index.js';
import { splitSentences, cutAtSentence } from '../text/sentences.js';
import { paragraphs } from '../jobs/descriptionText.js';
import { buildJobInsights } from '../server/jobInsights.js';
import { runAdvantage } from '../server/resumeAnalysis.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { resumeSpecialisation, roleCloseness, resumeRoleFamilies, jobMatchesResume } from '../server/resumeJobMatch.js';
import { JOB_INSIGHTS_VERSION } from '../jobInsightsVersion.js';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/paid-tool-postings.json', import.meta.url), 'utf8'));
const P = FX.postings;
const DEV = FX.resumes.dev;
const TASHA = FX.resumes.tasha;
const skills = (facts) => facts.filter((f) => f.factType === 'skill');
const skill = (facts, l) => facts.find((f) => f.factType === 'skill' && f.normalizedLabel === l);
const constraint = (facts, k) => facts.filter((f) => f.factType === 'constraint' && f.kind === k);

// ── Defect 1: the requirement reader ─────────────────────────────────────────────────────────
test('Groupon: the "Key Requirements" section is read (was 0 requirements → "No score")', () => {
  const facts = extractJobFacts(P.groupon.description, { jobTitle: P.groupon.title });
  for (const l of ['social media', 'tiktok', 'instagram', 'youtube', 'meta business suite', 'social media analytics']) assert.ok(skill(facts, l), `${l} missing: ${skills(facts).map((f) => f.label)}`);
  assert.equal(skill(facts, 'meta business suite').importance, 'required');
  assert.equal(skill(facts, 'on-camera presence').importance, 'preferred', '"Nice to Have" is preferred');
  const years = constraint(facts, 'years')[0];
  assert.ok(years && years.value === 2 && /social media/.test(years.label), JSON.stringify(years));
  assert.ok(!skill(facts, 'scheduling'), '"(not purely scheduling/community)" is not a requirement');
  const o = runOptimizer({ resumeText: TASHA, jobTitle: P.groupon.title, jobDescription: P.groupon.description });
  assert.ok(o.requirement_count >= 8, `requirement_count ${o.requirement_count}`);
  assert.notEqual(o.fit_score, null, o.verdict.sentence);
});

test('Stripe: more than two requirements are read (Studio said "only 2 requirements could be read")', () => {
  const facts = extractJobFacts(P.stripe.description, { jobTitle: P.stripe.title });
  for (const l of ['distributed systems', 'data structures', 'algorithms']) assert.equal(skill(facts, l)?.importance, 'required', l);
  for (const l of ['go', 'java', 'c++']) assert.match(skill(facts, l)?.anyOf || '', /^anyof:/, `${l} is one of the choices`);
  assert.equal(skill(facts, 'performance optimization')?.importance, 'preferred');
  assert.ok(!skill(facts, 'machine learning'), 'the team blurb is not a requirement');
  assert.ok(runOptimizer({ resumeText: DEV, jobTitle: P.stripe.title, jobDescription: P.stripe.description }).requirement_count >= 6);
});

test('Kunai: Go, event-driven architecture (Kafka/CDC as examples), payments; "training" is not read from the degree clause', () => {
  const facts = extractJobFacts(P.kunai.description, { jobTitle: P.kunai.title });
  assert.equal(skill(facts, 'go')?.importance, 'required');
  assert.ok(skill(facts, 'go').hard);
  assert.deepEqual(skill(facts, 'event-driven architecture')?.examples?.sort(), ['change data capture', 'kafka']);
  assert.match(skill(facts, 'payments')?.anyOf || '', /payments/);
  assert.equal(skill(facts, 'core banking')?.importance, 'preferred', '"… is a plus" beats a duty mention');
  assert.ok(!skill(facts, 'training'), '"in lieu of a degree … specialized training" is the degree rule');
  assert.equal(skill(facts, 'aws')?.orSimilar, true, '"AWS or other providers" is AWS or similar');
  assert.equal(constraint(facts, 'years')[0].importance, 'required', '"primary/preferred language" is not a preference cue');
});

test('Topstep: a parenthetical "a plus" makes only its own skills preferred; Preferred section heading', () => {
  const facts = extractJobFacts(P.topstep.description, { jobTitle: P.topstep.title });
  assert.equal(skill(facts, 'html')?.importance, 'required');
  assert.equal(skill(facts, 'css')?.importance, 'preferred');
  assert.equal(skill(facts, 'hubspot')?.importance, 'preferred');
  assert.ok(!skill(facts, 'customer intake'), '"asset intake" is not customer intake');
});

test('headings run into a flat posting are found under every common name', () => {
  for (const head of ['Key Requirements', 'Requirements', 'Qualifications', "What you'll need", "What we're looking for", 'Must have', 'Minimum Qualifications', 'Basic Qualifications', 'You have', 'About you', 'Who you are', 'Skills']) {
    const rows = sectionPosting(`We build software for banks and want to grow fast. ${head} Experience with Python and PostgreSQL. Strong SQL skills.`);
    assert.ok(rows.some((r) => r.kind === 'requirements' && /Python/.test(r.sentence)), `${head}: ${JSON.stringify(rows)}`);
  }
  const pref = sectionPosting('Requirements: Strong SQL. Preferred Qualifications Experience with Terraform.');
  assert.equal(pref.find((r) => /Terraform/.test(r.sentence)).kind, 'preferred');
  const nice = sectionPosting('Requirements: Strong SQL. Nice to have Experience with Terraform.');
  assert.equal(nice.find((r) => /Terraform/.test(r.sentence)).kind, 'preferred');
});

test('a semicolon, a trailing "ideally …" and "(PostgreSQL preferred)" do not demote a stated requirement', () => {
  const c = extractConstraints('Requirements:\n- 4+ years of HVAC service experience; commercial RTU and chiller experience strongly preferred');
  assert.equal(c.find((x) => x.kind === 'years').importance, 'required');
  const c2 = extractConstraints('Requirements:\n- 2+ years of phone and email customer support, ideally in a contact center');
  assert.equal(c2.find((x) => x.kind === 'years').importance, 'required');
  const f = extractJobFacts('What we are looking for\n- Strong SQL and relational database skills (PostgreSQL preferred)', { jobTitle: 'Backend Engineer' });
  assert.equal(skill(f, 'sql').importance, 'required');
  assert.equal(skill(f, 'postgresql').importance, 'preferred');
});

// ── Defect 2: AI job insights ────────────────────────────────────────────────────────────────
test('insights, Kunai: Go is read (title "(Golang)" + "Go as your primary language"); Kafka and AWS are not one choice', () => {
  const o = buildJobInsights({ title: P.kunai.title, company: P.kunai.company, description: P.kunai.description });
  assert.equal(o.what_they_want[0], 'Go');
  assert.ok(!o.what_they_want.some((w) => /Any of: Kafka, AWS/.test(w)), JSON.stringify(o.what_they_want));
  assert.ok(o.what_they_want.some((w) => /^Event-driven architecture \(e\.g\. Kafka/.test(w)), JSON.stringify(o.what_they_want));
  // the title alone names the language
  const t = extractJobFacts('Requirements: 5+ years of backend experience building services.', { jobTitle: 'Senior Backend Engineer (Golang)' });
  assert.equal(skill(t, 'go')?.importance, 'required');
  // the verb is never the language
  assert.ok(!skill(extractJobFacts('Requirements: you go above and beyond for customers; Python required.', { jobTitle: 'Software Engineer' }), 'go'));
});

test('insights, Stripe: no "Machine Learning" — it is only in the "About the team" blurb, which the old line parser read because a flat posting has no heading lines', () => {
  const o = buildJobInsights({ title: P.stripe.title, company: P.stripe.company, description: P.stripe.description });
  assert.ok(!/machine learning/i.test(JSON.stringify(o)), JSON.stringify(o.what_they_want));
  assert.ok(o.what_they_want.includes('Any of: Go, Java, C/C++'));
});

test('insights, Groupon: a real read, never the filler "Relevant experience"; a posting with nothing to read is read:false', () => {
  const o = buildJobInsights({ title: P.groupon.title, company: P.groupon.company, description: P.groupon.description });
  assert.equal(o.read, true);
  assert.ok(o.what_they_want.includes('Social media'), JSON.stringify(o.what_they_want));
  assert.ok(o.what_they_want.some((w) => /^2\+ years in social media/.test(w)));
  assert.ok(!o.what_they_want.some((w) => /relevant experience|clear communication|teamwork/i.test(w)));
  const empty = buildJobInsights({ title: 'Team Member', company: 'Sunbelt Express Car Wash', description: 'Join the family! We are a locally owned express car wash with 6 locations. Weekly pay, free unlimited wash membership, paid training and a fun team. Starting pay is $14 – $16 per hour. Apply today!' });
  assert.equal(empty.read, false);
  assert.deepEqual(empty.what_they_want, []);
  assert.equal(JOB_INSIGHTS_VERSION, 'v4', 'the cache version moved past every row written before this reader');
});

test('insights: a requirement the posting rules out, or another posting\'s, is never listed', () => {
  const nurse = buildJobInsights({ title: 'Registered Nurse – Telemetry', company: 'Summit Ridge', description: 'Position Summary\nPediatric unit nurses also need PALS; this telemetry role does not.\nQualifications\n- Active RN license (required)\n- BLS required; ACLS required within 6 months of hire' });
  assert.ok(!/PALS/.test(JSON.stringify(nurse)), JSON.stringify(nurse.what_they_want));
  const wh = buildJobInsights({ title: 'Warehouse Shift Lead', company: 'Northgate', description: 'Our sister company, Northgate Freight, is also hiring CDL-A drivers — see their separate postings.\nRequirements\n- 2+ years of warehouse experience\n- Forklift certification' });
  assert.ok(!/CDL/.test(JSON.stringify(wh.what_they_want)), JSON.stringify(wh.what_they_want));
});

// ── Defect 3: the sentence splitter, the summary and "About this role" ───────────────────────
test('splitter: "(e.g. Kafka/CDC)" is not a sentence end and no text is ever dropped', () => {
  for (const p of Object.values(P)) {
    const flat = p.description.replace(/\s+/g, ' ').trim();
    assert.equal(splitSentences(p.description).join(' '), flat);
    assert.equal(paragraphs(p.description).join(' ').replace(/\s+/g, ' '), flat, `${p.title}: paragraphs dropped text`);
    assert.ok(!paragraphs(p.description).some((x) => /\. g\. /.test(x) || /^g\. /.test(x)), 'never "safely. g. Kafka/CDC)"');
  }
  assert.ok(splitPostingSentences(P.groupon.description).some((s) => /\(e\.g\. Kling, Higgsfield/.test(s)));
});

test('summary: whole sentences, with the pay and what the job asks for', () => {
  const o = buildJobInsights({ title: P.kunai.title, company: P.kunai.company, description: P.kunai.description });
  const s = o.description_summary;
  assert.match(s, /140 - 170k/);
  assert.match(s, /What it asks for: Go;/);
  assert.match(s, /[.!?…]$/);
  assert.ok(!/\bnew da\b/.test(s));
  for (const sent of splitSentences(s)) assert.match(sent, /[.!?…:)]$|^What it asks for/, `cut sentence: ${sent}`);
  // a cut never ends mid-word: what is kept is the text up to a word boundary, then "…"
  const long = 'Help define whether new data products are served via batch.';
  const cut = cutAtSentence(long, 30);
  assert.ok(cut.endsWith('…'), cut);
  const kept = cut.slice(0, -1);
  assert.ok(long.startsWith(kept) && long[kept.length] === ' ', cut);
});

// ── Defect 4: the strategy plan ──────────────────────────────────────────────────────────────
const plan = (o) => Object.values(o).join('\n');
test('strategy, Kunai × Dev: names Go and payments, never fragments ("data and system", "core and applications")', () => {
  const o = runAdvantage({ job: P.kunai.title, company: P.kunai.company, resume: DEV, jobDescription: P.kunai.description });
  const t = plan(o);
  assert.match(o.hiring_manager_script, /\bGo\b/);
  assert.match(t, /payments/);
  assert.match(t, /Kafka/);
  assert.doesNotMatch(t, /experience with data and system|core and applications|\bdata, core\b/);
});

test('strategy, Topstep × Tasha: Starbucks "partners" and "email" fragments never pose as skills; proof is a whole bullet', () => {
  const o = runAdvantage({ job: P.topstep.title, company: P.topstep.company, resume: TASHA, jobDescription: P.topstep.description });
  const t = plan(o);
  assert.doesNotMatch(t, /\bpartners\b(?! on)/i);
  assert.doesNotMatch(t, /experience with email and/);
  const quoted = (t.match(/"([^"]+)"/g) || []).filter((q) => /\d/.test(q));
  for (const q of quoted) assert.ok(!/3 quarters in"$/.test(q), `cut quote ${q}`);
  // a résumé whose only result wraps onto a second line is quoted whole
  const wrapped = 'Pat Lee\nChicago, IL\nEXPERIENCE\nBarista — Starbucks, Chicago, IL  Sep 2023 – Present\n• Promoted seasonal launches and the rewards app at the register; store hit rewards sign-up goals 3 quarters in\na row.\nSKILLS\nCustomer service, email marketing';
  const w = runAdvantage({ job: P.topstep.title, company: P.topstep.company, resume: wrapped, jobDescription: P.topstep.description });
  assert.match(plan(w), /3 quarters in a row/);
});

test('strategy timing uses the listing\'s real age; no "first 48 hours" for a 5-day-old listing', () => {
  const old = runAdvantage({ job: P.kunai.title, company: P.kunai.company, resume: DEV, jobDescription: P.kunai.description, postedAt: '2026-10-20T18:00:00Z', now: '2026-10-25T18:00:00Z' });
  assert.doesNotMatch(old.timing_note, /48 hours/);
  assert.match(old.timing_note, /about 5 days/);
  const unknown = runAdvantage({ job: P.kunai.title, company: P.kunai.company, resume: DEV, jobDescription: P.kunai.description });
  assert.doesNotMatch(unknown.timing_note, /48 hours/);
});

test('strategy for a store MANAGER role is a manager plan, and a grocery chain has no "funding round"', () => {
  const jd = 'Assistant Store Leader\nWhat you\'ll do\n- Lead a team of 15–20 associates and hold them to service standards\n- Own labor scheduling and shrink results\nRequirements\n- 2+ years of retail management experience\n- Experience with scheduling and inventory management\n- Open availability including weekends';
  const r = 'Maria Lopez\nPhoenix, AZ\nEXPERIENCE\nDepartment Manager — Safeway, Phoenix, AZ  2017 – Present\n• Led teams of 14–18 associates; raised service scores from 78% to 91% in one year\n• Built weekly schedules and cut shrink 12%';
  const o = runAdvantage({ job: 'Assistant Store Leader', company: "Fry's Food Stores", resume: r, jobDescription: jd });
  const t = plan(o);
  assert.doesNotMatch(t, /register\/POS|master the open\/close|funding round/);
  assert.doesNotMatch(t, /leans on associates|performance, which/);
  assert.match(o.day_30, /one-on-one|schedule/);
});

// ── Defect 5: the résumé-matched rail ────────────────────────────────────────────────────────
test('rail: Dev (senior backend) is not matched to embedded, full-stack, AI-manager or security roles', () => {
  const spec = resumeSpecialisation({ top_titles: ['Senior Backend Engineer', 'Backend Engineer', 'Software Engineer'], skills: ['go', 'python', 'postgresql'] });
  for (const t of ['Embedded Software Engineer', 'Manager, Software Engineer (AI)', 'Principal Software Engineer, Full-Stack Development', 'Senior Software Engineer, Atlas Clusters Security', 'Forward Deployed Software Engineer', 'Junior Software Engineer']) {
    assert.equal(roleCloseness({ title: t }, spec).ok, false, t);
  }
  for (const t of ['Senior Backend Engineer (Golang)', 'Backend Engineer, Core Technology', 'Software Engineer II', 'Staff Software Engineer, Payments']) {
    assert.equal(roleCloseness({ title: t }, spec).ok, true, t);
  }
  assert.ok(roleCloseness({ title: 'Senior Backend Engineer (Golang)' }, spec).penalty < roleCloseness({ title: 'Software Engineer II' }, spec).penalty, 'a shared specialisation ranks first');
});

test('rail: retail and marketing matches are unchanged (no specialisation rule outside tech)', () => {
  const retail = resumeRoleFamilies({ top_titles: ['Sales Associate', 'Cashier'] });
  const rspec = resumeSpecialisation({ top_titles: ['Sales Associate', 'Cashier'] });
  for (const t of ['Sales Associate', 'Front End Cashier', 'Store Associate - Part Time']) {
    assert.ok(jobMatchesResume({ title: t }, retail) && roleCloseness({ title: t }, rspec).ok, t);
  }
  const mspec = resumeSpecialisation({ top_titles: ['Social Media Intern', 'Barista'] });
  assert.ok(roleCloseness({ title: 'Social Media Coordinator' }, mspec).ok);
  assert.ok(roleCloseness({ title: 'Marketing Assistant' }, mspec).ok);
});

// ── Role family: a field word decides; generic title words only when no field word is present ──
test('role family from ~30 real titles', () => {
  const want = {
    'Marketing Coordinator': 'marketing', 'Marketing Assistant': 'marketing', 'Social Media Specialist': 'marketing',
    'CRM & Lifecycle Marketing Coordinator': 'marketing', 'Sales Associate': 'retail', 'Medical Assistant': 'healthcare_support',
    'Dental Assistant': 'healthcare_support', 'Engineering Coordinator': 'general', 'Event Coordinator': 'general',
    'Administrative Assistant': 'administrative', 'Executive Administrative Assistant': 'administrative', 'Office Assistant': 'administrative',
    'Data Analyst': 'data_analytics', 'Financial Analyst': 'finance_accounting', 'Accounting Assistant': 'finance_accounting',
    'Project Coordinator': 'project_management', 'Operations Associate': 'operations', 'Teaching Assistant': 'education',
    'Customer Service Representative': 'customer_service', 'Customer Support Specialist (Remote)': 'customer_service',
    'Sales Development Representative': 'sales', 'Warehouse Associate': 'warehouse', 'Software Engineer': 'software_engineering',
    'Senior Backend Engineer (Golang)': 'software_engineering', 'Front Desk Agent': 'hospitality',
    'Registered Nurse – Telemetry (Nights)': 'clinical', 'Assistant Store Leader': 'retail', 'Commercial HVAC Service Technician': 'skilled_trades',
    '5th Grade Teacher': 'education', 'Line Cook': 'food_service', 'Senior Accountant': 'finance_accounting', 'Security Officer': 'security',
  };
  for (const [t, fam] of Object.entries(want)) assert.equal(detectRoleFamily(t, '').family, fam, t);
});

// ── The Studio/Résumé AI reader (lib/resume-intelligence): a choice is one requirement ──────────
test('résumé AI: "such as Zendesk, Freshdesk, or ServiceNow" is met by Zendesk; "or similar" is never a gap; RN is an RN license', async () => {
  const { analyzeApplication } = await import('../resume-intelligence/engine.js');
  const jd = 'Customer Support Specialist\nWhat we\'re looking for\n- Experience with a ticketing system such as Zendesk, Freshdesk, or ServiceNow\n- Experience with Tableau or Power BI\n- Experience with a warehouse management system (Manhattan, Blue Yonder, or similar)';
  const resume = 'Ana Ruiz\nEXPERIENCE\nSupport Rep — Acme, Austin, TX  2020 – Present\n- Resolved 60 tickets a day in Zendesk\n- Built weekly Tableau dashboards\n- Used Manhattan WMS to track returns';
  const out = analyzeApplication({ resumeText: resume, jobDescription: jd, jobTitle: 'Customer Support Specialist', company: 'Lumen' });
  const gaps = [...(out.missingRequirements || []), ...(out.missingRecoverable || [])].map((m) => String(m.requirement).toLowerCase());
  for (const bad of ['freshdesk', 'servicenow', 'power bi', 'similar', 'blue yonder']) assert.ok(!gaps.some((g) => g === bad), `${bad} listed as a gap: ${JSON.stringify(gaps)}`);
  const rn = analyzeApplication({ resumeText: 'Rebecca Thornton, BSN, RN\nEXPERIENCE\nStaff Nurse — St. Aurelia, Denver, CO  2020 – Present\n- Cared for 5 telemetry patients a shift', jobDescription: 'Qualifications\n- Active RN license (required)', jobTitle: 'Registered Nurse', company: 'Summit' });
  assert.ok(!(rn.criticalMissing || []).some((m) => /rn license/i.test(m.requirement)), JSON.stringify(rn.criticalMissing));
});
