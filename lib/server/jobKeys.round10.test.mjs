// Round 10: five principles from the independent judge's fresh set, each pinned with cases invented here across
// fields not used before (aviation, beauty trades, dental, defence, legal specialties, HR career changers, nursing
// students, stated limits). Table-driven: [name, résumé, listing, expected ok, optional reason pattern / why pattern].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobKeys, matchListing } from './jobKeys.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const L = (s, reqs = []) => `${s} `.repeat(6) + (reqs.length ? `\nRequirements\n${reqs.map((r) => `• ${r}`).join('\n')}` : '');
const R = (lines) => `Jordan Ash\nOmaha, NE\n${lines}`;

// ── résumés ─────────────────────────────────────────────────────────────────────────────────────
const RN_GRAD = R(`EDUCATION
Creighton University — B.S.N., Nursing, May 2026
EXPERIENCE
Barista (part-time) — Campus Coffee, Omaha NE | 2023 – 2026
- Opened the cafe and ran the bar
Student Nurse Extern — CHI Health | Jun 2025 – Aug 2025
- Supported RNs with vitals and charting on a med-surg unit
LICENSES
Registered Nurse — Nebraska (compact) license, active 2026`);
const AP_MECH = R(`EXPERIENCE
Crew Chief, C-130 — U.S. Air Force, Offutt AFB | 2017 – 2025
- Led aircraft inspections, engine changes and flight line servicing on C-130H aircraft
LICENSES
FAA Airframe & Powerplant (A&P) certificate, 2025`);
const STYLIST = R(`EXPERIENCE
Hair Stylist / Colorist — Salon Lux, Omaha NE | 2019 – Present
- Balayage, color correction and cuts for 30+ clients a week
LICENSES
Cosmetology License — Nebraska, active`);
const ESTHETICIAN = R(`EXPERIENCE
Esthetician — Glow Spa, Omaha NE | 2021 – Present
- Facials, peels and waxing; 25 clients a week
LICENSES
Licensed Esthetician — Nebraska`);
const RDA = R(`EXPERIENCE
Registered Dental Assistant — Bright Smiles Dental, Omaha NE | 2020 – Present
- Chairside assisting, x-rays and impressions for two dentists
LICENSES
RDA — Nebraska, active`);
const CLEARED_INACTIVE = R(`EXPERIENCE
Intelligence Analyst (35F) — U.S. Army | 2016 – 2022
- All-source analysis and briefings
Security Analyst — Mutual of Omaha | 2022 – Present
- SOC monitoring, incident triage
CERTIFICATIONS
CompTIA Security+ (2022)
TS/SCI clearance (inactive since 2022)`);
const LIT_PARALEGAL = R(`EXPERIENCE
Litigation Paralegal — Baird Holm LLP, Omaha NE | 2019 – Present
- Drafted discovery, managed trial binders and e-filing for 4 litigation partners
CERTIFICATIONS
Paralegal Certificate — Metropolitan Community College, 2019`);
const STORE_TO_HR = R(`Store manager of 7 years moving into human resources; SHRM-CP candidate.
EXPERIENCE
Store Manager — Target, Omaha NE | 2019 – Present
- Led 60 team members; hiring, scheduling and onboarding
Assistant Store Manager — Target | 2016 – 2019
- Led the guest service team`);
const CNA_DAYS = R(`Certified nursing assistant seeking full-time, day shift only work.
EXPERIENCE
Certified Nursing Assistant — Immanuel Communities, Omaha NE | 2020 – Present
- ADLs, vitals and charting for 12 residents
LICENSES
CNA — Nebraska, active`);
const PT_STUDENT = R(`Student looking for part-time work, weekdays only.
EXPERIENCE
Cashier — Hy-Vee, Omaha NE | 2024 – Present
- Register and customer service`);
const PHARM_CERT = R(`EDUCATION
Metropolitan Community College — Pharmacy Technician certificate, 2026
EXPERIENCE
Sales Associate — Walgreens, Omaha NE | 2024 – 2026
- Front store sales and register
CERTIFICATIONS
CPhT (PTCB), 2026`);

const ARMY_NURSE = R(`EXPERIENCE
Clinical Nurse Officer (66H) — U.S. Army, Brooke Army Medical Center | 2018 – 2025
- Charge nurse on a 30-bed medical-surgical ward; precepted new nurses
LICENSES
Registered Nurse — Texas (compact) license, active
EDUCATION
University of Texas — B.S.N., 2018`);
const LPN = R(`EXPERIENCE
Licensed Practical Nurse — Hillcrest Health, Omaha NE | 2021 – Present
- Med pass and wound care for 24 residents
LICENSES
LPN — Nebraska, active`);
const JOURNEYMAN = R(`EXPERIENCE
Journeyman Electrician — Ballard Electric, Omaha NE | 2019 – Present
- Commercial wiring, conduit and panel work
LICENSES
Journeyman Electrician License — Nebraska`);
const BARBER = R(`EXPERIENCE
Barber — Fade Factory, Omaha NE | 2020 – Present
- Fades, beard work and hot towel shaves for 40 clients a week
LICENSES
Barber License — Nebraska, active`);
const TEACH_GRAD = R(`EDUCATION
University of Nebraska Omaha — B.S. Elementary Education, May 2026
EXPERIENCE
Server (part-time) — Olive Garden, Omaha NE | 2022 – 2026
- Served tables
Student Teacher — Millard Public Schools | Jan 2026 – May 2026
- Taught 3rd grade math and reading lessons under a mentor teacher
LICENSES
Nebraska Teaching Certificate (Elementary K-8), 2026`);
const STAFF_ACCT = R(`EXPERIENCE
Staff Accountant — Lutz & Co, Omaha NE | 2021 – Present
- Month-end close, reconciliations and tax workpapers
EDUCATION
University of Nebraska — B.S. Accounting, 2021`);
const MASSAGE = R(`EXPERIENCE
Massage Therapist — Massage Heights, Omaha NE | 2020 – Present
- Deep tissue and sports massage, 25 clients a week
LICENSES
Licensed Massage Therapist (LMT) — Nebraska`);
const CASES = [
  // ── 1. a licence or degree is a field ─────────────────────────────────────────────────────────
  ['RN grad: an entry RN job', RN_GRAD, { title: 'Registered Nurse - New Graduate Residency', company: 'Nebraska Medicine', description: L('Join our new graduate RN residency on a med-surg unit. New graduates welcome; entry level.', ['Active RN license or compact license']) }, true, /RN license, which you hold|You hold an RN license/],
  ['RN grad: never a barista job (a student job is not the direction)', RN_GRAD, { title: 'Barista', company: 'Scooter\'s Coffee', description: L('Make drinks and serve guests. No experience needed.') }, false],
  ['RN grad: an ICU RN job asking 2 years is refused (years she lacks)', RN_GRAD, { title: 'Registered Nurse - ICU', company: 'Nebraska Medicine', description: L('Care for critically ill patients.', ['Active RN license', '2+ years of ICU nursing experience']) }, false],
  ['A&P mechanic from a military crew chief title', AP_MECH, { title: 'Aircraft Maintenance Technician', company: 'Duncan Aviation', description: L('Inspect and repair business jets.', ['FAA A&P certificate required', '3+ years of aircraft maintenance experience']) }, true, /Crew Chief|A&P/],
  ['A&P mechanic: an Inspection Authorization job is refused', AP_MECH, { title: 'Aircraft Inspector (A&P/IA)', company: 'Duncan Aviation', description: L('Perform annual inspections and return aircraft to service.', ['FAA A&P certificate with Inspection Authorization (IA) required', '5+ years of aircraft maintenance']) }, false],
  ['A&P mechanic: not a car mechanic job', AP_MECH, { title: 'Automotive Technician', company: 'Jiffy Lube', description: L('Service cars and light trucks.', ['2+ years of automotive repair']) }, false],
  ['RDA: a registered dental assistant job', RDA, { title: 'Registered Dental Assistant', company: 'Omaha Family Dental', description: L('Chairside assisting for a busy family practice.', ['Active RDA license', '2+ years of dental assisting']) }, true, /Registered Dental Assistant/],
  ['RDA: a dental hygienist job is refused (another licence)', RDA, { title: 'Dental Hygienist', company: 'Omaha Family Dental', description: L('Cleanings and periodontal care.', ['Active RDH license']) }, false],
  ['pharmacy tech certificate: an entry pharmacy technician job', PHARM_CERT, { title: 'Pharmacy Technician', company: 'CVS Health', description: L('Fill prescriptions and help patients at the pharmacy counter. Entry level; we will train you.', ['PTCB certification (CPhT)']) }, true, /Pharmacy Technician certificate|You hold/],
  ['pharmacy tech certificate: the old retail job is not the direction', PHARM_CERT, { title: 'Sales Associate', company: 'Kohl\'s', description: L('Help customers on the sales floor. No experience needed.') }, false],
  ['stylist: her exact job is not refused for years she has', STYLIST, { title: 'Hair Stylist / Colorist', company: 'Great Clips', description: L('Cut and color for walk-in guests.', ['Active cosmetology license', '3+ years of salon experience']) }, true, /Hair Stylist \/ Colorist/],
  // ── 2. a different licence in the same trade is not a match ───────────────────────────────────
  ['cosmetologist ≠ esthetician', STYLIST, { title: 'Esthetician', company: 'Massage Envy', description: L('Facials and skin care treatments.', ['Active esthetician license']) }, false],
  ['cosmetologist ≠ barber', STYLIST, { title: 'Barber', company: 'Sport Clips', description: L('Men\'s cuts and fades.', ['Active barber license']) }, false],
  ['cosmetologist ≠ nail technician', STYLIST, { title: 'Nail Technician', company: 'Nail Studio', description: L('Manicures and pedicures.', ['Active nail technician license']) }, false],
  ['esthetician ≠ hair stylist', ESTHETICIAN, { title: 'Hair Stylist', company: 'Supercuts', description: L('Cuts and color.', ['Active cosmetology license']) }, false],
  ['esthetician: her own job elsewhere', ESTHETICIAN, { title: 'Licensed Esthetician', company: 'Hand & Stone', description: L('Facials, waxing and peels.', ['Active esthetician license', '2+ years as an esthetician']) }, true, /Esthetician/],
  ['an inactive clearance is not held', CLEARED_INACTIVE, { title: 'Security Analyst', company: 'Leidos', description: L('Monitor and triage alerts for a federal customer.', ['Active TS/SCI clearance required', '3+ years of SOC experience']) }, false],
  ['security analyst without a clearance ask: matched', CLEARED_INACTIVE, { title: 'SOC Analyst', company: 'First National Bank', description: L('Monitor alerts and triage incidents.', ['2+ years of SOC or security operations experience']) }, true],
  ['litigation years do not meet a corporate / M&A ask', LIT_PARALEGAL, { title: 'Corporate Paralegal', company: 'Kutak Rock', description: L('Support M&A transactions and entity management.', ['4+ years of corporate/M&A paralegal experience']) }, false],
  ['litigation paralegal: a litigation job', LIT_PARALEGAL, { title: 'Litigation Paralegal', company: 'Kutak Rock', description: L('Discovery, trial prep and e-filing.', ['3+ years of litigation paralegal experience']) }, true, /Litigation Paralegal/],
  // ── 3. every clause of a reason is a check that passed ────────────────────────────────────────
  ['career changer: an HR business partner asking 5 years of HR is refused', STORE_TO_HR, { title: 'HR Business Partner', company: 'Union Pacific', description: L('Partner with leaders on talent and employee relations.', ['5+ years of HR generalist or HRBP experience']) }, false],
  ['career changer: a benefits job requiring a named certification is refused', STORE_TO_HR, { title: 'Benefits Specialist', company: 'Mutual of Omaha', description: L('Administer benefits plans.', ['CEBS certification required', '3+ years of benefits administration']) }, false],
  ['career changer: an entry HR coordinator job with an entry statement', STORE_TO_HR, { title: 'HR Coordinator', company: 'Werner Enterprises', description: L('Support recruiting and onboarding. This is an entry-level role; no prior HR experience required.') }, true, /moving into .*entry level/],
  ['career changer: an HR generalist asking 3 years of HR is refused', STORE_TO_HR, { title: 'HR Generalist', company: 'Werner Enterprises', description: L('Own employee relations for a 400-person site.', ['3+ years of HR generalist experience']) }, false],
  ['career changer: a senior HR role is never an entry point', STORE_TO_HR, { title: 'Senior HR Manager', company: 'Werner Enterprises', description: L('Lead the HR team for a 400-person site.') }, false],
  // ── 4. stated limits are read ─────────────────────────────────────────────────────────────────
  ['days only: a night-shift CNA job is refused', CNA_DAYS, { title: 'Certified Nursing Assistant - Nights', company: 'Methodist', description: L('Night shift 7p-7a caring for residents.', ['Active CNA']) }, false, null, /limit:no_nights/],
  ['full-time only: a part-time CNA job is refused', CNA_DAYS, { title: 'Certified Nursing Assistant (Part-Time)', company: 'Methodist', description: L('Part-time day shifts caring for residents.', ['Active CNA']) }, false, null, /limit:full_time_only/],
  ['days only + full-time: a full-time day CNA job is matched', CNA_DAYS, { title: 'Certified Nursing Assistant', company: 'Methodist', description: L('Full-time day shift caring for residents.', ['Active CNA certification']) }, true, /Certified Nursing Assistant/],
  ['part-time wanted: a full-time cashier job is refused', PT_STUDENT, { title: 'Cashier', company: 'Walmart', type: 'Full-time', description: L('Full-time cashier position.') }, false, null, /limit:part_time_only/],
  ['weekdays only: a weekend-required job is refused', PT_STUDENT, { title: 'Cashier (Part-Time)', company: 'Walmart', description: L('Part-time cashier. Weekends required.') }, false, null, /limit:no_weekends/],
  ['part-time weekdays: a part-time weekday cashier job is matched', PT_STUDENT, { title: 'Cashier (Part-Time)', company: 'Hy-Vee', description: L('Part-time cashier, weekday afternoons.') }, true],
  // ── more fields: military nursing, LPN vs RN, electrical grades, barbering, teaching, accounting, massage ─────
  ['an Army nurse (66H) with an RN licence gets RN jobs', ARMY_NURSE, { title: 'Registered Nurse - Med/Surg', company: 'Methodist Hospital', description: L('Care for adult medical-surgical patients.', ['Active RN license', '2+ years of acute care nursing']) }, true, /Clinical Nurse Officer|RN license/],
  ['an Army nurse is not sent a CNA job', ARMY_NURSE, { title: 'Certified Nursing Assistant', company: 'Methodist Hospital', description: L('Assist nurses with patient care.', ['Active CNA certificate']) }, false],
  ['an LPN is not an RN', LPN, { title: 'Registered Nurse', company: 'Bryan Health', description: L('Care for patients on a telemetry unit.', ['Active RN license']) }, false],
  ['an LPN gets an LPN job', LPN, { title: 'Licensed Practical Nurse', company: 'Bryan Health', description: L('Med pass and treatments for long-term care residents.', ['Active LPN license', '1+ year of LPN experience']) }, true, /Licensed Practical Nurse/],
  ['a journeyman is not sent a master electrician job', JOURNEYMAN, { title: 'Master Electrician', company: 'Ballard Electric', description: L('Pull permits and supervise crews.', ['Master Electrician License required', '8+ years of electrical experience']) }, false],
  ['a journeyman gets a journeyman job', JOURNEYMAN, { title: 'Journeyman Electrician', company: 'Commonwealth Electric', description: L('Commercial and industrial wiring.', ['Journeyman electrician license', '4+ years of electrical experience']) }, true, /Journeyman Electrician/],
  ['a barber gets a barber job', BARBER, { title: 'Barber', company: 'Sport Clips', description: L('Men\'s cuts and fades.', ['Active barber license', '2+ years of barbering']) }, true, /Barber/],
  ['a barber is not a cosmetologist', BARBER, { title: 'Cosmetologist', company: 'Ulta Beauty Salon', description: L('Cut, color and style.', ['Active cosmetology license']) }, false],
  ['a new teacher: an elementary teaching job, never a server job', TEACH_GRAD, { title: 'Elementary Teacher - 3rd Grade', company: 'Omaha Public Schools', description: L('Teach a 3rd grade classroom. New teachers welcome.', ['Nebraska teaching certificate (elementary)']) }, true],
  ['a new teacher: no server job', TEACH_GRAD, { title: 'Server', company: 'Olive Garden', description: L('Serve guests. No experience needed.') }, false],
  ['a staff accountant without a CPA: a CPA-required manager job is refused', STAFF_ACCT, { title: 'Accounting Manager', company: 'Lutz & Co', description: L('Lead the close.', ['Active CPA license required', '7+ years of accounting']) }, false],
  ['a staff accountant gets a senior accountant job she meets', STAFF_ACCT, { title: 'Senior Accountant', company: 'Gavilon', description: L('Month-end close and reconciliations.', ['3+ years of accounting experience']) }, true, /Staff Accountant/],
  ['a massage therapist is not sent an esthetician job', MASSAGE, { title: 'Esthetician', company: 'Massage Heights', description: L('Facials and skin treatments.', ['Active esthetician license']) }, false],
  ['a massage therapist gets a massage job', MASSAGE, { title: 'Licensed Massage Therapist', company: 'Hand & Stone', description: L('Deep tissue and Swedish massage.', ['Active LMT license', '1+ year of massage experience']) }, true, /Massage Therapist/],
];

for (const [name, resume, listing, want, rx, whyRx] of CASES) {
  test(`round 10: ${name}`, () => {
    const k = buildJobKeys({ resumeText: resume, profile: { city: 'Omaha, NE' }, now: NOW });
    const m = matchListing({ location: 'Omaha, NE', ...listing }, k, { now: NOW });
    assert.equal(m.ok, want, `${name}: ${JSON.stringify(m).slice(0, 400)}`);
    if (want && rx) assert.match(m.reason, rx);
    if (!want && whyRx) assert.match(String(m.why), whyRx);
  });
}

test('round 10: sentence law — no clause without a passed check, over every positive case', () => {
  for (const [name, resume, listing, want] of CASES) {
    if (!want) continue;
    const k = buildJobKeys({ resumeText: resume, profile: { city: 'Omaha, NE' }, now: NOW });
    const m = matchListing({ location: 'Omaha, NE', ...listing }, k, { now: NOW });
    assert.ok(m.ok, name);
    assert.doesNotMatch(m.reason, /covers what this role asks for|it names|a side-step/i, name);
    assert.doesNotMatch(m.reason, /They ask for \d+\+ years?\.(\s|$)/, `${name}: a bare years fragment`);
    assert.ok(Array.isArray(m.checks) && m.checks.every((c) => c.pass), `${name}: the checks behind the sentence`);
    for (const c of m.checks.filter((x) => x.check === 'years')) assert.ok(c.have >= c.need, `${name}: years check`);
  }
});

test('round 10: the direction order — licence field before a student job, and keys say which credential', () => {
  const k = buildJobKeys({ resumeText: RN_GRAD, now: NOW });
  assert.ok(k.direction.includes('registered_nurse'), JSON.stringify(k.direction));
  assert.ok(!k.direction.includes('barista'), 'a campus barista shift is never the direction');
  assert.ok(k.credential_fields.some((c) => c.occupation === 'registered_nurse'));
  const ap = buildJobKeys({ resumeText: AP_MECH, now: NOW });
  assert.ok(ap.credential_fields.some((c) => c.occupation === 'aircraft_mechanic'));
  assert.ok(ap.roles.some((r) => r.occupations.includes('aircraft_mechanic')), 'the crew-chief role is placed under the licence field by its own lines');
});
