import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBullet } from './grammar.js';
import { verifyRewrite, isCosmetic } from './verify.js';

test('grammar: earlier jobs are past tense; the current job keeps its lead verb; joined verbs agree', () => {
  assert.equal(checkBullet('Lead the crew', { current: false }).text, 'Led the crew');
  assert.equal(checkBullet('Manages weekly schedules in Kronos', { current: true }).text, 'Manage weekly schedules in Kronos');
  assert.equal(checkBullet('Grew store sales 9% in 2023', { current: true }).text, 'Grew store sales 9% in 2023', 'a finished result may be past in the current job');
  assert.equal(checkBullet('Lead a crew of 14 and trained 9 new hires', { current: true }).text, 'Lead a crew of 14 and train 9 new hires');
  assert.equal(checkBullet('Built schedules and train 9 new hires', { current: false }).text, 'Built schedules and trained 9 new hires');
  assert.equal(checkBullet('Handled returns, cash handling and closing', { current: false }).text, 'Handled returns, cash handling and closing', 'a noun phrase is never conjugated');
  assert.equal(checkBullet('Cut shrink 54% and trained the team', { current: true }).text, 'Cut shrink 54% and trained the team', '"Cut" is past or present, so the joined verb is left as written');
  assert.equal(checkBullet('Cut shrink 54% and train the team', { current: false }).text, 'Cut shrink 54% and trained the team');
});

test('grammar: what cannot be fixed is refused', () => {
  for (const [t, code] of [['Responsible for weekly schedules', 'weak_lead'], ['I managed the floor', 'pronoun'], ['Results-driven leader who grew sales 9%', 'buzzword'], ['Customer service and cash handling', 'no_verb'], ['Managing the store', 'gerund_lead']]) {
    const r = checkBullet(t, { current: false });
    assert.equal(r.ok, false, t);
    assert.ok(r.issues.some((i) => i.code === code), `${t}: ${r.issues.map((i) => i.code)}`);
  }
});

test('verify: new numbers, new tools, new claims, lost numbers and synonym swaps are refused', () => {
  const R = 'Build weekly schedules in Kronos for 900+ labor hours and run the cash office\nCut shrink from 2.4% to 1.1% in 12 months';
  const v = (before, after) => verifyRewrite({ before, after, resumeText: R });
  assert.ok(v('Build weekly schedules in Kronos for 900+ labor hours', 'Built Workday schedules for 900+ labor hours, cutting overtime 15%').reasons.includes('new_number'));
  assert.ok(v('Build weekly schedules in Kronos for 900+ labor hours', 'Built Workday schedules for 900+ labor hours').reasons.includes('new_term'));
  assert.ok(v('Build weekly schedules in Kronos for 900+ labor hours and run the cash office', 'Run a 900+ hour weekly labor budget in Kronos and own the cash office').reasons.includes('new_claims'));
  assert.ok(v('Cut shrink from 2.4% to 1.1% in 12 months', 'Cut shrink in 12 months').reasons.includes('lost_number'));
  assert.ok(isCosmetic('Cut shrink from 2.4% to 1.1% in 12 months by tightening the fitting-room process', 'Reduced shrink from 2.4% to 1.1% in 12 months by tightening the fitting-room process'));
  assert.equal(v('Responsible for weekly schedules in Kronos', 'Build weekly schedules in Kronos').ok, true);
});
