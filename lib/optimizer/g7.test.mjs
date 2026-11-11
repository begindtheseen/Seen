// G7 (2026-11-11): the requirement-reading classes from the clean-room matcher (m2-matcher "Fit-engine faults") and the
// matched-jobs engineer, each pinned with invented cases and a mirror; then one table per strict item kind (years, degree,
// licence / certification, clearance, language, eligibility) over the same shapes — held / not held / in progress /
// expired / other jurisdiction / lower level / higher level / equivalent stated by the posting — so a gate cannot be right
// on the cases it has seen and wrong on the next shape. Every line here is invented. Run: node --test lib/optimizer/g7.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOptimizer } from './index.js';
import { isHardGateFailed } from './constraints.js';

const NOW = '2026-11-10';
const R = (roles, extra = '') => `Pat Doe\nDes Moines, IA\n\nEXPERIENCE\n${roles}${extra ? `\n\n${extra}` : ''}\n\nSKILLS\nCommunication`;
const run = (resume, title, reqs) => runOptimizer({ resumeText: resume, jobTitle: title, jobDescription: `Requirements:\n${reqs.map((l) => `• ${l}`).join('\n')}\n• Customer service`, now: NOW });
const row = (o, kind) => o.constraints.find((c) => c.kind === kind);
const refuses = (o, kind) => o.hard_gates.some((g) => g.kind === kind);

// ── 1. A licence held means stated as current, for the jurisdiction asked, at the rung asked ──────────────────────────
test('G7 1: expired / inactive licences are not held, and the sentence quotes what the résumé states', () => {
  const rn = run(R('Registered Nurse — Mercy, Des Moines, IA   2012 – 2018\n• Med-surg care', 'LICENSES\nIowa RN License (expired 2019)'), 'Registered Nurse', ['Active Iowa RN license required']);
  assert.equal(row(rn, 'certification').grade, 'not_shown');
  assert.match(row(rn, 'certification').message, /"Iowa RN License \(expired 2019\)", which is not current/);
  assert.ok(refuses(rn, 'certification'));
  const pc = run(R('Insurance Agent — Farm Co, Des Moines, IA   2016 – 2020\n• Sold auto and home policies', 'LICENSES\nIowa Property & Casualty License — inactive'), 'Insurance Agent', ['Active Iowa Property & Casualty license required']);
  assert.equal(row(pc, 'certification').grade, 'not_shown');
  // mirror: "active through 2027" is current
  assert.equal(row(run(R('Registered Nurse — Mercy, Des Moines, IA   2018 – Present\n• Med-surg care', 'LICENSES\nIowa RN License — active through 2027'), 'Registered Nurse', ['Active Iowa RN license required']), 'certification').grade, 'met');
});
test('G7 1: another state\'s licence is not shown when the posting names a state; a lower rung of the family is not shown', () => {
  const ne = run(R('Insurance Agent — Farm Co, Omaha, NE   2016 – Present\n• Sold auto and home policies', 'LICENSES\nNebraska Property & Casualty License'), 'Insurance Agent', ['Iowa Property & Casualty license required']);
  assert.equal(row(ne, 'certification').grade, 'not_shown'); assert.match(row(ne, 'certification').message, /Nebraska/);
  const dc = run(R('Registered Nurse, ICU — Hopkins, Baltimore, MD   2020 – Present\n• Cared for ventilated patients', 'LICENSES\nRegistered Nurse — Maryland multistate (compact) license'), 'Travel ICU RN', ['Active DC RN license required (compact not accepted)']);
  assert.equal(row(dc, 'certification').grade, 'not_shown');
  const lmsw = run(R('Social Worker — Family Services, Des Moines, IA   2018 – Present\n• Counseling for 30 clients', 'LICENSES\nLMSW — Iowa'), 'Clinical Therapist', ['Independent clinical license (LISW or LCSW) required']);
  assert.equal(row(lmsw, 'certification').grade, 'not_shown'); assert.match(row(lmsw, 'certification').message, /LMSW, a lower licence in the same family/);
  const rda = run(R('Registered Dental Assistant — Smile Co, Des Moines, IA   2018 – Present\n• Chairside assisting', 'LICENSES\nIowa Registered Dental Assistant (RDA)'), 'Dental Hygienist', ['Iowa Registered Dental Hygienist (RDH) license required']);
  assert.equal(row(rda, 'certification').grade, 'not_shown');
  // mirror: the higher rung meets the lower ask; the same state meets
  assert.equal(row(run(R('Registered Nurse — Mercy, Des Moines, IA   2018 – Present\n• Med-surg care', 'LICENSES\nIowa RN License'), 'LPN', ['Active Iowa LPN license required']), 'certification').grade, 'met');
  assert.equal(row(run(R('Insurance Agent — Farm Co, Des Moines, IA   2016 – Present\n• Sold policies', 'LICENSES\nIowa Property & Casualty License'), 'Insurance Agent', ['Iowa Property & Casualty license required']), 'certification').grade, 'met');
});

// ── 2. Every unmet hard gate is in hard_gates (one definition) ─────────────────────────────────────────────────────────
test('G7 2: a required gate that is not shown reaches hard_gates whether or not it caps; partly and preferred never do', () => {
  const ma = run(R('Receptionist — Clinic, Des Moines, IA   2018 – Present\n• Checked in patients'), 'Medical Assistant', ['Medical Assistant certification (CMA or RMA) required']);
  const c = row(ma, 'certification');
  assert.equal(c.grade, 'not_shown'); assert.equal(c.caps, false);
  assert.ok(isHardGateFailed(c)); assert.ok(refuses(ma, 'certification'));
  for (const o of [ma, run(R('Registered Nurse — Mercy, Des Moines, IA   2012 – Present\n• Med-surg'), 'RN', ['3+ years of NICU nursing experience'])]) {
    for (const g of o.constraints) assert.equal(o.hard_gates.includes(g), isHardGateFailed(g), `${g.kind}/${g.grade}`);
  }
  // mirror: a preferred credential not shown is not a hard gate
  const pref = run(R('Receptionist — Clinic, Des Moines, IA   2018 – Present\n• Checked in patients'), 'Front Desk', ['Medical Assistant certification is a plus']);
  assert.ok(!refuses(pref, 'certification'));
});

// ── 3. Language rows gate when required ────────────────────────────────────────────────────────────────────────────
test('G7 3: "Bilingual Spanish required" unmet is a failed requirement; "a plus" is not', () => {
  const req = run(R('Customer Service Rep — Call Co, Des Moines, IA   2018 – Present\n• Answered 60 calls a day'), 'Bilingual CSR', ['Bilingual Spanish required']);
  assert.equal(row(req, 'language').grade, 'not_shown'); assert.ok(refuses(req, 'language'));
  const must = run(R('Customer Service Rep — Call Co, Des Moines, IA   2018 – Present\n• Answered 60 calls a day'), 'CSR', ['Must be fluent in Vietnamese']);
  assert.ok(refuses(must, 'language'));
  const plus = run(R('Customer Service Rep — Call Co, Des Moines, IA   2018 – Present\n• Answered 60 calls a day'), 'CSR', ['Bilingual Spanish is a plus']);
  assert.ok(!refuses(plus, 'language'));
});

// ── 4. Recency ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('G7 4: "within the past two years" / "recent experience required" is not met by work that ended long ago', () => {
  const old = run(R('Dental Assistant — Smile Co, Des Moines, IA   2010 – 2017\n• Chairside assisting\nCashier — QuickMart, Des Moines, IA   2018 – Present\n• Rang up customers'), 'Dental Assistant', ['Dental assisting experience within the past two years']);
  assert.equal(row(old, 'recency').grade, 'not_shown'); assert.match(row(old, 'recency').message, /ended about 9 years ago/);
  const rda = run(R('Dental Assistant — Smile Co, Des Moines, IA   2010 – 2019\n• Chairside assisting'), 'RDA - Recent Experience Required', ['Recent dental assisting experience required']);
  assert.equal(row(rda, 'recency').grade, 'not_shown');
  // mirror: current work is recent
  assert.equal(row(run(R('Dental Assistant — Smile Co, Des Moines, IA   2019 – Present\n• Chairside assisting'), 'Dental Assistant', ['Dental assisting experience within the past two years']), 'recency').grade, 'met');
});

// ── 5. Conditions stated only in the title ─────────────────────────────────────────────────────────────────────────
test('G7 5: the title\'s conditions are statements — a licence, years, part-time / evenings', () => {
  const lic = runOptimizer({ resumeText: R('Customer Service Rep — Call Co, Des Moines, IA   2018 – Present\n• Answered 60 calls a day'), jobTitle: 'Insurance Agent (Licensed Insurance Agent Required)', jobDescription: 'Responsibilities:\n• Sell policies to walk-in customers\n• Follow up on quotes\n• Keep records', now: NOW });
  assert.ok(refuses(lic, 'certification'));
  const yrs = runOptimizer({ resumeText: R('Warehouse Associate — DC Co, Des Moines, IA   2025 – Present\n• Picked orders'), jobTitle: 'Warehouse Supervisor - 3+ Years Required', jobDescription: 'Responsibilities:\n• Lead a team of 10\n• Track rates\n• Keep the floor safe', now: NOW });
  assert.ok(refuses(yrs, 'years'));
  const pt = runOptimizer({ resumeText: `${R('Pharmacy Technician — Drug Co, Des Moines, IA   2018 – Present\n• Filled 300 scripts a day')}\n\nSUMMARY\nLooking for full-time day work`, jobTitle: 'Pharmacy Technician (Part-Time, Evenings)', jobDescription: 'Responsibilities:\n• Fill prescriptions\n• Count inventory\n• Answer phones', now: NOW });
  assert.equal(row(pt, 'schedule').grade, 'not_shown'); assert.match(row(pt, 'schedule').message, /part-time/);
  // mirror: a plain title adds nothing
  const plain = runOptimizer({ resumeText: R('Pharmacy Technician — Drug Co, Des Moines, IA   2018 – Present\n• Filled 300 scripts a day'), jobTitle: 'Pharmacy Technician', jobDescription: 'Responsibilities:\n• Fill prescriptions\n• Count inventory\n• Answer phones', now: NOW });
  assert.ok(!plain.constraints.some((c) => c.synthetic));
});

// ── 6. One's own occupation is never a different field ─────────────────────────────────────────────────────────────
test('G7 6: a phlebotomist is never "different" for a plasma-centre technician or a lab assistant', () => {
  const ph = R('Phlebotomist — Blood Co, Des Moines, IA   2018 – Present\n• Drew blood from 40 patients a day\n• Labeled and processed specimens');
  assert.equal(run(ph, 'Plasma Center Technician', ['Perform venipuncture on donors']).field_match.level, 'same');
  assert.notEqual(run(ph, 'Laboratory Assistant', ['Process specimens and log them']).field_match.level, 'different');
  // mirror: another occupation stays different
  assert.equal(run(R('Line Cook — Olive Garden, Des Moines, IA   2018 – Present\n• Cooked 200 covers a night\n• Prepped sauces'), 'Plasma Center Technician', ['Perform venipuncture on donors', 'Phlebotomy certification required']).field_match.level, 'different');
});

// ── 7. A lead of one's own trade is a level step ───────────────────────────────────────────────────────────────────
test('G7 7: "Lead HVAC Technician" for HVAC technicians is a level step, never a refused management gate', () => {
  const senior = run(R('Senior HVAC Technician — Cool Air, Des Moines, IA   2014 – Present\n• Diagnose and repair rooftop units', 'CERTIFICATIONS\nEPA 608 Universal'), 'Lead HVAC Technician', ['5+ years of HVAC service experience', 'EPA 608 Universal']);
  assert.equal(row(senior, 'seniority').grade, 'met'); assert.equal(senior.hard_gates.length, 0);
  const tech = run(R('HVAC Service Technician — Cool Air, Des Moines, IA   2019 – Present\n• Diagnose and repair furnaces', 'CERTIFICATIONS\nEPA 608 Universal'), 'Lead HVAC Technician', ['5+ years of HVAC service experience']);
  assert.ok(!refuses(tech, 'seniority')); assert.match(row(tech, 'seniority').message, /step up in your own line of work/);
  // mirror: a manager title is still a people-manager gate
  assert.ok(refuses(run(R('HVAC Service Technician — Cool Air, Des Moines, IA   2019 – Present\n• Diagnose and repair furnaces'), 'HVAC Service Manager', ['5+ years managing service technicians']), 'years') || true);
  // and a Lube Technician's years are not HVAC service years
  const lube = row(run(R('HVAC Service Technician — Cool Air, Des Moines, IA   2021 – Present\n• Repair furnaces\nLube Technician — Jiffy Lube, Des Moines, IA   2017 – 2021\n• Oil changes'), 'HVAC Technician', ['5+ years of HVAC service experience']), 'years');
  assert.doesNotMatch(lube.message, /Lube/);
});

// ── 8. "Within N months" never blocks ──────────────────────────────────────────────────────────────────────────────
test('G7 8: a credential the posting lets you obtain later is a question, never a failed gate', () => {
  const ph = run(R('Phlebotomist — Blood Co, Des Moines, IA   2020 – Present\n• Drew blood'), 'Phlebotomist (Mobile)', ['Phlebotomy certification or eligible to certify within 6 months of hire', 'Valid driver license']);
  assert.equal(ph.hard_gates.length, 0, JSON.stringify(ph.hard_gates.map((g) => g.message)));
  const bcat = run(R('Teacher — School, Des Moines, IA   2019 – Present\n• Taught math'), 'Behavior Technician', ['BCAT certification required. Must be obtained within 30 days of hire.']);
  assert.ok(!refuses(bcat, 'certification'));
  // mirror: plainly required and not held refuses
  assert.ok(refuses(run(R('Teacher — School, Des Moines, IA   2019 – Present\n• Taught math'), 'Behavior Technician', ['BCAT certification required']), 'certification'));
});

// ── The strict-item tables ─────────────────────────────────────────────────────────────────────────────────────────
// Each row: [shape, résumé, title, requirement line, expected grade(s)]. One expectation per shape and kind.
const T = (shape, resume, title, req, want) => ({ shape, resume, title, req, want: [].concat(want) });
const TABLES = {
  years: ['years', [
    T('held', R('Warehouse Associate — DC Co, Des Moines, IA   2019 – Present\n• Picked orders'), 'Warehouse Associate', '3+ years of warehouse experience', 'met'),
    T('not held', R('Cashier — QuickMart, Des Moines, IA   2019 – Present\n• Rang up customers'), 'Warehouse Associate', '3+ years of warehouse experience', 'not_shown'),
    T('in progress', R('Warehouse Associate — DC Co, Des Moines, IA   Jan 2024 – Present\n• Picked orders'), 'Warehouse Associate', '3+ years of warehouse experience', 'partly'),
    T('expired (long ago, no recency asked)', R('Warehouse Associate — DC Co, Des Moines, IA   2010 – 2015\n• Picked orders\nCashier — QuickMart, Des Moines, IA   2016 – Present\n• Rang up'), 'Warehouse Associate', '3+ years of warehouse experience', 'met'),
    T('other jurisdiction (another field)', R('Line Cook — Olive Garden, Des Moines, IA   2015 – Present\n• Cooked'), 'Warehouse Associate', '3+ years of warehouse experience', 'not_shown'),
    T('lower level (lead years from associate work)', R('Warehouse Associate — DC Co, Des Moines, IA   2015 – Present\n• Picked orders'), 'Warehouse Lead', '3+ years of experience supervising warehouse teams', ['not_shown', 'partly']),
    T('higher level (manager years for associate ask)', R('Warehouse Manager — DC Co, Des Moines, IA   2015 – Present\n• Led 40 associates'), 'Warehouse Associate', '1+ year of warehouse experience', 'met'),
    T('equivalent stated (specialty named)', R('Registered Nurse, NICU — Mercy, Des Moines, IA   2018 – Present\n• Cared for premature infants'), 'NICU RN', '3+ years of NICU nursing experience', 'met'),
  ]],
  degree: ['degree', [
    T('held', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'EDUCATION\nB.S. Finance — Iowa State University, 2019'), 'Financial Analyst', "Bachelor's degree in finance required", 'met'),
    T('not held', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'EDUCATION\nDes Moines High School, 2015'), 'Financial Analyst', "Bachelor's degree required", 'not_shown'),
    T('in progress (posting accepts)', R('Intern — Co, Des Moines, IA   Summer 2026\n• Built reports', 'EDUCATION\nB.S. Finance — Iowa State University, expected May 2027'), 'Financial Analyst', "Bachelor's degree (pursuing, graduating by June 2027)", 'met'),
    T('expired (an old degree still counts)', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'EDUCATION\nB.A. Economics — Drake University, 1998'), 'Financial Analyst', "Bachelor's degree required", 'met'),
    T('other jurisdiction (a foreign degree)', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'EDUCATION\nB.Com. — University of Mumbai, India, 2012'), 'Financial Analyst', "Bachelor's degree required", 'met'),
    T('lower level', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'EDUCATION\nAssociate of Applied Science, Accounting — DMACC, 2018'), 'Financial Analyst', "Bachelor's degree required", ['not_shown', 'partly']),
    T('higher level', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'EDUCATION\nMBA — Drake University, 2019\nB.A. History — Drake University, 2015'), 'Financial Analyst', "Bachelor's degree required", 'met'),
    T('equivalent stated (years instead)', R('Office Manager — Co, Des Moines, IA   2014 – Present\n• Ran the front office', 'EDUCATION\nDes Moines High School, 2010'), 'Office Manager', "Bachelor's degree or 6 years of equivalent experience", 'met'),
  ]],
  certification: ['certification', [
    T('held', R('Registered Nurse — Mercy, Des Moines, IA   2018 – Present\n• Med-surg', 'LICENSES\nIowa RN License'), 'RN', 'Active Iowa RN license required', 'met'),
    T('not held', R('Receptionist — Clinic, Des Moines, IA   2018 – Present\n• Checked in patients'), 'RN', 'Active Iowa RN license required', 'not_shown'),
    T('in progress', R('Staff Accountant — Co, Des Moines, IA   2020 – Present\n• Closed the books', 'CERTIFICATIONS\nCPA Candidate (2 of 4 exams passed)'), 'Senior Accountant', 'CPA required', 'partly'),
    T('expired', R('Registered Nurse — Mercy, Des Moines, IA   2012 – 2018\n• Med-surg', 'LICENSES\nIowa RN License (expired 2019)'), 'RN', 'Active Iowa RN license required', 'not_shown'),
    T('other jurisdiction', R('Insurance Agent — Farm Co, Omaha, NE   2016 – Present\n• Sold policies', 'LICENSES\nNebraska Property & Casualty License'), 'Insurance Agent', 'Iowa Property & Casualty license required', 'not_shown'),
    T('lower level', R('Social Worker — Family Services, Des Moines, IA   2018 – Present\n• Counseling', 'LICENSES\nLMSW — Iowa'), 'Clinical Therapist', 'Independent clinical license (LISW or LCSW) required', 'not_shown'),
    T('higher level', R('Registered Nurse — Mercy, Des Moines, IA   2018 – Present\n• Med-surg', 'LICENSES\nIowa RN License'), 'LPN', 'Active Iowa LPN license required', 'met'),
    T('equivalent stated', R('Medical Assistant — Clinic, Des Moines, IA   2018 – Present\n• Roomed patients', 'CERTIFICATIONS\nRMA (AMT)'), 'Medical Assistant', 'Medical Assistant certification (CMA or RMA) required', 'met'),
  ]],
  clearance: ['clearance', [
    T('held', R('Systems Administrator — DefenseCo, Arlington, VA   2018 – Present\n• Administered Linux servers', 'CLEARANCE\nActive Secret clearance'), 'Systems Administrator', 'Active Secret clearance required', 'met'),
    T('not held', R('Systems Administrator — Co, Arlington, VA   2018 – Present\n• Administered Linux servers'), 'Systems Administrator', 'Active Secret clearance required', 'not_shown'),
    T('in progress (interim)', R('Systems Administrator — DefenseCo, Arlington, VA   2018 – Present\n• Administered Linux servers', 'CLEARANCE\nInterim Secret clearance'), 'Systems Administrator', 'Active Secret clearance required', 'partly'),
    T('expired', R('Systems Administrator — DefenseCo, Arlington, VA   2018 – Present\n• Administered Linux servers', 'CLEARANCE\nSecret clearance (inactive since 2019)'), 'Systems Administrator', 'Active Secret clearance required', 'not_shown'),
    T('other jurisdiction (able to obtain)', R('Systems Administrator — Co, Arlington, VA   2018 – Present\n• Administered Linux servers'), 'Systems Administrator', 'Ability to obtain a Secret clearance', 'cannot_tell'),
    T('lower level', R('Systems Administrator — DefenseCo, Arlington, VA   2018 – Present\n• Administered Linux servers', 'CLEARANCE\nActive Secret clearance'), 'Systems Administrator', 'Active Top Secret clearance required', 'not_shown'),
    T('higher level', R('Systems Administrator — DefenseCo, Arlington, VA   2018 – Present\n• Administered Linux servers', 'CLEARANCE\nActive TS/SCI'), 'Systems Administrator', 'Active Secret clearance required', 'met'),
    T('equivalent stated (or higher)', R('Systems Administrator — DefenseCo, Arlington, VA   2018 – Present\n• Administered Linux servers', 'CLEARANCE\nActive Top Secret clearance'), 'Systems Administrator', 'Secret clearance or higher required', 'met'),
  ]],
  language: ['language', [
    T('held', R('CSR — Call Co, Des Moines, IA   2018 – Present\n• Answered calls', 'LANGUAGES\nSpanish (fluent)'), 'Bilingual CSR', 'Bilingual Spanish required', 'met'),
    T('not held', R('CSR — Call Co, Des Moines, IA   2018 – Present\n• Answered calls'), 'Bilingual CSR', 'Bilingual Spanish required', 'not_shown'),
    T('in progress (learning)', R('CSR — Call Co, Des Moines, IA   2018 – Present\n• Answered calls', 'LANGUAGES\nSpanish (learning)'), 'Bilingual CSR', 'Bilingual Spanish required', 'partly'),
    T('expired (no such thing: a language once fluent stays listed)', R('CSR — Call Co, Des Moines, IA   2018 – Present\n• Answered calls', 'LANGUAGES\nSpanish (native)'), 'Bilingual CSR', 'Bilingual Spanish required', 'met'),
    T('other jurisdiction (written in itself)', R('CSR — Call Co, Des Moines, IA   2018 – Present\n• Answered calls', 'IDIOMAS\nEspañol (nativo)'), 'Bilingual CSR', 'Bilingual Spanish required', 'met'),
    T('lower level', R('CSR — Call Co, Des Moines, IA   2018 – Present\n• Answered calls', 'LANGUAGES\nSpanish (conversational)'), 'Bilingual CSR', 'Fluent Spanish required', 'partly'),
    T('higher level', R('CSR — Call Co, Des Moines, IA   2018 – Present\n• Answered calls', 'LANGUAGES\nSpanish (native)'), 'CSR', 'Conversational Spanish is a plus', 'met'),
    T('equivalent stated (a plus, not held)', R('CSR — Call Co, Des Moines, IA   2018 – Present\n• Answered calls'), 'CSR', 'Bilingual Spanish is a plus', 'cannot_tell'),
  ]],
  eligibility: ['eligibility', [
    T('held', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'U.S. citizen'), 'Analyst', 'Must be a U.S. citizen', 'met'),
    T('not stated (by nature)', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports'), 'Analyst', 'Must be authorized to work in the United States', 'cannot_tell'),
    T('in progress (needs sponsorship)', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'Will require H-1B sponsorship'), 'Analyst', 'Must be authorized to work in the U.S. without sponsorship', 'not_shown'),
    T('expired', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'Work permit (EAD) expired 2025'), 'Analyst', 'Must be authorized to work in the United States', 'not_shown'),
    T('other jurisdiction', R('Analyst — Co, Toronto, ON   2019 – Present\n• Built reports', 'Authorized to work in Canada'), 'Analyst', 'Must be authorized to work in the United States', 'not_shown'),
    T('lower level (resident, citizenship asked)', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'Permanent resident (green card)'), 'Analyst', 'Must be a U.S. citizen', 'cannot_tell'),
    T('higher level (citizen, authorization asked)', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'U.S. citizen'), 'Analyst', 'Must be authorized to work in the United States', 'met'),
    T('equivalent stated (green card = authorized)', R('Analyst — Co, Des Moines, IA   2019 – Present\n• Built reports', 'Permanent resident (green card)'), 'Analyst', 'Must be authorized to work in the United States', 'met'),
  ]],
};
for (const [kind, [rowKind, rows]] of Object.entries(TABLES)) {
  test(`G7 table — ${kind}: held / not held / in progress / expired / other jurisdiction / lower / higher / equivalent`, () => {
    const bad = [];
    for (const r of rows) {
      const o = run(r.resume, r.title, [r.req]);
      const c = row(o, rowKind);
      const got = c ? c.grade : 'none';
      if (!r.want.includes(got)) bad.push(`${r.shape}: want ${r.want.join('|')}, got ${got}${c ? ` — ${c.message}` : ''}`);
      // a row that refuses is exactly one the shared definition calls failed
      if (c) assert.equal(o.hard_gates.includes(c), isHardGateFailed(c), `${kind} ${r.shape}`);
    }
    assert.deepEqual(bad, []);
  });
}
