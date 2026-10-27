// The place a person meant (audit 2026-10-27: "Anahiem ca" emptied every search; "LA" was Louisiana; "Arizona" was a
// 25-mile circle around the middle of the state; "pheonix" geocoded to a business in Round Rock, TX).
// Run: node --test lib/geo/resolveLocation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocation, stateBox, zip3Center, nearestPlace, normPlace } from './resolveLocation.js';
import { editDistance } from '../text/editDistance.js';

const city = (input) => { const r = resolveLocation(input); return r && r.kind === 'city' ? r : null; };

test('a misspelt city resolves to the city, and says it was corrected', () => {
  for (const [typed, label] of [['Anahiem ca', 'Anaheim, CA'], ['pheonix', 'Phoenix, AZ'], ['Tuscon', 'Tucson, AZ'], ['Los Angles', 'Los Angeles, CA'],
    ['San Fransisco', 'San Francisco, CA'], ['albequerque', 'Albuquerque, NM'], ['Chcago', 'Chicago, IL']]) {
    const r = city(typed);
    assert.ok(r, `${typed} resolved`);
    assert.equal(r.label, label, typed);
    assert.equal(r.corrected, true, `${typed} is flagged corrected`);
  }
});

test('exact names, "City ST", "City, State" and abbreviations resolve without a correction flag', () => {
  for (const [typed, label] of [['anaheim, CA', 'Anaheim, CA'], ['Phoenix', 'Phoenix, AZ'], ['phoenix az', 'Phoenix, AZ'], ['Phoenix, Arizona', 'Phoenix, AZ'],
    ['Tustin, CA', 'Tustin, CA'], ['boise', 'Boise, ID'], ['St. Louis, MO', 'St. Louis, MO'], ['saint louis', 'St. Louis, MO'], ['ft worth', 'Fort Worth, TX'],
    ['kansas city missouri', 'Kansas City, MO'], ['Kansas City, KS', 'Kansas City, KS'], ['glendale ca', 'Glendale, CA'], ['Nashville', 'Nashville, TN'],
    ['louisville ky', 'Louisville, KY'], ['Honolulu', 'Honolulu, HI'], ['New York', 'New York, NY'], ['washington dc', 'Washington, DC'], ['cerritos, ca', 'Cerritos, CA']]) {
    const r = city(typed);
    assert.ok(r, `${typed} resolved`);
    assert.equal(r.label, label, typed);
    assert.equal(r.corrected, false, `${typed} is not a correction`);
  }
});

test('nicknames and regions people type', () => {
  for (const [typed, label] of [['NYC', 'New York, NY'], ['LA', 'Los Angeles, CA'], ['sf', 'San Francisco, CA'], ['DC', 'Washington, DC'], ['philly', 'Philadelphia, PA'],
    ['vegas', 'Las Vegas, NV'], ['inland empire', 'Riverside, CA'], ['bay area', 'San Francisco, CA'], ['orange county', 'Orange County, CA'], ['OC', 'Orange County, CA']]) {
    assert.equal(city(typed)?.label, label, typed);
  }
});

test('a state on its own is a state, with a box that holds its cities', () => {
  for (const typed of ['Arizona', 'AZ', 'arizon']) {
    const r = resolveLocation(typed);
    assert.equal(r.kind, 'state', typed);
    assert.equal(r.state, 'AZ');
    assert.equal(r.label, 'Arizona');
  }
  assert.equal(resolveLocation('Washington').kind, 'state', 'Washington alone is the state');
  const box = stateBox('AZ');
  const phx = city('Phoenix, AZ'), tuc = city('Tucson, AZ'), flag = city('Flagstaff, AZ');
  for (const p of [phx, tuc, flag]) assert.ok(p.lat >= box.latMin && p.lat <= box.latMax && p.lng >= box.lngMin && p.lng <= box.lngMax, `${p.label} inside the AZ box`);
  const la = city('Los Angeles, CA');
  assert.ok(!(la.lng >= box.lngMin && la.lat <= box.latMax && la.lng <= box.lngMax && la.lat >= box.latMin), 'Los Angeles is not in Arizona');
});

test('ZIP codes, remote, foreign cities and nonsense', () => {
  assert.deepEqual(resolveLocation('85004'), { kind: 'zip', zip: '85004', input: '85004' });
  assert.equal(resolveLocation('Phoenix, AZ 85004').kind, 'zip');
  assert.equal(resolveLocation('remote').kind, 'remote');
  assert.equal(resolveLocation('Toronto').kind, 'unknown', 'not Toronto, OH');
  assert.equal(resolveLocation('London').kind, 'unknown', 'not London, KY');
  assert.equal(city('London, KY')?.label, 'London, KY', 'with a state it resolves');
  assert.equal(resolveLocation('xyzzy town').kind, 'unknown');
  assert.equal(resolveLocation(''), null);
});

test('a name typed part-way resolves only to a big city that owns the prefix', () => {
  assert.equal(city('phoe')?.label, 'Phoenix, AZ');
  assert.equal(city('anah')?.label, 'Anaheim, CA');
  assert.equal(resolveLocation('san').kind, 'unknown', 'too short to guess');
});

test('downtown centres for the big cities (not the Census internal point)', () => {
  const phx = city('Phoenix, AZ');
  // downtown Phoenix is ~33.45, -112.07; the Census internal point is 8.6 miles north at 33.57
  assert.ok(Math.abs(phx.lat - 33.45) < 0.06 && Math.abs(phx.lng + 112.07) < 0.06, `Phoenix centre ${phx.lat},${phx.lng}`);
  const sf = city('San Francisco, CA');
  assert.ok(sf.lng > -122.6, `San Francisco centre is on land (${sf.lng}), not at the Farallon Islands`);
});

test('ZIP prefix fallback and the place a point belongs to', () => {
  const z = zip3Center('85004');
  assert.ok(z && Math.abs(z.lat - 33.5) < 0.5 && Math.abs(z.lng + 112.1) < 0.6, 'the 850 prefix is the Phoenix area');
  assert.equal(nearestPlace(33.46, -112.07).label, 'Phoenix, AZ');
  assert.equal(nearestPlace(40.748, -73.994).label, 'New York, NY', 'Manhattan, not Hoboken');
});

test('helpers: place normalisation and the typo distance', () => {
  assert.equal(normPlace('St. Louis'), 'saint louis');
  assert.equal(normPlace('Ft. Worth'), 'fort worth');
  assert.equal(normPlace('Winston-Salem'), 'winston salem');
  assert.equal(editDistance('anahiem', 'anaheim'), 1, 'a swap of two letters is one edit');
  assert.equal(editDistance('electrition', 'electrician', 3), 2);
  assert.equal(editDistance('abc', 'xyzxyz', 2), 3, 'stops past the limit');
});
