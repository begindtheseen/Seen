// The cases the round-3 graders found (2026-10-25): each pinned by the real line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClaims, allowedNumbers, namedTerms, credentialsHeld, norm, unsupportedClaims } from './claims.js';

const codes = (r) => r.map((x) => x.code);

test('arithmetic a reader can check is allowed; an invented number is not', () => {
  const a = allowedNumbers(['Keep a 94% CSAT score against a team average of 88% (2024)', 'Saved 1 in 4 cancellation calls']);
  assert.ok(a.has('6') && a.has('25'));
  assert.deepEqual(codes(checkClaims('Hold a 94% CSAT, 6 points above the 88% team average (2024)', { before: 'Keep a 94% CSAT score against a team average of 88% (2024)', facts: [] })), []);
  assert.ok(codes(checkClaims('Hold a 94% CSAT, ranking 1st of 40', { before: 'Keep a 94% CSAT score against a team average of 88% (2024)', facts: [] })).includes('new_number'));
});

test('accents and slashes do not break names', () => {
  assert.equal(norm('Sauté/Grill'), 'saute grill');
  assert.deepEqual(codes(checkClaims('Work sauté and grill stations; bilingual English/Spanish', { before: 'Work sauté and grill', facts: ['Bilingual (English/Spanish)'] })), []);
  assert.deepEqual(namedTerms('Previously ran the floor. Built schedules in Kronos'), ['Kronos']);
});

test('a credential in progress is not held', () => {
  const resume = 'Passed FAR and AUD sections of the CPA exam in 2024; sitting for REG in 2025.';
  assert.deepEqual(credentialsHeld('Staff Accountant, CPA, with 5 years of close', resume), ['CPA']);
  assert.deepEqual(credentialsHeld('Holds ServSafe Manager', 'ServSafe Food Handler (2024)'), ['ServSafe Manager']);
  assert.deepEqual(credentialsHeld('ServSafe Food Handler certified', 'ServSafe Food Handler (2024)'), []);
});

test('level words, disqualifiers and availability need a source', () => {
  assert.ok(codes(checkClaims('Installed 300+ systems and mastered brazing and evacuation', { before: 'Installed 300+ systems with a two-person crew, brazing and evacuation', facts: [] })).includes('level_word'));
  assert.ok(codes(checkClaims('Prospect operations leaders (no IT/security buyer experience)', { before: 'Prospect operations leaders', facts: [] })).includes('disqualifier'));
  assert.ok(codes(checkClaims('ServSafe Food Handler certified; available evenings and weekends.', { facts: ['ServSafe Food Handler (2024)'], isSummary: true })).includes('availability'));
  assert.deepEqual(codes(checkClaims('Available evenings and weekends', { facts: [], answersText: 'Yes, I can work evenings and weekends', isSummary: true })), []);
});

test('the fact-checker\'s unsourced claims sink a line', () => {
  assert.deepEqual(unsupportedClaims({ claims: [{ claim: 'cut shrink 2.4% to 1.1%', source: ['J1.2'], supported: true }, { claim: 'trained the team', source: [], supported: false }] }), ['trained the team']);
});

test('round 4: on-call is experience, 4K is 4,000, a removed claim does not sink the line', () => {
  assert.ok(!codes(checkClaims('Go engineer on a one-week-in-five on-call rotation serving 4K requests/sec', { facts: ['Built the shipment-tracking event service in Go; 4,000 requests/sec at peak', 'On-call one week in five'], isSummary: true })).includes('availability'));
  assert.ok(!codes(checkClaims('Serve 4K requests/sec at peak', { before: 'Handled 4,000 requests/sec at peak', facts: [] })).includes('new_number'));
  assert.deepEqual(unsupportedClaims({ claims: [{ claim: 'ready for full P&L ownership at scale', source: [], supported: false }] }, 'Grew store sales 9% on $4.2M volume'), []);
});
