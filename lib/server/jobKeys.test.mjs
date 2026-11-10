// Job keys + THE match rule (lib/server/jobKeys.js). The owner's case (2026-11-10): a matched-jobs email
// sent "Account Manager (LA Metro)" at GSG Protective Services — a security company whose posting asks for
// "Security Officer License", "registration as a security guard" and "two (2) years of supervisory
// experience within the security industry" — to a person who has never worked security. Her résumé listed
// an Account Manager job, and the title phrase alone made the match.
// Run: node --test lib/server/jobKeys.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as places from '../geo/usPlaces.js';
import { areAdjacent } from '../optimizer/fieldMatch.js';
import {
  buildJobKeys, matchListing, classifyTitle, levelOf, requiredLicences, statedMinimums, resumeLicences,
  keysStale, placeMatch, JOB_KEYS_VERSION, occupation, titleYearParts, shownYears, jobNounKey, primaryField, classifyListing,
} from './jobKeys.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-11-10T12:00:00Z');
const read = (rel) => fs.readFileSync(path.join(HERE, '..', 'fixtures', rel), 'utf8');

// A résumé shaped like hers (an Account Manager job, operations management, retail; no security work).
const ACCOUNT_RESUME = `Jamie Rivera
Norwalk, CA | jamie.rivera@example.com

EXPERIENCE
Intake Specialist — Express Marketing | Jul 2025 – Present
• Process new client intake records and schedule follow-ups.

Account Manager — Skymark Solutions | Jan 2025 – Jul 2025
• Managed 40 small-business accounts and renewals.

Key Holder — Club Pilates | Dec 2022 – Jan 2025
• Opened and closed the studio, handled cash and memberships.

Operations Manager — Practical Magicka, Long Beach, CA | Apr 2018 – Dec 2023
• Led a team of 6; ran scheduling, purchasing and vendor management.

EDUCATION
Associate of Science in Engineering - Aerospace & Mechanical Specialty — Cerritos College | In progress`;

// The real posting's qualification lines (GSG Protective Services, Adzuna 5948012608, read 2026-11-10).
const GSG_FULL = `Overview
About Us – GSG Protective Services
GSG Protective Services is a trusted security provider with a strong presence across the Southwest and Northeast United States. We offer high-quality, full-service security solutions with a commitment to safety, professionalism, and reliability. Our services include physical security, protective services, consulting, technology integration, and specialized training.

Job Skills / Requirements
GSG Protective Services is seeking an experienced and professional Operations Support Specialist to support security operations, personnel management, client relations, scheduling oversight, and training functions across designated assignments.

Essential Duties & Key Responsibilities
• Manage physical security procedures and operational protocols.
• Supervise security officers and operational personnel.

Minimum Qualifications
• Associate degree or higher required.
• Minimum three (3) years of related security or operations experience.
• Minimum two (2) years of supervisory experience within the security industry.
• Valid driver’s license with acceptable driving record in accordance with company policy.

Preferred Qualifications
• Bachelor’s degree or higher.
• Five (5) years or more of security, operations, or related industry experience.

Additional Requirements
• Maintain valid registration as a security guard throughout employment.

Certification Requirements (All)
Security Officer License`;
// What Seen's jobs row held (an Adzuna teaser, cut off).
const GSG_TEASER = 'Overview About Us – GSG Protective Services GSG Protective Services is a trusted security provider with a strong presence across the Southwest and Northeast United States. We offer high-quality, full-service security solutions with a commitment to safety, professionalism, and reliability. Our services include physical security, protective services, consulting, technology integration, and specialized training. Led by a seasoned leadership team with decades of experience, we stand by our core val…';
const GSG = { title: 'Account Manager (LA Metro)', company: 'GSG Protective Services', location: 'Culver City, Los Angeles County', lat: 33.995, lng: -118.400 };

test('the owner\'s case: a security company\'s "Account Manager" is never matched to a résumé with no security work', () => {
  const keys = buildJobKeys({ resumeText: ACCOUNT_RESUME, now: NOW });
  assert.ok(keys.occupations.some((o) => o.occupation === 'account_manager'), 'the Account Manager job is in her keys');
  assert.ok(!keys.occupations.some((o) => ['security_officer', 'loss_prevention'].includes(o.occupation)));
  const full = matchListing({ ...GSG, description: GSG_FULL }, keys, { now: NOW });
  assert.equal(full.ok, false, JSON.stringify(full));
  assert.equal(requiredLicences({ ...GSG, description: GSG_FULL }).includes('guard_card'), true, 'the guard licence is read as required');
  const teaser = matchListing({ ...GSG, description: GSG_TEASER }, keys, { now: NOW });
  assert.equal(teaser.ok, false, `teaser door: ${JSON.stringify(teaser)}`);
  assert.ok(['industry:security', 'different_field'].includes(teaser.why), teaser.why);
  // With the Account Manager job still current, the industry rule is what stops it.
  const current = buildJobKeys({ resumeText: ACCOUNT_RESUME.replace('Account Manager — Skymark Solutions | Jan 2025 – Jul 2025', 'Account Manager — Skymark Solutions | Jan 2025 – Present'), now: NOW });
  assert.equal(matchListing({ ...GSG, description: GSG_TEASER }, current, { now: NOW }).why, 'industry:security');
  // Even with the licence somehow on the résumé, "2 years of supervisory experience within the security
  // industry" needs security years: management AND security, not management alone.
  const withCard = { ...keys, credentials: [...keys.credentials, 'guard_card'] };
  const r = matchListing({ ...GSG, description: GSG_FULL }, withCard, { now: NOW });
  assert.equal(r.ok, false, JSON.stringify(r));
});

test('the stated minimums read the qualifications, not the preferred section, and keep the field', () => {
  const mins = statedMinimums({ ...GSG, description: GSG_FULL });
  assert.ok(mins.some((m) => m.years === 3 && m.domains.includes('security_officer')), JSON.stringify(mins));
  const sup = mins.find((m) => m.years === 2);
  assert.ok(sup && sup.management && sup.domains.includes('security_officer'), JSON.stringify(sup));
  assert.ok(!mins.some((m) => m.years === 5), 'the "Five (5) years" line sits under Preferred Qualifications');
});

test('the reverse: 4+ years as a security officer with a guard card → matched, the reason names the job', () => {
  const keys = buildJobKeys({ resumeText: read('matching/security.txt'), now: NOW });
  assert.ok(keys.credentials.includes('guard_card'));
  const job = { title: 'Unarmed Security Officer', company: 'Allied Protection', location: 'Los Angeles, CA',
    description: `${'Patrol and access control at a downtown office tower. '.repeat(10)}\nRequirements\n• Active California Guard Card required.\n• Minimum 3 years of security experience.` };
  const m = matchListing(job, keys, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.reason, /Security Officer at Allied Universal \(since 2021\)/);
  assert.match(m.reason, /They ask for 3\+ years; you have about 5\.5 years as a Security Officer and about 1 year as a Security Guard\./);
  // …and the security résumé is never offered the GSG account-manager job (a different field).
  assert.equal(matchListing({ ...GSG, description: GSG_FULL }, keys, { now: NOW }).ok, false);
});

test('a security officer\'s title implies the guard licence (CA guards hold one); a cashier\'s does not', () => {
  const noCard = read('matching/security.txt').replace(/CERTIFICATIONS[\s\S]*$/, '');
  const keys = buildJobKeys({ resumeText: noCard, now: NOW });
  const job = { title: 'Security Guard', company: 'Securitas', location: 'Los Angeles, CA', description: 'Guard card required. '.repeat(40) };
  assert.equal(matchListing(job, keys, { now: NOW }).ok, true);
  const cashier = buildJobKeys({ resumeText: read('matching/cashier.txt'), now: NOW });
  assert.equal(matchListing(job, cashier, { now: NOW }).ok, false);
});

test('traps: different fields that share words are never matched', () => {
  const nurse = buildJobKeys({ resumeText: read('personas/nurse.txt'), now: NOW });
  assert.equal(classifyTitle('Nurse Recruiter').id, 'recruiter');
  assert.equal(matchListing({ title: 'Nurse Recruiter', company: 'Aya', description: 'Recruit travel nurses. '.repeat(40) }, nurse, { now: NOW }).ok, false);

  const sparky = buildJobKeys({ resumeText: read('personas/electrician.txt'), now: NOW });
  assert.equal(classifyTitle('Electrical Engineer, Intelligence Systems').id, 'electrical_engineer');
  assert.equal(classifyTitle('Electrical Journeyman -Commercial & Industrial').id, 'electrician');
  assert.equal(matchListing({ title: 'Staff Electrical Engineer (Sensors)', company: 'X', description: 'Design sensor boards. '.repeat(40) }, sparky, { now: NOW }).ok, false);

  assert.equal(classifyTitle('Customer Success Specialist').id, 'customer_success');
  assert.equal(classifyTitle('Customer Service Representative').id, 'customer_service');
  const maria = buildJobKeys({ resumeText: read('personas/maria.txt'), now: NOW });
  assert.equal(matchListing({ title: 'Customer Success Specialist', company: 'SaaSCo', description: 'Own onboarding for SaaS accounts. '.repeat(30) }, maria, { now: NOW }).ok, false);

  assert.equal(classifyTitle('Security Engineer').id, 'security_engineer');
  assert.equal(classifyTitle('Loss Prevention Associate').id, 'loss_prevention');
  const cashier = buildJobKeys({ resumeText: read('matching/cashier.txt'), now: NOW });
  assert.equal(matchListing({ title: 'Loss Prevention Associate', company: 'Target', description: 'Prevent theft on the sales floor. '.repeat(30) }, cashier, { now: NOW }).ok, false);
});

test('traps: under-qualified — warehouse manager with 7+ years, a CDL for a "No CDL" driver, a senior title for a new graduate', () => {
  const wh = buildJobKeys({ resumeText: read('personas/warehouse.txt'), now: NOW });
  const mgr = { title: 'Warehouse Manager', company: 'DC Co', description: `${'Run a 400k sq ft DC. '.repeat(20)}\nRequirements\n• 7+ years of warehouse experience, including 3 years managing teams.` };
  assert.equal(matchListing(mgr, wh, { now: NOW }).ok, false);
  const assoc = { title: 'Warehouse Associate', company: 'DC Co', description: `${'Pick, pack and ship orders. '.repeat(40)}\nRequirements\n• 1+ year of warehouse experience.` };
  assert.equal(matchListing(assoc, wh, { now: NOW }).ok, true);

  const driver = buildJobKeys({ resumeText: read('matching/driver.txt'), now: NOW });
  assert.ok(!driver.credentials.includes('cdl'), '"No CDL." is not a CDL');
  assert.equal(matchListing({ title: 'Class A CDL Company Driver - 1yr EXP Required', company: 'Lily', description: 'Class A CDL required. '.repeat(40) }, driver, { now: NOW }).ok, false);
  assert.equal(matchListing({ title: 'Coca-Cola - Delivery Driver (Non-CDL) $20-$27/hr', company: 'Coca Cola', description: 'Deliver to stores. No CDL required. '.repeat(30) }, driver, { now: NOW }).ok, true);

  const grad = buildJobKeys({ resumeText: read('matching/newgrad.txt'), now: NOW });
  assert.equal(matchListing({ title: 'Senior Accountant', company: 'Shinola', description: 'Close the books. '.repeat(50) }, grad, { now: NOW }).ok, false);
  const staff = matchListing({ title: 'Staff Accountant', company: 'Rent the Runway', description: 'Entry level. Reconcile accounts and support the close. '.repeat(20) }, grad, { now: NOW });
  assert.equal(staff.ok, true, JSON.stringify(staff));
});

test('traps: an internship is for students and recent graduates, never for someone with years of work', () => {
  const dev = buildJobKeys({ resumeText: read('personas/dev.txt'), now: NOW });
  assert.equal(levelOf('Mechanical Engineering Intern - 1047'), 0);
  assert.equal(matchListing({ title: 'Software Engineering Intern - Summer 2027', company: 'X', description: 'Pursuing a CS degree. '.repeat(40) }, dev, { now: NOW }).ok, false);
  const student = buildJobKeys({ resumeText: ACCOUNT_RESUME, now: NOW });
  const m = matchListing({ title: 'Mechanical Engineering Intern - 1047', company: 'Acme', description: 'Pursuing a degree in mechanical engineering. '.repeat(20) }, student, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.reason, /internship in your field: you're studying .*Engineering.* at Cerritos College/);
});

test('recent applications put a field in the keys — entry level only, with the application as the reason', () => {
  const apps = [{ role: 'Barista', company_name: 'Dutch Bros', created_at: '2026-11-02T18:00:00Z' }, { role: 'Old Job', company_name: 'X', created_at: '2026-01-01T00:00:00Z' }];
  const keys = buildJobKeys({ resumeText: read('matching/admin.txt'), applications: apps, now: NOW });
  assert.deepEqual(keys.applied.map((a) => a.occupation), ['barista'], 'only the last 60 days, only placeable titles');
  const entry = matchListing({ title: 'Barista', company: 'Starbucks', description: 'No experience required — we train. '.repeat(30) }, keys, { now: NOW });
  assert.equal(entry.ok, true);
  assert.equal(entry.reason, 'Similar to the Barista job at Dutch Bros you applied to on Nov 2.');
  const exp = matchListing({ title: 'Barista Trainer', company: 'Starbucks', description: 'Requirements\n• 2+ years of barista experience required. '.repeat(10) }, keys, { now: NOW });
  assert.equal(exp.ok, false, 'a stated minimum is never met by an application alone');
});

test('a changed résumé changes the keys and the matches; the same résumé keeps them (stale check)', () => {
  const a = buildJobKeys({ resumeText: read('matching/cashier.txt'), now: NOW });
  const b = buildJobKeys({ resumeText: read('matching/cook.txt'), now: NOW });
  assert.notEqual(a.resume_hash, b.resume_hash);
  const job = { title: 'Line Cook', company: 'Snooze', description: 'Grill station. '.repeat(60) };
  assert.equal(matchListing(job, a, { now: NOW }).ok, false);
  assert.equal(matchListing(job, b, { now: NOW }).ok, true);
  assert.equal(keysStale(a, { resumeText: read('matching/cashier.txt'), applications: [], now: NOW }), false);
  assert.equal(keysStale(a, { resumeText: read('matching/cook.txt'), applications: [], now: NOW }), true, 'different résumé text');
  assert.equal(keysStale({ ...a, v: JOB_KEYS_VERSION - 1 }, { resumeText: read('matching/cashier.txt'), now: NOW }), true, 'old version');
  assert.equal(keysStale(a, { resumeText: read('matching/cashier.txt'), applications: [{ role: 'Barista', company_name: 'Dutch Bros', created_at: '2026-11-02T00:00:00Z' }], now: NOW }), true, 'a new application');
  assert.equal(keysStale(null, { resumeText: 'x' }), true);
  // Deterministic for the same inputs.
  assert.deepEqual(buildJobKeys({ resumeText: read('matching/cook.txt'), now: NOW }), b);
});

test('levels: account / product managers are not people managers; trainees are entry level; assistants to executives are not executives', () => {
  assert.equal(levelOf('Account Manager (LA Metro)'), 1);
  assert.equal(levelOf('Key Account Manager West'), 2);
  assert.equal(levelOf('Principal Account Manager - Navy and Marine Corps Aviation'), 3);
  assert.equal(levelOf('Operations Manager'), 3);
  assert.equal(levelOf('Retail Manager Trainee'), 1);
  assert.equal(levelOf('Executive Assistant to the CEO'), 1);
  assert.equal(levelOf('Shift Lead - Laurel'), 2);
  assert.equal(levelOf('Director, Finance'), 4);
});

test('licences: required vs obtainable vs preferred; the résumé side ignores "in progress" and "no"', () => {
  assert.deepEqual(requiredLicences({ title: 'Caregiver', description: 'HHA certification preferred.' }), []);
  assert.deepEqual(requiredLicences({ title: 'Security Officer', description: 'Must obtain guard card within 30 days of hire.' }), ['guard_card'], 'the title itself needs one');
  assert.deepEqual(requiredLicences({ title: 'Warehouse Associate', description: 'Forklift certification a plus.' }), []);
  assert.deepEqual(requiredLicences({ title: 'Delivery Driver (Non-CDL)', description: 'No CDL required.' }), []);
  assert.ok(requiredLicences({ title: 'Software Engineer', description: 'Active TS/SCI clearance required.' }).includes('clearance'));
  assert.deepEqual(resumeLicences('CDL Class A — in progress (school starts January)'), []);
  assert.deepEqual(resumeLicences('No CDL; Class C license'), []);
  assert.deepEqual(resumeLicences('California BSIS Guard Card (active)'), ['guard_card']);
});

test('place: within the radius by coordinates or by the location text; remote only for remote-able fields, never abroad', () => {
  const geo = {
    geocodePlace: (t) => (/norwalk/i.test(t) ? { lat: 33.902, lng: -118.081 } : /culver city/i.test(t) ? { lat: 34.021, lng: -118.396 } : /austin/i.test(t) ? { lat: 30.27, lng: -97.74 } : null),
    distanceMiles: (a, b) => Math.hypot((a.lat - b.lat) * 69, (a.lng - b.lng) * 57),
  };
  const home = { city: 'Norwalk, CA', point: { lat: 33.902, lng: -118.081 } };
  assert.equal(placeMatch({ location: 'Culver City, CA' }, home, geo, 30).ok, true);
  assert.equal(placeMatch({ location: 'Austin, TX' }, home, geo, 30).ok, false);
  assert.equal(placeMatch({ title: 'Customer Service Rep', location: 'Remote - US' }, home, geo, 30).ok, true);
  assert.equal(placeMatch({ title: 'Customer Service Rep', location: 'Remote' }, home, geo, 30).ok, true, 'plain "Remote" on a US board is US-remote');
  assert.equal(placeMatch({ title: 'Customer Service Rep', location: 'Remote', description: 'This role is based in Germany.' }, home, geo, 30).ok, false, 'tied to another country');
  assert.equal(placeMatch({ title: 'Customer Service Rep', location: 'Worldwide' }, home, geo, 30).ok, false);
  assert.equal(placeMatch({ title: 'Customer Service Rep', location: 'Remote', description: 'This is a remote role open to candidates in the United States.' }, home, geo, 30).ok, true);
  assert.equal(placeMatch({ title: 'Accountant', location: 'Remote - European Region' }, home, geo, 30).ok, false);
  assert.equal(placeMatch({ title: 'Call Center Trainer', location: 'United States', description: 'This is a fully remote position.' }, home, geo, 30).ok, true, 'country-wide + remote text = US-remote');
  assert.equal(placeMatch({ title: 'Enterprise Account Executive (Hybrid - London office)', location: 'Remote' }, home, geo, 30).ok, false);
  assert.equal(placeMatch({ title: 'Cashier', location: 'Remote' }, home, geo, 30).ok, false, 'a cashier job is not remote work');
  assert.equal(placeMatch({ title: 'Care Expert - Senegal', location: 'Remote' }, home, geo, 30).ok, false);
  assert.equal(placeMatch({ location: 'Berlin, Germany' }, home, geo, 30).ok, false);
});

// ── Properties over the fixture résumés × 682 real postings ──────────────────────────────────────
const CORPUS_PATH = process.env.SEEN_MATCH_CORPUS || '/tmp/claude-0/-home-user-Seen/b30eccfc-31e3-5e58-94c8-e02565dad614/scratchpad/corpus/all.json';
const corpus = fs.existsSync(CORPUS_PATH) ? JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8')) : JSON.parse(read('personas/postings-sample.json')).map((p, i) => ({ id: `s${i}`, title: p.title || p.jobTitle || '', company: p.company || '', location: p.location || '', description: p.description || p.text || p.jd || '' }));
const RESUMES = [
  ...['dev', 'maria', 'tasha', 'accountant', 'admin', 'electrician', 'nurse', 'rn-home-health', 'warehouse'].map((n) => [`personas/${n}`, read(`personas/${n}.txt`)]),
  ...['cashier', 'cna', 'cook', 'admin', 'driver', 'newgrad', 'security'].map((n) => [`matching/${n}`, read(`matching/${n}.txt`)]),
  ['synthetic/account', ACCOUNT_RESUME],
];

test(`properties over ${RESUMES.length} résumés × ${corpus.length} postings: field, years, reason`, () => {
  let matches = 0;
  for (const [name, text] of RESUMES) {
    const keys = buildJobKeys({ resumeText: text, now: NOW });
    const fields = new Set([...keys.occupations.map((o) => o.occupation), ...keys.applied.map((a) => a.occupation), ...keys.education.map((e) => e.occupation), ...(keys.intent || [])]);
    const near = new Set(fields);
    for (const id of fields) for (const a of occupation(id)?.adj || []) near.add(a);
    for (const o of keys.occupations) for (const other of Object.values(keys.occupations)) if ((occupation(other.occupation)?.adj || []).includes(o.occupation)) near.add(other.occupation);
    for (const j of corpus) {
      const m = matchListing(j, keys, { now: NOW });
      if (!m.ok) continue;
      matches++;
      const occ = classifyTitle(j.title, `${j.company} ${String(j.description || '').slice(0, 1500)}`);
      const lk = primaryField(classifyListing(j.title, j.company, j.description));
      const fieldOk = keys.occupations.some((o) => (o.occupation.startsWith('field:') || String(classifyListing(j.title, j.company, j.description)?.id).startsWith('field:')) && areAdjacent(primaryField(occupation(o.occupation)), lk));
      assert.ok(occ && (near.has(occ.id) || m.basis === 'transfer' || m.basis === 'intent' || m.basis === 'side' || fieldOk) || (!occ && fieldOk), `${name}: "${j.title}" (${occ?.id}) is not a field in the keys`);
      if (m.basis === 'transfer') assert.ok(keys.roles.some((r) => (r.trains || r.occupations.includes('instructor')) && m.reason.includes(r.title)), `${name}: transfer reason names a role that trains or teaches`);
      assert.ok(m.reason && m.reason.length > 10, `${name}: "${j.title}" has no reason`);
      const named = keys.roles.some((r) => m.reason.includes(r.title)) || keys.applied.some((a) => m.reason.includes(a.title)) || keys.education.some((e) => m.reason.includes(e.field || e.degree));
      assert.ok(named, `${name}: the reason "${m.reason}" names no résumé role, application or degree`);
      for (const min of statedMinimums(j)) {
        if (min.management || min.domains.length) continue; // field-specific minimums are checked inside matchListing
        assert.ok(m.basis !== 'applied' && m.basis !== 'education', `${name}: "${j.title}" states ${min.years} years but matched on ${m.basis}`);
      }
      if (m.need != null) assert.ok(m.have >= m.need || (m.have >= m.need / 2 && m.need - m.have <= 1), `${name}: "${j.title}" needs ${m.need}, has ${m.have}`);
    }
  }
  assert.ok(matches > (corpus.length > 100 ? 50 : 0), `the rule still finds matches (${matches})`);
});

// ── Classes found by the director's hidden set (2026-11-10) ───────────────────────────────────────
test('step-down: the junior job a person was promoted out of is not a match unless they applied to it lately', () => {
  const ae = buildJobKeys({ resumeText: `Alex Kim
Denver, CO
EXPERIENCE
Senior Account Executive — Salesloft | Mar 2022 – Present
• President's Club 2023 and 2024; closed $1.4M ARR.
Sales Development Representative — Salesloft | Jan 2021 – Feb 2022
• Booked 30 meetings a month.`, now: NOW });
  const sdr = { title: 'Sales Development Representative', company: 'Acme', description: 'Prospect and book meetings for AEs. '.repeat(30) };
  assert.ok(['step_down', 'step_down_held', 'left_field'].includes(matchListing(sdr, ae, { now: NOW }).why));
  const applied = buildJobKeys({ resumeText: ae.roles.length ? `Alex Kim
EXPERIENCE
Senior Account Executive — Salesloft | Mar 2022 – Present
Sales Development Representative — Salesloft | Jan 2021 – Feb 2022` : '', applications: [{ role: 'Sales Development Representative', company_name: 'Gong', created_at: '2026-11-01T00:00:00Z' }], now: NOW });
  assert.equal(matchListing(sdr, applied, { now: NOW }).ok, true, 'she applied to SDR jobs this month');

  const rn = buildJobKeys({ resumeText: read('personas/nurse.txt'), now: NOW });
  assert.equal(matchListing({ title: 'Nursing Attendant On Call Days', company: 'Kaiser', description: 'Assist nurses with patient care. '.repeat(30) }, rn, { now: NOW }).ok, false, 'an RN is not sent her CNA-years job');

  const teacher = buildJobKeys({ resumeText: `Pat Lee
EXPERIENCE
5th Grade Teacher — Mesa Public Schools | Aug 2017 – Present
• Teach 28 students.
Teacher's Aide — Mesa Public Schools | Aug 2015 – Jun 2017
• Supported a 3rd grade classroom.`, now: NOW });
  assert.equal(matchListing({ title: "Teacher's Aide", company: 'District', description: 'Support classroom teachers. '.repeat(30) }, teacher, { now: NOW }).ok, false);
});

test('years in a reason are one job type\'s own years, recomputed from the keys', () => {
  const k = buildJobKeys({ resumeText: `Chris Doe
EXPERIENCE
Account Executive — Brex | Jun 2025 – Present
• Closed mid-market deals.
Retail Sales Associate — Best Buy | 2019 – 2025
• Sold electronics on the floor.`, now: NOW });
  const ae3 = { title: 'Account Executive', company: 'Gusto', description: `${'Sell payroll software to SMBs. '.repeat(20)}\nRequirements\n• 3+ years of SaaS sales experience as an account executive.` };
  const m = matchListing(ae3, k, { now: NOW });
  assert.equal(m.ok, false, `1.4 years as an AE is not 3 — retail sales years do not count (${JSON.stringify(m)})`);
  // Every number in a reason is recomputed from the dated roles, per exact job title. The test OWNS its cases
  // (résumés in lib/fixtures/matching + postings written here), so other packages' fixture edits and the
  // presence of the scratchpad corpus cannot change what it checks (CI ran it against the 8-posting fallback
  // and the old "more than 20 numbers" guard failed with 8).
  const OWN = [
    ['matching/security.txt', { title: 'Security Officer', company: 'Allied Protection', description: LONG('Patrol and access control at a downtown office tower.') + '\nRequirements\n• Active guard card required.\n• 3+ years of security experience.' }],
    ['matching/cashier.txt', { title: 'Cashier', company: 'Ralphs', description: LONG('Ring up customers at our busy front end and keep the store tidy.') + '\nRequirements\n• 2+ years of cashier experience.' }],
    ['matching/cna.txt', { title: 'Certified Nursing Assistant', company: 'Brookdale', description: LONG('Help residents with daily living in assisted living.') + '\nRequirements\n• Active CNA certification required.\n• 2+ years as a CNA.' }],
    ['matching/cook.txt', { title: 'Line Cook', company: 'Hash Kitchen', description: LONG('Work the grill station on a busy brunch line.') + '\nRequirements\n• 2+ years of line cook experience in a high-volume restaurant.' }],
    ['matching/admin.txt', { title: 'Administrative Assistant', company: 'Kaiser', description: LONG('Support three managers with calendars, travel and invoices.') + '\nRequirements\n• 3+ years of administrative experience.' }],
    ['matching/driver.txt', { title: 'Delivery Driver', company: 'Gopuff', description: LONG('Deliver orders to customers from our local fulfillment center.') + '\nRequirements\n• 2+ years of delivery driving experience.' }],
  ];
  let checked = 0;
  for (const [file, job] of OWN) {
    const keys = buildJobKeys({ resumeText: read(file), now: NOW });
    const r = matchListing(job, keys, { now: NOW });
    assert.equal(r.ok, true, `${file} × ${job.title}: ${JSON.stringify(r)}`);
    assert.ok(r.need != null, `${file}: the posting's minimum was read`);
    const pieces = [...r.reason.matchAll(/about (\d+(?:\.5)?) years? as an? ([^.]+?)(?= and |\.(?:\s|$))/g)];
    assert.ok(pieces.length >= 1, `${file}: the reason states years (${r.reason})`);
    const total = r.reason.match(/you have about (\d+(?:\.5)?) years? in all/);
    if (total) assert.equal(Number(total[1]), shownYears(r.have), `${file}: the total is the job type's own years`);
    for (const piece of pieces) {
      const title = piece[2];
      const idx = keys.roles.map((x, i) => (jobNounKey(x.title) === jobNounKey(title) ? i : -1)).filter((i) => i >= 0);
      assert.ok(idx.length, `${job.title}: "${title}" is not a résumé title (${r.reason})`);
      const exact = titleYearParts(keys, idx, NOW)[0].years;
      assert.equal(Number(piece[1]), shownYears(exact), `${job.title}: "${r.reason}" — ${title} = ${exact} years`);
      assert.ok(Number(piece[1]) <= exact, 'never rounded up');
      checked++;
    }
  }
  assert.equal(checked >= OWN.length, true);
});

test('a degree opens entry-level work only for students, recent graduates and people with under a year of work', () => {
  const lead = buildJobKeys({ resumeText: `Morgan Fox
Austin, TX
EXPERIENCE
Customer Support Lead — Dell | 2016 – Present
• Lead a team of 12 support agents.
EDUCATION
B.A. in Communication Studies — Texas State University | 2016`, now: NOW });
  const mkt = { title: 'Marketing Associate', company: 'Brand Co', description: 'Entry level. Help run our social channels. '.repeat(20) };
  assert.equal(matchListing(mkt, lead, { now: NOW }).ok, false);
  const grad = buildJobKeys({ resumeText: read('personas/tasha.txt'), now: NOW });
  assert.equal(matchListing({ title: 'Digital Marketing Specialist', company: 'Solve', description: 'Entry level. Run paid social. '.repeat(25) }, grad, { now: NOW }).ok, true, 'a 2026 marketing graduate');
});

test('above level: senior / staff / manager titles need years in the field even when the posting states none', () => {
  const junior = buildJobKeys({ resumeText: `Sam Park
EXPERIENCE
Software Engineer — Acme | Jun 2024 – Present
• Built backend APIs in Go.`, now: NOW });
  assert.equal(matchListing({ title: 'Senior Software Engineer, Blockchain Protocols', company: 'X', description: 'Build protocols. '.repeat(60) }, junior, { now: NOW }).ok, false);
  assert.equal(levelOf('Sr Product Marketing Manager'), 3);
  assert.equal(levelOf('Enterprise Account Executive - US'), 2);
  const coord = buildJobKeys({ resumeText: `Lee Wu
EXPERIENCE
Marketing Coordinator — Brand Co | 2023 – Present
• Scheduled campaigns.`, now: NOW });
  assert.equal(matchListing({ title: 'Copy of Sr Product Marketing Manager, Platform', company: 'X', description: 'Own positioning. '.repeat(60) }, coord, { now: NOW }).ok, false);
});

test('a backend engineer is not sent frontend, mobile or embedded roles', () => {
  const dev = buildJobKeys({ resumeText: read('personas/dev.txt'), now: NOW });
  assert.ok(dev.specs.includes('backend'));
  assert.equal(matchListing({ title: 'Frontend Engineer', company: 'X', description: 'React. '.repeat(100) }, dev, { now: NOW }).ok, false);
  assert.equal(matchListing({ title: 'Embedded Software Engineer - 965', company: 'X', description: 'Firmware. '.repeat(100) }, dev, { now: NOW }).ok, false);
});

test('recall: title variants of the same job (travel, per diem, PRN, night shift, abbreviations)', () => {
  const rn = buildJobKeys({ resumeText: read('personas/nurse.txt'), now: NOW });
  for (const t of ['Travel Post Partum RN - $2,365 per week', 'RN - 19405498', 'Registered Nurse PRN Nights', 'Per Diem RN, Med/Surg']) {
    assert.equal(classifyTitle(t).id, 'registered_nurse', t);
  }
  assert.equal(classifyTitle('CNA - Night Shift').id, 'cna');
  assert.equal(classifyTitle('LPN- Licensed Practical Nurse').id, 'lpn');
  assert.equal(classifyTitle('CDL A Truck Driver - 100% no-touch').id, 'truck_driver_cdl');
  assert.equal(matchListing({ title: 'Travel Post Partum RN - $2,365 per week', company: 'MedPro', description: 'Active RN license required. 1+ year of postpartum or med-surg nursing experience required. '.repeat(10) }, rn, { now: NOW }).ok, true);
});

// ── Round 2 (director, 2026-11-10): recall without losing precision ─────────────────────────────
const LONG = (s) => `${s} `.repeat(Math.ceil(800 / (s.length + 1)));
const SUPPORT_LEAD = `Morgan Fox
Austin, TX
EXPERIENCE
Customer Support Team Lead — Dell Technologies | Mar 2022 – Present
• Lead a team of 8 support agents; coach and onboard every new hire through a 3-week program.
Customer Support Representative — Dell Technologies | Jun 2018 – Feb 2022
• Phone and chat support, 60 contacts a day.`;
const TEACHER = `Pat Lee
Mesa, AZ
EXPERIENCE
5th Grade Teacher — Mesa Public Schools | Aug 2017 – Present
• Teach 28 students; design weekly lessons and assessments.
EDUCATION
B.A. in Elementary Education — ASU | 2015`;

test('teasers: email mode flags a summary for the full read; the rail shows one only for the person\'s own current title', () => {
  const k = buildJobKeys({ resumeText: read('matching/cashier.txt'), now: NOW });
  const teaser = { title: 'Cashier', company: 'Walmart', source: 'Adzuna', description: 'Walmart is hiring cashiers to help customers at the front end of our store. Apply today to join a team that…' };
  const rail = matchListing(teaser, k, { now: NOW });
  assert.equal(rail.ok, true);
  assert.equal(rail.summaryOnly, true, 'the rail says it is a summary');
  const sales = { title: 'Retail Sales Associate', company: 'Ross', source: 'Adzuna', description: 'Ross is hiring sales associates for our store…' };
  assert.equal(matchListing(sales, k, { now: NOW }).ok, false, 'a neighbouring title on a summary is not shown');
  // round 8 (director): one decision for both surfaces — the email never accepts what the rail refuses
  assert.equal(matchListing(sales, k, { now: NOW, mode: 'email' }).ok, false, 'the email refuses what the rail refuses');
  const email = matchListing(teaser, k, { now: NOW, mode: 'email' });
  assert.equal(email.ok, true);
  assert.equal(email.summaryOnly, true, 'email mode passes a same-title summary on to be read in full first');
});

test('transferable work: a teacher who applied to trainer jobs gets trainer roles; a support lead who onboards agents too; a teacher who did not apply does not', () => {
  const trainer = { title: 'Corporate Trainer', company: 'Acme Logistics', location: 'Mesa, AZ', description: LONG('Deliver onboarding and compliance training to new hires; build training materials.') + '\nRequirements\n• 2+ years of training or teaching experience.' };
  const applied = buildJobKeys({ resumeText: TEACHER, applications: [{ role: 'Corporate Trainer', company_name: 'Banner Health', created_at: '2026-10-20T00:00:00Z' }, { role: 'Instructional Designer', company_name: 'ASU Online', created_at: '2026-10-25T00:00:00Z' }], now: NOW });
  const m = matchListing(trainer, applied, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.reason, /^Similar to the Corporate Trainer job at Banner Health you applied to on Oct 20\. They ask for 2\+ years; you have about 9 years teaching\.$/);
  const notApplied = buildJobKeys({ resumeText: TEACHER, now: NOW });
  assert.equal(matchListing(trainer, notApplied, { now: NOW }).ok, false, 'teaching alone does not send trainer jobs unasked');

  const lead = buildJobKeys({ resumeText: SUPPORT_LEAD, now: NOW });
  assert.ok(lead.level.training_years >= 4, JSON.stringify(lead.level));
  const cct = { title: 'Call Center Trainer', company: 'Concentrix', location: 'United States', description: LONG('This is a fully remote position. Train new call center agents on systems and service standards.') };
  const t = matchListing(cct, lead, { now: NOW });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.match(t.reason, /^You train people as a Customer Support Team Lead at Dell Technologies \(since 2022\)\.$/);
});

test('one step up in the same field: a support team lead who leads 8 agents is offered a support manager role', () => {
  const lead = buildJobKeys({ resumeText: SUPPORT_LEAD, now: NOW });
  assert.equal(lead.level.managed_people, true, 'present-tense "Lead a team of 8" is people management');
  const mgr = { title: 'Customer Support Manager', company: 'Indeed', location: 'Austin, TX', description: LONG('Manage a team of 10 support agents and own CSAT for our customers.') + '\nRequirements\n• 3+ years of customer support experience, including 2 years leading a team.' };
  const m = matchListing(mgr, lead, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
});

test('a kitchen manager whose roles parse with no employer still has his field', () => {
  const k = buildJobKeys({ resumeText: `Luis Ortega
Phoenix, AZ
EXPERIENCE
Kitchen Manager | 2021 – Present
• Run a 12-person kitchen; order food and write the prep schedule.
Line Cook | 2017 – 2021
• Grill and sauté stations.`, now: NOW });
  assert.ok(k.occupations.some((o) => o.occupation === 'cook'), JSON.stringify(k.occupations));
  const m = matchListing({ title: 'Sous Chef', company: 'Hash Kitchen', description: LONG('Lead the line, order product and train cooks in a busy brunch restaurant.') }, k, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.reason, /^You're a Kitchen Manager \(since 2021\)\./);
});

// ── Round 3 (director, 2026-11-10) ───────────────────────────────────────────────────────────────
const JOURNEYMAN = `Ray Ortiz
Phoenix, AZ
EXPERIENCE
Journeyman Electrician — Sunbelt Electric | Mar 2020 – Present
• Ran EMT conduit and pulled wire for tenant improvements; read blueprints and NEC code.
Electrical Apprentice — Sunbelt Electric | Mar 2016 – Feb 2020
• Assisted journeymen on commercial jobs.
LICENSES
Arizona Journeyman Electrician card · OSHA 30`;

test('licence grades: a journeyman is not a master; years are counted at the grade the posting asks for', () => {
  const k = buildJobKeys({ resumeText: JOURNEYMAN, now: NOW });
  assert.ok(!k.credentials.includes('emt'), `"EMT conduit" is not an EMT certification (${k.credentials})`);
  assert.ok(k.credentials.includes('journeyman_electrician'));
  const master = { title: 'Master Electrician', company: 'Volt Co', description: LONG('Run commercial electrical projects and supervise crews.') + '\nRequirements\n• Arizona master electrician license required.\n• 4+ years as a licensed master electrician.' };
  assert.deepEqual(requiredLicences(master), ['master_electrician']);
  assert.equal(matchListing(master, k, { now: NOW }).why, 'licence:master_electrician');
  const masterYears = { title: 'Lead Electrician', company: 'Volt Co', description: LONG('Lead commercial electrical crews.') + '\nRequirements\n• 4+ years as a licensed master electrician.' };
  assert.equal(matchListing(masterYears, k, { now: NOW }).ok, false, 'years as a master, not as an electrician');
  const jm = { title: 'Electrical Journeyman - Commercial & Industrial', company: 'CoolSys', description: LONG('Install and service commercial electrical systems.') + '\nRequirements\n• Journeyman electrician license required.\n• 3+ years of commercial electrical experience.' };
  const m = matchListing(jm, k, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.reason, /They ask for 3\+ years; you have about 6\.5 years as a Journeyman Electrician and about 3\.5 years as an Electrical Apprentice\./);
});

test('licence grades: LPN is not RN, Class B is not Class A; a higher grade covers the lower', () => {
  assert.ok(requiredLicences({ title: 'CDL A Truck Driver', description: 'Class A CDL required.' }).includes('cdl_a'));
  const classB = buildJobKeys({ resumeText: 'Joe Doe\nEXPERIENCE\nTruck Driver — Sysco | 2019 – Present\n• Local routes.\nLICENSES\nCDL Class B with air brakes', now: NOW });
  assert.equal(matchListing({ title: 'CDL A Truck Driver', company: 'X', description: LONG('Haul dry van freight regionally.') + '\nRequirements\n• Class A CDL required.' }, classB, { now: NOW }).why, 'licence:cdl_a');
  const lpn = buildJobKeys({ resumeText: 'Ann Lee\nEXPERIENCE\nLicensed Practical Nurse — Sunrise | 2019 – Present\n• Pass meds.\nLICENSES\nLPN License — Texas', now: NOW });
  assert.equal(matchListing({ title: 'Registered Nurse - Med/Surg', company: 'X', description: LONG('Care for patients.') + '\nRequirements\n• Active RN license required.' }, lpn, { now: NOW }).ok, false);
});

test('credentials are read only from a licences section or a line that says licence / certified / card', () => {
  assert.deepEqual(resumeLicences('EXPERIENCE\nElectrician\n• Ran EMT conduit\n• Worked with the PE on site'), []);
  assert.deepEqual(resumeLicences('CPA candidate, sitting for FAR in 2027'), []);
  assert.deepEqual(resumeLicences('CERTIFICATIONS\nEMT-B (NREMT)\nBLS'), ['emt']);
  assert.deepEqual(resumeLicences('Certified Nursing Assistant (CNA), Texas'), ['cna']);
  assert.deepEqual(resumeLicences('SKILLS\nRN-level charting, CNA supervision'), []);
});

test('years in a reason are the exact title\'s years — not the specialist years before a promotion', () => {
  const k = buildJobKeys({ resumeText: SUPPORT_LEAD.replace('Customer Support Representative', 'Customer Support Specialist'), now: NOW });
  const job = { title: 'Customer Support Team Lead', company: 'Zendesk', location: 'Austin, TX', description: LONG('Lead a support team of 8.') + '\nRequirements\n• 3+ years of customer support experience.' };
  const m = matchListing(job, k, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.reason, /you have about 4\.5 years as a Customer Support Team Lead and about 3\.5 years as a Customer Support Specialist\./);
});

test('60 titles: the job noun decides the field; a team or domain qualifier never does', () => {
  const CASES = [
    ['Frontend Developer, Device Security', 'software_engineer'], ['Software Engineer, Fraud', 'software_engineer'], ['Backend Engineer - Payments', 'software_engineer'],
    ['Data Analyst, Trust & Safety', 'data_analyst'], ['Account Executive, Healthcare', 'account_executive'], ['Security Officer', 'security_officer'],
    ['Unarmed Security Guard', 'security_officer'], ['Security Field Supervisor', 'security_officer'], ['Loss Prevention Associate', 'loss_prevention'],
    ['Security Engineer', 'security_engineer'], ['Application Security Analyst (SAST)', 'security_engineer'], ['Nurse Recruiter', 'recruiter'],
    ['Technical Recruiter', 'recruiter'], ['Registered Nurse - Home Health', 'registered_nurse'], ['Travel Post Partum RN - $2,365 per week', 'registered_nurse'],
    ['RN - 19405498', 'registered_nurse'], ['LPN- Licensed Practical Nurse', 'lpn'], ['Hospice Licensed Nurse (LPN/LVN)', 'lpn'],
    ['Certified Nursing Assistant (CNA)', 'cna'], ['Medical Assistant, Pomona Valley', 'medical_assistant'], ['Phlebotomist - Full Time, Days', 'phlebotomist'],
    ['Nurse Practitioner', 'nurse_practitioner'], ['Electrician', 'electrician'], ['Electrical Journeyman -Commercial & Industrial', 'electrician'],
    ['Electrical Engineer, Intelligence Systems', 'electrical_engineer'], ['Lead Electrical Engineer, Facilities Engineering', 'electrical_engineer'], ['Customer Success Manager', 'customer_success'],
    ['Customer Service Representative', 'customer_service'], ['Customer Support Manager', 'customer_service'], ['Call Center Trainer', 'corporate_trainer'],
    ['Corporate Trainer', 'corporate_trainer'], ['Instructional Designer', 'instructional_designer'], ['Teacher', 'instructor'],
    ["Teacher's Aide", 'teaching_assistant'], ['Personal Trainer', 'personal_trainer'], ['Barista Trainer', 'barista'],
    ['Warehouse Associate - Outbound Night Shift', 'warehouse_associate'], ['Warehouse Manager', 'warehouse_associate'], ['Material Handler 1 - 1st Shift', 'warehouse_associate'],
    ['CDL A Truck Driver - 100% no-touch', 'truck_driver_cdl'], ['Coca-Cola - Delivery Driver (Non-CDL) $20-$27/hr', 'delivery_driver'], ['Valet Parker (Seasonal, Part Time)', 'valet'],
    ['Cashier', 'cashier'], ['Seasonal Sales Associate (part-time)- Perry Ellis', 'retail_associate'], ['Keyholder, Atlanta', 'retail_associate'],
    ['Line Cook', 'cook'], ['Sous Chef', 'cook'], ['Kitchen Manager', 'cook'],
    ['Administrative Coordinator', 'admin_assistant'], ['Executive Assistant to the Communications and Enterprise Services Executives', 'admin_assistant'], ['Receptionist', 'receptionist'],
    ['Staff Accountant', 'accountant'], ['HR Coordinator', 'hr_generalist'], ['Litigation Assistant', 'legal_assistant'],
    ['Account Manager (LA Metro)', 'account_manager'], ['Sales Development Representative', 'sdr'], ['Production Supervisor - 2nd Shift', 'production_associate'],
    ['Registered Nurses - AI Training - Colorado Springs, US', 'ai_training'], ['CNC Programmer', null], ['Fire Alarm Programmer', null],
  ];
  assert.ok(CASES.length >= 60);
  const wrong = CASES.filter(([t, want]) => (classifyTitle(t)?.id ?? null) !== want).map(([t, want]) => `${t}: ${classifyTitle(t)?.id ?? null} ≠ ${want}`);
  assert.deepEqual(wrong, []);
  // …and a developer job on a security team needs no guard card.
  assert.deepEqual(requiredLicences({ title: 'Frontend Developer, Device Security', description: LONG('Build the web app for our device security product.') }), []);
});

test('the rail\'s own-title test for summaries reads the job noun (shift / site qualifiers, trade word order)', () => {
  const wh = buildJobKeys({ resumeText: read('personas/warehouse.txt'), now: NOW });
  const teaser = { title: 'Warehouse Associate - Outbound Night Shift', company: 'Integrity Staffing', source: 'Adzuna', description: 'Integrity Staffing is hiring warehouse associates for outbound night shift at our distribution center…' };
  const m = matchListing(teaser, wh, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.equal(m.summaryOnly, true);
  const jm = buildJobKeys({ resumeText: JOURNEYMAN, now: NOW });
  const t2 = { title: 'Electrical Journeyman - Commercial & Industrial', company: 'CoolSys', source: 'Adzuna', description: 'CoolSys is hiring an electrical journeyman for commercial and industrial work…' };
  assert.equal(matchListing(t2, jm, { now: NOW }).ok, true);
  assert.equal(matchListing(t2, jm, { now: NOW, mode: 'email' }).summaryOnly, true, 'email mode sends it to the full read');
});

// ── Round 4 (director, 2026-11-10): two last wrong picks for a mid-market SaaS account executive ──────
const MM_AE = `Chris Doe
Denver, CO
EXPERIENCE
Account Executive, Mid-Market — Outreach | Jan 2022 – Present
• Closed $1.1M new ARR selling sales-engagement software to 200–1,000 seat companies.
Sales Development Representative — Outreach | Jun 2020 – Dec 2021
• Booked 25 meetings a month.`;

test('a different job inside sales: deal desk, sales operations, sales engineering, account management are not closing jobs', () => {
  const k = buildJobKeys({ resumeText: MM_AE, now: NOW });
  for (const t of ['Deal Desk', 'Revenue Operations Manager', 'Sales Enablement Manager', 'Sales Engineer', 'Solutions Engineer', 'Account Manager', 'Customer Success Manager']) {
    const m = matchListing({ title: t, company: 'SaaSCo', description: LONG('Support the sales team at a software company.') + '\nRequirements\n• 4+ years of experience.' }, k, { now: NOW });
    assert.equal(m.ok, false, `${t}: ${JSON.stringify(m)}`);
  }
  assert.equal(classifyTitle('Deal Desk').id, 'sales_operations');
  assert.equal(classifyTitle('Territory Manager - Columbus, OH').id, 'sales_rep');
  const ae = matchListing({ title: 'Mid-Market Account Executive', company: 'Attio', location: 'Remote', description: LONG('Sell our CRM to mid-market companies.') + '\nRequirements\n• 3+ years of closing experience in SaaS.' }, k, { now: NOW });
  assert.equal(ae.ok, true, JSON.stringify(ae));
});

test('a territory tied to another city and a specialised industry is not a match', () => {
  const k = buildJobKeys({ resumeText: MM_AE, now: NOW });
  const terr = { title: 'Territory Manager - Columbus, OH', company: 'Aquestive Therapeutics', location: 'US Remote', description: LONG('Call on physicians and pharmacies to grow prescriptions of our therapeutics portfolio; pharmaceutical sales experience preferred.') };
  assert.equal(matchListing(terr, k, { now: NOW }).ok, false);
  const pharmaAe = { ...terr, title: 'Specialty Account Executive', location: 'Denver, CO' };
  assert.equal(matchListing(pharmaAe, k, { now: NOW }).why, 'industry:life sciences', 'a SaaS closer has no years selling therapeutics');
  const home = { city: 'Denver, CO', point: places.geocodePlace('Denver, CO') };
  assert.equal(placeMatch(terr, home, places, 30).ok, false, 'the title names Columbus, OH');
  assert.equal(placeMatch({ title: 'Account Executive', location: 'US Remote' }, home, places, 30).ok, true);
  // Someone who sold pharma passes the industry rule.
  const rep = buildJobKeys({ resumeText: 'Pat Kim\nColumbus, OH\nEXPERIENCE\nPharmaceutical Sales Representative — Pfizer | 2019 – Present\n• Called on 120 physicians selling cardiology therapeutics.', now: NOW });
  const r = matchListing(pharmaAe, rep, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r));
});

// ── Round 5 (independent judge, 2026-11-10): classes, on fixtures written here ─────────────────────────
const GRAD = `Dana Kim
Chicago, IL
EDUCATION
DePaul University — B.S. Accountancy, May 2026
EXPERIENCE
Audit Intern — Grant Thornton | Jan 2026 – Apr 2026
• Tested cash and receivables for two manufacturing clients.
Accounting Assistant (part-time) — DePaul Bursar | Sep 2024 – Dec 2025
• Posted student payments and reconciled daily deposits in Excel.
Barista — Intelligentsia Coffee | 2022 – 2024
• Made espresso drinks for a busy cafe.`;
const CHANGER = `Alex Ruiz
Denver, CO
Electrical apprentice (3rd year) switching careers from restaurant kitchens.
EXPERIENCE
Electrical Apprentice — Summit Peak Electric | May 2023 – Present
• Rough-in and trim-out for tenant improvements; pull wire.
Line Cook / Kitchen Lead — Snooze | 2017 – 2023
• Ran the grill station.`;
const STORE_MGR = `Bobby Nguyen
Dallas, TX
EXPERIENCE
Store Manager — Kohl's | 2016 – Present
• P&L for an $18M store; 75 associates and 6 managers.
Assistant Store Manager — Target | 2013 – 2016
• Led softlines and guest service; schedules for 40 team members.
Sales Associate / Cashier — Target | 2011 – 2013
• Register and fitting room.`;
const FORKLIFT = `Ty Brooks
Columbus, OH
EXPERIENCE
Material Handler / Forklift Operator — Ohio Valley Distribution | Mar 2020 – Present
• Operate sit-down and reach forklifts; cycle counts and inventory control every shift.
Warehouse Associate (temp) — Amazon | 2019 – 2020
• Picked and packed orders.
Warehouse Associate — Amazon | 2017 – 2019
• Stowed and scanned inventory.
LICENSES
Forklift certified (OSHA). No CDL.`;

test('direction of travel: a field the person left, or a job held through school, is never the match or the headline', () => {
  const grad = buildJobKeys({ resumeText: GRAD, now: NOW });
  assert.ok(grad.occupations.find((o) => o.occupation === 'barista').left, 'barista ended before the accounting work began');
  const barista = { title: 'Barista', company: 'Intelligentsia Coffee', location: 'Chicago, IL', description: LONG('Make espresso drinks and serve guests in our cafe.') };
  assert.equal(matchListing(barista, grad, { now: NOW }).ok, false);
  const audit = matchListing({ title: 'Audit Associate', company: 'Crowe', description: LONG('Join our audit team as a first-year associate; CPA eligible preferred.') }, grad, { now: NOW });
  assert.equal(audit.ok, true, JSON.stringify(audit));
  const ch = buildJobKeys({ resumeText: CHANGER, now: NOW });
  assert.ok(ch.occupations.find((o) => o.occupation === 'cook').left, '"switching careers from restaurant kitchens"');
  assert.equal(matchListing({ title: 'Line Cook', company: 'Snooze', description: LONG('Work the grill on a busy brunch line.') + '\nRequirements\n• 1+ year of line cook experience.' }, ch, { now: NOW }).ok, false);
  // A job held through school, in another field from the degree, is a side job: below the degree's field.
  const tasha = buildJobKeys({ resumeText: read('personas/tasha.txt'), now: NOW });
  const b = matchListing({ title: 'Barista', company: 'Blue Bottle', description: LONG('Make espresso drinks for guests.') }, tasha, { now: NOW });
  const mkt = matchListing({ title: 'Digital Marketing Specialist', company: 'Solve', description: 'Entry level. Run paid social. '.repeat(30) }, tasha, { now: NOW });
  assert.ok(!b.ok || b.side, JSON.stringify(b));
  if (b.ok) assert.ok(mkt.ok && mkt.rank > b.rank, 'the degree field outranks the school job');
});

test('requirements the reader must catch: supervising teams, an electrician certification, years with no word "experience"', () => {
  const fk = buildJobKeys({ resumeText: FORKLIFT, now: NOW });
  const sup = { title: 'Warehouse Shift Supervisor', company: 'DC Co', description: LONG('Run a shift of 25 associates in our distribution center.') + '\nRequirements\n• 2+ years supervising warehouse teams.\n• 3+ years of warehouse experience.' };
  assert.equal(matchListing(sup, fk, { now: NOW }).ok, false, 'he has never supervised');
  assert.ok(statedMinimums(sup).some((m) => m.years === 2 && m.management));
  const ch = buildJobKeys({ resumeText: CHANGER, now: NOW });
  const lead = { title: 'Electrical Lead Installer', company: 'Bell Brothers', description: LONG('Lead residential electrical installs.') + '\nRequirements\n• Current California Residential Electrician Certification or higher.' };
  assert.ok(requiredLicences(lead).includes('journeyman_electrician'));
  assert.equal(matchListing(lead, ch, { now: NOW }).ok, false);
  const ent = { description: '\nRequirements\n• Proven SaaS quota-carrying success: 5+ years closing complex Enterprise deals.', title: 'Enterprise Account Executive' };
  assert.ok(statedMinimums(ent).some((m) => m.years === 5));
  assert.deepEqual(statedMinimums({ description: '\nBenefits\n• 401k match after one year of service\n• Tuition help after 2 years' }), []);
});

test('no shortfall inside a match: 1 year is not "2+ years"', () => {
  const grad = buildJobKeys({ resumeText: GRAD, now: NOW });
  const staff = { title: 'Staff Accountant', company: 'Lakeshore', description: LONG('Support the monthly close.') + '\nRequirements\n• 2+ years of accounting experience.' };
  assert.equal(matchListing(staff, grad, { now: NOW }).ok, false);
});

test('level: never a level the person was promoted out of; a supervisor title needs people managed', () => {
  const sm = buildJobKeys({ resumeText: STORE_MGR, now: NOW });
  for (const t of ['Assistant Store Manager', 'Keyholder, Atlanta', 'Retail Sales Associate']) {
    const m = matchListing({ title: t, company: 'Target', description: LONG('Help run a busy retail store, register and sales floor.') }, sm, { now: NOW });
    assert.equal(m.ok, false, `${t}: ${JSON.stringify(m)}`);
  }
  const dm = matchListing({ title: 'District Manager', company: 'Ross Dress for Less', description: LONG('Lead 10-12 stores in the district; coach store managers and own the district P&L.') + '\nRequirements\n• 5+ years as a store manager.' }, sm, { now: NOW });
  assert.equal(dm.ok, true, JSON.stringify(dm));
  const fk = buildJobKeys({ resumeText: FORKLIFT, now: NOW });
  assert.equal(matchListing({ title: 'Warehouse Supervisor', company: 'X', description: LONG('Supervise receiving.') }, fk, { now: NOW }).why, 'management');
});

test('true numbers: floored to the half year, every role with the same title summed', () => {
  const fk = buildJobKeys({ resumeText: FORKLIFT, now: NOW });
  const wa = matchListing({ title: 'Warehouse Associate', company: 'Integrity', description: LONG('Pick, pack and ship orders.') + '\nRequirements\n• 2+ years of warehouse experience.' }, fk, { now: NOW });
  assert.equal(wa.ok, true, JSON.stringify(wa));
  const piece = wa.reason.match(/about (\d+(?:\.5)?) years? as an? Warehouse Associate/);
  assert.ok(piece, wa.reason);
  assert.equal(Number(piece[1]), 3, 'Amazon 2017–2019 plus the 2019–2020 temp year');
  assert.equal(shownYears(3.5), 3.5);
  assert.equal(shownYears(7.3), 7);
  assert.equal(shownYears(3.99), 3.5);
});

test('round-5 titles: audit associate, district manager, electrical technician titles, a team name is not a specialisation', () => {
  assert.equal(classifyTitle('Audit Associate').id, 'accountant');
  assert.equal(classifyTitle('Electrical Test Technician').id, 'electrician');
  assert.equal(classifyTitle('Mechatronics Technician').id, 'electrician');
  assert.equal(classifyTitle('Installation Technician Helper').id, 'electrician');
  assert.equal(classifyTitle('District Manager', 'Ross Dress for Less Lead 10-12 stores in the district; coach store managers').id, 'retail_associate');
  const dev = buildJobKeys({ resumeText: read('personas/dev.txt'), now: NOW });
  const m = matchListing({ title: 'Agentic AI Team - Software Engineer (Mid-level)', company: 'Sprinter', description: LONG('Build backend services in Python for our agent platform.') }, dev, { now: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
});
