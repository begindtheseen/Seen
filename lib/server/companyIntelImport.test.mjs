import { test } from 'node:test';
import assert from 'node:assert/strict';
import { censorExcerpt, canonicalSourceUrl, normalizeIntelItem } from './companyIntelImport.js';

test('company-intel imports censor PII/profanity and have stable duplicate identities', () => {
  assert.equal(censorExcerpt('This is fucking bad. Call 555-555-1234 or a@b.com'), 'This is f•••••• bad. Call [phone removed] or [email removed]');
  assert.equal(canonicalSourceUrl('https://www.reddit.com/r/jobs/x?utm_source=x#comments'), 'https://www.reddit.com/r/jobs/x');
  const a = normalizeIntelItem({ company: 'Acme', source: 'Reddit', source_url: 'https://reddit.com/r/jobs/x?utm_source=x', excerpt: 'I interviewed and never heard back after the final round.', kind: 'applicant_outcome', outcome: 'ghosted' });
  const b = normalizeIntelItem({ company: 'Acme', source: 'Reddit', source_url: 'https://reddit.com/r/jobs/x', excerpt: 'I interviewed and never heard back after the final round.', kind: 'applicant_outcome', outcome: 'ghosted' });
  assert.equal(a.source_hash, b.source_hash);
  assert.equal(normalizeIntelItem({ company: 'Acme', source_url: 'https://x.test/a', excerpt: 'Great workplace culture and benefits.', kind: 'applicant_outcome' }), null);
});
