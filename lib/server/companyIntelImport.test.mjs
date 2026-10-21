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

test('one identity per Reddit post or comment, whatever link form a collector saw', async () => {
  const { redditPermalinkKey } = await import('./companyIntelImport.js');
  const post = 'https://www.reddit.com/r/Quantinuum/comments/1x426rz/';
  assert.equal(canonicalSourceUrl('https://www.reddit.com/r/Quantinuum/comments/1x426rz/interview_prep/'), post);
  assert.equal(canonicalSourceUrl('https://old.reddit.com/r/Quantinuum/comments/1x426rz/interview_prep/?utm_source=share'), post);
  assert.equal(canonicalSourceUrl(post), post);
  assert.equal(canonicalSourceUrl('https://www.reddit.com/r/starbucks/comments/1wq7mv8/pc2miz8/'), 'https://www.reddit.com/r/starbucks/comments/1wq7mv8/pc2miz8/');
  assert.equal(canonicalSourceUrl('https://www.reddit.com/r/starbucks/comments/1wq7mv8/i_got_offered/pc2miz8/'), 'https://www.reddit.com/r/starbucks/comments/1wq7mv8/pc2miz8/');
  assert.equal(redditPermalinkKey('https://www.reddit.com/r/x/comments/abc/help/').key, 'abc', 'a one-word slug is not a comment');
  assert.equal(redditPermalinkKey('https://example.com/r/x/comments/abc/'), null);
  assert.equal(normalizeIntelItem({ company: 'Q', source: 'Reddit r/r/Quantinuum', source_url: post, excerpt: 'I have an interview next week with them.', kind: 'applicant_outcome', outcome: 'interview' }).source, 'Reddit r/Quantinuum');
});
