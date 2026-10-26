// HumanProof integrity — regression tests from Dev's 2026-10-25 Pro run (lib/fixtures/personas).
//
// The request's text WAS his résumé (text === resumeText), and HumanProof returned "Reconciliation
// breaks 9%" (92%), "B/year" ($1.2B/year), "Platency ms ms" (p99 latency 180ms to 70ms), "Jun 020",
// "() -" (the phone number), "00+ stores", "SOC Type II", "SUMMARY." — and flagged every number as
// unsupported_metric, under a "no invented numbers" badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runHumanProof } from './index.js';
import { stripUnsupportedClaims, humanizeBullet } from './humanizeBullet.js';
import { numbersIn, numbersIntact } from './protect.js';
import { mergeRules } from './phraseRisk.js';
import { buildHumanProofPackage } from '../server/humanizePackage.js';

const DEV = readFileSync(new URL('../fixtures/personas/dev.txt', import.meta.url), 'utf8');
const TASHA = readFileSync(new URL('../fixtures/personas/tasha.txt', import.meta.url), 'utf8');
const RULES = mergeRules(null);

test('Dev: his own résumé through HumanProof keeps every number, date, phone and heading exactly', () => {
  const out = runHumanProof({ text: DEV, mode: 'resume', resumeText: DEV, jobTitle: 'Senior Backend Engineer (Golang)' });
  assert.deepEqual(numbersIn(out.humanized_text), numbersIn(DEV), 'the same numbers, in the same order');
  for (const s of ['92%', '$1.2B/year', 'p99 latency 180ms to 70ms', 'Mar 2022', 'Jun 2020', 'Jul 2018', '(512) 555-0187', '300+ stores', 'SOC 2 Type II', '40+ interviews', '1-in-5', 'Sev-2']) {
    assert.ok(out.humanized_text.includes(s), `kept "${s}"`);
  }
  assert.ok(!/^(SUMMARY|EXPERIENCE|SKILLS|EDUCATION)\.$/m.test(out.humanized_text), 'no heading gets a period');
  assert.ok(out.humanized_text.includes('\nlinkedin.com/in/devpatel-eng\n'), 'contact line untouched (not "Linkedin.com…")');
  assert.ok(out.humanized_text.startsWith('Dev Patel\n'), 'name line untouched (no period)');
  assert.equal(out.flags.filter((f) => f.flagType === 'unsupported_metric').length, 0, 'none of his own numbers is "unsupported"');
  assert.equal(out.confirm_before_using.length, 0);
  assert.equal(out.integrity.numbers_preserved, true);
  assert.equal(out.integrity.grounded, true);
  // Only bullets and the summary are offered as "safe bullets" — never the name or a heading.
  assert.ok(out.safe_bullets.every((b) => !/^(Dev Patel|SUMMARY|EXPERIENCE)\.?$/.test(b.text)));
});

test('a rewritten bullet keeps its numbers exactly and a wrapped bullet is one bullet', () => {
  const resume = [
    'Jordan Avery', 'jordan@example.com | (602) 555-0100', 'EXPERIENCE',
    'Shift Lead — Target, Phoenix, AZ Mar 2021 – Present',
    '• Leveraged strong communication skills in a fast-paced environment to cut wait times 22% across',
    'Drive Up orders.',
    'SKILLS', 'Leadership, POS',
  ].join('\n');
  const out = runHumanProof({ text: resume, mode: 'resume', resumeText: resume });
  assert.ok(!/leveraged/i.test(out.humanized_text), 'the buzzword was rewritten');
  assert.ok(out.humanized_text.includes('22%'), 'its number kept');
  assert.ok(out.humanized_text.includes('Mar 2021 – Present'), 'the date line kept');
  assert.deepEqual(numbersIn(out.humanized_text), numbersIn(resume));
  const bullet = out.humanized_text.split('\n').find((l) => l.startsWith('• '));
  assert.ok(/Drive Up orders\.$/.test(bullet), `the wrapped tail joined its bullet: ${bullet}`);
  assert.ok(out.humanized_text.endsWith('SKILLS\nLeadership, POS'), 'skills untouched');
});

test('the stripper never cuts digits out of a longer number, a date or a phone number', () => {
  const text = 'Cut reconciliation breaks 92% from Mar 2022; call (512) 555-0187; 300+ stores.';
  for (const metric of ['2', '1', '0', '5', '00', '3']) {
    const r = stripUnsupportedClaims(text, { metrics: [metric], tools: [] });
    assert.equal(r.text, text, `"${metric}" is not a separate number here`);
  }
  // A standalone unsupported number is removed as a whole token and nothing else changes.
  const r = stripUnsupportedClaims('Served 9999 guests in Mar 2022 with 92% satisfaction.', { metrics: ['9999'], tools: [] });
  assert.equal(r.text, 'Served guests in Mar 2022 with 92% satisfaction.');
});

test('an edit that would lose a number is thrown away (integrity guard)', () => {
  // A hostile rule that would delete a span containing digits never applies inside a number.
  const rules = [...RULES, { phrase: '92', category: 'buzzword', severity: 'high', replacementHint: null }];
  const r = humanizeBullet('Cut reconciliation breaks 92% in 2024.', { rules });
  assert.equal(r.text, 'Cut reconciliation breaks 92% in 2024.');
  assert.equal(r.changed, false);
  assert.equal(numbersIntact('a 92% b', 'a 9% b'), false);
});

test('an unchanged line is returned byte-for-byte (no added period, no re-capitalization)', () => {
  const line = 'linkedin.com/in/devpatel-eng';
  const r = humanizeBullet(line, { rules: RULES });
  assert.equal(r.text, line);
  assert.equal(r.changed, false);
});

test('package mode (the /resume HumanProof tab): optimized bullets keep their résumé numbers', () => {
  const bullets = [
    'Grew Instagram followers from 2,100 to 3,400 in 7 months; best Reel reached 48,000 views.',
    'Designed event flyers and fundraiser graphics in Canva; wrote captions and the monthly email newsletter (1,800 subscribers).',
  ];
  const out = buildHumanProofPackage({ bullets, resumeText: TASHA, jobTitle: 'Social Media Specialist' }, {});
  out.package.bullets.forEach((b, i) => {
    assert.deepEqual(numbersIn(b.humanized_text), numbersIn(bullets[i]));
    assert.equal(b.confirm_before_using.length, 0);
  });
  assert.equal(out.integrity.grounded, true);
});

test('Maria (job page "Humanize this application"): zip, phone, years, ranges and decimals survive', () => {
  const MARIA = readFileSync(new URL('../fixtures/personas/maria.txt', import.meta.url), 'utf8');
  const out = runHumanProof({ text: MARIA, mode: 'resume', resumeText: MARIA, jobTitle: 'Assistant Store Leader' });
  assert.deepEqual(numbersIn(out.humanized_text), numbersIn(MARIA));
  for (const s of ['95%', '35%', '14–18', '200+ transactions', 'Diploma, 2010', '85033', '(602) 555-0147', '4.6/5', '(2014–2016)']) {
    assert.ok(out.humanized_text.includes(s), `kept "${s}"`);
  }
  const notBacked = out.flags.filter((f) => /unsupported/.test(f.flagType)).map((f) => f.originalPhrase);
  assert.deepEqual(notBacked, [], 'nothing on her own résumé is "not backed" (not even "lead" — she is a Team Lead)');
  const grounding = out.explanation.contributions.find((c) => c.factor === 'evidence_grounding');
  assert.ok(grounding.raw >= 0.6, `evidence grounding reads her résumé as grounded (${grounding.raw})`);
  assert.equal(out.integrity.grounded, true);
});

test('a number the résumé does not have is surfaced, and the badge claim is withheld', () => {
  const out = runHumanProof({ text: 'Grew followers 250% using Canva.', mode: 'resume', resumeText: TASHA });
  assert.ok(out.confirm_before_using.some((c) => /250/.test(c.placeholder)));
  assert.ok(!/250/.test(out.humanized_text));
  assert.equal(out.integrity.grounded, false, 'the "grounded" badge must not show');
});
