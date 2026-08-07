// Tests: résumé → job-search query derivation (the pure half of the résumé→jobs floor).
// Run: node --test lib/server/resumeJobMatch.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveResumeJobQuery } from './resumeJobMatch.js';

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
