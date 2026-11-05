import test from 'node:test';
import assert from 'node:assert/strict';
import { eqValue, ilikeExact, ilikePrefix, ilikeContains, ilikeWords, inList, likeLiteral, quoteValue } from './pgrest.js';

// What PostgREST sees: the query string split on raw `&`, each part URL-decoded.
const params = (qs) => [...new URLSearchParams(qs)];

test('a value can never add a parameter or change the select', () => {
  const evil = 'acme&select=*,reports(*)&or=(id.gt.0)#x';
  for (const enc of [eqValue, ilikeExact, ilikePrefix, ilikeContains, (v) => ilikeWords(v), (v) => inList([v, 'b'])]) {
    const p = params(`company_name=eq.${enc(evil)}&select=id`);
    assert.deepEqual(p.map(([k]) => k), ['company_name', 'select']);
    assert.equal(p[1][1], 'id');
  }
});

test('like wildcards are literal; * becomes a one-character match', () => {
  assert.equal(likeLiteral('50%_off\\'), '50\\%\\_off\\\\');
  assert.equal(likeLiteral('E*TRADE'), 'E_TRADE');
  assert.equal(decodeURIComponent(ilikeExact('*')), '_');
  assert.equal(decodeURIComponent(ilikePrefix('ph%')), 'ph\\%*');
  assert.equal(decodeURIComponent(ilikeContains(' target ')), '*target*');
  assert.equal(decodeURIComponent(ilikeWords('Coca-Cola  Co', { contains: true })), '*Coca*Cola*Co*');
  assert.equal(decodeURIComponent(ilikeWords('a_b c')), 'a\\_b*c');
  assert.equal(ilikeWords('  - '), '');
});

test('quoted lists cannot be broken out of', () => {
  assert.equal(quoteValue('a"),b.eq.1,("\\'), '"a),b.eq.1,("');
  assert.equal(decodeURIComponent(inList(['walmart', 'say "hi"\\', 'x\u0000y'])), '("walmart","say hi","xy")');
  // A pre-encoded quote stays text: the whole inside is encoded once more, PostgREST decodes once.
  assert.equal(decodeURIComponent(inList(['%22'])), '("%22")');
  assert.equal(inList([]), '()');
});

test('control characters are dropped', () => {
  assert.equal(decodeURIComponent(eqValue('a\nb\u0000c')), 'abc');
});
