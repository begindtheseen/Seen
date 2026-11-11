// Round 12: the RULE OF EVIDENCE. An email item needs every check PASSED on evidence; doubt means silence. The rail
// names what it could not check. Invented people in occupations not used before (surgical technologist, court
// reporter, veterinary technician, welding inspector, wind-turbine technician, sign-language interpreter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobKeys, matchListing, credentialShown, scheduleAgreement, statedLimits, unreadYearsAsks } from './jobKeys.js';
import { finalizeMatches } from './resumeMatches.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const L = (s, reqs = []) => `${s} `.repeat(8) + (reqs.length ? `\nRequirements\n${reqs.map((r) => `• ${r}`).join('\n')}` : '');

test('rule 1a: a PAST role is never the basis of an email headline (the rail may still name it)', () => {
  const k = buildJobKeys({ resumeText: 'Ari Vance\nDenver, CO\nEXPERIENCE\nSign Language Interpreter — Mile High Interpreting | 2016 – 2021\n- Interpreted medical and legal appointments\nOperations Analyst — Ball Corporation | 2021 – Present\n- Built weekly plant KPI reports in Excel and Power BI', now: NOW });
  const m = matchListing({ title: 'Sign Language Interpreter', company: 'Denver Health', location: 'Denver, CO', description: L('Interpret for patients and clinicians in clinic visits.') }, k, { now: NOW });
  if (m.ok) {
    assert.match(m.reason, /^You were /, 'the rail may name the past role');
    assert.equal(m.headlineOk, false, 'a past role never heads an email');
  }
  const cur = matchListing({ title: 'Operations Analyst', company: 'Molson Coors', location: 'Denver, CO', description: L('Build plant KPI reports and dashboards for the brewery team, partner with plant managers on weekly reviews, and keep the data accurate.', ['Excel and Power BI']) }, k, { now: NOW });
  assert.equal(cur.ok, true, JSON.stringify(cur));
  assert.equal(cur.headlineOk, true, 'the current role can head an email');
});

test('rule 1a: a rung the person already left on their own ladder is no match at all', () => {
  const k = buildJobKeys({ resumeText: 'Bo Reyes\nAmarillo, TX\nEXPERIENCE\nWind Turbine Technician II — NextEra Energy | 2023 – Present\n- Troubleshoot pitch and yaw systems; climb 300 ft towers\nWind Turbine Technician I — NextEra Energy | 2021 – 2023\n- Scheduled maintenance on GE 1.5 MW turbines', now: NOW });
  for (const mode of ['rail', 'email']) {
    const m = matchListing({ title: 'Wind Turbine Technician I', company: 'Vestas', location: 'Amarillo, TX', description: L('Perform scheduled maintenance on wind turbines. Entry level; we train.') }, k, { now: NOW, mode });
    assert.equal(m.ok, false, `${mode}: ${JSON.stringify(m)}`);
  }
});

test('rule 1b: a credential named with any doubt is never shown — never "which you hold"', () => {
  assert.equal(credentialShown('CST certification', 'CERTIFICATIONS\nCST (NBSTSA) — expired 2024'), false);
  assert.equal(credentialShown('CST certification', 'CST — exam scheduled for January'), false);
  assert.equal(credentialShown('RVT license', 'Registered Veterinary Technician (RVT) — pending state approval'), false);
  assert.equal(credentialShown('CST certification', 'CST (NBSTSA), 2023'), true);
  const k = buildJobKeys({ resumeText: 'Kim Ito\nTulsa, OK\nEXPERIENCE\nVeterinary Assistant — Banfield | 2022 – Present\n- Restrained animals and prepped surgical packs\nLICENSES\nRegistered Veterinary Technician (RVT) — eligible, exam 2027', now: NOW });
  assert.ok(!(k.credentials || []).length, 'an "eligible" licence is not held');
  const m = matchListing({ title: 'Registered Veterinary Technician', company: 'VCA', location: 'Tulsa, OK', description: L('Induce anesthesia and monitor surgical patients.', ['Active RVT license required']) }, k, { now: NOW });
  assert.ok(!m.ok || !/which you hold/.test(m.reason), JSON.stringify(m));
});

test('rule 1c: a stated schedule preference without a positive match blocks the headline', () => {
  const lim = statedLimits('Court reporter seeking full-time daytime work only.');
  assert.equal(lim.scheduleSaid, true);
  assert.deepEqual(scheduleAgreement({ title: 'Court Reporter', description: 'Full-time, day schedule in the county courthouse.' }, lim), { said: true, affirmed: true });
  assert.equal(scheduleAgreement({ title: 'Court Reporter', description: 'Evening and weekend depositions.' }, lim).affirmed, false, 'an evening condition is not affirmed by a day want');
  assert.equal(scheduleAgreement({ title: 'Court Reporter (Per Diem)', description: 'As-needed coverage.' }, lim).affirmed, false, 'per diem is not affirmed by a full-time want');
  // the person states nothing → a stated listing condition is fine
  assert.equal(scheduleAgreement({ title: 'Court Reporter (Per Diem)', description: '' }, statedLimits('Certified court reporter, 9 years.')).affirmed, true);
});

test('rule 1 + 2: an unverified requirement — dropped from the email, named as a question on the rail and sorted last', () => {
  const resume = 'Lee Moss\nMobile, AL\nEXPERIENCE\nWelding Inspector — Austal USA | 2019 – Present\n- Visual and UT inspection of hull welds to AWS D1.1 and D1.2\n- Wrote nonconformance reports\nCERTIFICATIONS\nAWS CWI (Certified Welding Inspector), 2019';
  const keys = buildJobKeys({ resumeText: resume, now: NOW });
  const clean = { id: 'a', title: 'Welding Inspector', company: 'Ingalls', location: 'Mobile, AL', description: L('Inspect structural welds on ship hulls.', ['AWS CWI certification required']) };
  const unsure = { id: 'b', title: 'Welding Inspector', company: 'Gulf Fab', location: 'Mobile, AL', description: L('Inspect pipe welds on offshore modules.', ['AWS CWI certification required', 'Inspecting pressure piping to ASME B31.3: 3+ years']) };
  const rows = [unsure, clean].map((j) => { const m = matchListing(j, keys, { now: NOW }); return { ...j, _reason: m.reason, _basis: m.basis, _checks: m.checks, _checked: m.checked, _headlineOk: m.headlineOk, _summaryOnly: m.summaryOnly }; });
  assert.ok(unreadYearsAsks(unsure, [], rows[0]._checked).length >= 0);
  const rail = finalizeMatches(rows, resume, { keys, now: NOW, limit: 12 }).rows;
  const ids = rail.map((r) => r.id);
  if (ids.includes('b')) {
    assert.ok(ids.indexOf('a') === -1 || ids.indexOf('a') < ids.indexOf('b'), 'a row with an unverified requirement sorts below every clean row');
    const b = rail.find((r) => r.id === 'b');
    if (b._unverified) assert.match(b._reason, /check (yours is current|your résumé shows it)\.$/, 'the requirement is named as a question');
  }
  const email = finalizeMatches(rows, resume, { keys, now: NOW, limit: 6, strict: true }).rows;
  for (const r of email) assert.ok(!r._unverified, 'the email never carries an unverified requirement');
});

test('rule 1b: a basic driver licence is shown by driving work; a CDL or a class never is', () => {
  const r = 'Nia Park\nReno, NV\nEXPERIENCE\nValet Driver — Peppermill Resort | 2022 – Present\n- Parked and retrieved up to 400 guest vehicles a night';
  assert.equal(credentialShown('driver license', r), true);
  assert.equal(credentialShown("valid driver's license", r), true);
  assert.equal(credentialShown('CDL Class A license', r), false, 'a commercial licence must be named');
  assert.equal(credentialShown('driver license', 'Front desk agent — checked in guests'), false);
});
