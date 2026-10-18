// Tracker "View listing" target. Run: node --test lib/listingHref.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingHref } from './listingHref.js';

const ID = '2209e55f-cdef-4dcc-9fbb-5d0c7d481788';

test('a listing posted on Seen opens its Seen page inside the app', () => {
  // The exact job_url Apply on Seen stores (lib/server/seenApply.js).
  assert.deepEqual(listingHref({ jobUrl: `https://seenjobs.io/jobs/${ID}`, jobId: ID }), { href: `/jobs/${ID}`, internal: true });
  assert.deepEqual(listingHref({ jobUrl: `https://www.seenjobs.io/jobs/${ID}/` }), { href: `/jobs/${ID}`, internal: true });
  assert.deepEqual(listingHref({ jobUrl: `/jobs/${ID}` }), { href: `/jobs/${ID}`, internal: true });
});

test('no stored link: a Seen listing id still links back to the listing', () => {
  assert.deepEqual(listingHref({ jobUrl: null, jobId: ID }), { href: `/jobs/${ID}`, internal: true });
  assert.deepEqual(listingHref({ jobUrl: '', jobId: ID }), { href: `/jobs/${ID}`, internal: true });
  // Search-result ids (j_<hash>) are not rows in jobs, so there is no page to link to.
  assert.equal(listingHref({ jobId: 'j_16mwd5p' }), null);
  assert.equal(listingHref({}), null);
  assert.equal(listingHref(null), null);
});

test('outside listings keep their own link and open in a new tab', () => {
  const adz = 'https://www.adzuna.com/details/5834536149?utm_medium=api';
  assert.deepEqual(listingHref({ jobUrl: adz, jobId: ID }), { href: adz, internal: false });
  // A seenjobs.io page that is not a listing is treated as an outside link.
  assert.deepEqual(listingHref({ jobUrl: 'https://seenjobs.io/company/target' }), { href: 'https://seenjobs.io/company/target', internal: false });
  // Not a web link: fall back to the id.
  assert.deepEqual(listingHref({ jobUrl: 'javascript:alert(1)', jobId: ID }), { href: `/jobs/${ID}`, internal: true });
});
