import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClaimCompany,
  isValidClaimCompany,
  resolveEmployerCompany,
  selectActiveClaim,
  canRequestClaim,
  effectiveSurfaceCompany,
  emailDomain,
  emailDomainMatchesCompany,
} from './employerClaims.js';

test('normalizeClaimCompany canonicalizes like company_scores (lower/trim/collapse ws)', () => {
  assert.equal(normalizeClaimCompany('  Acme   Corp '), 'acme corp');
  assert.equal(normalizeClaimCompany('AMAZON'), 'amazon');
  assert.equal(normalizeClaimCompany('Acme corp'), 'acme corp'); // same target as messy spelling
  assert.equal(normalizeClaimCompany(''), '');
  assert.equal(normalizeClaimCompany(null), '');
  assert.equal(normalizeClaimCompany(undefined), '');
});

test('isValidClaimCompany blocks empty/junk, accepts real names', () => {
  assert.ok(isValidClaimCompany('Amazon'));
  assert.ok(isValidClaimCompany('3M'));
  assert.ok(isValidClaimCompany('a1'));
  assert.equal(isValidClaimCompany(''), false);
  assert.equal(isValidClaimCompany(' '), false);
  assert.equal(isValidClaimCompany('x'), false);        // too short
  assert.equal(isValidClaimCompany('   -- '), false);   // punctuation only
  assert.equal(isValidClaimCompany('a'.repeat(121)), false); // too long
  assert.equal(isValidClaimCompany(null), false);
});

test('resolveEmployerCompany returns the approved display name, else null', () => {
  assert.equal(resolveEmployerCompany([]), null);
  assert.equal(resolveEmployerCompany(undefined), null);
  // Only pending → not scoped yet.
  assert.equal(resolveEmployerCompany([{ status: 'pending', company_name: 'amazon' }]), null);
  // Approved → display name preferred over canonical.
  assert.equal(
    resolveEmployerCompany([{ status: 'approved', company_name: 'amazon', company_display_name: 'Amazon' }]),
    'Amazon',
  );
  // Approved with no display name → canonical.
  assert.equal(
    resolveEmployerCompany([{ status: 'approved', company_name: 'acme corp' }]),
    'acme corp',
  );
  // Rejected never grants scope.
  assert.equal(resolveEmployerCompany([{ status: 'rejected', company_name: 'amazon' }]), null);
});

test('resolveEmployerCompany: newest approved wins if somehow two exist', () => {
  const company = resolveEmployerCompany([
    { status: 'approved', company_name: 'old co', company_display_name: 'Old Co', created_at: '2026-01-01T00:00:00Z' },
    { status: 'approved', company_name: 'new co', company_display_name: 'New Co', created_at: '2026-06-01T00:00:00Z' },
  ]);
  assert.equal(company, 'New Co');
});

test('selectActiveClaim prioritizes approved > pending > rejected, newest within', () => {
  assert.equal(selectActiveClaim([]), null);
  const approved = selectActiveClaim([
    { status: 'rejected', company_name: 'r', created_at: '2026-05-01T00:00:00Z' },
    { status: 'pending', company_name: 'p', created_at: '2026-05-02T00:00:00Z' },
    { status: 'approved', company_name: 'a', created_at: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(approved.status, 'approved');

  const pending = selectActiveClaim([
    { status: 'rejected', company_name: 'r', created_at: '2026-05-01T00:00:00Z' },
    { status: 'pending', company_name: 'p1', created_at: '2026-02-01T00:00:00Z' },
    { status: 'pending', company_name: 'p2', created_at: '2026-04-01T00:00:00Z' },
  ]);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.company_name, 'p2'); // newest pending
});

test('canRequestClaim: fresh employer with no claims can request', () => {
  const r = canRequestClaim([], 'Amazon');
  assert.equal(r.ok, true);
  assert.equal(r.company, 'amazon'); // returns the canonical key
});

test('canRequestClaim: invalid name is refused', () => {
  const r = canRequestClaim([], '  ');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
});

test('canRequestClaim: duplicate pending / already approved for same company refused', () => {
  const pending = canRequestClaim([{ status: 'pending', company_name: 'amazon' }], 'AMAZON');
  assert.equal(pending.ok, false);
  assert.equal(pending.reason, 'already_pending');

  const approved = canRequestClaim([{ status: 'approved', company_name: 'amazon' }], 'amazon');
  assert.equal(approved.ok, false);
  assert.equal(approved.reason, 'already_approved');
});

test('canRequestClaim: one approved company per employer (different company refused)', () => {
  const r = canRequestClaim([{ status: 'approved', company_name: 'amazon' }], 'Google');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'has_other_company');
});

test('canRequestClaim: a rejected claim does not block re-requesting', () => {
  const r = canRequestClaim([{ status: 'rejected', company_name: 'amazon' }], 'Amazon');
  assert.equal(r.ok, true);
  assert.equal(r.company, 'amazon');
});

test('effectiveSurfaceCompany: approved employer scopes to their company, param ignored', () => {
  const r = effectiveSurfaceCompany({ isEmployer: true, employerCompany: 'Amazon', paramCompany: 'Google', godview: false });
  assert.equal(r.company, 'Amazon');
  assert.equal(r.scoped, true);
  assert.equal(r.source, 'claim');
});

test('effectiveSurfaceCompany: visitor / logged-out uses the param', () => {
  const r = effectiveSurfaceCompany({ isEmployer: false, employerCompany: null, paramCompany: 'Google', godview: false });
  assert.equal(r.company, 'Google');
  assert.equal(r.scoped, false);
  assert.equal(r.source, 'param');
});

test('effectiveSurfaceCompany: god-view always honors the param (even for an approved employer)', () => {
  const r = effectiveSurfaceCompany({ isEmployer: true, employerCompany: 'Amazon', paramCompany: 'Google', godview: true });
  assert.equal(r.company, 'Google');
  assert.equal(r.scoped, false);
  assert.equal(r.source, 'godview');
});

test('effectiveSurfaceCompany: employer without an approved company falls back to the param', () => {
  const r = effectiveSurfaceCompany({ isEmployer: true, employerCompany: null, paramCompany: 'Netflix', godview: false });
  assert.equal(r.company, 'Netflix');
  assert.equal(r.scoped, false);
  assert.equal(r.source, 'param');
});

test('emailDomain extracts the lowercased domain, else empty', () => {
  assert.equal(emailDomain('HR@Acme.com'), 'acme.com');
  assert.equal(emailDomain('  brandon@ACME.CO.UK '), 'acme.co.uk');
  assert.equal(emailDomain('not-an-email'), '');
  assert.equal(emailDomain('a@b@c'), '');
  assert.equal(emailDomain(''), '');
  assert.equal(emailDomain(null), '');
});

test('emailDomainMatchesCompany: work-email domain matches the company → true', () => {
  assert.equal(emailDomainMatchesCompany('brandon@acme.com', 'Acme'), true);
  assert.equal(emailDomainMatchesCompany('hr@acme.com', 'Acme Inc'), true);           // legal suffix dropped
  assert.equal(emailDomainMatchesCompany('a@acmecorp.com', 'Acme Corp'), true);        // joined-name match
  assert.equal(emailDomainMatchesCompany('a@acme.co.uk', 'Acme'), true);               // country TLD stripped
  assert.equal(emailDomainMatchesCompany('recruiter@stripe.com', 'Stripe'), true);
  assert.equal(emailDomainMatchesCompany('x@coca-cola.com', 'Coca Cola'), true);       // punctuation-insensitive
  assert.equal(emailDomainMatchesCompany('p@mycompany.onmicrosoft.com', 'MyCompany'), true);
});

test('emailDomainMatchesCompany: free/personal email is never a match', () => {
  for (const d of ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'proton.me', 'hotmail.com']) {
    assert.equal(emailDomainMatchesCompany(`someone@${d}`, 'Acme'), false, d);
  }
});

test('emailDomainMatchesCompany: a mismatched domain falls through to manual (false)', () => {
  assert.equal(emailDomainMatchesCompany('spy@totallyunrelated.com', 'Acme'), false);
  assert.equal(emailDomainMatchesCompany('a@facebook.com', 'Netflix'), false);
  assert.equal(emailDomainMatchesCompany('', 'Acme'), false);
  assert.equal(emailDomainMatchesCompany('a@acme.com', ''), false);
  assert.equal(emailDomainMatchesCompany('a@acme.com', '   '), false);
  // A generic 2-letter token must not create a spurious match.
  assert.equal(emailDomainMatchesCompany('a@it.com', 'IT Department'), false);
});
