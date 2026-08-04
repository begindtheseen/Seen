import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptToken, decryptToken, signState, verifyState, buildAuthUrl, buildGmailQuery,
  headerValue, gmailCaptureRow, GMAIL_SCOPES,
} from './gmailAuth.js';
import { captureToApplication, EVENT_TO_STAGE } from '../gmailCaptureMap.js';

test('token encryption round-trips; tamper/wrong-key fails closed', () => {
  const secret = 'super-secret-key';
  const enc = encryptToken('1//refresh-token-abc', secret);
  assert.ok(enc && enc.includes('.'));
  assert.equal(decryptToken(enc, secret), '1//refresh-token-abc');
  assert.equal(decryptToken(enc, 'wrong-key'), null);      // GCM auth fails
  assert.equal(decryptToken(enc.slice(0, -2) + 'xy', secret), null); // tampered ciphertext
  assert.equal(encryptToken('', secret), null);
});

test('state is HMAC-signed and verifies; forgery rejected', () => {
  const secret = 'jwt-secret';
  const uid = '3f1a2b4c-0000-4d5e-8f90-abcdef012345';
  const state = signState(uid, secret);
  assert.equal(verifyState(state, secret), uid);
  assert.equal(verifyState(state, 'other-secret'), null);
  assert.equal(verifyState(`${uid}.deadbeef`, secret), null);
  assert.equal(verifyState('garbage', secret), null);
});

test('auth URL requests offline metadata scope with the signed state', () => {
  const url = buildAuthUrl({ clientId: 'cid', redirectUri: 'https://seenjobs.io/api/gmail?action=callback', state: 'st' });
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  const q = new URL(url).searchParams;
  assert.equal(q.get('client_id'), 'cid');
  assert.equal(q.get('access_type'), 'offline');
  assert.equal(q.get('prompt'), 'consent');
  assert.equal(q.get('state'), 'st');
  assert.ok(q.get('scope').includes('gmail.metadata'));
  assert.ok(!q.get('scope').includes('gmail.readonly')); // never the restricted body scope
  assert.equal(GMAIL_SCOPES.length, 2);
});

test('gmail query narrows by recency + ATS senders + phrases', () => {
  const q = buildGmailQuery(14);
  assert.ok(q.includes('newer_than:14d'));
  assert.ok(q.includes('from:greenhouse.io'));
  assert.ok(q.includes('"application received"'));
  assert.equal(buildGmailQuery(0).includes('newer_than:1d'), true); // floored
});

test('headerValue is case-insensitive; capture row shape', () => {
  const headers = [{ name: 'From', value: 'Acme <no-reply@greenhouse.io>' }, { name: 'Subject', value: 'Update' }];
  assert.equal(headerValue(headers, 'from'), 'Acme <no-reply@greenhouse.io>');
  assert.equal(headerValue(headers, 'DATE'), '');
  const row = gmailCaptureRow('u1', 'msg123', { signature: 'sig', company: 'Acme', event: 'rejected', outcome: 'rejected', confidence: 'high', senderDomain: 'greenhouse.io' }, 1_700_000_000_000);
  assert.equal(row.user_id, 'u1');
  assert.equal(row.message_id, 'msg123');
  assert.equal(row.status, 'suggested');
  assert.equal(row.company, 'Acme');
});

test('captureToApplication maps events → stage and reuses add_application shape', () => {
  assert.equal(captureToApplication(null), null);
  assert.equal(captureToApplication({ event: 'rejected' }), null); // no company
  const app = captureToApplication({ company: 'Acme', event: 'interview_received', confidence: 'high', received_at: '2026-08-01T00:00:00Z', message_id: 'm1' });
  assert.equal(app.company, 'Acme');
  assert.equal(app.platform, 'Gmail');
  assert.equal(app.status, 'active');
  assert.equal(app.stage, 'Interview');
  assert.equal(app.events[0].source, 'gmail');
  assert.equal(app.events[0].type, 'interview_received');
  // rejected → status rejected, stage stays a valid pipeline position (terminal state is in status)
  const rej = captureToApplication({ company: 'B', event: 'rejected' });
  assert.equal(rej.status, 'rejected');
  assert.equal(rej.stage, 'Applied');
  assert.equal(typeof rej.appliedAt, 'number');
  assert.equal(EVENT_TO_STAGE.offer_received.stage, 'Offer');
});
