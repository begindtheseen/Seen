// Tests: résumé → job-search query derivation (the pure half of the résumé→jobs floor).
// Run: node --test lib/server/resumeJobMatch.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveResumeJobQuery, deriveResumeSignal, resumeSkillsStale } from './resumeJobMatch.js';

test('prefers the real job title, stripped of seniority/type noise', () => {
  assert.equal(deriveResumeJobQuery({ top_titles: ['Senior Software Engineer'] }), 'software engineer');
  assert.equal(deriveResumeJobQuery({ top_titles: ['Software Engineer II (Contract)'] }), 'software engineer');
  assert.equal(deriveResumeJobQuery({ top_titles: ['Lead Data Analyst', 'Analyst'] }), 'data analyst');
});

test('keeps a niche title verbatim (high recall, real role)', () => {
  assert.equal(deriveResumeJobQuery({ top_titles: ['Budtender'] }), 'budtender');
  assert.equal(deriveResumeJobQuery({ top_titles: ['Valet Attendant'] }), 'valet attendant');
});

test('falls back to the raw title when noise-stripping empties it', () => {
  // "Lead" is pure seniority noise → stripping leaves nothing → keep the raw token.
  assert.equal(deriveResumeJobQuery({ top_titles: ['Lead'] }), 'lead');
});

test('falls back to function → role when there is no usable title', () => {
  assert.equal(deriveResumeJobQuery({ top_titles: [], function: 'engineering' }), 'software engineer');
  assert.equal(deriveResumeJobQuery({ function: 'sales' }), 'sales representative');
  assert.equal(deriveResumeJobQuery({ top_titles: ['   '], function: 'data' }), 'data analyst');
});

test('falls back to the strongest skill when title and function are unusable', () => {
  assert.equal(deriveResumeJobQuery({ top_titles: [], function: 'other', skills: ['tableau', 'excel'] }), 'tableau');
});

test('returns empty string when nothing is searchable (caller skips the pull)', () => {
  assert.equal(deriveResumeJobQuery({}), '');
  assert.equal(deriveResumeJobQuery({ top_titles: ['123', '  '], function: 'other', skills: ['#', '5'] }), '');
  assert.equal(deriveResumeJobQuery(null), '');
});

test('sanitizes injection / filter-abusing characters and caps length', () => {
  const out = deriveResumeJobQuery({ top_titles: ['Nurse <script>|`\\ (RN)'] });
  assert.ok(!/[<>`\\|()]/.test(out), 'strips dangerous chars');
  assert.ok(out.includes('nurse'));
  const long = deriveResumeJobQuery({ top_titles: ['a'.repeat(200) + ' engineer'] });
  assert.ok(long.length <= 60, 'caps at 60 chars');
});

test('is deterministic and lowercased', () => {
  const s = { top_titles: ['Registered Nurse'] };
  assert.equal(deriveResumeJobQuery(s), deriveResumeJobQuery(s));
  assert.equal(deriveResumeJobQuery(s), 'registered nurse');
});

const NON_TECH = `Jordan Lee
jordan@example.com | 555-010-0000

EXPERIENCE
Valet Attendant — Towne Park | Oct 2022 – Jan 2025
• Safely parked and retrieved high volumes of vehicles for hotel guests.
• Provided front-line customer service in a fast-paced environment.

Membership Specialist — UFC Gym | 2021 – 2022
• Sold and renewed memberships through consultative conversations.

EDUCATION
High School Diploma — Great Oak High School`;

test('deriveResumeSignal: a non-tech résumé still yields its real titles → a searchable role', () => {
  const sig = deriveResumeSignal(NON_TECH);
  assert.ok(sig.top_titles.some((t) => /valet attendant/i.test(t)), JSON.stringify(sig.top_titles));
  assert.ok(Array.isArray(sig.skills));
  assert.equal(deriveResumeJobQuery(sig), 'valet attendant');
  const empty = deriveResumeSignal('');
  assert.deepEqual(empty.top_titles, []);
  assert.deepEqual(empty.skills, []);
  assert.equal(deriveResumeJobQuery(empty), '');
});

test('resumeSkillsStale: missing, signal-less, or older than the résumé on file', () => {
  assert.equal(resumeSkillsStale(null, '2026-10-19T00:00:00Z'), true);
  assert.equal(resumeSkillsStale({ skills: [], top_titles: [], updated_at: '2026-10-20T00:00:00Z' }, '2026-10-19T00:00:00Z'), true, 'no signal at all');
  assert.equal(resumeSkillsStale({ skills: [], top_titles: ['Valet Attendant'], updated_at: '2026-10-20T00:00:00Z' }, '2026-10-19T00:00:00Z'), false, 'titles alone are a signal');
  assert.equal(resumeSkillsStale({ skills: ['pos'], updated_at: '2026-01-01T00:00:00Z' }, '2026-10-19T00:00:00Z'), true, 'older than the résumé');
  assert.equal(resumeSkillsStale({ skills: ['pos'], updated_at: '2026-10-20T00:00:00Z' }, '2026-10-19T00:00:00Z'), false);
  assert.equal(resumeSkillsStale({ skills: ['pos'] }, null), false, 'no résumé timestamp → trust the row');
  assert.equal(resumeSkillsStale({ skills: ['pos'] }, '2026-10-19T00:00:00Z'), true, 'row without a timestamp is older than a dated résumé');
});

// ── The rail's match bar: same role FAMILY and near the person ───────────────────────────────
import { resumeRoleFamilies, jobMatchesResume, jobNearCity, resumeMatchStrength } from './resumeJobMatch.js';

test('resumeRoleFamilies: a GNC sales associate is retail (+ valet), not B2B sales', () => {
  const r = resumeRoleFamilies({ top_titles: ['Sales Associate', 'Membership Specialist', 'Valet Attendant'] });
  assert.ok(r.families.includes('retail'), JSON.stringify(r));
  assert.ok(r.families.includes('valet_parking'));
  assert.ok(!r.families.includes('sales'));
  assert.ok(r.phrases.includes('sales associate'));
});

test('jobMatchesResume: family or whole role phrase — never the bare word "sales"', () => {
  const r = resumeRoleFamilies({ top_titles: ['Sales Associate', 'Valet Attendant'] });
  assert.equal(jobMatchesResume({ title: 'Account Executive (Independent Hotel Sales)' }, r), false);
  assert.equal(jobMatchesResume({ title: 'Commercial Sales Manager' }, r), false);
  assert.equal(jobMatchesResume({ title: 'Retail Sales Associate - Mall' }, r), true);
  assert.equal(jobMatchesResume({ title: 'Cosmetics Cashier' }, r), true); // retail family
  assert.equal(jobMatchesResume({ title: 'Valet Parking Attendant' }, r), true);
  assert.ok(resumeMatchStrength({ title: 'Seasonal Sales Associate' }, r) > resumeMatchStrength({ title: 'Cosmetics Cashier' }, r), 'shared phrase ranks above family-only');
  const cashier = resumeRoleFamilies({ top_titles: ['Cashier', 'Crew Member'] });
  assert.equal(jobMatchesResume({ title: 'Cosmetics Cashier' }, cashier), true);
  assert.equal(jobMatchesResume({ title: 'Director of Retail Operations' }, cashier), false); // roleOntology: operations, not retail
  assert.equal(jobMatchesResume({ title: 'Software Engineer' }, cashier), false);
  assert.equal(jobMatchesResume({ title: 'Software Engineer' }, resumeRoleFamilies({ top_titles: [] })), false);
});

test('jobNearCity: coordinates within the radius, else the city named in the text; remote always', () => {
  const home = { city: 'Phoenix, AZ', center: { lat: 33.4484, lng: -112.074 }, miles: 30 };
  assert.equal(jobNearCity({ location: 'Glendale, Maricopa County', lat: 33.54, lng: -112.19 }, home), true);
  assert.equal(jobNearCity({ location: 'Austin, TX', lat: 30.27, lng: -97.74 }, home), false);
  assert.equal(jobNearCity({ location: 'Phoenix, AZ', lat: null, lng: null }, home), true);
  assert.equal(jobNearCity({ location: 'Dallas-Fort Worth Metroplex', lat: null, lng: null }, home), false);
  assert.equal(jobNearCity({ location: 'Remote', lat: null, lng: null }, home), true);
  assert.equal(jobNearCity({ location: 'Phoenix, AZ' }, { city: 'Phoenix, AZ', center: null }), true); // no geocode → text
  assert.equal(jobNearCity({ location: 'Phoenix, AZ' }, { city: '' }), false);
});

// ── The city a résumé states (the /jobs rail falls back to it when the profile has none) ────────
import { deriveResumeCity, cleanResumeCity } from './resumeJobMatch.js';
test('deriveResumeCity: the contact-block city, ZIP dropped; nothing for remote/foreign/absent', () => {
  const jordan = 'Jordan Avery\nPhoenix, AZ 85004 · (602) 555-0148 · jordan.avery.jobs@gmail.com · linkedin.com/in/jordanavery\n\nSUMMARY\nCustomer-focused retail professional.\n\nEXPERIENCE\nSales Associate — GNC | 2021 – Present\n• Sold supplements.';
  assert.equal(deriveResumeCity(jordan), 'Phoenix, AZ');
  assert.equal(deriveResumeCity('Sam Q\nTemecula, CA | sam@x.com\nEXPERIENCE\nValet — Towne Park | 2022 – 2025'), 'Temecula, CA');
  assert.equal(deriveResumeCity('Jordan Lee\njordan@example.com | 555-010-0000\n\nEXPERIENCE\nValet Attendant — Towne Park | 2022 – 2025'), '');
  assert.equal(deriveResumeCity('Sam Q\nRemote - US | sam@x.com\n\nEXPERIENCE\nEngineer — Acme | 2020 – 2024'), '');
  assert.equal(deriveResumeCity('Sam Q\nLondon, UK | sam@x.com\n\nEXPERIENCE\nEngineer — Acme | 2020 – 2024'), '');
  assert.equal(deriveResumeCity(''), '');
  assert.equal(cleanResumeCity('Phoenix, AZ 85004'), 'Phoenix, AZ');
  assert.equal(cleanResumeCity('Austin, Texas'), 'Austin, Texas');
  assert.equal(cleanResumeCity('Remote'), '');
  assert.equal(cleanResumeCity('Toronto, ON'), '');
});
