import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalizeLocalIndeedJob, classifyWorkArrangement, indeedUrl } = await import('./ingest-local-indeed.js');

test('local Indeed ingress only accepts complete listings from indeed.com', () => {
  const job = normalizeLocalIndeedJob({
    title: 'Software Engineer', company: 'Acme', location: 'Remote',
    description: 'Build reliable systems for customers and collaborate across the engineering organization. '.repeat(3),
    url: 'https://www.indeed.com/viewjob?jk=0123456789abcdef', job_type: 'fulltime',
  });
  assert.equal(job?.source, 'Indeed (local OpenCLI)');
  assert.equal(job?.company, 'Acme');
  assert.equal(job?.external_id, '0123456789abcdef');
  assert.equal(normalizeLocalIndeedJob({
    title: 'Software Engineer', company: 'Acme',
    description: 'Build reliable systems for customers and collaborate across the engineering organization. '.repeat(3),
    url: 'https://example.com/job',
  }), null);
});

test('local Indeed ingress preserves unknown work arrangement and rejects location strings as companies', () => {
  assert.equal(classifyWorkArrangement({ location: 'Remote in Texas' }), 'remote');
  assert.equal(classifyWorkArrangement({ location: 'Austin, TX', description: 'Work happens in-office.' }), 'onsite');
  assert.equal(classifyWorkArrangement({ location: 'Austin, TX' }), 'unknown');
  assert.equal(indeedUrl('https://www.indeed.com/viewjob?jk=abc&utm_source=x#details'), 'https://www.indeed.com/viewjob?jk=abc');
  assert.equal(normalizeLocalIndeedJob({ title: 'Engineer', company: 'Chicago, Detroit, Indianapolis', description: 'Useful listing details '.repeat(10), url: 'https://www.indeed.com/viewjob?jk=0123456789abcdef' }), null);
});
