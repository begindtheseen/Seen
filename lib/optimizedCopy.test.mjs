// "Your application is optimized" may only be said after the paid optimizer ran (willingness-to-pay
// test, 2026-10-25: the job page said it right after the FREE fit check, before any optimize).
// Source-level guard over the three places the claim could come from.
// Run: node --test lib/optimizedCopy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the free fit check never marks the application as optimized', () => {
  const panel = read('components/SeenFitPanel.tsx');
  assert.doesNotMatch(panel, /onOptimized/, 'SeenFitPanel is a diagnosis; it has no "optimized" callback');
  const page = read('app/jobs/[id]/page.tsx');
  assert.doesNotMatch(page, /<SeenFitPanel[^>]*onOptimized/);
  // the job page's flag comes only from a real optimize of this job by this person
  assert.match(page, /setOptimized\(wasOptimized\(user\?\.id, job\??\.id\)\)/);
  assert.ok(!/setOptimized\(true\)/.test(page), 'nothing sets optimized=true by fiat');
});

test('the HumanProof upgrade dialog does not claim an optimization happened', () => {
  const modal = read('components/UpgradeModal.tsx');
  assert.doesNotMatch(modal, /headline: 'Your application is optimized/);
});
