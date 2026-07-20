import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveEmployerNotifications,
  STALE_AFTER_DAYS,
  EXPIRE_AFTER_DAYS,
  NEARING_WINDOW_DAYS,
  APPLICANT_WINDOW_DAYS,
} from './employerNotifications.js';

// A fixed "now" so every age computation is deterministic.
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const daysFromNow = (n) => new Date(NOW + n * 86400000).toISOString();
const find = (items, kind) => items.filter((i) => i.kind === kind);

// ── Thresholds must mirror api/refresh-jobs.js › markStaleJobs EXACTLY ──────────
test('thresholds are locked to the markStaleJobs rule (7d stale / 14d expire)', () => {
  assert.equal(STALE_AFTER_DAYS, 7);
  assert.equal(EXPIRE_AFTER_DAYS, 14);
  assert.ok(NEARING_WINDOW_DAYS >= 0 && NEARING_WINDOW_DAYS < STALE_AFTER_DAYS);
  assert.equal(APPLICANT_WINDOW_DAYS, 7);
});

// ── Empty / garbage input → empty, never throws ─────────────────────────────────
test('empty input yields an empty feed', () => {
  const { items, summary } = deriveEmployerNotifications({ jobs: [], applications: [], now: NOW });
  assert.deepEqual(items, []);
  assert.equal(summary.total, 0);
  assert.equal(summary.newApplicants, 0);
});

test('missing/undefined fields do not throw', () => {
  assert.doesNotThrow(() => deriveEmployerNotifications());
  assert.doesNotThrow(() => deriveEmployerNotifications({ jobs: [null, {}], applications: [null, {}], now: NOW }));
});

// ── Posting staleness, by explicit status ───────────────────────────────────────
test('a status=stale posting is a warning with days-until-expiry', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 1, title: 'Warehouse Associate', company: 'Acme', availability_status: 'stale', last_seen_at: daysAgo(9) }],
    now: NOW,
  });
  const stale = find(items, 'posting_stale');
  assert.equal(stale.length, 1);
  assert.equal(stale[0].severity, 'warning');
  // 9 days old → 14 - 9 = 5 days until expiry
  assert.equal(stale[0].daysUntilExpiry, 5);
  assert.match(stale[0].detail, /drop off Seen in 5 days/);
  // Aggregated decay is actionable ONE way: post it yourself (first-party).
  assert.equal(stale[0].action, 'post_yourself');
  assert.equal(stale[0].role, 'Warehouse Associate');
});

test('a status=expired posting is critical', () => {
  const { items, summary } = deriveEmployerNotifications({
    jobs: [{ id: 2, title: 'Driver', company: 'Acme', availability_status: 'expired', last_seen_at: daysAgo(20) }],
    now: NOW,
  });
  const expired = find(items, 'posting_expired');
  assert.equal(expired.length, 1);
  assert.equal(expired[0].severity, 'critical');
  assert.equal(summary.postingsExpired, 1);
});

// ── Posting staleness, by AGE even when status hasn't flipped yet ────────────────
test('an active posting last seen 8 days ago is stale by age (rule, not just status)', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 3, title: 'Cook', company: 'Acme', availability_status: 'active', last_seen_at: daysAgo(8) }],
    now: NOW,
  });
  assert.equal(find(items, 'posting_stale').length, 1);
});

test('an active posting last seen 15 days ago is expired by age', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 4, title: 'Cashier', company: 'Acme', availability_status: 'active', last_seen_at: daysAgo(15) }],
    now: NOW,
  });
  assert.equal(find(items, 'posting_expired').length, 1);
});

test('an active posting inside the nearing window warns before it goes stale', () => {
  // 6 days old, window is 2 → 7-2=5, so 6 >= 5 → nearing_stale
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 5, title: 'Barista', company: 'Acme', availability_status: 'active', last_seen_at: daysAgo(6) }],
    now: NOW,
  });
  const near = find(items, 'posting_nearing_stale');
  assert.equal(near.length, 1);
  assert.equal(near[0].severity, 'warning');
  assert.match(near[0].detail, /aging off Seen in 1 day\b/);
  assert.equal(near[0].action, 'post_yourself');
});

test('EMPLOYER-POSTED listings are exempt from staleness — no refresh nagging, ever', () => {
  // 10 days unseen would be stale-by-age for an aggregated row; employer rows are exempt
  // (the refresh-jobs sweep filters is_employer_posted) and live to their own expires_at.
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 9, title: 'Line Cook', company: 'Acme', availability_status: 'active', last_seen_at: daysAgo(10), is_employer_posted: true, expires_at: daysFromNow(40) }],
    now: NOW,
  });
  assert.equal(items.filter(i => i.kind.startsWith('posting_')).length, 0);
});

test('EMPLOYER-POSTED listing expiring within 7 days → repost action', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 10, title: 'Line Cook', company: 'Acme', availability_status: 'active', is_employer_posted: true, expires_at: daysFromNow(3) }],
    now: NOW,
  });
  const exp = find(items, 'posting_expiring');
  assert.equal(exp.length, 1);
  assert.equal(exp[0].severity, 'warning');
  assert.equal(exp[0].action, 'repost');
  assert.match(exp[0].title, /expires in 3 days/);
});

test('EMPLOYER-POSTED listing past expires_at → critical repost', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 11, title: 'Line Cook', company: 'Acme', availability_status: 'active', is_employer_posted: true, expires_at: daysAgo(1) }],
    now: NOW,
  });
  const exp = find(items, 'posting_expired');
  assert.equal(exp.length, 1);
  assert.equal(exp[0].severity, 'critical');
  assert.equal(exp[0].action, 'repost');
});

test('aggregated copy names the SOURCE, never tells the employer to "refresh"', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 12, title: 'Server', company: 'Acme', availability_status: 'stale', last_seen_at: daysAgo(9), source: 'Adzuna' }],
    now: NOW,
  });
  const stale = find(items, 'posting_stale');
  assert.equal(stale.length, 1);
  assert.match(stale[0].detail, /Adzuna/);
  assert.doesNotMatch(stale[0].detail, /refresh/i);
  assert.match(stale[0].detail, /Post it yourself/i);
});

test('a freshly-seen active posting produces NO notification', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 6, title: 'Server', company: 'Acme', availability_status: 'active', last_seen_at: daysAgo(1) }],
    now: NOW,
  });
  assert.equal(items.length, 0);
});

test('status=unknown carries no signal and is skipped', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [{ id: 7, title: 'Ghost', company: 'Acme', availability_status: 'unknown', last_seen_at: daysAgo(30) }],
    now: NOW,
  });
  assert.equal(items.length, 0);
});

test('duplicate job ids are de-duplicated', () => {
  const row = { id: 9, title: 'Clerk', company: 'Acme', availability_status: 'stale', last_seen_at: daysAgo(10) };
  const { items } = deriveEmployerNotifications({ jobs: [row, { ...row }], now: NOW });
  assert.equal(find(items, 'posting_stale').length, 1);
});

// ── New applicants ──────────────────────────────────────────────────────────────
test('recent applications group by role into a counted item with the latest time', () => {
  const { items, summary } = deriveEmployerNotifications({
    applications: [
      { role: 'Warehouse Associate', city: 'Dallas', status: 'applied', created_at: daysAgo(1) },
      { role: 'Warehouse Associate', city: 'Austin', status: 'applied', created_at: daysAgo(3) },
      { role: 'Driver', city: 'Dallas', status: 'applied', created_at: daysAgo(2) },
    ],
    now: NOW,
  });
  const apps = find(items, 'new_applicants');
  assert.equal(apps.length, 2);
  const warehouse = apps.find((a) => a.role === 'Warehouse Associate');
  assert.equal(warehouse.count, 2);
  assert.equal(warehouse.at, daysAgo(1)); // latest of the two
  assert.match(warehouse.title, /2 new applicants/);
  assert.equal(summary.newApplicants, 3);
});

test('applications older than the window are excluded', () => {
  const { items } = deriveEmployerNotifications({
    applications: [{ role: 'Old Role', created_at: daysAgo(APPLICANT_WINDOW_DAYS + 2) }],
    now: NOW,
  });
  assert.equal(find(items, 'new_applicants').length, 0);
});

test('future-dated applications are ignored (clock-skew guard)', () => {
  const { items } = deriveEmployerNotifications({
    applications: [{ role: 'Future', created_at: new Date(NOW + 5 * 86400000).toISOString() }],
    now: NOW,
  });
  assert.equal(find(items, 'new_applicants').length, 0);
});

test('applications with no created_at are skipped, never counted', () => {
  const { items } = deriveEmployerNotifications({
    applications: [{ role: 'NoDate' }, { role: 'HasDate', created_at: daysAgo(1) }],
    now: NOW,
  });
  const apps = find(items, 'new_applicants');
  assert.equal(apps.length, 1);
  assert.equal(apps[0].role, 'HasDate');
});

// ── Ordering + since-last-visit ─────────────────────────────────────────────────
test('feed is ordered critical → warning → info', () => {
  const { items } = deriveEmployerNotifications({
    jobs: [
      { id: 10, title: 'Stale One', availability_status: 'stale', last_seen_at: daysAgo(9) },
      { id: 11, title: 'Expired One', availability_status: 'expired', last_seen_at: daysAgo(20) },
    ],
    applications: [{ role: 'New Role', created_at: daysAgo(1) }],
    now: NOW,
  });
  assert.equal(items[0].severity, 'critical');
  assert.equal(items[items.length - 1].severity, 'info');
});

test('lastVisit flags newer items and counts them in the summary', () => {
  const { items, summary } = deriveEmployerNotifications({
    applications: [
      { role: 'Fresh', created_at: daysAgo(1) }, // after last visit
      { role: 'Older', created_at: daysAgo(5) }, // before last visit
    ],
    now: NOW,
    lastVisit: daysAgo(3),
  });
  const fresh = items.find((i) => i.role === 'Fresh');
  const older = items.find((i) => i.role === 'Older');
  assert.equal(fresh.isNew, true);
  assert.equal(older.isNew, false);
  assert.equal(summary.newSinceVisit, 1);
});

test('newSinceVisit is null when no lastVisit is supplied', () => {
  const { summary } = deriveEmployerNotifications({
    applications: [{ role: 'X', created_at: daysAgo(1) }],
    now: NOW,
  });
  assert.equal(summary.newSinceVisit, null);
});

// ── A realistic mixed feed ──────────────────────────────────────────────────────
test('a mixed employer feed produces the right shape and summary', () => {
  const { items, summary, thresholds } = deriveEmployerNotifications({
    jobs: [
      { id: 20, title: 'Line Cook', availability_status: 'expired', last_seen_at: daysAgo(16) },
      { id: 21, title: 'Dishwasher', availability_status: 'stale', last_seen_at: daysAgo(8) },
      { id: 22, title: 'Host', availability_status: 'active', last_seen_at: daysAgo(6) }, // nearing
      { id: 23, title: 'Manager', availability_status: 'active', last_seen_at: daysAgo(0) }, // healthy → none
    ],
    applications: [
      { role: 'Line Cook', city: 'Reno', created_at: daysAgo(2) },
      { role: 'Host', city: 'Reno', created_at: daysAgo(1) },
    ],
    now: NOW,
  });
  assert.equal(summary.postingsExpired, 1);
  assert.equal(summary.postingsStale, 1);
  assert.equal(summary.postingsNearingStale, 1);
  assert.equal(summary.newApplicants, 2);
  assert.equal(summary.total, 5); // 3 postings + 2 applicant-roles (Manager healthy → excluded)
  assert.equal(thresholds.STALE_AFTER_DAYS, 7);
  // every item carries the fields the page renders
  for (const it of items) {
    assert.ok(it.id && it.kind && it.severity && it.title && it.detail);
  }
});
