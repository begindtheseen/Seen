import test from 'node:test';
import assert from 'node:assert/strict';
import { careerStartCandidates, keywordTerms, titleMatches, jobIdentity, outsideUs } from './careerNavigate.js';

test('start pages: the one given, else the usual career addresses for the company or its website', () => {
  assert.deepEqual(careerStartCandidates({ company: 'Tesla', url: 'https://www.tesla.com/careers/search/?site=US' }), ['https://www.tesla.com/careers/search/?site=US']);
  const c = careerStartCandidates({ company: 'The Home Depot, Inc.' });
  assert.equal(c[0], 'https://www.homedepot.com/careers');
  assert.ok(careerStartCandidates({ company: 'X', website: 'acme.io' }).some((u) => new URL(u).hostname === 'careers.acme.io'));
});

test('keywords and title matching', () => {
  assert.deepEqual(keywordTerms('Software Engineer, technician; sales\nsales'), ['software engineer', 'technician', 'sales']);
  assert.equal(titleMatches('Sr. Software Engineer II', ['software engineer']), true);
  assert.equal(titleMatches('Service Technician', ['software engineer', 'technician']), true);
  assert.equal(titleMatches('Recruiter', ['technician']), false);
});

test('one identity per job across pages, keywords and passes; abroad only when certain', () => {
  assert.equal(jobIdentity(null, 'https://Jobs.Acme.com/job/123/?utm_source=x&gh_src=y#apply'), jobIdentity({ url: 'https://jobs.acme.com/job/123' }, null));
  assert.notEqual(jobIdentity(null, 'https://a.com/job/1'), jobIdentity(null, 'https://a.com/job/2'));
  assert.equal(outsideUs('Berlin, Germany'), true);
  assert.equal(outsideUs('Austin, TX'), false);
  assert.equal(outsideUs('Remote'), false);
  assert.equal(outsideUs(''), false);
  assert.equal(outsideUs('Toronto, ON; Austin, TX'), false, 'one US location keeps it');
});
