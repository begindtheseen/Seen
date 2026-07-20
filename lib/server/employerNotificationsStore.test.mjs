import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORED_NOTIFICATION_KINDS, buildNotificationRow, persistedToFeedItem, mergeFeed,
} from './employerNotificationsStore.js';

test('buildNotificationRow rejects unknown kinds and unscoped rows', () => {
  assert.equal(buildNotificationRow('bogus', { companyName: 'Acme' }), null);
  assert.equal(buildNotificationRow('apply_activity', {}), null); // no company key → never store unscoped
  const row = buildNotificationRow('apply_activity', { companyName: '  Acme Corp ', title: 'Someone applied', jobId: 7 });
  assert.equal(row.company_key, 'acme corp'); // normalized like the claims key
  assert.equal(row.company_name, '  Acme Corp ');
  assert.equal(row.kind, 'apply_activity');
  assert.equal(row.severity, 'info');
  assert.equal(row.job_id, '7');
  assert.equal(row.title, 'Someone applied');
});

test('buildNotificationRow derives severity + default title per kind', () => {
  assert.equal(buildNotificationRow('listing_reported', { companyKey: 'acme' }).severity, 'warning');
  assert.equal(buildNotificationRow('dispute_approved', { companyKey: 'acme' }).title, 'Your dispute was approved');
  assert.ok(STORED_NOTIFICATION_KINDS.includes('dispute_denied'));
});

test('mergeFeed sorts urgent-first and reports unread from persisted only', () => {
  const persisted = [
    { id: 1, kind: 'apply_activity', severity: 'info', title: 'Applied', body: 'x', created_at: '2026-07-10T00:00:00Z', read_at: null },
    { id: 2, kind: 'listing_reported', severity: 'warning', title: 'Reported', body: 'y', created_at: '2026-07-09T00:00:00Z', read_at: '2026-07-11T00:00:00Z' },
  ];
  const derived = [
    { id: 'job:1:posting_expired', kind: 'posting_expired', severity: 'critical', title: 'Expired', detail: 'z', at: '2026-07-08T00:00:00Z' },
  ];
  const { items, unread, storedCount } = mergeFeed(persisted, derived);
  assert.equal(items[0].severity, 'critical'); // derived critical floats to the top
  assert.equal(items[1].severity, 'warning');
  assert.equal(items[2].severity, 'info');
  assert.equal(unread, 1);        // only the unread persisted apply_activity
  assert.equal(storedCount, 2);
  // derived items are always treated as read (transient)
  assert.equal(items.find((i) => i.id === 'job:1:posting_expired').read, true);
});

test('persistedToFeedItem carries read state + stored flag', () => {
  const item = persistedToFeedItem({ id: 5, kind: 'dispute_denied', severity: 'info', title: 'Reviewed', body: null, created_at: '2026-07-10T00:00:00Z', read_at: null, job_id: 'j9', meta: { dispute_id: 5 } });
  assert.equal(item.id, 'evt:5');
  assert.equal(item.read, false);
  assert.equal(item.stored, true);
  assert.equal(item.jobId, 'j9');
  assert.deepEqual(item.meta, { dispute_id: 5 });
});
