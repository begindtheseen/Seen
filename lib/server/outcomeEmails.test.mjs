// Tests for the outcome follow-up email logic.
// Run: node --test lib/server/outcomeEmails.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWaiting, ageDays, milestoneForAge, dueMilestone, unsubToken, verifyUnsub, buildEmail } from './outcomeEmails.js';

const NOW = Date.parse('2026-07-05T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400e3).toISOString();

test('isWaiting excludes resolved outcomes, includes active/unknown', () => {
  for (const s of ['hired', 'rejected', 'ghosted', 'withdrawn', 'offer', 'HIRED']) {
    assert.equal(isWaiting({ status: s }), false, `${s} should be resolved`);
  }
  for (const s of ['active', 'applied', 'screening', 'interview', '', null, undefined]) {
    assert.equal(isWaiting({ status: s }), true, `${s} should be waiting`);
  }
});

test('ageDays anchors on applied_at, falls back to created_at, null when absent', () => {
  assert.equal(ageDays({ applied_at: daysAgo(9), created_at: daysAgo(20) }, NOW), 9);
  assert.equal(ageDays({ created_at: daysAgo(15) }, NOW), 15);
  assert.equal(ageDays({}, NOW), null);
  assert.equal(ageDays({ applied_at: 'not-a-date' }, NOW), null);
});

test('milestoneForAge buckets to the highest reached milestone', () => {
  assert.equal(milestoneForAge(6), null);
  assert.equal(milestoneForAge(7), 7);
  assert.equal(milestoneForAge(13), 7);
  assert.equal(milestoneForAge(14), 14);
  assert.equal(milestoneForAge(29), 14);
  assert.equal(milestoneForAge(30), 30);
  assert.equal(milestoneForAge(90), 30);
  assert.equal(milestoneForAge(null), null);
});

test('dueMilestone combines age + waiting status', () => {
  assert.equal(dueMilestone({ status: 'active', applied_at: daysAgo(8) }, NOW), 7);
  assert.equal(dueMilestone({ status: 'active', applied_at: daysAgo(31) }, NOW), 30);
  assert.equal(dueMilestone({ status: 'hired', applied_at: daysAgo(31) }, NOW), null); // resolved
  assert.equal(dueMilestone({ status: 'active', applied_at: daysAgo(3) }, NOW), null); // too new
});

test('unsubscribe token is a stable HMAC and verifies constant-time', () => {
  const secret = 'test-secret';
  const uid = 'user-123';
  const tok = unsubToken(uid, secret);
  assert.equal(tok, unsubToken(uid, secret)); // deterministic
  assert.ok(verifyUnsub(uid, tok, secret));
  assert.equal(verifyUnsub(uid, tok, 'wrong-secret'), false);
  assert.equal(verifyUnsub(uid, 'deadbeef', secret), false);
  assert.equal(verifyUnsub('other-user', tok, secret), false);
  assert.equal(verifyUnsub(uid, '', secret), false);
});

test('buildEmail produces distinct honest copy per milestone with working links', () => {
  const app = { id: 'a1', company: 'Aerotek', role: 'Warehouse Associate' };
  const links = { reportUrl: 'https://seenjobs.io/report?company=Aerotek', unsubUrl: 'https://seenjobs.io/api/unsubscribe?uid=a1&token=x' };

  const d7 = buildEmail(app, 7, links);
  assert.match(d7.subject, /Aerotek/);
  assert.match(d7.html, /Day 7 check-in/);
  assert.match(d7.html, /Did Aerotek respond/);
  assert.match(d7.html, /seenjobs\.io\/report\?company=Aerotek/);
  assert.match(d7.html, /api\/unsubscribe/);

  const d14 = buildEmail(app, 14, links);
  assert.match(d14.html, /interview with Aerotek/i);

  const d30 = buildEmail(app, 30, links);
  assert.match(d30.html, /What happened with Aerotek/);
  assert.match(d30.text, /Report the outcome:/);

  // Distinct subjects across milestones.
  assert.notEqual(d7.subject, d14.subject);
  assert.notEqual(d14.subject, d30.subject);
});

test('buildEmail escapes company/role to prevent HTML injection', () => {
  const app = { id: 'x', company: '<script>alert(1)</script>', role: 'Dev & Ops' };
  const { html } = buildEmail(app, 7);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Dev &amp; Ops/);
});
