// Client helpers for saved résumés (lib/resumeChoice.js). Run: node --test lib/resumeChoice.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickerMode, defaultResume, canAddResume, capLine, optionLabel, chooseResumeId } from './resumeChoice.js';

const r = (id, is_default, usable = true) => ({ id, name: `R${id}`, is_default, usable });

test('the picker hides when not live or empty, shows a name for one, a choice for several', () => {
  assert.equal(pickerMode(null), 'hidden');
  assert.equal(pickerMode({ ready: false, resumes: [] }), 'hidden');
  assert.equal(pickerMode({ ready: true, resumes: [] }), 'hidden');
  assert.equal(pickerMode({ ready: true, resumes: [r('a', true)] }), 'name');
  assert.equal(pickerMode({ ready: true, resumes: [r('a', true), r('b', false)] }), 'select');
});

test('selection: the default, or the one asked for while it is usable', () => {
  const list = { ready: true, resumes: [r('a', false, false), r('b', true), r('c', false)] };
  assert.equal(defaultResume(list).id, 'b');
  assert.equal(chooseResumeId(list, null), 'b');
  assert.equal(chooseResumeId(list, 'c'), 'c');
  assert.equal(chooseResumeId(list, 'a'), 'b', 'a résumé that needs Pro is never selected');
  assert.equal(chooseResumeId(list, 'gone'), 'b');
});

test('the cap line is honest for free, Pro and a lapsed Pro account', () => {
  assert.equal(capLine({ ready: true, pro: false, max: 1, count: 1, resumes: [] }), '1 of 1 — keep up to 5 with Pro');
  assert.equal(capLine({ ready: true, pro: true, max: 5, count: 3, resumes: [] }), '3 of 5');
  assert.match(capLine({ ready: true, pro: false, max: 1, count: 3, resumes: [] }), /3 saved — only your default/);
  assert.equal(canAddResume({ ready: true, max: 5, count: 5 }), false);
  assert.equal(canAddResume({ ready: true, max: 5, count: 2 }), true);
  assert.equal(canAddResume({ ready: false, max: 5, count: 0 }), false);
  assert.equal(optionLabel(r('a', true)), 'Ra (default)');
  assert.equal(optionLabel(r('b', false, false)), 'Rb · Pro');
});
