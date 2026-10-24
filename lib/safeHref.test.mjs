// Run: node --test lib/safeHref.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathSegment, slugSegment, httpHref } from './safeHref.js';

test('pathSegment encodes everything that is not a path character', () => {
  assert.equal(pathSegment('abc-123'), 'abc-123');
  assert.equal(pathSegment('javascript:alert(1)'), 'javascript%3Aalert(1)');
  assert.equal(pathSegment('../x'), '..%2Fx');
  assert.equal(pathSegment(null), '');
});

test('slugSegment keeps a canonical slug as it is and never double-encodes', () => {
  assert.equal(slugSegment('coca-cola'), 'coca-cola');
  assert.equal(slugSegment('at%26t'), 'at%26t');
  assert.equal(slugSegment('a b'), 'a%20b');
  assert.equal(slugSegment('%E0%A4%A'), '%25E0%25A4%25A'); // malformed: encoded as is, no throw
  assert.equal(slugSegment('x/../y'), 'x%2F..%2Fy');
});

test('httpHref accepts only http(s) URLs and returns the parsed form', () => {
  assert.equal(httpHref('https://jobs.example.com/apply?id=1'), 'https://jobs.example.com/apply?id=1');
  assert.equal(httpHref('HTTP://Example.com/a'), 'http://example.com/a');
  assert.equal(httpHref('javascript:alert(1)'), null);
  assert.equal(httpHref('data:text/html,hi'), null);
  assert.equal(httpHref('//evil.example'), null);
  assert.equal(httpHref('/jobs/abc'), null);
  assert.equal(httpHref(''), null);
  assert.equal(httpHref(undefined), null);
});

test('internalPath accepts one origin-relative path and refuses every open-redirect shape', async () => {
  const { internalPath, loginHref } = await import('./safeHref.js');
  assert.equal(internalPath('/tracker'), '/tracker');
  assert.equal(internalPath('/company/amazon?tab=reports#top'), '/company/amazon?tab=reports#top');
  assert.equal(internalPath('/profile#plan'), '/profile#plan');
  assert.equal(internalPath('  /pricing '), '/pricing');
  assert.equal(internalPath('//evil.example/x'), null);
  assert.equal(internalPath('/\\evil.example'), null);
  assert.equal(internalPath('https://evil.example/'), null);
  assert.equal(internalPath('javascript:alert(1)'), null);
  assert.equal(internalPath('tracker'), null);
  assert.equal(internalPath('/a\nb'), null);
  assert.equal(internalPath(''), null);
  assert.equal(internalPath(null), null);
  assert.equal(internalPath(undefined), null);
  // loginHref carries the path back and never points /login at itself
  assert.equal(loginHref('/tracker'), '/login?return=%2Ftracker');
  assert.equal(loginHref('/company/amazon?tab=reports'), '/login?return=%2Fcompany%2Famazon%3Ftab%3Dreports');
  assert.equal(loginHref('/login?signup=1'), '/login');
  assert.equal(loginHref('/reset'), '/login');
  assert.equal(loginHref('//evil.example'), '/login');
  assert.equal(loginHref(null), '/login');
});
