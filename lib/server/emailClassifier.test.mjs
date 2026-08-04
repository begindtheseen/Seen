import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmail, emailSignature } from './emailClassifier.js';

test('non-hiring email is ignored', () => {
  const r = classifyEmail({ from: 'newsletter@substack.com', subject: 'Your weekly digest', date: '2026-08-01' });
  assert.equal(r.isHiring, false);
  assert.equal(r.event, null);
});

test('Greenhouse rejection → high confidence, company from subject, terminal', () => {
  const r = classifyEmail({
    from: 'Acme Corp <no-reply@greenhouse-mail.io>',
    subject: 'Update on your application to Acme Corp',
    date: '2026-08-01', uid: 'u1',
  });
  assert.equal(r.isHiring, true);
  assert.equal(r.ats, true);
  assert.equal(r.event, 'response_received'); // "update on your application" = generic response
  // Now a clearly-rejection subject:
  const rej = classifyEmail({ from: 'Acme Corp <no-reply@greenhouse-mail.io>', subject: 'Your application to Acme Corp — unfortunately', date: '2026-08-01' });
  assert.equal(rej.event, 'rejected');
  assert.equal(rej.outcome, 'rejected');
  assert.equal(rej.terminal, true);
  assert.equal(rej.company, 'Acme Corp');
  assert.equal(rej.confidence, 'high'); // ATS sender + outcome + company
});

test('Lever interview invite → interview_received, non-terminal', () => {
  const r = classifyEmail({
    from: 'Stripe <no-reply@hire.lever.co>',
    subject: 'We would like to invite you to interview with Stripe',
    date: '2026-08-02',
  });
  assert.equal(r.event, 'interview_received');
  assert.equal(r.terminal, false);
  assert.equal(r.company, 'Stripe');
  assert.equal(r.confidence, 'high');
});

test('offer wins over interview wording; docusign infers offer', () => {
  const both = classifyEmail({ from: 'jobs@ashbyhq.com', subject: 'Following your interview — we are pleased to offer you the role', date: '2026-08-03' });
  assert.equal(both.event, 'offer_received');
  const sign = classifyEmail({ from: 'no-reply@docusign.net', subject: 'Please sign: employment agreement', date: '2026-08-03' });
  assert.equal(sign.event, 'offer_received');
  assert.equal(sign.confidence, 'medium'); // signing platform, no company/keyword
});

test('rejection beats interview when both appear', () => {
  const r = classifyEmail({ from: 'careers@bigco.com', subject: 'Thank you for interviewing — unfortunately we are moving forward with other candidates', date: '2026-08-04' });
  assert.equal(r.event, 'rejected');
});

test('company-domain recruiting mailbox → company from domain', () => {
  const r = classifyEmail({ from: 'careers@stripe.com', subject: 'Application received', date: '2026-08-01' });
  assert.equal(r.isHiring, true);
  assert.equal(r.event, 'application_submitted');
  assert.equal(r.company, 'Stripe');
  assert.equal(r.confidence, 'high'); // recruiting mailbox + applied keyword + company
});

test('assessment detection', () => {
  const r = classifyEmail({ from: 'no-reply@greenhouse.io', subject: 'Next step: your take-home coding challenge for DataCo', date: '2026-08-05' });
  assert.equal(r.event, 'assessment_received');
  assert.equal(r.company, 'DataCo');
});

test('generic keyword email with no ATS sender → medium/low, still captured', () => {
  const r = classifyEmail({ from: 'hi@somestartup.xyz', subject: 'Thanks for applying to SomeStartup!', date: '2026-08-01' });
  assert.equal(r.isHiring, true);
  assert.equal(r.event, 'application_submitted');
  assert.ok(['medium', 'high'].includes(r.confidence));
});

test('signature is stable per (uid, domain, subject, day) and message-independent of case/space', () => {
  const a = emailSignature({ uid: 'u1', from: 'X <no-reply@greenhouse.io>', subject: 'Your Application  To Acme', date: '2026-08-01T09:00:00Z' });
  const b = emailSignature({ uid: 'u1', from: 'no-reply@greenhouse.io', subject: 'your application to acme', date: '2026-08-01T23:00:00Z' });
  assert.equal(a, b);
  const other = emailSignature({ uid: 'u2', from: 'no-reply@greenhouse.io', subject: 'your application to acme', date: '2026-08-01' });
  assert.notEqual(a, other);
});

test('malformed / empty input never throws', () => {
  assert.equal(classifyEmail({}).isHiring, false);
  assert.equal(classifyEmail({ from: 'garbage', subject: null }).isHiring, false);
  assert.doesNotThrow(() => classifyEmail(null ?? {}));
});
