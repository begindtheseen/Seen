// Tests: résumé PDF export carries the optional optimized package (COMMIT 4).
// Run: node --test lib/server/resumeExport.test.mjs
//
// buildResumePDF renders a base résumé from the user's own text; when an `optimized` package
// is supplied in meta it appends a clearly-separated "Optimized for …" section. When absent,
// the output is identical to before. We can't read PDF text easily, so we assert the appendix
// makes the document strictly larger (proving it rendered) and the base output is stable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildResumePDF } from '../../api/resume.js';

const DOC = {
  name: 'Jane Doe',
  contact: { email: 'jane@example.com', location: 'Austin, TX' },
  summary: 'Retail associate with customer service experience.',
  experience: [
    { company: 'Acme Store', title: 'Sales Associate', dates: '2020–2023', location: 'Austin, TX',
      bullets: ['Provided customer service on a busy floor.', 'Handled cash handling at the register.'] },
  ],
  skills: ['Customer service', 'Cash handling', 'Inventory management'],
  education: ['High School Diploma'],
};

test('base résumé PDF renders to a valid PDF buffer (no optimized package)', async () => {
  const buf = await buildResumePDF(DOC, { role: 'Cashier', company: 'Target' });
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.slice(0, 5).toString('ascii'), '%PDF-');
});

test('supplying an optimized package appends a section (larger PDF)', async () => {
  const base = await buildResumePDF(DOC, { role: 'Cashier', company: 'Target' });
  const withOpt = await buildResumePDF(DOC, {
    role: 'Cashier',
    company: 'Target',
    optimized: {
      role: 'Cashier',
      company: 'Target',
      fitScore: 82,
      bullets: [
        'Delivered customer service in a fast-paced environment, maintaining a consistent standard of service.',
        'Handled cash handling with accuracy under time-sensitive conditions.',
      ],
      confirmItems: ['Served [X] customers per shift — add the real number.'],
      message: 'I am excited to bring my retail experience to this cashier role.',
    },
  });
  assert.equal(withOpt.slice(0, 5).toString('ascii'), '%PDF-');
  assert.ok(withOpt.length > base.length, 'optimized appendix should make the PDF larger');
});

test('an empty optimized package changes nothing (no section rendered)', async () => {
  const base = await buildResumePDF(DOC, { role: 'Cashier', company: 'Target' });
  const withEmpty = await buildResumePDF(DOC, { role: 'Cashier', company: 'Target', optimized: null });
  // Same inputs → same byte length (PDFKit is deterministic for identical content).
  assert.equal(withEmpty.length, base.length);
});

// ── Watermark gating (owner: "Seenjobs labeling only when the user isn't Pro") ──
// Free/anonymous exports carry the "Optimized with Seen · seenjobs.io" footer on every
// page; Pro users (meta.pro === true) get a clean, unbranded résumé. Because the footer
// draws a hairline + a text block per page, removing it makes the PDF strictly smaller.
test('Pro export omits the watermark footer (smaller than the free export)', async () => {
  const free = await buildResumePDF(DOC, { role: 'Cashier', company: 'Target' });
  const pro  = await buildResumePDF(DOC, { role: 'Cashier', company: 'Target', pro: true });
  assert.equal(pro.slice(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pro.length < free.length, 'Pro résumé must be smaller — no footer wordmark drawn');
});

test('pro:false renders identically to the default (footer present for free users)', async () => {
  const dflt = await buildResumePDF(DOC, { role: 'Cashier', company: 'Target' });
  const free = await buildResumePDF(DOC, { role: 'Cashier', company: 'Target', pro: false });
  // Default (undefined) and explicit non-Pro must both keep the watermark → same bytes.
  assert.equal(free.length, dflt.length);
});
