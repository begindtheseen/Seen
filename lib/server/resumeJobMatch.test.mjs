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
