// Tests for the work thesaurus (lib/text/workFamilies.js + data/workFamilies.json): the brief's paraphrases match,
// the traps do not, conditional members need their object, and the shipped JSON equals a fresh build of the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relatePhrases, sameWorkWord, unitsOf } from './workFamilies.js';
import { build } from '../../scripts/text/build-work-families.mjs';

test('real paraphrases from the verdict judge match', () => {
  for (const [a, b] of [
    ['Educate patients and families', 'patient teaching at every visit'],
    ['Develop and maintain delivery schedules', 'Build and update 3-week delivery look-aheads'],
    ['Partner with SDRs to share feedback on meeting quality', 'Work with 2 SDRs on call quality and messaging'],
    ['Train new hires on store procedures', 'Coached 6 new associates on opening and closing steps'],
    ['Resolve customer complaints', 'Handled customer complaints'],
    ['Operate a forklift', 'Drove a forklift'],
  ]) assert.equal(relatePhrases(a, b).same, true, `${a} ~ ${b}`);
});

test('traps never match', () => {
  for (const [a, b] of [
    ['age-restricted sales', 'B2B sales'], ['logistic regression', 'logistics'], ['coach youth soccer', 'coach agents'],
    ['PT', 'PTA'], ['drive a truck', 'drive revenue'], ['Operate a forklift', 'Operate a business'],
    ['Train new hires', 'Train machine learning models'], ['Administer medications', 'Administer servers'],
    ['Close deals', 'Close the store'], ['Process payments', 'Process claims'],
  ]) assert.equal(relatePhrases(a, b).same, false, `${a} must not match ${b}`);
});

test('conditional members need their object', () => {
  assert.equal(sameWorkWord('manage', 'supervise')?.same, false);
  assert.deepEqual(sameWorkWord('manage', 'supervise', { context: ['staff'] }), { same: true, family: 'supervise', conditional: true });
  assert.equal(sameWorkWord('teach', 'educate')?.same, true);
  assert.equal(sameWorkWord('customer', 'client')?.same, true);
  assert.equal(sameWorkWord('zzqq', 'teach'), null);          // unknown word → the caller decides
});

test('multi-word members are read as one unit', () => {
  assert.deepEqual(unitsOf('3-week delivery look-aheads').map((u) => u.text), ['week', 'delivery', 'look aheads']);
  assert.ok(unitsOf('worked with the team')[0].members.some((m) => m.fam === 'collaborate'));
});

test('the shipped JSON is a fresh build of the reviewed source', () => {
  assert.equal(JSON.stringify(build()), readFileSync(new URL('./data/workFamilies.json', import.meta.url), 'utf8'));
});
