// "What people are saying" counts toward company scores (owner rule 2026-10-18):
// 1 online mention = 0.5 of an applicant report, in the rates and toward the 5 needed for a grade.
// Run: node --test api/_utils/mentions.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMention, mentionOutcomes, mentionTotal, fuseCompanyIntel, SOURCE_TRUST } from './companyIntel.js';
import { isGradeable, gradeEvidenceCount, MENTION_WEIGHT } from '../../lib/server/reportCounts.js';

test('a mention weighs exactly half of an applicant report', () => {
  assert.equal(MENTION_WEIGHT, 0.5);
  assert.equal(SOURCE_TRUST.mentions, SOURCE_TRUST.direct / 2);
});

test('classifyMention reads the outcome; ghosting wins when an account says both', () => {
  assert.equal(classifyMention('They make you go through so many interviews just to ghost you for 3 weeks'), 'ghosted');
  assert.equal(classifyMention('No response for 2 weeks after my interview'), 'ghosted');
  assert.equal(classifyMention('Easy interview process; under 30 minutes'), 'responded');
  assert.equal(classifyMention("now I just get a 'thank you for your interest' email the next day"), 'autoreject');
  assert.equal(classifyMention('Process was definitely slow but everyone was very nice'), null);
  assert.equal(classifyMention(''), null);
});

test('Starbucks: 2 reports + 6 online mentions = 5 → graded (the owner\'s example)', () => {
  const web = [
    { text: 'Process was definitely slow but everyone was very nice and friendly.' },
    { text: 'Easy interview process; under 30 minutes.' },
    { text: 'They make you go through so many interviews just to ghost you for 3 weeks.' },
    { text: "I just get a 'thank you for your interest' email the next day." },
    { text: 'The interview went extremely smooth.' },
    { text: 'I had to send multiple emails to HR for updates.' },
  ];
  assert.equal(mentionTotal(web), 6);            // every account counts toward the bar
  assert.equal(mentionOutcomes(web).length, 4);  // only stated outcomes move the rates
  const row = { first_party_report_count: 2, mention_count: mentionTotal(web) };
  assert.equal(gradeEvidenceCount(row), 5);
  assert.equal(isGradeable(row), true);
});

test('the bar: halves add up, and mentions never grade a company on their own', () => {
  assert.equal(isGradeable({ first_party_report_count: 2, mention_count: 5 }), false); // 4.5
  assert.equal(isGradeable({ first_party_report_count: 3, mention_count: 4 }), true);  // 5
  assert.equal(isGradeable({ first_party_report_count: 0, mention_count: 20 }), false); // needs ≥1 real report
  assert.equal(isGradeable({ first_party_report_count: 5 }), true);                    // unchanged without mentions
});

test('fusion: mentions move the rates at half weight but are not counted as reports', () => {
  const reportsOnly = fuseCompanyIntel({ sources: [{ type: 'direct', outcomes: [{ outcome: 'hired' }, { outcome: 'hired' }] }] });
  const withMentions = fuseCompanyIntel({ sources: [
    { type: 'direct', outcomes: [{ outcome: 'hired' }, { outcome: 'hired' }] },
    { type: 'mentions', outcomes: [{ outcome: 'ghosted' }, { outcome: 'ghosted' }] },
  ] });
  assert.equal(withMentions.first_party_report_count, 2);
  assert.equal(withMentions.mention_count, 2);
  // 2 hired at 1.0 vs 2 ghosted at 0.5 → empirical ghost rate 1/3.
  assert.equal(withMentions.empirical.ghost_rate, 0.3);
  assert.ok(withMentions.ghost_rate > reportsOnly.ghost_rate);
});
