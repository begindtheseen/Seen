// Unit tests for the Opportunity Engine. Run: node --test api/_utils/opportunityEngine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpportunities } from './opportunityEngine.js';

const now = Date.now();
const daysAgo = (d) => now - d * 86400000;

test('returns global profile opportunities even with no apps', () => {
  const out = buildOpportunities({ apps: [], answeredKeys: [], dailyEarned: 0 });
  assert.ok(out.length > 0);
  assert.ok(out.some((o) => o.key === 'opp_employment_status'));
  // every opportunity is survey-shaped
  for (const o of out) {
    assert.equal(typeof o.key, 'string');
    assert.equal(typeof o.text, 'string');
    assert.ok(Array.isArray(o.options) && o.options.length >= 2);
    assert.equal(o.credit_value, 1);
    assert.equal(o.source, 'engine');
  }
});

test('dedups already-answered keys', () => {
  const answered = ['opp_employment_status', 'opp_visa'];
  const out = buildOpportunities({ apps: [], answeredKeys: answered, dailyEarned: 0 });
  assert.ok(!out.some((o) => answered.includes(o.key)));
});

test('generates per-app apply_channel after a day', () => {
  const apps = [{ company: 'Stripe', role: 'SWE', status: 'active', appliedAt: daysAgo(3), events: [] }];
  const out = buildOpportunities({ apps, answeredKeys: [], dailyEarned: 0 });
  assert.ok(out.some((o) => o.key === 'opp_apply_channel|stripe'));
});

test('a rejected app surfaces tier-2 rejection_stage + would_reapply, ranked before tier-3 profile', () => {
  const apps = [{ company: 'Meta', role: 'PM', status: 'rejected', appliedAt: daysAgo(20), events: [{ type: 'response_received', date: daysAgo(10) }] }];
  const out = buildOpportunities({ apps, answeredKeys: [], dailyEarned: 0, maxQuestions: 20 });
  const keys = out.map((o) => o.key);
  assert.ok(keys.includes('opp_rejection_stage|meta'));
  assert.ok(keys.includes('opp_would_reapply|meta'));
  // tier-2 rejection question must come before a tier-3 profile question
  assert.ok(keys.indexOf('opp_rejection_stage|meta') < keys.indexOf('opp_visa'));
  // company-experience questions are flagged to feed reports
  const rej = out.find((o) => o.key === 'opp_rejection_stage|meta');
  assert.equal(rej.feeds_reports, true);
});

test('hired app asks offer details', () => {
  const apps = [{ company: 'Linear', role: 'Eng', status: 'hired', appliedAt: daysAgo(40), events: [{ type: 'offer_received', date: daysAgo(2) }] }];
  const out = buildOpportunities({ apps, answeredKeys: [], dailyEarned: 0, maxQuestions: 20 });
  const keys = out.map((o) => o.key);
  assert.ok(keys.includes('opp_offer_accepted|linear'));
  assert.ok(keys.includes('opp_offer_salary|linear'));
});

test('respects maxQuestions cap', () => {
  const apps = Array.from({ length: 10 }, (_, i) => ({ company: `Co${i}`, role: 'R', status: 'rejected', appliedAt: daysAgo(10), events: [] }));
  const out = buildOpportunities({ apps, answeredKeys: [], dailyEarned: 0, maxQuestions: 5 });
  assert.equal(out.length, 5);
});

test('resume signals add a skill-depth question', () => {
  const out = buildOpportunities({ apps: [], resumeSignals: { skills: ['Python', 'Go'] }, answeredKeys: [], dailyEarned: 0, maxQuestions: 20 });
  const skill = out.find((o) => o.key === 'opp_skill_depth');
  assert.ok(skill);
  assert.match(skill.text, /Python/);
});

test('no duplicate keys in output', () => {
  const apps = [
    { company: 'Stripe', role: 'A', status: 'ghosted', appliedAt: daysAgo(30), events: [] },
    { company: 'Stripe', role: 'B', status: 'ghosted', appliedAt: daysAgo(20), events: [] },
  ];
  const out = buildOpportunities({ apps, answeredKeys: [], dailyEarned: 0, maxQuestions: 20 });
  const keys = out.map((o) => o.key);
  assert.equal(keys.length, new Set(keys).size);
});
