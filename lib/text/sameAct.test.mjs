// sameAct: the same act on the same kind of thing, by object class, with one-way edges and the trust contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sameAct, readAct, readActs, actClasses, hasActFamilies } from './sameAct.js';
import { sameThing } from './tradeTalk.js';
import { build } from '../../scripts/text/build-act-families.mjs';

const yes = (a, b, conf, opts) => {
  const r = sameAct(a, b, opts);
  assert.equal(r.same, true, `${a} ~ ${b}: ${JSON.stringify(r)}`);
  if (conf) assert.equal(r.confidence, conf, `${a} ~ ${b}: ${JSON.stringify(r)}`);
  return r;
};
const no = (a, b, how, opts) => {
  const r = sameAct(a, b, opts);
  assert.equal(r.same, false, `${a} vs ${b}: ${JSON.stringify(r)}`);
  if (how) assert.match(String(r.how), how);
  return r;
};

test('the table is loaded and the shipped file matches its reviewed source', () => {
  assert.equal(hasActFamilies(), true);
  assert.ok(actClasses().length >= 20);
  const shipped = JSON.parse(readFileSync(new URL('./data/actFamilies.json', import.meta.url), 'utf8'));
  assert.deepEqual(shipped, build(), 'run node scripts/text/build-act-families.mjs');
});

test('same act on the same thing is exact; on a thing of the same narrow class it is close', () => {
  yes('Trained 12 new associates on the register', 'Onboard and train new hires', 'exact');
  yes('Provided training to new hires', 'Train new team members', 'exact');
  yes('Experience training new hires', 'Onboarded new employees', 'exact');
  yes('Ran the store on weekends', 'Manage the store', 'exact');
  yes('Hit quota 6 quarters', 'Meet or exceed sales quota', 'exact');
  yes('Administered medications', 'Pass medications', 'exact');
  yes('Built data pipelines', 'Develop pipelines', 'exact');          // the résumé's thing is a kind of the posting's
  yes('Cash handling', 'Handle cash', 'exact');                        // noun + -ing reads as verb + object
  yes('Trained cashiers', 'train new hires', 'close');
  yes('Supervise 15-18 pickers and packers', 'Lead and develop a team of 200+ warehouse employees', 'close');
  yes('Stocked shelves', 'Replenish merchandise', 'close');
});

test('one-way edges: coach ⇒ train holds, train ⇏ coach', () => {
  yes('Coached associates', 'train associates', 'close');
  no('Trained associates', 'coach associates', /one-way/);
  yes('Exceeded sales goals by 20%', 'Meet sales goals', 'close');
  no('Met sales goals', 'Exceed sales goals', /one-way/);
  yes('Resolved customer complaints', 'handle complaints', 'close');
  no('Handled customer complaints', 'Resolve customer complaints', /one-way/);
  no('Followed safety procedures', 'Develop procedures', /one-way/);
  yes('Sanitized tables', 'Clean tables', 'close');
  no('Cleaned tables', 'Sanitize tables', /one-way/);
});

test('the verb picks the object class: a different class is a known "no"', () => {
  no('Ran tests', 'Manage the store', /different object class/);
  no('Maintained equipment', 'maintain records', /different object class/);
  no('Trained a machine learning model', 'Train new hires', /different object class/);
  no('Tracked sales goals', 'Exceed sales goals', /different act/);
});

test('guesses: near acts, conflicting modifiers, broad classes, no object on the résumé side, linked families', () => {
  yes('Unloaded trucks', 'Load trucks', 'guess');
  yes('Maintained patient records', 'Maintain inventory records', 'guess');
  yes('Implemented audits', 'Implement integrations', 'guess');
  yes('Performed cycle counts', 'Count inventory', 'guess');
  yes('supervise 15-18 pickers and packers', 'Oversee day to day outbound warehouse operations', 'guess');
});

test('every act of a line is read; "no" only when every act is known not to match', () => {
  yes('Answered phones and scheduled appointments', 'Schedule patient appointments', 'close');   // the posting's kind (patient) is not named
  yes('Greeted customers and processed payments', 'Process cash and card payments', 'close');
  assert.equal(readActs('answered multi-line phones greeted visitors sorted mail').length, 3);
  assert.equal(sameAct('Answered phones and wrote Python services', 'Answer calls').same, true);
});

test('the posting names a kind the résumé does not: close, not exact', () => {
  yes('Kept records', 'Maintain CRM records', 'close');
});

test('an object class given by the caller places an object-less phrase', () => {
  yes('Trained', 'onboard', 'close', { objectClass: 'workforce' });
  assert.equal(sameAct('Trained', 'onboard', { objectClass: 'no-such-class' }).same, null);
});

test('null when the table does not know a verb or the objects', () => {
  assert.equal(sameAct('Loved the outdoors', 'Train new hires').same, null);
  assert.equal(sameAct('Excellent customer service skills', 'Serve customers').same, null);   // "service" is not a verb here
  assert.equal(readAct('Excellent customer service skills'), null);
});

test('readAct reads light verbs, coordination and lead-ins', () => {
  assert.deepEqual(readAct('Conducted inventory counts')?.verbs, ['count']);
  assert.equal(readAct('Perform maintenance on equipment')?.verbs[0], 'maintain');
  assert.equal(readAct('Perform maintenance on equipment')?.head, 'equipment');
  assert.equal(readAct('Perform preventive maintenance on equipment')?.verbs[0], 'preventive maintenance');
  assert.equal(readAct('Perform preventive maintenance on equipment')?.head, 'equipment');
  assert.deepEqual(readAct('Lead and develop a team of 200+')?.verbs, ['lead', 'develop']);
  assert.equal(readAct('Proven track record of exceeding sales goals')?.verbs[0], 'exceed');
  assert.equal(readAct('Used Salesforce tools')?.verbs[0], 'use');
});

test('everyday noun equals in tradeTalk hold in every field (the "general" field)', () => {
  assert.equal(sameThing('new associates', 'new hires').same, true);
  assert.equal(sameThing('new staff', 'new team members', { field: 'food' }).same, true);
  assert.equal(sameThing('CSAT', 'customer feedback scores').same, true);
  assert.equal(sameThing('customer feedback scores', 'CSAT').same, false);    // the class does not show the instance
  assert.equal(sameThing('the floor', 'sales floor', { field: 'retail' }).same, true);
  assert.equal(sameThing('floor', 'shop floor', { field: 'warehouse' }).same, true);
  assert.equal(sameThing('quota', 'plan', { field: 'sales' }).same, true);
  assert.equal(sameThing('shift', 'crew', { field: 'food' }).same, true);
  assert.equal(sameThing('shift', 'crew', { field: 'software' }).same, null);  // field-scoped
});

test('the source format is validated', () => {
  assert.throws(() => build('fam: a, b'), /before any @class/);
  assert.throws(() => build('@class x: a, b, c\nf: run\nedges: run => walk'), /edge verb "walk"/);
  assert.throws(() => build('@class x: a, b, c\nf: run\n@link x.f ~ y.g'), /unknown family "y.g"/);
  const ok = build('@class x [broad]: a, b, c\nf: run, operate ; near: use\nedges: run => use');
  assert.deepEqual(ok.c[0], ['x', ['a', 'b', 'c'], [['f', ['run', 'operate'], ['use']]], [['run', 'use']], 1]);
});

test('no data in a browser: null and empty, never a throw', () => {
  const mod = fileURLToPath(new URL('./sameAct.js', import.meta.url));
  const code = `process.getBuiltinModule = undefined; const m = await import(${JSON.stringify(mod)});
    console.log(JSON.stringify({ s: m.sameAct('Trained new associates', 'Onboard new hires'), r: m.readActs('Trained staff'), c: m.actClasses(), h: m.hasActFamilies() }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.deepEqual(r, { s: { same: null, confidence: null, how: null, via: null, objectClass: null, family: null }, r: [], c: [], h: false });
});
