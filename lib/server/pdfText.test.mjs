// Content-stream text extraction: the line breaks a PDF encodes must survive into the
// text we parse. Run: node --test lib/server/pdfText.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { textFromContentStream, looksLikeGarbledText } from './pdfText.js';

test('Td/TD/Tm/T* positioning operators each start a new line', () => {
  const out = textFromContentStream('BT (First) Tj 0 -14 Td (Second) Tj 0 -14 Td (Third) Tj ET', null);
  const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
  assert.deepEqual(lines, ['First', 'Second', 'Third']);
});

// PDF 32000-1 §9.4.3: ' and " move to the next line AND show the string. A generator that
// uses them emits no Td/TD/Tm between lines, so a reader that ignores them concatenates
// every line with no separator. That is how an exported résumé came back reading
// "High School DiplomaGreat Oak High School – Temecula, CA" as a single education entry:
// two lines in the source document, welded into one before any parsing happened.
test("the ' operator separates lines instead of welding them together", () => {
  const out = textFromContentStream("BT (High School Diploma) ' (Great Oak High School) ' ET", null);
  assert.ok(!/DiplomaGreat/.test(out), `lines welded together: ${JSON.stringify(out)}`);
  const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
  assert.deepEqual(lines, ['High School Diploma', 'Great Oak High School']);
});

test('the " operator (word/char spacing + show) also separates lines', () => {
  const out = textFromContentStream('BT 0 0 (Alpha) " 0 0 (Beta) " ET', null);
  const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
  assert.deepEqual(lines, ['Alpha', 'Beta']);
});

test('an apostrophe inside a literal string is text, not an operator', () => {
  const out = textFromContentStream("BT (Owner's Operator) Tj ET", null);
  assert.equal(out.trim(), "Owner's Operator");
});

test('TJ kerning arrays keep their pieces on one line', () => {
  const out = textFromContentStream('BT [(Bran) -250 (don) -250 ( Burnett)] TJ ET', null);
  assert.equal(out.trim(), 'Brandon Burnett');
});

test('looksLikeGarbledText only flags substantial output with no words and no spaces', () => {
  assert.equal(looksLikeGarbledText('short'), false);
  assert.equal(looksLikeGarbledText('x'.repeat(400)), true);
  const real = 'The candidate has experience with customer service and team management. '.repeat(6);
  assert.equal(looksLikeGarbledText(real), false);
});
