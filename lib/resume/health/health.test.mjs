// Tests: per-bullet analysis + the résumé health score.
// Run: node --test lib/resume/health/health.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeBullet, findMetrics } from './bullet.js';
import { scoreResume, WEIGHTS } from './score.js';
import { parseResume } from '../parse/index.js';
import { normalizeDoc } from '../model.js';

const txt = (name) => fs.readFileSync(new URL(`../fixtures/text/${name}`, import.meta.url), 'utf8');

test('metrics: money, percent, counts, multipliers, hyphenated units — never years, versions or levels', () => {
  assert.deepEqual(findMetrics('Reduced p95 latency by 38% by moving to edge caching.'), ['38%']);
  assert.deepEqual(findMetrics('Led a team of 5 engineers to ship a platform used by 40,000 users.'), ['5 engineers', '40,000']);
  assert.deepEqual(findMetrics('Manage a 12-person support desk'), ['12-person']);
  assert.deepEqual(findMetrics('Selected as one of 230 participants nationwide'), ['230 participants']);
  assert.deepEqual(findMetrics('Grew revenue 3x to $1.2M'), ['3x', '$1.2M']);
  assert.deepEqual(findMetrics('Worked on the Python 3 migration for Level 2 support in 2023'), []);
  assert.deepEqual(findMetrics('Completed 8,000 on-the-job hours toward licensure.'), ['8,000']);
});

test('bullet analysis: lead kinds, tense, pronouns, passive, buzzwords, fillers, length', () => {
  const strong = analyzeBullet('Led a team of 5 engineers to ship a React platform used by 40,000 users.', { roleTense: 'past' });
  assert.equal(strong.lead.kind, 'strong'); assert.equal(strong.lead.category, 'leadership'); assert.equal(strong.lead.tense, 'past');
  assert.equal(strong.issues.length, 0); assert.ok(strong.impact >= 0.95);
  const weak = analyzeBullet('Responsible for managing a team of 5 cashiers', { roleTense: 'past' });
  assert.equal(weak.lead.kind, 'weak'); assert.ok(weak.issues.some((i) => i.code === 'weak_lead'));
  const pron = analyzeBullet('I was responsible for the implementation of SSO', { roleTense: 'past' });
  assert.ok(pron.issues.some((i) => i.code === 'pronoun'));
  const pass = analyzeBullet('Weekly reports were generated for leadership', { roleTense: 'past' });
  assert.ok(pass.passive.length === 1 && pass.issues.some((i) => i.code === 'passive'));
  const recog = analyzeBullet('Selected as one of 230 participants nationwide', { roleTense: 'past' });
  assert.equal(recog.lead.kind, 'recognition'); assert.equal(recog.passive.length, 0);
  const buzz = analyzeBullet('Team player with a proven track record', { roleTense: 'past' });
  assert.ok(buzz.buzzwords.includes('team player') && buzz.buzzwords.includes('proven track record'));
  const fill = analyzeBullet('Successfully utilized various tools in order to improve reporting', { roleTense: 'past' });
  assert.ok(fill.fillers.includes('in order to') && fill.vague.includes('various') && fill.lead.adverb === 'Successfully');
  const tense = analyzeBullet('Manage a 12-person support desk', { roleTense: 'past' });
  assert.ok(tense.issues.some((i) => i.code === 'tense'));
  const long = analyzeBullet('word '.repeat(34).trim(), { roleTense: null });
  assert.equal(long.length, 'long');
});

test('score: a strong résumé grades A, a weak one grades lower, weights sum to 100', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
  const strong = scoreResume(parseResume({ text: txt('company_first_stacked.txt') }), { now: '2026-10-19' });
  assert.ok(strong.score >= 85, `strong fixture scored ${strong.score}`); assert.equal(strong.grade, 'A');
  const weak = scoreResume(parseResume({ text: txt('john_doe_legacy.txt') }), { now: '2026-10-19' });
  assert.ok(weak.score < strong.score);
  assert.ok(weak.dimensions.impact.score < 60, 'weak leads and few metrics pull impact down');
  assert.ok(weak.findings.some((f) => f.code === 'weak_lead' && f.fix && f.fix.kind === 'rewrite' && /^Owned|^Managed|^Built|^Drove/.test(f.fix.text) === false), 'weak-lead findings carry a rewrite fix');
  assert.ok(weak.findings.some((f) => f.code === 'no_email'));
});

test('findings anchor to real bullet/item ids and the top fixes are deduplicated per bullet', () => {
  const doc = parseResume({ text: txt('brandon_shape.txt') });
  const h = scoreResume(doc, { now: '2026-10-19' });
  const ids = new Set([...doc.experience.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)])]);
  for (const f of h.findings) {
    if (f.anchor && f.anchor.bulletId) assert.ok(ids.has(f.anchor.bulletId), `unknown bullet id on ${f.code}`);
    if (f.anchor && f.anchor.itemId) assert.ok(ids.has(f.anchor.itemId), `unknown item id on ${f.code}`);
  }
  const keys = h.topFixes.map((f) => f.anchor.bulletId || f.anchor.itemId || f.code);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(h.findings.some((f) => f.code === 'role_no_dates'));
  assert.ok(h.findings.some((f) => f.code === 'no_skills'));
});

test('timeline: gaps, overlaps, multiple presents, end-before-start, future dates', () => {
  const doc = normalizeDoc({
    basics: { name: 'T', email: 't@x.com', phone: '555-010-0100' },
    experience: [
      { title: 'A', company: 'Now', start: '2024-01', end: 'present', bullets: ['Led 3 teams to ship 4 releases.'] },
      { title: 'B', company: 'Also Now', start: '2023-06', end: 'present', bullets: ['Built 2 apps.'] },
      { title: 'C', company: 'Gap Co', start: '2021-01', end: '2022-03', bullets: ['Cut costs 10%.'] },
      { title: 'D', company: 'Bad Dates', start: '2020-05', end: '2019-01', bullets: ['Won 1 award.'] },
    ],
    education: [{ degree: 'B.S.', school: 'U' }], skills: [{ items: ['x'] }],
  });
  const h = scoreResume(doc, { now: '2026-10-19' });
  const codes = h.findings.map((f) => f.code);
  assert.ok(codes.includes('gap'), 'gap between 2022-03 and 2023-06');
  assert.ok(codes.includes('multiple_present'));
  assert.ok(codes.includes('end_before_start'));
  assert.ok(h.dimensions.timeline.score <= 70, `timeline ${h.dimensions.timeline.score}`);
  const future = scoreResume(normalizeDoc({ experience: [{ title: 'X', company: 'Y', start: '2025-01', end: '2031-01', bullets: ['Led 2 teams.'] }] }), { now: '2026-10-19' });
  assert.ok(future.findings.some((f) => f.code === 'future_date'));
});

test('language: mixed tense in the current role and repeated lead verbs are flagged', () => {
  const doc = normalizeDoc({
    basics: { name: 'T', email: 't@x.com', phone: '555-010-0100' },
    experience: [{ title: 'A', company: 'Now', start: '2024-01', end: 'present', bullets: ['Led 3 teams.', 'Run weekly syncs.', 'Managed 2 vendors.', 'Managed 3 budgets.', 'Managed 4 projects.'] }],
    education: [{ degree: 'B.S.', school: 'U' }], skills: [{ items: ['x'] }],
  });
  const h = scoreResume(doc, { now: '2026-10-19' });
  assert.ok(h.findings.some((f) => f.code === 'tense_mixed'));
  assert.ok(h.findings.some((f) => f.code === 'verb_repeat' && /manage/.test(f.message)));
});

test('determinism: the same document scores identically', () => {
  const doc = parseResume({ text: txt('projects_and_certs.txt') });
  assert.deepEqual(scoreResume(doc, { now: '2026-10-19' }), scoreResume(doc, { now: '2026-10-19' }));
});
