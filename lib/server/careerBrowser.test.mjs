// Run: node --test lib/server/careerBrowser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EXTRACT_JS, parseExtract, safeStartUrl } from './careerBrowser.js';

test('the in-page script finds JobPosting data and same-site job links', () => {
  const doc = {
    scripts: [{ textContent: JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'JobPosting', title: 'Service Technician' }] }) }, { textContent: '{bad json' }],
    anchors: ['https://www.tesla.com/careers/search/job/service-technician-123', 'https://www.tesla.com/about', 'https://evil.example/jobs/1', '/careers/search/job/x-456#apply'],
  };
  const ctx = { location: { href: 'https://www.tesla.com/careers/search', hostname: 'www.tesla.com' }, URL,
    document: { title: 'Careers', querySelectorAll: (sel) => sel.startsWith('script') ? doc.scripts : doc.anchors.map((h) => ({ href: h })) } };
  const out = parseExtract(vm.runInNewContext(EXTRACT_JS, ctx));
  assert.equal(out.postings.length, 1);
  assert.equal(out.postings[0].title, 'Service Technician');
  assert.deepEqual(out.links, ['https://www.tesla.com/careers/search/job/service-technician-123', 'https://www.tesla.com/careers/search/job/x-456']);
});

test('parseExtract tolerates wrappers and junk; start URLs must be plain https', () => {
  assert.deepEqual(parseExtract({ result: JSON.stringify({ links: ['http://x/jobs/1', 'https://x/jobs/2'] }) }).links, ['https://x/jobs/2']);
  assert.deepEqual(parseExtract('nope').postings, []);
  assert.equal(safeStartUrl('https://www.tesla.com/careers'), 'https://www.tesla.com/careers');
  assert.equal(safeStartUrl('http://www.tesla.com/careers'), null);
  assert.equal(safeStartUrl('https://user:pw@x.com/'), null);
  assert.equal(safeStartUrl('javascript:alert(1)'), null);
});
