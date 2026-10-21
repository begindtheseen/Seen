import test from 'node:test';
import assert from 'node:assert/strict';
import { planChange, findApplication, roleSimilarity } from './apply.js';

const AT = Date.parse('2026-10-21T17:00:00Z');
const app = (o) => ({ id: o.id || 'a1', company_name: 'Stripe', role: 'Account Executive', status: 'active', stage: 'Applied', applied_at: '2026-10-10T00:00:00Z', events: [{ id: 'e0', type: 'application_submitted', date: 1, source: 'user', confidence: 'low' }], ...o });

test('a confirmation with no card creates one, dated by the email, from the email source', () => {
  const p = planChange({ kind: 'application_received', company: 'Costco', role: 'Cashier', vendor: 'Workday' }, [], { at: AT });
  assert.equal(p.action, 'create');
  assert.deepEqual({ ...p.row, events: undefined }, { company_name: 'Costco', role: 'Cashier', city: '', platform: 'Workday', status: 'active', stage: 'Applied', applied_at: new Date(AT).toISOString(), events: undefined });
  assert.equal(p.row.events.length, 1);
  assert.equal(p.row.events[0].type, 'application_submitted');
  assert.equal(p.row.events[0].source, 'email');
  assert.equal(p.share, null, 'a confirmation is not an outcome');
});

test('a confirmation for a card the user already tracks changes nothing', () => {
  const p = planChange({ kind: 'application_received', company: 'Stripe, Inc.', role: 'Account Executive' }, [app({})], { at: AT });
  assert.deepEqual([p.action, p.appId], ['none', 'a1']);
});

test('a rejection closes the matching card and offers the one-tap share', () => {
  const p = planChange({ kind: 'rejection', company: 'Stripe', role: '' }, [app({})], { at: AT });
  assert.equal(p.action, 'update');
  assert.equal(p.patch.status, 'rejected');
  assert.equal(p.patch.stage, 'Rejected');
  assert.equal(p.patch.events.at(-1).type, 'rejected');
  assert.equal(p.share, 'rejected');
});

test('an interview raises the stage, never lowers it, and reopens a ghosted card', () => {
  const up = planChange({ kind: 'interview', company: 'Stripe', stage: 'Phone Screen' }, [app({ status: 'ghosted' })], { at: AT });
  assert.equal(up.patch.stage, 'Phone Screen');
  assert.equal(up.patch.status, 'active');
  const later = planChange({ kind: 'interview', company: 'Stripe', stage: 'Phone Screen' }, [app({ stage: 'Final Round' })], { at: AT });
  assert.equal(later.patch.stage, undefined, 'a final-round card stays final round');
  assert.equal(later.share, 'interview');
});

test('the same email event twice within 3 days is recorded once', () => {
  const first = planChange({ kind: 'interview', company: 'Stripe' }, [app({})], { at: AT });
  const again = planChange({ kind: 'interview', company: 'Stripe' }, [app({ events: first.patch.events })], { at: AT + 3600e3 });
  assert.equal(again.action, 'none');
});

test('hired or withdrawn cards are never reopened', () => {
  for (const status of ['hired', 'withdrawn']) assert.equal(planChange({ kind: 'rejection', company: 'Stripe' }, [app({ status })], { at: AT }).action, 'none');
});

test('a clearly different job at the same company is a new card', () => {
  const p = planChange({ kind: 'application_received', company: 'Stripe', role: 'Data Scientist' }, [app({})], { at: AT });
  assert.equal(p.action, 'create');
  assert.equal(findApplication([app({})], 'Stripe', 'Senior Account Executive').id, 'a1', 'a close title is the same job');
});

test('no company → unplaced; an alert/other → ignored', () => {
  assert.equal(planChange({ kind: 'interview', company: '' }, [app({})]).action, 'unplaced');
  assert.equal(planChange({ kind: 'other', company: 'Stripe' }, [app({})]).action, 'ignore');
});

test('an interview with no card creates one at the interview stage with an inferred apply event', () => {
  const p = planChange({ kind: 'interview', company: 'Ramp', stage: 'Phone Screen', vendor: null }, [], { at: AT });
  assert.equal(p.row.stage, 'Phone Screen');
  assert.equal(p.row.platform, 'Email');
  assert.deepEqual(p.row.events.map((e) => [e.type, e.source]), [['application_submitted', 'inferred'], ['interview_received', 'email']]);
});

test('company names match across legal suffixes and longer forms, not across different companies', () => {
  assert.ok(findApplication([app({ company_name: 'Chipotle Mexican Grill' })], 'Chipotle'));
  assert.equal(findApplication([app({ company_name: 'Compass Group' })], 'Compass Health'), null);
  assert.equal(roleSimilarity('Cashier', ''), null);
});
