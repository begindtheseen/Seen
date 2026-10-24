// Tests for the rewrite guard — every rule pinned by a sentence from the 2026-10-23 live audits.
// Run: node --test lib/optimizer/rewriteGuard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordKey, uniqueKeywords, withoutKeywords, isSubstantiveRewrite, addedTokens, rewriteIsGrounded, isNounList } from './rewriteGuard.js';

test('keywordKey folds case, plural and possessive: ASSOCIATE / associates / associate\'s are one keyword', () => {
  assert.equal(keywordKey('ASSOCIATE'), 'associate');
  assert.equal(keywordKey('associates'), 'associate');
  assert.equal(keywordKey("associate's"), 'associate');
  assert.equal(keywordKey('Customer Service'), 'customer service');
  assert.equal(keywordKey('POS systems'), 'pos system');
  // short words and words ending in -ss are not "plurals"
  assert.equal(keywordKey('sales'), 'sale');
  assert.equal(keywordKey('pos'), 'pos');
  assert.equal(keywordKey('business'), 'business');
});

test('uniqueKeywords keeps one spelling per key; withoutKeywords makes matched ∩ missing = ∅', () => {
  assert.deepEqual(uniqueKeywords(['ASSOCIATE', 'associates', 'sales', 'Sales', 'excel']), ['ASSOCIATE', 'sales', 'excel']);
  assert.deepEqual(withoutKeywords(['cashier', 'leadership', 'Cashiers'], ['CASHIER']), ['leadership']);
});

test('isSubstantiveRewrite: a dropped glyph, an added period or a parenthetical is not an improvement', () => {
  const before = '• Sold and renewed 40+ memberships per month; ranked top 3 of 12 on the sales floor for 6 straight months';
  assert.equal(isSubstantiveRewrite(before, 'Sold and renewed 40+ memberships per month; ranked top 3 of 12 on the sales floor for 6 straight months.'), false);
  const pos = '• Trained 4 new front-desk hires on the POS system and the daily opening and closing checklist';
  assert.equal(isSubstantiveRewrite(pos, 'Trained 4 new front-desk hires on the POS (cashier) system and the daily opening and closing checklist.'), false);
  assert.equal(isSubstantiveRewrite('Responsible for cash handling at the register', 'Handled cash handling at the register.'), true);
  assert.equal(isSubstantiveRewrite('x', ''), false);
});

test('rewriteIsGrounded: every added token must appear in the résumé or the posting', () => {
  const before = 'Responsible for cash handling at the register';
  assert.deepEqual(addedTokens(before, 'Handled cash handling at the register.'), ['handled']);
  assert.equal(rewriteIsGrounded(before, 'Handled cash handling at the register.', 'Required: cash handling.'), false);
  assert.equal(rewriteIsGrounded(before, 'Handled cash handling at the register.', ['Required: cash handling.', 'Cash is handled daily']), true);
  assert.equal(rewriteIsGrounded(before, 'Responsible for cash handling at the register.', ''), true, 'no added tokens is grounded by definition');
});

test('isNounList flags the audit\'s keyword-list sentence and bare noun lists, not real sentences', () => {
  assert.equal(isNounList('Retail-experienced candidate for Seasonal Sales Associate, with demonstrated sales, associates, associate.'), true);
  assert.equal(isNounList('Customer service, cash handling, point of sale.'), true);
  assert.equal(isNounList('Retail-experienced candidate for Seasonal Sales Associate with sales and customer service experience.'), false);
  assert.equal(isNounList('Trained 4 new hires on the POS system, the opening checklist, and nightly reconciliation of the register.'), false);
  assert.equal(isNounList('Handled billing questions, freezes and cancellations for 1,200+ members with a 94% satisfaction score'), false);
});
