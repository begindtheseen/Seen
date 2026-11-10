// Package R (2026-11-10): what Seen says a posting asks for, and what it says a résumé shows, is right.
// Every case is the judge's real sentence (director/reports/optimize.md classes 2–7, 10, 11; prep-insights D9, D10, D12).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer } from './index.js';
import { requirementSentences, extractConstraints, isBoilerplate } from './postingSections.js';
import { extractJobFacts } from './extractJobFacts.js';
import { cleanTerm } from './postingTerms.js';
import { stemWord } from './lemma.js';
import { careerYears } from '../resume/years.js';
import { CLOSED_PAGE_RE } from '../server/pageText.js';
import { IN_PROGRESS_LINE_RE } from './lineProof.js';

const FIX = new URL('../fixtures/personas/', import.meta.url);
const persona = (n) => fs.readFileSync(new URL(`${n}.txt`, FIX), 'utf8');
const POSTINGS = JSON.parse(fs.readFileSync(new URL('postings-sample.json', FIX), 'utf8'));
const labels = (o) => [...o.matched_requirements, ...o.unsupported_requirements].map((m) => m.surface);
const row = (o, re) => [...o.matched_requirements, ...o.unsupported_requirements].find((m) => re.test(m.surface));

test('class 1: boilerplate is never a requirement (real sentences from the judge cases)', () => {
  const junk = [
    'We invite you to take a look at our 12 West Instagram page, highlighting our great team!',
    "If you're ready to join our team, apply NOW and start work fast!",
    '(Se anima a los veteranos militares a postularse.) UNA NUEVA CARRERA IMPULSADA POR TI',
    'To conform to U.S. Government export regulations, applicant must be a (i) U.S. citizen or national, (ii) U.S. lawful, permanent resident.',
    'Learn more about the ITAR here .',
    'If you have a disability and need a workplace accommodation or adjustment during the application and hiring process, including support for the interview or onboarding process, please visit our page.',
    'Your Amazon package will include sign-on payments and restricted stock units (RSUs).',
  ];
  for (const s of junk) {
    assert.ok(isBoilerplate(s), s);
    assert.deepEqual(requirementSentences(`Requirements\n- 2+ years of retail experience.\n${s}`).map((r) => r.sentence), ['2+ years of retail experience.'], s);
  }
  // "What OBE Offers You" is a benefits heading: "Training – We will equip you…" under it is not a requirement
  const facts = extractJobFacts("What We're Looking For\n• Prior manufacturing experience\nWhat OBE Offers You\n• Training – We will equip you with the knowledge and skills you need to succeed", { jobTitle: 'Material Handler 1', company: 'Oldcastle BuildingEnvelope' });
  const ls = facts.filter((f) => f.factType === 'skill').map((f) => f.label);
  assert.ok(!ls.includes('training') && !ls.includes('OBE'), ls.join(' · '));
  assert.ok(ls.includes('manufacturing'), ls.join(' · '));
});

test('class 1: the employer, its initials and a negated sentence are never requirements', () => {
  const f = (jd, title, company) => extractJobFacts(jd, { jobTitle: title, company }).filter((x) => x.factType === 'skill').map((x) => x.label);
  assert.ok(!f('Requirements\n- CMD Technology & Offerings Expert: become familiar with CMD services and costs.\n- Experience with EMR systems required.', 'Medical Receptionist', 'ConvenientMD').includes('CMD'));
  assert.ok(!f('Qualifications\n- Based on the NMH framework for practice, the RN is accountable for care.\n- BLS required.', 'Registered Nurse', 'Northwestern Medicine').includes('NMH'));
  assert.ok(!f("What you'll do\n- What ships here isn't metrics on a dashboard. Build Go services for fleets.", 'Senior Software Engineer', 'Samsara').some((l) => /dashboard/i.test(l)));
});

test('class 1: fragments, shouted words and adjectives never make a requirement label', () => {
  for (const s of ['Trauma unit gain incredible', 'less than 1', 'education reflecting', 'critical thinking by integrating theoretical', 'You’ll combine advanced assessment', 'represent customer', 'exceptional analytical', 'simultaneous digital', 'senior individual', 'programs used', 'Proficient computer', 'clinical area', 'tasks based on crew members']) {
    assert.equal(cleanTerm(s), '', s);
  }
  assert.equal(cleanTerm('up keyword targeting'), 'keyword targeting');
  assert.equal(cleanTerm('diagnostic tools'), 'diagnostic tools');
});

test('class 2: a verb form meets its gerund; a different sense stays apart', () => {
  assert.equal(stemWord('scheduled'), stemWord('scheduling'));
  assert.equal(stemWord('engineer'), stemWord('engineering'));
  assert.equal(stemWord('electrician'), stemWord('electrical'));
  assert.equal(stemWord('developer'), stemWord('development'));
  assert.notEqual(stemWord('account'), stemWord('accounting')); // Account Management is not accounting
  assert.notEqual(stemWord('schedule'), stemWord('scheduling')); // a work schedule is not scheduling
  assert.notEqual(stemWord('pose'), 'pos'); // "pose relevant clinical questions" is not POS
});

test('class 2: false "missing" — the résumé shows it, in its own words', () => {
  const acct = runOptimizer({ resumeText: persona('accountant'), jobTitle: 'Senior Accountant', company: 'CoinsPaid', jobDescription: 'Requirements\n- Strong experience with bank, AP, AR and intercompany reconciliations.\n- Experience with month-end close.' });
  assert.equal(row(acct, /^AP$/).matched, true, 'AP ← "Accounts payable processing"');
  const elec = runOptimizer({ resumeText: persona('electrician'), jobTitle: 'Electrical Lead Installer', company: 'Bell Brothers', jobDescription: 'Requirements\n- A strong understanding of applicable electrical codes and safe installation practices.\n- Residential service upgrades.' });
  const codes = row(elec, /electrical codes/);
  assert.equal(codes.matched, true);
  assert.match(codes.evidence, /\bNEC\b/);
  const nurse = runOptimizer({ resumeText: persona('nurse'), jobTitle: 'Registered Nurse', company: 'DMC', jobDescription: 'Qualifications\n- Experience providing patient care on a med-surg unit required.\n- BLS required.' });
  const pc = row(nurse, /^patient care$/);
  assert.equal(pc.matched, true);
  assert.match(pc.evidence, /Provide care for 4-5 telemetry patients/);
  const dev = runOptimizer({ resumeText: persona('dev'), jobTitle: 'Backend Engineer, Payments', company: 'Stripe', jobDescription: persona('dev-stripe-jd') });
  const se = row(dev, /^software engineering$/);
  assert.ok(se && se.matched && se.via === 'title', JSON.stringify(se));
  const algo = row(dev, /^algorithms$/);
  assert.ok(algo && algo.matched && algo.inferred && algo.fundamental, 'an engineer is tested on algorithms, not told they lack them');
});

test('class 3: wrong proof — a word sense, an in-progress degree, an objective never prove', () => {
  const elec = runOptimizer({ resumeText: persona('electrician'), jobTitle: 'Electrical Test Technician', company: 'Base Power', jobDescription: 'Requirements\n- Comfort with power tools and fabrication equipment of all kinds.\n- Experience reading schematics.' });
  assert.equal(row(elec, /^power tools$/).matched, false, '"lighting and power problems" is not power tools');
  const nurse = runOptimizer({ resumeText: persona('nurse'), jobTitle: 'Registered Nurse', company: 'DMC', jobDescription: 'Qualifications\n- BSN preferred.\n- BLS required.' });
  const bsn = row(nurse, /BSN/);
  assert.ok(!bsn || !bsn.matched, '"Currently enrolled: RN to BSN" is not a BSN');
  const wh = runOptimizer({ resumeText: persona('warehouse'), jobTitle: 'Warehouse Associate', company: 'Integrity Staffing Solutions', jobDescription: 'Requirements\n- Previous warehouse experience preferred.\n- Able to lift 50 lbs.' });
  const w = row(wh, /^warehouse$/);
  assert.ok(w.matched && !/looking for/i.test(w.evidence), w.evidence);
});

test('class 4: hard gates — CPR by BLS, Staff is not management, college meets a diploma, a licence names its state', () => {
  const rn = runOptimizer({ resumeText: persona('nurse'), jobTitle: 'RN, Registered Nurse Home Health', company: 'VitalCaring', jobDescription: 'Requirements\n- Current RN license required.\n- CPR certification required.' });
  assert.ok(!rn.hard_gates.some((g) => /CPR/.test(g.label)), JSON.stringify(rn.hard_gates));
  const staff = runOptimizer({ resumeText: persona('tasha'), jobTitle: 'Staff Accountant', company: 'Sargent & Lundy', jobDescription: "Requirements\n- Bachelor's degree in accounting required.\n- Strong attention to detail." });
  assert.ok(!staff.hard_gates.some((g) => g.kind === 'seniority'), JSON.stringify(staff.hard_gates));
  const admin = runOptimizer({ resumeText: persona('admin'), jobTitle: 'Medical Receptionist', company: 'ConvenientMD', jobDescription: 'Requirements\n- High school diploma or GED required.\n- Experience with insurance verification.' });
  assert.ok(!admin.hard_gates.some((g) => g.kind === 'degree'), JSON.stringify(admin.hard_gates));
  const elec = runOptimizer({ resumeText: persona('electrician'), jobTitle: 'Journeyman Service Driver', company: 'Enterprise Electrical', jobDescription: 'Requirements\n• Possession of a Texas Journeyman or Master electrical license.\n• Demonstrated leadership abilities.' });
  const lic = elec.hard_gates.find((g) => g.kind === 'certification');
  assert.ok(lic, 'the Texas licence is a real gate for an Arizona electrician');
  assert.match(lic.message, /Texas/);
  assert.match(lic.message, /Arizona Journeyman/);
  const wh = runOptimizer({ resumeText: persona('warehouse'), jobTitle: 'Warehouse Manager', company: 'Uline', jobDescription: 'Requirements\n- 7+ years of management experience in a high-volume, 100,000+ square-foot distribution center including hiring, training and motivating a team.' });
  const y = wh.constraints.find((c) => c.kind === 'years');
  assert.match(y.message, /management/);
  assert.doesNotMatch(y.message, /square-foot/);
});

test('class 6: the years label is never doubled', () => {
  const c = extractConstraints('Requirements\n1+ year of experience as department manager, assistant department manager or comparable retail leadership position required.');
  assert.equal(c.find((x) => x.kind === 'years').label, '1+ year of experience as department manager');
});

test('class 7: one years figure, and a note when the summary disagrees with the dates', () => {
  const cy = careerYears(persona('dev'));
  assert.equal(typeof cy.dated, 'number');
  assert.equal(cy.stated, 6);
  assert.match(cy.note, /says 6 years/);
  const o = runOptimizer({ resumeText: persona('dev'), jobTitle: 'Backend Engineer', company: 'Stripe', jobDescription: persona('dev-stripe-jd') });
  assert.equal(o.career_years.dated, cy.dated);
  assert.equal(o.years_note, cy.note);
  assert.equal(careerYears(persona('admin')).note, null, '"12+ years" with 14 years of dates agrees');
});

test('class 8: every requirement row carries a kind consumers can phrase', () => {
  const KINDS = new Set(['tool', 'skill', 'field', 'credential', 'duty', 'trait', 'language', 'schedule']);
  for (const p of POSTINGS) {
    const o = runOptimizer({ resumeText: persona(p.persona), jobTitle: p.title, company: p.company, jobDescription: p.description });
    for (const m of [...o.matched_requirements, ...o.unsupported_requirements]) assert.ok(KINDS.has(m.kind), `${p.id}: ${m.surface} → ${m.kind}`);
  }
});

test('invariants over the fixture set: no gate without a posting quote, no proof from an in-progress line, no junk label', () => {
  const JUNK = /\b(?:instagram|apply now|NOW|una|nueva|itar|rsus?|than|gain|youll)\b/;
  for (const p of POSTINGS) {
    const o = runOptimizer({ resumeText: persona(p.persona), jobTitle: p.title, company: p.company, jobDescription: p.description });
    for (const g of o.hard_gates) assert.ok(String(g.posting_quote || '').trim(), `${p.id}: gate "${g.label}" has no posting sentence`);
    for (const m of o.matched_requirements) if (m.evidence) assert.ok(!IN_PROGRESS_LINE_RE.test(m.evidence), `${p.id}: ${m.surface} ← ${m.evidence}`);
    for (const l of labels(o)) assert.ok(!JUNK.test(l), `${p.id}: junk label "${l}"`);
  }
});

test('liveness guard: "open until the position is filled" is not a closed page', () => {
  assert.equal(CLOSED_PAGE_RE.test('Applications accepted on a rolling basis, open until the position is filled.'), false);
  assert.equal(CLOSED_PAGE_RE.test('This position has been filled.'), true);
});
