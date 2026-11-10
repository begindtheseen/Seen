// Trade talk (lib/text/tradeTalk.js): jargon and plain words name the same thing inside a field, never outside it;
// instance ⇒ class is one way; the longest listed term wins; ordinary words count only as the whole term; the shipped
// JSON is a fresh build of the reviewed source; no data in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameThing, expand, fieldsOf, hasTradeTalk } from './tradeTalk.js';
import { build, FIELDS } from '../../scripts/text/build-trade-talk.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const same = (/** @type {string} */ a, /** @type {string} */ b, /** @type {string} */ field) => sameThing(a, b, { field }).same;

test('the obvious-fit classes: jargon shows the plain words', () => {
  assert.equal(same('vitals', 'vital signs', 'healthcare'), true);
  assert.equal(same('autoclave', 'sterilize instruments', 'healthcare'), true);
  assert.equal(same('IM injections', 'intramuscular medications', 'healthcare'), true);
  assert.equal(same('stow', 'put away', 'warehouse'), true);
  assert.equal(same('OASIS start-of-care visits', 'in-home assessments', 'nursing'), true);
  assert.equal(same('save desk', 'resolving complaints', 'support'), true);
  assert.equal(same('Epic', 'electronic health record', 'healthcare'), true);
  assert.equal(same('forklift', 'powered industrial truck', 'warehouse'), true);
});

test('instance ⇒ class is one way', () => {
  assert.equal(same('ServSafe', 'food safety certification', 'food'), true);
  assert.equal(same('food safety certification', 'ServSafe Manager', 'food'), false);
  assert.equal(same('sterilize instruments', 'autoclave', 'healthcare'), false);
  assert.equal(same('refrigerant certification', 'EPA 608 Universal', 'trades'), false);   // longest match: the instance
});

test('outside its field an entry answers null; same letters, different field', () => {
  assert.equal(same('IM injections', 'intramuscular medications', 'office'), null);
  assert.equal(same('IM', 'instant messaging', 'office'), true);
  assert.notEqual(same('IM', 'instant messaging', 'healthcare'), true);
  assert.equal(same('pick', 'select orders', 'food'), null);
  assert.equal(same('PO', 'post office', 'office'), null);
  // no field: answered only when both terms share ONE reading in one field ("IM" ~ "intramuscular" is the clinic's)
  assert.equal(sameThing('IM', 'intramuscular').same, true);
});

test('ordinary words count only as the whole term', () => {
  assert.notEqual(same('pick', 'pick a lock', 'warehouse'), true);
  assert.notEqual(same('stow', 'stow luggage on aircraft', 'warehouse'), true);
  assert.notEqual(same('REST', 'rest breaks', 'software'), true);
});

test('expand: what a term shows', () => {
  const e = expand('ServSafe', { field: 'food' });
  assert.ok(e.some((x) => x.shows.includes('food safety certification')));
  assert.ok(!expand('food safety certification', { field: 'food' }).some((x) => x.shows.includes('servsafe')));
  assert.deepEqual(expand('vitals', { field: 'software' }), []);
});

test('fieldsOf maps occupations to field keys', () => {
  assert.ok(fieldsOf('35-2014.00').includes('food'));
  assert.ok(fieldsOf('29-1141.00').includes('nursing'));
  assert.ok(fieldsOf('53-7065.00').includes('warehouse'));
  assert.ok(fieldsOf('49-9021.00').includes('trades'));
  for (const f of fieldsOf('15-1232.00')) assert.ok(FIELDS.includes(f));
});

test('every field has at least 40 reviewed groups, and the shipped JSON is a fresh build', () => {
  const file = build();
  for (const [i, f] of FIELDS.entries()) assert.ok(file.g.filter((g) => g[0].includes(i)).length >= 40, f);
  assert.equal(JSON.stringify(file), readFileSync(join(ROOT, 'lib/text/data/tradeTalk.json'), 'utf8'));
  assert.equal(hasTradeTalk(), true);
});

test('no data in a browser: null, never a throw', () => {
  const code = `process.getBuiltinModule = undefined; const m = await import(${JSON.stringify(join(ROOT, 'lib/text/tradeTalk.js'))});
    console.log(JSON.stringify({ s: m.sameThing('vitals', 'vital signs', { field: 'healthcare' }), e: m.expand('vitals'), h: m.hasTradeTalk() }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(r, { s: { same: null, via: null, kind: null, confidence: null }, e: [], h: false });
});
