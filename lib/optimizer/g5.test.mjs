// G5 (2026-11-10): degree subjects and compound credential lines, field-noun words, header proof, junior credentials,
// specialties in front of a field, and years the gate got wrong (matched-jobs gold D1 / D5 / D7 / D12 — résumé lines
// written here, not the gold ones). Run: node --test lib/optimizer/g5.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer } from './index.js';
import { evaluateConstraints } from './constraints.js';
import { extractResumeFacts } from './extractResumeFacts.js';

const R = {
  bsn: 'Jamie Cole\nDenver, CO\n\nEXPERIENCE\nRegistered Nurse — Mercy Hospital, Denver, CO   2019 – Present\n• Care for 5 med-surg patients per shift\n• Coordinate discharge plans with social workers\n\nEDUCATION\nBSN, University of Colorado, 2019\n\nLICENSES\nRN License — Colorado',
  msw: 'Alex Rivera\nDenver, CO\n\nEXPERIENCE\nClinical Social Worker — Denver Health, Denver, CO   2019 – Present\n• Provide counseling and case management for 30 clients\n\nEDUCATION\nMSW, University of Denver, 2019\nBSW, Colorado State University, 2017\n\nLICENSES\nLCSW — Colorado',
  bsw: 'Sam Lee\nDenver, CO\n\nEXPERIENCE\nCase Aide — Denver Human Services, Denver, CO   2021 – Present\n• Help families apply for benefits\n\nEDUCATION\nB.A. Social Work — Metro State University, 2021',
  bizgrad: 'Pat Kim\nAustin, TX\n\nEXPERIENCE\nOperations Analyst — Lone Star Logistics, Austin, TX   2020 – Present\n• Built weekly shipment reports in Excel\n\nEDUCATION\nB.S. Business — University of Texas, 2020',
  bsee: 'Lee Park\nAustin, TX\n\nEXPERIENCE\nTest Engineer — Lone Star Devices, Austin, TX   2020 – Present\n• Wrote Python test scripts for embedded boards\n\nEDUCATION\nB.S. Electrical Engineering — Texas A&M University, 2020',
  hsci: 'Robin Diaz\nAustin, TX\n\nEXPERIENCE\nSoftware Developer — Brightwave, Austin, TX   2021 – Present\n• Build React and Node.js features for a patient portal\n\nEDUCATION\nB.S. Health Sciences — Texas State University, 2020',
  hsciNurse: 'Robin Diaz\nAustin, TX\n\nEXPERIENCE\nPatient Care Technician — St. David\'s, Austin, TX   2021 – Present\n• Take vitals and assist nurses\n\nEDUCATION\nB.S. Health Sciences — Texas State University, 2020',
  cs: 'Jo Tran\nAustin, TX\n\nEXPERIENCE\nSoftware Engineer — Brightwave, Austin, TX   2021 – Present\n• Build APIs in Go\n\nEDUCATION\nB.S. Computer Science — UT Austin, 2020',
  ml: 'Kai Wu\nSeattle, WA\n\nEXPERIENCE\nData Scientist — Northwind Analytics, Seattle, WA   2020 – Present\n• Built logistic regression and gradient boosting churn models\n\nEDUCATION\nB.S. Statistics — UW, 2020',
  agesales: 'Dana Fox\nPhoenix, AZ\n\nEXPERIENCE\nCashier — QuickMart, Phoenix, AZ   2019 – Present\n• Handle age-restricted sales (tobacco, alcohol) and check IDs\n• Ring up 200 customers a shift',
  pta: 'Chris Bell\nTampa, FL\n\nEXPERIENCE\nPhysical Therapist Assistant — Coastal Rehab, Tampa, FL   2020 – Present\n• Guide patients through exercise plans\n\nLICENSES\nPhysical Therapist Assistant (PTA) license — Florida',
  d1: 'Ana Ruiz\nAlbuquerque, NM\n\nEXPERIENCE\nProcess Assistant (PA) — Amazon, Albuquerque, NM   2024 – Present\n• Lead a pick/stow line of 25 associates per shift; assign stations, track rates\nFulfillment Associate (Tier 1) — Amazon, Albuquerque, NM   2022 – 2024\n• Picked and stowed 300+ items an hour',
  d5: 'Lou Grant\nOmaha, NE\n\nEXPERIENCE\nRecords Custodian — Douglas County District Court, Omaha, NE   2022 – Present\n• Maintain and retrieve court records and case files\nFile Clerk — Omaha Law Group, Omaha, NE   2019 – 2022\n• Filed pleadings and client records',
  d7: 'Mia Shaw\nDes Moines, IA\n\nEXPERIENCE\nInsurance Producer — Heartland Insurance Agency, Des Moines, IA   2023 – Present\n• Quote and bind auto, home and umbrella policies\n• Grow book to 400 households\n\nLICENSES\nIowa Property & Casualty license',
  d12: 'Jan Ortiz\nTucson, AZ\n\nEXPERIENCE\nOffice Manager — Sonoran Family Dental, Tucson, AZ   2021 – Present\n• Run the front office for a 4-dentist practice\n• Manage payroll and vendor accounts\nAdministrative Assistant — Pima Insurance, Tucson, AZ   2017 – 2021\n• Scheduled appointments',
};

const NOW = '2026-11-10';
const P = (title, lines) => ({ title, jd: `Requirements:\n${lines.map((l) => `• ${l}`).join('\n')}\n• Excellent communication skills` });
const run = (text, p) => runOptimizer({ resumeText: text, jobTitle: p.title, jobDescription: p.jd, now: NOW });
const row = (o, kind) => o.constraints.find((c) => c.kind === kind);
const st = (o, re) => o.statements.find((s) => re.test(s.text));
const CSW = P('Clinical Social Worker', ["The Clinical Social Worker is an individual licensed by the Colorado Board of Social Work Examiners, has a Bachelor's degree in social work from an accredited school", 'Case management experience']);
const HW = P('Hardware Engineer', ["Bachelor's degree in engineering, computer science, or a related technical field", 'Experience with Python']);
const SWE = P('Software Engineer', ["Bachelor's in Computer Science, Computer Engineering, a related field or equivalent work experience", 'Experience with React']);

test('G5 1a: a BSN never meets a social-work degree, and the license in the same sentence is a second gate', () => {
  const o = run(R.bsn, CSW);
  assert.equal(row(o, 'degree').grade, 'not_shown');
  assert.match(row(o, 'degree').message, /social work; you list a BSN\./);
  assert.notEqual(st(o, /Board of Social Work/).status, 'shown');
  // mirror: an MSW with an LCSW is shown; a BSW without a license is not
  const m = run(R.msw, CSW);
  assert.equal(row(m, 'degree').status, 'met');
  assert.equal(st(m, /Board of Social Work/).status, 'shown');
  const b = run(R.bsw, CSW);
  assert.equal(row(b, 'degree').status, 'met');
  assert.notEqual(st(b, /Board of Social Work/).status, 'shown', 'the license is the other half of the sentence');
});

test('G5 1b: a B.S. in Business is not an engineering / CS degree (not even partly: not in the field); a B.S. EE is', () => {
  assert.equal(row(run(R.bizgrad, HW), 'degree').grade, 'not_shown');
  assert.equal(row(run(R.bsee, HW), 'degree').status, 'met');
});

test('G5 1c: a B.S. in Health Sciences is never SHOWN for CS; partly only for someone working in software', () => {
  const dev = run(R.hsci, SWE);
  assert.equal(row(dev, 'degree').grade, 'partly');
  assert.match(row(dev, 'degree').message, /^You have a B\.S\. in Health Sciences; they ask for Computer Science, Computer Engineering or a related field\.$/);
  assert.notEqual(st(dev, /Computer Science/).status, 'shown');
  assert.equal(row(run(R.hsciNurse, SWE), 'degree').grade, 'not_shown');
  assert.equal(row(run(R.cs, SWE), 'degree').status, 'met');
});

test('G5 2: "logistic regression" is not logistics; "age-restricted sales" is not B2B sales; a PTA is not a PT', () => {
  const ml = run(R.ml, P('Logistics Coordinator', ['Experience in logistics', '2+ years of supply chain experience']));
  assert.ok(!ml.matched_requirements.some((m) => /^logistics$/i.test(m.surface)));
  const t = R.agesales;
  const f = { factType: 'constraint', kind: 'years', label: '3+ years', importance: 'required', gate: true, value: 3, evidence: '3+ years business to business sales', alternatives: [{ degree: 0, years: 3, field: 'business to business sales' }] };
  assert.notEqual(evaluateConstraints([f], extractResumeFacts(t), t, { jobTitle: 'Account Executive', now: new Date(NOW) })[0].grade, 'met');
  const pt = run(R.pta, P('Physical Therapist', ['Active Physical Therapist license required', 'Outpatient orthopedic experience']));
  assert.equal(row(pt, 'certification').status, 'unmet');
  // G7: one licence family — the PTA is the lower rung of the PT licence
  assert.match(row(pt, 'certification').message, /lists Physical Therapist Assistant, a lower license in the same family/);
});

test('G5 2: a related match never cites a role header as proof of a duty', () => {
  for (const name of ['dev', 'maria', 'warehouse']) {
    const text = fs.readFileSync(new URL(`../fixtures/personas/${name}.txt`, import.meta.url), 'utf8');
    const o = run(text, P('Customer Support Specialist', ['Answer customer calls and resolve billing questions', 'Sell add-on plans', 'Experience with Zendesk']));
    assert.ok(!o.matched_requirements.some((m) => m.kind === 'duty' && m.via === 'related' && ['role', 'title'].includes(m.evidenceKind)), name);
  }
});

test('G5 3: a specialty in front of the field must be on the résumé ("cath lab or interventional radiology nursing")', () => {
  const icu = fs.readFileSync(new URL('../fixtures/calibration/icu-nurse.txt', import.meta.url), 'utf8');
  const o = run(icu, P('Cath Lab RN', ['2+ years of cath lab or interventional radiology nursing', 'Active RN license', 'BLS and ACLS']));
  const y = row(o, 'years');
  // G6 addendum (a): the field's true years, the specialty said as not shown — partly, never the field's years credited
  assert.equal(y.grade, 'partly');
  assert.equal(y.computed, 0);
  assert.match(y.message, /in nursing .*no job on it names cath lab or interventional radiology/);
  // mirror: plain "2+ years of nursing" is met
  assert.equal(row(run(icu, P('Staff RN', ['2+ years of nursing experience', 'Active RN license'])), 'years').status, 'met');
});

test('G5 3: years the gate got wrong — warehouse by duties, supervising by a lead bullet, court records, personal lines, office management', () => {
  const d1 = run(R.d1, P('Warehouse Shift Lead', ['3+ years of warehouse experience', '1+ year of supervising hourly associates']));
  assert.ok(d1.constraints.filter((c) => c.kind === 'years').every((c) => c.status === 'met'), JSON.stringify(d1.constraints.map((c) => c.message)));
  const d5 = row(run(R.d5, P('Court Records Clerk', ['4+ years in court records', 'Typing 50 wpm'])), 'years');
  assert.equal(d5.status, 'met');
  assert.match(d5.message, /\(Records Custodian, 2022–now\)/);
  assert.equal(row(run(R.d7, P('Insurance Sales Agent', ['1+ year selling personal lines', 'Active P&C license required'])), 'years').status, 'met');
  const d12 = row(run(R.d12, P('Office Manager', ['5+ years of office management', 'QuickBooks'])), 'years');
  assert.equal(d12.status, 'met');
  assert.match(d12.message, /office management \(Office Manager, 2021–now\)/);
});

// ── The person's answers (confirmations.js) in the sentence and the score ─────────────────────────────────────
const NO_SCHOOL = 'Dana Fox\nPhoenix, AZ\n\nEXPERIENCE\nCashier — QuickMart, Phoenix, AZ   2019 – Present\n• Ring up 200 customers a shift and balance the drawer\n• Stock shelves and help customers find products\n• Handle returns and exchanges';
const CASHIER_JOB = P('Bilingual Cashier', ['Must be fluent in Spanish', 'High school diploma or GED required', 'Cash handling experience', 'Customer service experience', 'Strong organizational and time management skills']);
const runC = (confirmed) => runOptimizer({ resumeText: NO_SCHOOL, jobTitle: CASHIER_JOB.title, jobDescription: CASHIER_JOB.jd, now: NOW, ...(confirmed ? { confirmed } : {}) });
const idOf = (o, re) => (o.statements.find((s) => re.test(s.text)) || {}).id;

test('G5 answers: no answers → the verdict is byte-identical', () => {
  assert.equal(JSON.stringify(runC([]).verdict), JSON.stringify(runC().verdict));
});

test('G5 answers: a Yes on a required unknown lifts the score; a No on a hard requirement applies the gate; a trait answer moves nothing', () => {
  const base = runC();
  const spanish = idOf(base, /fluent in Spanish/i);
  const diploma = idOf(base, /High school diploma/i);
  const trait = idOf(base, /organizational and time management/i);
  assert.ok(spanish && diploma && trait, JSON.stringify(base.statements.map((s) => [s.id, s.text, s.status])));
  void spanish; // its statement is not_shown while its constraint is cannot_tell (R3's judge), so it cannot be answered yet
  const yes = runC([{ statementId: diploma, answer: 'yes' }]);
  assert.ok(yes.fit_score > base.fit_score, `Yes on the diploma (unknown, no education section): ${base.fit_score} → ${yes.fit_score}`);
  assert.equal(yes.constraints.find((c) => c.kind === 'degree').by, 'you');
  const no = runC([{ statementId: diploma, answer: 'no' }]);
  assert.ok(no.fit_score <= 35 && no.hard_gates.some((g) => g.kind === 'degree'), `No on the diploma: ${no.fit_score} ${JSON.stringify(no.hard_gates.map((g) => g.message))}`);
  for (const answer of ['yes', 'no']) {
    const t = runC([{ statementId: trait, answer }]);
    assert.equal(t.fit_score, base.fit_score, `trait ${answer}`);
    assert.equal(t.fit_band, base.fit_band);
  }
});

test('G5 answers: answered lines are counted apart, a No is said as what the person said, never as missing (warehouse × 305)', () => {
  const r = JSON.parse(fs.readFileSync(new URL('../fixtures/calibration/postings.json', import.meta.url), 'utf8'))[305];
  const text = fs.readFileSync(new URL('../fixtures/personas/warehouse.txt', import.meta.url), 'utf8');
  const base = runOptimizer({ resumeText: text, jobTitle: r.title, jobDescription: r.description, now: NOW });
  const ct = base.statements.filter((s) => s.status === 'cannot_tell' && s.display !== false);
  const stairs = ct.find((s) => /stairs/i.test(s.text));
  const yes = ct.filter((s) => s !== stairs).slice(0, 5);
  const o = runOptimizer({ resumeText: text, jobTitle: r.title, jobDescription: r.description, now: NOW, confirmed: [...yes.map((s) => ({ statementId: s.id, answer: 'yes' })), { statementId: stairs.id, answer: 'no' }] });
  const shownBefore = base.verdict.sentence.match(/your résumé shows (\d+) and part of (\d+)/);
  const shownAfter = o.verdict.sentence.match(/your résumé shows (\d+) and part of (\d+)/);
  assert.deepEqual(shownAfter.slice(1), shownBefore.slice(1), 'what the résumé shows does not grow with answers');
  assert.match(o.verdict.sentence, /you said yes to 5 and no to going up and down stairs; (\d+) more are things only you can say/);
  assert.doesNotMatch(o.verdict.sentence.split("what's missing most")[1] || '', /stairs/);
  // the numbers add up to the count on screen
  const [, a, b] = shownAfter.map(Number);
  const more = Number(o.verdict.sentence.match(/(\d+) more are things only you can say/)[1]);
  const notShown = o.statements.filter((s) => s.display !== false && s.status === 'not_shown' && s.by !== 'you' && ['required', 'duty', 'preferred'].includes(s.importance) && s.kind !== 'promise').length;
  assert.ok(Math.abs(a + b + 5 + 1 + more + notShown - o.requirement_count) <= 0, `${a}+${b}+5+1+${more}+${notShown} vs ${o.requirement_count}`);
});

// ── Obvious-fit classes (director's worked example + obvious-dev classes, written as my own lines) ──────────────────
const W = (t) => runOptimizer({ resumeText: t.r, jobTitle: t.title, jobDescription: t.jd, now: NOW });

test('G5 dates: "2021 – now" under "NURSING EXPERIENCE", seasons, employer-first headers and header-only "roles"', async () => {
  const { rolesFromText } = await import('./extractResumeFacts.js');
  const r = rolesFromText('Rebecca Lyle, RN\nAda, OK\n\nNURSING EXPERIENCE\nField RN Case Manager — Amedisys Home Health, Ada OK        2021 – now\n- carry a caseload of 25 home health patients\nStaff Nurse, Med-Surg — Mercy Hospital Ada        2018 – 2021\n- 5-6 patients a shift', { now: new Date(NOW) });
  assert.deepEqual(r.map((x) => x.title), ['Field RN Case Manager', 'Staff Nurse']);
  assert.ok(r.every((x) => x.from != null && x.to != null));
  const s = rolesFromText('X\n\nEXPERIENCE\nConstruction Intern — Turner, Boston   Summers 2025 & 2026\n- site walks', { now: new Date(NOW) });
  assert.equal(s[0].to - s[0].from + 1, 6, 'two summers = six months');
  const e = rolesFromText('X\n\nAmazon Fulfillment Center DFW7 — Fulfillment Associate (Tier 1)      Mar 2022 – current\n* Stow and pick', { now: new Date(NOW) });
  assert.match(e[0].title, /^Fulfillment Associate/);
});

test('G5 years: a trainer and lead of support agents is still in customer service; a cashier\'s "age-restricted sales" is not sales', () => {
  const t = 'Morgan Blake\nTampa, FL\n\nEXPERIENCE\nCall Center Trainer — Bayside Mutual, Tampa, FL   Jan 2024 – Present\n• Train classes of 12 new customer service agents on calls, systems and empathy\nCustomer Service Team Lead — Bayside Mutual, Tampa, FL   Jan 2021 – Dec 2023\n• Led 10 customer service agents; handled escalated customer calls\nCustomer Service Representative — Bayside Mutual, Tampa, FL   Jan 2019 – Dec 2020\n• Answered 70 customer calls a day';
  const y = row(W({ r: t, title: 'Customer Experience Trainer', jd: 'Requirements:\n• 5+ years of customer service experience\n• Experience training new hires\n• Excellent communication skills' }), 'years');
  assert.equal(y.status, 'met');
  assert.match(y.message, /Call Center Trainer, 2024–now; Customer Service Team Lead, 2021–2023; Customer Service Representative, 2019–2020/);
  const sdr = 'Kim Roe\nDenver, CO\n\nEXPERIENCE\nSales Development Representative — Peak SaaS, Denver, CO   Jan 2025 – Present\n• Booked 15 meetings a month by cold calling\nCashier — King Soopers, Denver, CO   2019 – 2024\n• Handled age-restricted sales and customer questions';
  const s = row(W({ r: sdr, title: 'Account Executive', jd: 'Requirements:\n• 3+ years of sales or business development experience\n• CRM experience\n• Cold calling' }), 'years');
  // 1.9 of 3 years, in the SDR role only (the cashier lends nothing) — under NEAR_YEARS_SHARE, so not shown
  assert.equal(s.grade, 'not_shown');
  assert.match(s.message, /^Your résumé shows 1\.9 years of sales or business development \(Sales Development Representative, 2025–now\); they ask for 3\+\./);
});

test('G5 gates: being supervised is not supervising; managing records is not managing people; "español" is Spanish', () => {
  const t = 'Tiff Ruiz\nAnderson, IN\n\nEXPERIENCE\nMedical Records Clerk — Community Hospital   2022 - present\n• Process records requests\n\nEDUCATION\nAnderson High School, 2018';
  for (const line of ['Must be able to work with minimum supervision responding to changing priorities', 'Responsible for managing patient health records']) {
    const o = W({ r: t, title: 'Health Information Specialist', jd: `Requirements:\n• ${line}\n• High school diploma\n• Medical records experience` });
    assert.ok(!o.constraints.some((c) => c.kind === 'management'), line);
  }
  const sp = W({ r: 'Javi Salinas\nHarlingen, TX\nBilingüe: español / English (native in both)\n\nOutside Sales Rep — Heartland, Harlingen   2021 – present\n• Cold calls to stores', title: 'Territory Account Executive', jd: 'Requirements:\n• Bilingual English/Spanish required\n• 2+ years of outside sales\n• Valid driver\'s license' });
  assert.equal(row(sp, 'language').status, 'met');
});

test('G5 role named: the current job in the posting\'s field, never an old one', () => {
  const t = 'Ana Cole\nAnnapolis, MD\n\nEXPERIENCE\nDietary Aide (Nutrition Services) — Anne Arundel Medical Center   2021 – present\n• Deliver meal trays to patients and check diet orders\nCrew Member — McDonald\'s, Annapolis   2018 – 2021\n• Grill and front counter';
  const o = W({ r: t, title: 'Food Service Attendant', jd: 'Responsibilities:\n• Deliver trays to patients\n• Clean and sanitize the work area\nRequirements:\n• Food service experience\n• Food handler card' });
  assert.match(o.verdict.sentence, /Dietary Aide \(2021–now\)/);
  assert.doesNotMatch(o.verdict.sentence, /Crew Member/);
});

test('G5 field: Army cyber operations and SIGINT are cybersecurity / intelligence, not software engineering', () => {
  const t = 'Dre Coleman\nJersey City, NJ\n\nU.S. ARMY — 17C Cyber Operations Specialist, 2009 – 2025\n\nNCOIC, Cyber Protection Team 154 — Fort Gordon, GA (2019 – 2025)\n- Ran hunt missions on DoD networks\nAll-Source / SIGINT Analyst — 704th MI Brigade, Fort Meade, MD (2009 – 2019)\n- wrote INTSUMs and threat reports';
  const o = W({ r: t, title: 'Security Operations Specialist', jd: 'Requirements:\n• 10+ years in intelligence\n• Splunk\n• Incident response experience' });
  assert.equal(o.field_match.level, 'same');
  assert.equal(o.field_match.postingFieldKey, 'cyber');
  assert.equal(row(o, 'years').status, 'met');
});

test('G5 worked example: the coffee-shop shift supervisor is Strong in the 80s, the setting gate in the posting\'s words', () => {
  const dir = '/tmp/claude-0/-home-user-Seen/b30eccfc-31e3-5e58-94c8-e02565dad614/scratchpad/director/gold/worked';
  if (!fs.existsSync(`${dir}/resume-shift-supervisor.txt`)) return;
  const o = runOptimizer({ resumeText: fs.readFileSync(`${dir}/resume-shift-supervisor.txt`, 'utf8'), jobTitle: 'Shift Lead', company: 'Copper Kettle Kitchen', jobDescription: fs.readFileSync(`${dir}/posting-shift-lead.txt`, 'utf8'), now: NOW });
  assert.equal(o.fit_band, 'Strong fit');
  assert.ok(o.fit_score >= 80 && o.fit_score < 90, String(o.fit_score));
  assert.equal(row(o, 'years').message, 'Shift Supervisor at Dutch Bros Coffee since 2022 — about 4 years leading a shift in a coffee shop; they ask for 1.');
  assert.equal(row(o, 'degree').message, 'Your résumé lists Dobson High School, 2018.');
  assert.doesNotMatch(o.verdict.sentence, /helping with|what's missing most is (?:lifting|standing)/);
});

// ROUND 12d (matched-jobs engineer, for the scoring engineer — ONE READING): the job keys now take their roles from this
// reader, so it must read every common header layout. Twelve invented layouts × two roles: title, employer, dates, current.
test('rolesFromText layout table: twelve header layouts, both roles with title, employer, dates and current flag', async () => {
  const { rolesFromText } = await import('./extractResumeFacts.js');
  const now = new Date('2026-11-11T12:00:00Z');
  const B = '- Inspected hull welds to AWS D1.1';
  const mi = (y, m) => y * 12 + m - 1;
  const LAYOUTS = [
    ['Title — Employer  dates', `Welding Inspector — Austal USA | Mar 2021 – Present\n${B}\nWelder — Ingalls Shipbuilding | Jun 2017 – Feb 2021\n${B}`],
    ['Employer — Title, dates on the next line', `Austal USA — Welding Inspector\nMar 2021 – Present\n${B}\nIngalls Shipbuilding — Welder\nJun 2017 – Feb 2021\n${B}`],
    ['title and employer on separate lines, dates under', `Welding Inspector\nAustal USA\nMar 2021 – Present\n${B}\nWelder\nIngalls Shipbuilding\nJun 2017 – Feb 2021\n${B}`],
    ['dates on their own line above', `Mar 2021 – Present\nWelding Inspector — Austal USA\n${B}\nJun 2017 – Feb 2021\nWelder — Ingalls Shipbuilding\n${B}`],
    ['dates right-aligned after tabs', `Welding Inspector, Austal USA\t\t\tMar 2021 – Present\n${B}\nWelder, Ingalls Shipbuilding\t\t\tJun 2017 – Feb 2021\n${B}`],
    ['Title, Employer (dates)', `Welding Inspector, Austal USA (Mar 2021 – Present)\n${B}\nWelder, Ingalls Shipbuilding (Jun 2017 – Feb 2021)\n${B}`],
    ['Employer | Title | dates', `Austal USA | Welding Inspector | Mar 2021 – Present\n${B}\nIngalls Shipbuilding | Welder | Jun 2017 – Feb 2021\n${B}`],
    ['numeric dates, lower-case present', `Welding Inspector — Austal USA | 03/2021 – present\n${B}\nWelder — Ingalls Shipbuilding | 06/2017 – 02/2021\n${B}`],
    ['season dates, "now"', `Welding Inspector — Austal USA | Spring 2021 – now\n${B}\nWelder — Ingalls Shipbuilding | Summer 2017 – Winter 2020\n${B}`],
    ['"current", full month names', `Welding Inspector — Austal USA | March 2021 – current\n${B}\nWelder — Ingalls Shipbuilding | June 2017 – February 2021\n${B}`],
    ['"to date", "at"', `Welding Inspector at Austal USA, March 2021 to date\n${B}\nWelder at Ingalls Shipbuilding, June 2017 to February 2021\n${B}`],
    ['Employer and dates, title on the next line', `Austal USA, Mobile AL — Mar 2021 – Present\nWelding Inspector\n${B}\nIngalls Shipbuilding, Pascagoula MS — Jun 2017 – Feb 2021\nWelder\n${B}`],
  ];
  for (const [name, body] of LAYOUTS) {
    const r = rolesFromText(`Lee Moss\nMobile, AL\n\nEXPERIENCE\n${body}`, { now });
    assert.equal(r.length, 2, `${name}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.map((x) => [x.title, x.employer, x.from, x.to, x.current]), [
      ['Welding Inspector', 'Austal USA', mi(2021, 3), mi(2026, 11), true],
      ['Welder', 'Ingalls Shipbuilding', mi(2017, 6), mi(2021, 2), false],
    ], name);
  }
  // a title no title noun names is still read (its first piece), with its employer
  const g = rolesFromText('EXPERIENCE\nJefe de Cocina — Restaurante La Nogalera | 2021 – Present\n- Dirijo una cocina de 9 personas', { now });
  assert.deepEqual([g[0].title, g[0].employer, g[0].current], ['Jefe de Cocina', 'Restaurante La Nogalera', true]);
});

test('a role header made of separators and tabs is read in linear time (code scanning: no backtracking pattern on résumé text)', async () => {
  const { rolesFromText } = await import('./extractResumeFacts.js');
  const evil = `${', \t'.repeat(20000)}x${'\t ,'.repeat(20000)}`;
  const t0 = Date.now();
  rolesFromText(`Jo Doe\n\nEXPERIENCE\n${evil}   2019 – 2021\n- stocked shelves`, { now: new Date(NOW) });
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  // the separators a removed date leaves at either end of a header are still cut
  for (const h of ['Clerk — Acme, Tulsa OK |   2021 – Present', '| Clerk — Acme, Tulsa OK —  2021 – Present', 'Acme | Clerk | Mar 2021 – Present']) {
    const r = rolesFromText(`Jo Doe\n\nEXPERIENCE\n${h}\n- ran the register`, { now: new Date(NOW) });
    assert.deepEqual(r.map((x) => [x.title, x.employer]), [['Clerk', 'Acme']], h);
  }
});
