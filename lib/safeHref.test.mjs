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
