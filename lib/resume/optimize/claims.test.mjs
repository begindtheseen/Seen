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

test('round 5: meaning checks — qualifiers, frequency, labels, replaced lines; and the false refusals', async () => {
  const { mislabeled } = await import('./claims.js');
  // inflations that passed before
  assert.ok(codes(checkClaims('Prepare correspondence, pleadings and exhibit binders in Word', { before: 'Prepare correspondence, pleadings drafts and exhibit binders in Word', facts: [] })).includes('qualifier'));
  assert.ok(codes(checkClaims('Sold $180K in maintenance agreements in 2023', { before: 'Sold $180K in maintenance agreements and replacement leads in 2023', facts: [] })).includes('qualifier'));
  assert.ok(codes(checkClaims('Handle confidential attorney-client information daily', { before: 'Handle confidential attorney-client information', facts: ['Have you handled confidential information? Yes, regularly'] })).includes('frequency'));
  assert.equal(mislabeled('Rolled out to the team at a 7% hold rate', 'Reply rate settled around 7% after the manager rolled it out'), '"7% hold rate"');
  assert.equal(mislabeled('Lifted reply rate from 4% to 9%', 'lifted reply rate from 4% to 9%'), '');
  assert.ok(codes(checkClaims('Sold $180K in maintenance agreements and replacement leads, #2 of 11 techs', { before: 'Diagnose and repair refrigerant leaks, failed compressors, capacitors and control boards', facts: ['Sold $180K in maintenance agreements and replacement leads in 2023, #2 of 11 techs'] })).includes('replaced'));
  // false refusals from round 5
  assert.deepEqual(codes(checkClaims('Track weekly social and email results in Google Sheets', { before: 'Pulled weekly social and email numbers into a one-page report', facts: ['How do you build the report? I put it in a Google Sheet plus a one-page PDF in Canva'] })).filter((c) => c === 'new_term'), []);
  assert.deepEqual(codes(checkClaims('SDR with nearly 4 years of outbound', { facts: ['Booked 18 meetings a month'], history: [{ title: 'Sales Development Representative', company: 'Pipewell' }], isSummary: true })).filter((c) => c === 'new_term'), []);
  assert.deepEqual(codes(checkClaims('Batch PostgreSQL writes', { before: 'Batched Postgres writes', facts: [] })).filter((c) => c === 'new_term'), []);
});

test('round 6: derived points and "a day" are fine; the label check is for rates and money', () => {
  assert.deepEqual(codes(checkClaims('Hold a 94% CSAT, 6 points above the 88% team average; answer 60–70 calls daily (2024)', { before: 'Keep a 94% CSAT score against a team average of 88% (2024)', facts: ['Handle 60–70 inbound calls a day', 'Average handle time 6:10 against a 7:30 target'] })), []);
});

test('round 6: a length of time is checked against the person\'s own record', async () => {
  const { durationsMatch } = await import('./claims.js');
  const h = [{ months: 91 }, { months: 31 }, { months: 13 }];
  assert.equal(durationsMatch('7½ years managing calendars for 4 attorneys', h), true);
  assert.equal(durationsMatch('A 10-year admin career', h), true, 'the career, written down');
  assert.equal(durationsMatch('9 years managing calendars', h), false, 'never rounded up past the record');
  assert.equal(durationsMatch('Retail leader with 9 years', [{ months: 66 }], ['Retail leader with 9 years on the sales floor']), true, 'what the résumé states');
});

test('round 7: relabelled facts are refused; a paraphrase of two words and honest exam progress pass', () => {
  const f = ['Built and maintain the team\'s shared SQL view layer (25 views) in Snowflake'];
  assert.ok(codes(checkClaims('Write SQL in Snowflake; build the team\'s shared layer of 25 analytics tables and SQL pipelines', { before: f[0], facts: [] })).includes('new_words'));
  assert.ok(codes(checkClaims('Handle phone and chat support with average resolution time 6:10 against a 7:30 target, documenting interactions', { before: 'Average handle time 6:10 against a 7:30 target while keeping notes complete in Salesforce Service Cloud', facts: ['Calls and chats in Zendesk'] })).includes('new_words'));
  assert.deepEqual(codes(checkClaims('Covered 6 closing shifts in two weeks when the store was short-staffed', { before: 'Covered 6 closing shifts in two weeks', facts: ['When we were short-staffed in August'] })).filter((c) => c === 'new_words'), []);
  assert.deepEqual(codes(checkClaims('Passed FAR and AUD sections of the CPA exam in 2024', { facts: ['Passed FAR and AUD sections of the CPA exam in 2024; sitting for REG in 2025.'], resumeText: 'Passed FAR and AUD sections of the CPA exam in 2024; sitting for REG in 2025.' })).filter((c) => c === 'credential'), []);
  assert.ok(codes(checkClaims('Passed every health inspection with flawless food safety records', { before: 'Pass every health inspection since I started', facts: [] })).includes('level_word'));
  assert.ok(codes(checkClaims('Send 2 newsletter issues for campus events only', { before: 'Send newsletter issues for campus events', facts: ['2 issues'] })).includes('limits'));
});
