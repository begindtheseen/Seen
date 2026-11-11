// The activity index (lib/occupations/activities.js): real same-work paraphrases relate, hard negatives that share
// words never do, unknown phrases answer [] / null, copy titles are plain gerund phrases, and without Node built-ins
// (a browser bundle) everything answers "no knowledge".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activitiesOf, relateActivities, activityTitle, hasActivityData } from './activities.js';
import { gerund, gerundTitle } from './activityWords.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the index loads and finds detailed activities for a plain duty', () => {
  assert.equal(hasActivityData(), true);
  const r = activitiesOf('Drew blood from patients');
  assert.ok(r.length > 0);
  assert.equal(r[0].title, 'collecting biological specimens from patients');
  assert.ok(r.every((x) => x.score >= 0.5 && /^4\.A\./.test(x.dwa)));
});

test('same work in other words relates', () => {
  for (const [a, b] of [
    ['Drew blood from patients', 'Collect blood specimens'],
    ['Washed dishes and pots', 'Wash dishes'],
    ['Tested circuits with a multimeter', 'Test electrical circuits'],
    ['Ran the register and handled cash', 'Operate cash registers'],
    ['Answered phones and took messages', 'Answer telephone calls'],
  ]) {
    const r = relateActivities(a, b);
    assert.ok(r && (r.relation === 'same' || r.relation === 'related'), `${a} ~ ${b}`);
  }
});

test('hard negatives that share words never relate (a false "related" would become a false "shown")', () => {
  for (const [a, b] of [
    ['Manage inventory', 'Manage a sales pipeline'], ['Patient assessment', 'Risk assessment for the investment portfolio'],
    ['Logistics coordination', 'Logistic regression'], ['Policy writing for the HR handbook', 'Insurance policy sales'],
    ['Drove a forklift', 'Count cash drawers'], ['Administered medications', 'Administered servers'],
    ['Cooked meals', 'Cooked the books'], ['Built data pipelines', 'Built sales pipelines'], ['Train staff', 'Train neural networks'],
  ]) {
    const r = relateActivities(a, b);
    assert.ok(!r || r.relation === null || r.confidence === 'guess', `${a} must not relate to ${b} (${JSON.stringify(r)})`);
  }
});

test('unknown is an answer: weak or empty phrases return [] and null', () => {
  assert.deepEqual(activitiesOf(''), []);
  assert.deepEqual(activitiesOf('synergy alignment paradigm'), []);
  assert.equal(relateActivities('synergy alignment', 'Wash dishes')?.relation, null);
});

test('plain-words titles for copy', () => {
  assert.equal(gerund('plan'), 'planning');
  assert.equal(gerund('tie'), 'tying');
  assert.equal(gerund('prepare'), 'preparing');
  assert.equal(gerund('monitor'), 'monitoring');
  assert.equal(gerundTitle('Load or unload materials used in construction.'), 'loading or unloading materials used in construction');
  assert.equal(gerundTitle('Monitor, test, or adjust equipment.'), 'monitoring, testing, or adjusting equipment');
  assert.equal(gerundTitle('Getting Information'), 'getting information');
  const r = relateActivities('Drew blood from patients', 'Collect blood specimens');
  assert.ok(r?.via?.title && /^[a-z]/.test(r.via.title) && !/\.$/.test(r.via.title));
  assert.equal(activityTitle(String(r?.via?.dwa)), r?.via?.title);
});

test('without process.getBuiltinModule (a browser) the index answers no knowledge and never throws', () => {
  const code = `process.getBuiltinModule = undefined; const errors = []; console.error = (...a) => errors.push(a.join(' '));
    const m = await import(${JSON.stringify(join(ROOT, 'lib/occupations/activities.js'))});
    console.log(JSON.stringify({ a: m.activitiesOf('Drew blood'), r: m.relateActivities('Drew blood', 'Collect blood'), h: m.hasActivityData(), t: m.activityTitle('4.A.3.a.2.al.1'), errors }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(r, { a: [], r: null, h: false, t: '', errors: [] });
});
