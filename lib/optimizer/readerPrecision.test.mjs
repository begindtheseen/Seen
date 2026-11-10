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
  // G3: the same license held in another state is a real, stated gap (it lowers the score hard and names both states),
  // not a positive "not met" of the trade — it no longer caps at 35
  const lic = elec.constraints.find((g) => g.kind === 'certification');
  assert.ok(lic && lic.status === 'unmet' && lic.grade === 'partly' && lic.factor <= 0.6, 'the Texas license is a real gap for an Arizona electrician');
  assert.match(lic.message, /Texas/);
  assert.match(lic.message, /Arizona Journeyman/);
  const wh = runOptimizer({ resumeText: persona('warehouse'), jobTitle: 'Warehouse Manager', company: 'Uline', jobDescription: 'Requirements\n- 7+ years of management experience in a high-volume, 100,000+ square-foot distribution center including hiring, training and motivating a team.' });
  const y = wh.constraints.find((c) => c.kind === 'years');
  // graded (G 2026-11-10): he has trained new hires but managed no one — said in those words, never "shows none"
  assert.match(y.message, /managed people|managing people/);
  assert.doesNotMatch(y.message, /square-foot|shows none/);
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

// ── Director's acceptance-set classes (2026-11-10), each on a sentence from another public corpus posting ──
import { employerDisplayName } from '../text/employerName.js';
import { decodeEntities } from './pastedText.js';
const skills = (jd, title, company) => extractJobFacts(jd, { jobTitle: title, company }).filter((f) => f.factType === 'skill').map((f) => f.label);

test('acceptance 1: benefits, offer conditions, employment-entity notices and co-workers are never requirements', () => {
  const jd = 'Requirements\n- 2+ years of acute care nursing experience required.\n- Employee Assistance Program (EAP) and tuition support.\n- Employment is contingent upon successful completion of job-related pre-employment screenings.\n- If you will be working at a CMG clinical site, your employer will be Akido Labs MSO which contracts with CMG to provide staff.\n- Experience working with nursing assistants and other team members.';
  const ls = skills(jd, 'Registered Nurse - Nights', 'Akido Labs');
  for (const junk of ['EAP', 'Employee Assistance Program', 'MSO', 'CMG', 'team members', 'nursing assistants']) assert.ok(!ls.some((l) => l.toLowerCase().includes(junk.toLowerCase())), `${junk} in ${ls.join(' · ')}`);
});

test('acceptance 2/4: a place, an organisation or a co-worker\'s title is never a requirement', () => {
  const ls = skills('Responsibilities\n- Support the Junior Sous Chef with prep and line checks.\n- Partner with the NP and the Nurse Practitioner team daily.\n- Coordinate care across Northwestern Memorial Hospital (NMH) units.\n- Knife skills and food safety required.', 'Line Cook', 'Northwestern Medicine');
  for (const junk of ['Sous Chef', 'NP', 'NMH', 'Nurse Practitioner']) assert.ok(!ls.includes(junk), `${junk} in ${ls.join(' · ')}`);
});

test('acceptance 3: a licence or certificate named with the role is read first', () => {
  const c = extractConstraints('Requirements\nHigh School Diploma or general education degree (GED) required Medical Assistant certificate in California BLS certification required');
  assert.ok(c.some((x) => x.kind === 'certification' && /Medical Assistant certificate/.test(x.label) && x.state === 'California'), JSON.stringify(c.map((x) => x.label)));
  const rn = extractConstraints('Qualifications\nMust be licensed as a Registered Nurse in New Hampshire.');
  assert.equal(rn.find((x) => x.kind === 'certification').label, 'New Hampshire Registered Nurse license');
  const md = extractConstraints('Requirements\nMedical Degree: MD or DO from an accredited institution\nMedical License: Unrestricted/clear medical license in the state of practice');
  assert.ok(md.some((x) => x.kind === 'degree' && /MD or DO/.test(x.label)) && md.some((x) => /Medical license/i.test(x.label)));
});

test('acceptance 5: standard field pairs meet (ECG/EKG, RN/Registered Nurse, POS/point of sale, A/P / accounts payable)', () => {
  const pairs = [
    ['Perform 12-lead ECG on admission.', '• Ran EKGs and monitored telemetry for 5 patients', /ECG/],
    ['Current RN license required. Experience as a Registered Nurse.', 'Registered Nurse — Mercy Hospital | 2019 – Present\n• Provided care for 5 patients', /RN|Registered Nurse/],
    ['Experience with A/P and month-end close required.', '• Accounts payable processing for 3 entities', /A\/P|AP/],
  ];
  for (const [jd, cv, re] of pairs) {
    const o = runOptimizer({ resumeText: cv, jobTitle: 'Role', jobDescription: `Requirements\n- ${jd}` });
    const r = [...o.matched_requirements, ...o.unsupported_requirements].find((m) => re.test(m.surface));
    if (r) assert.ok(r.matched, `${r.surface} ← ${cv}`);
  }
});

test('acceptance 6: the reading is the same whichever way the posting was pasted', () => {
  const jd = 'Requirements\n• 3+ years of warehouse experience\n• Forklift certification required\n• Experience with WMS software preferred\n\nResponsibilities\n• Load and unload trucks\n• Perform cycle counts';
  const sig = (t) => new Set(extractJobFacts(t, { jobTitle: 'Warehouse Associate' }).filter((f) => f.factType !== 'seniority').map((f) => `${f.label.toLowerCase()}|${f.importance}`));
  const base = sig(jd);
  const wrap = (t) => t.replace(/^• /gm, 'o ');
  const forms = {
    email: `From: R <r@example.com>\nSubject: Role\n\n${jd.replace(/^/gm, '> ')}`,
    pdf_o: wrap(jd), pdf_dot: jd.replace(/^• /gm, '· '), markdown: jd.replace(/^• /gm, '- ').replace(/^(Requirements|Responsibilities)$/gm, '## $1'),
    board: `About the job\n\n${jd}\n\n…show more\nApply\nSave`,
  };
  for (const [k, t] of Object.entries(forms)) assert.deepEqual([...sig(t)].sort(), [...base].sort(), k);
});

test('acceptance 7: the employer as the posting writes it, never a slug', () => {
  assert.equal(employerDisplayName({ company: 'akidolabs', postingText: 'About Akido Labs. Akido Labs is building care.' }), 'Akido Labs');
  assert.equal(employerDisplayName({ company: 'TPG Careers Page', postingText: '' }), 'TPG');
  assert.equal(employerDisplayName({ company: 'csmcy', postingText: 'COLUMBIA SHIPMANAGEMENT is looking for seafarers' }), '');
  assert.equal(employerDisplayName({ company: 'Northwestern Medicine', postingText: '' }), 'Northwestern Medicine');
});

test('acceptance 8: HTML entities are decoded once, at the reader\'s entry point', () => {
  assert.equal(decodeEntities('Lead &mdash; train &amp; develop; &amp;lt;b&amp;gt;'), 'Lead — train & develop; &lt;b&gt;');
  const ls = extractJobFacts('Requirements\n- Experience with P&amp;L ownership &mdash; required.', { jobTitle: 'Store Manager' }).map((f) => f.label).join(' ');
  assert.ok(!/&mdash;|&amp;/.test(ls), ls);
});

test('class (d): what a posting waives is read with its polarity', () => {
  const c = extractConstraints('Schedule\nNo overnight shifts, no weekends, no holidays.\nRequirements\nNo previous wound care experience is required.');
  const w = c.filter((x) => x.kind === 'waived');
  assert.ok(w.length >= 2 && w.every((x) => x.negated === true && x.gate === false), JSON.stringify(w));
});
