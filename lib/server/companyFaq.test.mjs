import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanyFaq } from './companyFaq.js';

test('no score → empty (no FAQ, no schema)', () => {
  assert.deepEqual(buildCompanyFaq(null), []);
  assert.deepEqual(buildCompanyFaq({ name: 'Acme', overallScore: null }), []);
  assert.deepEqual(buildCompanyFaq({ name: '', overallScore: 70 }), []);
});

test('with first-party reports: full Q&A set, real numbers', () => {
  const faq = buildCompanyFaq({ name: 'Acme', overallScore: 42, ghostRate: 0.66, responseRate: 0.3, avgWaitDays: 12, reportCount: 40 });
  assert.equal(faq.length, 4);
  const ghost = faq.find(f => f.question === 'Does Acme ghost applicants?');
  assert.match(ghost.answer, /66% ghost rate/);
  assert.match(ghost.answer, /40 applicant reports/);
  assert.match(ghost.answer, /Most applicants report never hearing back\./);
  assert.match(faq.find(f => /respond to/.test(f.question)).answer, /30% response rate/);
  assert.match(faq.find(f => /How long/.test(f.question)).answer, /12 days/);
  assert.match(faq.find(f => /transparent/.test(f.question)).answer, /42\/100/);
});

test('honesty: NO percentages without first-party reports — only the grade Q&A', () => {
  const faq = buildCompanyFaq({ name: 'Globex', overallScore: 55, ghostRate: 0.5, responseRate: 0.5, avgWaitDays: 9, reportCount: 0 });
  assert.equal(faq.length, 1); // grade only
  assert.match(faq[0].answer, /55\/100/);
  assert.match(faq[0].answer, /aggregated hiring data/); // basis, not a fabricated count
  assert.ok(!faq.some(f => /%/.test(f.answer)), 'no percentage rendered without reports');
});

test('singular report + wait day phrasing', () => {
  const faq = buildCompanyFaq({ name: 'Solo', overallScore: 70, ghostRate: 0.1, responseRate: null, avgWaitDays: 1, reportCount: 1 });
  assert.match(faq.find(f => /ghost/.test(f.question)).answer, /1 applicant report\b/);
  assert.match(faq.find(f => /How long/.test(f.question)).answer, /1 day\b/);
  // response-rate Q omitted when responseRate is null, even with reports
  assert.ok(!faq.some(f => /percentage of applicants/.test(f.question)));
});
