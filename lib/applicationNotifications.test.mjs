// Application updates for the notifications modal. Run: node --test lib/applicationNotifications.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationNotifications, unreadCount, lastSeenKey } from './applicationNotifications.js';

const T = Date.UTC(2026, 9, 18, 12, 0, 0);
const MIN = 60000;

const apps = [
  {
    id: 'a1', company: 'Seen Jobs', role: 'Barista', appliedAt: T - 5 * 86400000,
    events: [
      { type: 'application_submitted', date: T - 5 * 86400000, source: 'seen_apply' },
      { type: 'interview_received', date: T - 2 * 86400000, source: 'employer' },
      { type: 'rejected', date: T, source: 'employer' },
      { type: 'interview_received', date: T - 86400000, source: 'user' }, // the applicant's own log — not an update
    ],
    messages: [
      { from: 'employer', at: new Date(T - 3 * 86400000).toISOString(), text: 'Interview Tue 3pm — call 555-0100' },
      { from: 'employer', at: new Date(T + MIN).toISOString(), text: 'We went with another candidate.' }, // came with the decline
      { from: 'applicant', at: new Date(T + 2 * MIN).toISOString(), text: 'n/a', withdrawal: true },
    ],
    listingEditedAt: new Date(T - 4 * 86400000).toISOString(),
  },
  { id: 'a2', company: 'Hilton', role: 'Front desk', appliedAt: T, events: [], listingEditedAt: new Date(T - 86400000).toISOString() },
];

test('updates are what the employer did, newest first', () => {
  const items = applicationNotifications(apps);
  assert.deepEqual(items.map((i) => i.kind), ['status', 'status', 'message', 'edit']);
  assert.equal(items[0].text, 'Seen Jobs isn’t moving forward with your application');
  assert.equal(items[0].tone, 'bad');
  assert.equal(items[1].text, 'Seen Jobs moved you to interviewing');
  assert.equal(items[2].message, 'Interview Tue 3pm — call 555-0100');
  assert.equal(items[3].text, 'Seen Jobs edited the listing after you applied');
  for (const i of items) assert.equal(i.appId, 'a1');
});

test('a decline note is folded into the decline; the applicant’s own words and logs never show', () => {
  const items = applicationNotifications(apps);
  assert.equal(items[0].message, 'We went with another candidate.');
  assert.equal(items.filter((i) => i.kind === 'message').length, 1);
  assert.equal(items.some((i) => i.message === 'n/a'), false);
});

test('an edit before the application is not news', () => {
  assert.equal(applicationNotifications([apps[1]]).length, 0);
  assert.deepEqual(applicationNotifications(null), []);
  assert.deepEqual(applicationNotifications([{ id: 'x', events: [{ type: 'rejected', date: 'bad', source: 'employer' }] }]), []);
});

test('unread = arrived after the modal was last opened; key is per user', () => {
  const items = applicationNotifications(apps);
  assert.equal(unreadCount(items, 0), 4);
  assert.equal(unreadCount(items, T - 2.5 * 86400000), 2);
  assert.equal(unreadCount(items, T + 10 * MIN), 0);
  assert.notEqual(lastSeenKey('u1'), lastSeenKey('u2'));
});
