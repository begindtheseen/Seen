import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalizeLocalIndeedJob } = await import('./ingest-local-indeed.js');

test('local Indeed ingress only accepts complete listings from indeed.com', () => {
  const job = normalizeLocalIndeedJob({
    title: 'Software Engineer', company: 'Acme', location: 'Remote',
    description: 'Build reliable systems for customers and collaborate across the engineering organization. '.repeat(3),
    url: 'https://www.indeed.com/viewjob?jk=0123456789abcdef', job_type: 'fulltime',
  });
  assert.equal(job?.source, 'Indeed (local OpenCLI)');
  assert.equal(job?.company, 'Acme');
  assert.equal(normalizeLocalIndeedJob({
    title: 'Software Engineer', company: 'Acme',
    description: 'Build reliable systems for customers and collaborate across the engineering organization. '.repeat(3),
    url: 'https://example.com/job',
  }), null);
});
