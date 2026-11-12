// The browser-safe place formatter (lib/geo/placeFormat.js): display tidying only, never a different place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocationText, placeKey, isRemoteText, stateLabel, looksFixed, STATE_NAMES } from './placeFormat.js';
import { geocodePlace } from './usPlaces.js';

test('normalizeLocationText tidies spacing, commas and case', () => {
  const cases = [
    ['phoenix ,az', 'Phoenix, AZ'],
    ['  phoenix,   az  ', 'Phoenix, AZ'],
    ['PHOENIX, AZ', 'Phoenix, AZ'],
    ['phoenix az', 'Phoenix AZ'],
    ['Phoenix Az', 'Phoenix AZ'],
    ['springfield', 'Springfield'],
    ['winston-salem, nc', 'Winston-Salem, NC'],
    ["o'fallon, mo", "O'Fallon, MO"],
    ['mcallen, tx', 'McAllen, TX'],
    ['village of oak creek', 'Village of Oak Creek'],
    [',,boise,, id,', 'Boise, ID'],
    ['McKinney, TX', 'McKinney, TX'], // mixed case is the person's own: kept
    ['DeKalb', 'DeKalb'],
    ['NYC', 'NYC'], // short all-caps (a nickname) is kept
    ['', ''],
    [null, ''],
  ];
  for (const [input, want] of cases) assert.equal(normalizeLocationText(input), want, JSON.stringify(input));
});

test('normalizeLocationText keepCase: spacing and commas only', () => {
  assert.equal(normalizeLocationText('  zzqx   qwrt ,ab ', { keepCase: true }), 'zzqx qwrt, ab');
  assert.equal(normalizeLocationText('springfield', { keepCase: true }), 'springfield');
});

test('normalizeLocationText keeps every word in order (display only)', () => {
  for (const t of ['asdf qwer', 'Paris, France', 'downtown phoenix', 'near me']) {
    assert.equal(normalizeLocationText(t).toLowerCase().replace(/[^a-z]/g, ''), t.toLowerCase().replace(/[^a-z]/g, ''));
  }
});

test('placeKey: one key for any spacing or case', () => {
  assert.equal(placeKey('  Phoenix,AZ '), 'phoenix, az');
  assert.equal(placeKey('phoenix ,  az'), 'phoenix, az');
  assert.equal(placeKey('PHX'), 'phx');
  assert.equal(placeKey(''), '');
});

test('isRemoteText', () => {
  for (const t of ['remote', 'Remote', 'fully remote', '100% remote', 'work from home', 'WFH', 'remote us']) assert.ok(isRemoteText(t), t);
  for (const t of ['remote phoenix', 'Remington', 'phoenix', '']) assert.ok(!isRemoteText(t), t);
});

test('every state label is read back as that whole state by the job search reader', () => {
  for (const code of Object.keys(STATE_NAMES)) {
    const label = stateLabel(code);
    if (code === 'DC') { assert.equal(label, null); continue; }
    const g = geocodePlace(label);
    assert.ok(g && g.stateOnly && g.state === code, `${label} → ${JSON.stringify(g)}`);
  }
  assert.equal(stateLabel('NY'), 'New York State'); // a lone "New York" is the city
  assert.equal(stateLabel('XX'), null);
});

test('looksFixed', () => {
  for (const t of ['Phoenix, AZ', 'St. Louis, MO', 'Washington, DC', 'Texas', 'New York State', 'Remote']) assert.ok(looksFixed(t), t);
  for (const t of ['phoenix, az', 'Phoenix AZ', 'Phoenix, AX', 'Phoenix', 'New York', 'remote', '85004', '']) assert.ok(!looksFixed(t), t);
});
