// Tests: SeenFit → HumanProof chaining (optimized-package humanization).
// Run: node --test lib/server/humanizePackage.test.mjs
//
// Verifies the truth contract of the package path:
//   • per-item human-signal scores are returned for every optimized bullet
//   • an unsupported-claim warning is CARRIED THROUGH (never laundered away) AND re-flagged
//   • the humanized output introduces NO new numbers or proper nouns that aren't in the input
//     evidence (token-level check)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHumanProofPackage,
  normalizeBulletList,
  normalizeWarnings,
  mergeCarriedWarnings,
} from './humanizePackage.js';

// Résumé evidence that grounds "customer service" but NOT Salesforce or any 5000 figure.
const EVIDENCE = `Jane Doe — Retail Associate
- Provided customer service to shoppers on the sales floor.
- Handled cash handling at the register.`;

// An optimized bullet carrying an unsupported tool (Salesforce) and an unsupported number
// (5000), plus AI-slop phrasing ("Leveraged", "spearhead").
const BULLET = 'Leveraged Salesforce to spearhead operations, serving 5000 customers.';

test('normalizeBulletList accepts strings and SeenFit bullet objects', () => {
  const list = normalizeBulletList([
    'plain bullet',
    { optimized: 'from optimized' },
    { text: 'from text' },
    { original: 'from original' },
    '',
    null,
  ]);
  assert.deepEqual(list, ['plain bullet', 'from optimized', 'from text', 'from original']);
});

test('normalizeWarnings + mergeCarriedWarnings preserve caller warnings verbatim', () => {
  const carried = normalizeWarnings([{ phrase: '5000', warning: 'Confirm the real customer count.' }]);
  assert.equal(carried.length, 1);
  const merged = mergeCarriedWarnings(carried, [{ placeholder: 'salesforce', reason: 'Not in your résumé.' }]);
  assert.ok(merged.some((w) => w.warning === 'Confirm the real customer count.'), 'caller warning dropped');
  assert.ok(merged.some((w) => w.phrase === 'salesforce'), 'engine confirm dropped');
});

test('package returns a per-item human-signal score for every bullet', () => {
  const r = buildHumanProofPackage({ bullets: [BULLET, 'Handled cash handling at the register.'], resumeText: EVIDENCE });
  assert.equal(r.package.bullets.length, 2);
  for (const item of r.package.bullets) {
    assert.equal(typeof item.human_signal, 'number');
    assert.equal(typeof item.humanized_text, 'string');
    assert.ok(item.humanized_text.length > 0);
  }
  assert.equal(typeof r.humanproof_score, 'number');
});

test('an unsupported-claim warning is carried through AND re-flagged', () => {
  const warnings = [{ phrase: '5000', warning: 'Unverified customer count — confirm before using.' }];
  const r = buildHumanProofPackage({ bullets: [BULLET], warnings, resumeText: EVIDENCE });

  // (a) carried through: the caller's warning survives verbatim.
  assert.ok(
    r.package.carried_warnings.some((w) => w.warning === 'Unverified customer count — confirm before using.'),
    'caller warning was laundered away'
  );

  // (b) re-flagged: the engine independently surfaced the unsupported number/tool as a
  //     confirm-before-using item on the bullet (never silently kept in the deliverable).
  const item = r.package.bullets[0];
  const confirmsBlob = JSON.stringify(item.confirm_before_using).toLowerCase();
  assert.ok(/5000|salesforce/.test(confirmsBlob), 'engine did not re-flag the unsupported claim');
});

test('humanized output introduces no new numbers or proper nouns (token-level)', () => {
  const r = buildHumanProofPackage({ bullets: [BULLET], resumeText: EVIDENCE });
  const humanized = r.package.bullets[0].humanized_text;
  const inputBlob = `${BULLET}\n${EVIDENCE}`.toLowerCase();

  // No digit run in the output that isn't present in the input.
  for (const d of humanized.match(/\d+/g) || []) {
    assert.ok(inputBlob.includes(d), `new number "${d}" appeared in humanized output`);
  }

  // No new proper noun: any capitalized word that is NOT sentence-initial must exist in input.
  const words = humanized.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^A-Za-z]/g, '');
    if (!/^[A-Z][a-z]+/.test(w)) continue;
    const sentenceInitial = i === 0 || /[.!?]$/.test(words[i - 1]);
    if (sentenceInitial) continue; // leading capital from tidy() is fine
    assert.ok(inputBlob.includes(w.toLowerCase()), `new proper noun "${w}" appeared in humanized output`);
  }

  // Specifically, the unsupported Salesforce/5000 must not survive in the deliverable.
  assert.doesNotMatch(humanized, /salesforce/i, 'unsupported tool leaked into deliverable');
  assert.doesNotMatch(humanized, /5000/, 'unsupported number leaked into deliverable');
});

test('an application message is humanized alongside bullets', () => {
  const r = buildHumanProofPackage({
    bullets: [BULLET],
    applicationMessage: 'I am a results-driven professional leveraging my skills to spearhead success.',
    resumeText: EVIDENCE,
  });
  assert.ok(r.package.application_message, 'expected an application_message result');
  assert.equal(typeof r.package.application_message.human_signal, 'number');
});
