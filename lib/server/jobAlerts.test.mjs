// Job alerts: input cleaning, title words, radius (true / false / null), remote, modes.
// Run: node --test lib/server/jobAlerts.test.mjs
// Geocoding is a stub with the lib/geo/usPlaces.js interface, so these never depend on its data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanAlertsInput, cleanKeywords, titleMatches, matchAlertJob, matchAlerts, describeAlert, prefsFromRow,
  storedAlerts, cleanMode, cleanMiles, alertHeadline, alertDbTerm, MAX_ALERTS, DEFAULT_MILES,
} from './jobAlerts.js';

const PHX = { lat: 33.4484, lng: -112.074, name: 'Phoenix', state: 'AZ' };
const PLACES = {
  'phoenix, az': PHX, '85004': PHX,
  'tempe, az': { lat: 33.4255, lng: -111.94, name: 'Tempe', state: 'AZ' },
  'tucson, az': { lat: 32.2226, lng: -110.9747, name: 'Tucson', state: 'AZ' },
  arizona: { lat: 34.2, lng: -111.6, name: null, state: 'AZ', stateOnly: true },
};
const miles = (a, b) => {
  const R = 3958.76, r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const geo = {
  geocodePlace: (t) => PLACES[String(t || '').toLowerCase().trim()] || null,
  distanceMiles: miles,
  withinMiles(loc, origin, m) { const p = geo.geocodePlace(loc); return p ? miles(p, origin) <= m : null; },
};
const alertIn = (keywords, place, m) => ({ keywords, place, miles: m });
const phxAlert = (kw = 'cashier', m = 25) => cleanAlertsInput([alertIn(kw, 'Phoenix, AZ', m)], geo).alerts[0];

test('input: cleans, geocodes, keeps the place Seen understood', () => {
  const r = cleanAlertsInput([alertIn('  Warehouse   Associate ', '85004', 50), alertIn('Cashier', 'remote')], geo);
  assert.equal(r.ok, true);
  assert.deepEqual(r.alerts[0], { keywords: 'Warehouse Associate', place: 'Phoenix, AZ', remote: false, miles: 50, lat: PHX.lat, lng: PHX.lng });
  assert.deepEqual(r.alerts[1], { keywords: 'Cashier', place: 'Remote', remote: true, miles: null, lat: null, lng: null });
});

test('input: refuses bad radius, unknown place, empty words, too many alerts; clips long text', () => {
  assert.equal(cleanAlertsInput([alertIn('cashier', 'Phoenix, AZ', 30)], geo).field, 'miles');
  assert.equal(cleanAlertsInput([alertIn('cashier', 'Atlantis', 25)], geo).field, 'place');
  assert.equal(cleanAlertsInput([alertIn('cashier', '', 25)], geo).field, 'place');
  assert.match(cleanAlertsInput([alertIn('cashier', 'Arizona', 25)], geo).error, /whole state/);
  assert.equal(cleanAlertsInput([alertIn('  jobs ', 'Phoenix, AZ', 25)], geo).field, 'keywords');
  assert.equal(cleanAlertsInput([alertIn('<>', 'Phoenix, AZ', 25)], geo).field, 'keywords');
  const six = Array.from({ length: MAX_ALERTS + 1 }, (_, i) => alertIn(`role${i}`, 'remote'));
  assert.equal(cleanAlertsInput(six, geo).ok, false);
  assert.equal(cleanAlertsInput('cashier', geo).ok, false);
  assert.equal(cleanKeywords('x'.repeat(200)).length, 60);
  // A missing radius takes the default; the same alert twice is kept once.
  const d = cleanAlertsInput([{ keywords: 'cashier', place: 'Phoenix, AZ' }, alertIn('Cashiers', '85004', 25)], geo);
  assert.equal(d.alerts.length, 1);
  assert.equal(d.alerts[0].miles, DEFAULT_MILES);
  // A geocoder that throws is "not found", never a crash.
  assert.equal(cleanAlertsInput([alertIn('cashier', 'Phoenix, AZ', 25)], { geocodePlace: () => { throw new Error('x'); } }).field, 'place');
});

test('title: every word, any order, plurals; never a part of a word', () => {
  assert.equal(titleMatches('Cashier - Part Time', 'cashier'), true);
  assert.equal(titleMatches('Cashiers Needed', 'cashier'), true);
  assert.equal(titleMatches('Associate, Warehouse (Nights)', 'warehouse associate'), true);
  assert.equal(titleMatches('Warehouse Supervisor', 'warehouse associate'), false);
  assert.equal(titleMatches('Head Cashier', 'cash'), false);
  assert.equal(titleMatches('IT Support Specialist', 'IT support'), true);
});

test('radius: within (true), outside (false), unplaceable (null → no match unless the listing has coordinates)', () => {
  const a = phxAlert('cashier', 25);
  const near = matchAlertJob({ id: 1, title: 'Cashier', location: 'Tempe, AZ' }, a, geo);
  assert.equal(near.match, true);
  assert.equal(near.miles, 8);
  assert.equal(matchAlertJob({ id: 2, title: 'Cashier', location: 'Tucson, AZ' }, a, geo).match, false);
  assert.equal(matchAlertJob({ id: 3, title: 'Cashier', location: 'Somewhere' }, a, geo).match, false);
  assert.equal(matchAlertJob({ id: 4, title: 'Cashier', location: 'Somewhere', lat: 0, lng: 0 }, a, geo).match, false, '0,0 is not a place');
  assert.equal(matchAlertJob({ id: 5, title: 'Cashier', location: 'Somewhere', lat: 33.5, lng: -112.1 }, a, geo).match, true, 'its own coordinates place it');
  assert.equal(matchAlertJob({ id: 6, title: 'Stocker', location: 'Tempe, AZ' }, a, geo).match, false, 'title must match');
  assert.equal(matchAlertJob({ id: 7, title: 'Cashier', location: 'Tempe, AZ' }, a, null).match, false, 'no geo → no match');
  assert.equal(matchAlertJob({ id: 8, title: 'Cashier', location: 'Tucson, AZ' }, phxAlert('cashier', 100), geo).match, false, 'Tucson is ~106 mi out');
  assert.equal(matchAlertJob({ id: 9, title: 'Cashier', location: 'Tucson, AZ', lat: 32.2, lng: -110.9 }, phxAlert('cashier', 100), geo).match, false, 'a placeable text wins over coordinates');
});

test('remote: a Remote alert takes remote listings only; a local alert never takes a remote one', () => {
  const remote = cleanAlertsInput([alertIn('customer service', 'Remote')], geo).alerts[0];
  assert.equal(matchAlertJob({ id: 1, title: 'Customer Service Rep', location: 'Remote' }, remote, geo).match, true);
  assert.equal(matchAlertJob({ id: 2, title: 'Customer Service Rep', location: 'Remote - US' }, remote, geo).match, true);
  assert.equal(matchAlertJob({ id: 3, title: 'Customer Service Rep', location: 'Remote, United Kingdom' }, remote, geo).match, false);
  assert.equal(matchAlertJob({ id: 4, title: 'Customer Service Rep', location: 'Tempe, AZ' }, remote, geo).match, false);
  assert.equal(matchAlertJob({ id: 5, title: 'Cashier', location: 'Remote' }, phxAlert(), geo).match, false);
});

test('matchAlerts: first matching alert wins, one row per listing', () => {
  const alerts = [phxAlert('cashier'), cleanAlertsInput([alertIn('cashier', 'remote')], geo).alerts[0]];
  const out = matchAlerts([
    { id: 'a', title: 'Cashier', location: 'Tempe, AZ' },
    { id: 'a', title: 'Cashier', location: 'Tempe, AZ' },
    { id: 'b', title: 'Cashier', location: 'Remote' },
    { id: 'c', title: 'Cook', location: 'Tempe, AZ' },
  ], alerts, geo);
  assert.deepEqual(out.map((j) => [j.id, j._alert, j._remote]), [['a', 0, false], ['b', 1, true]]);
});

test('modes: no row = résumé; opt-out = off (keeps the last mode); alerts', () => {
  assert.deepEqual(prefsFromRow(null), { mode: 'resume', savedMode: 'resume', alerts: [] });
  assert.equal(prefsFromRow({ job_match_opt_out: true, job_match_mode: 'alerts' }).mode, 'off');
  assert.equal(prefsFromRow({ job_match_opt_out: true, job_match_mode: 'alerts' }).savedMode, 'alerts');
  const p = prefsFromRow({ job_match_opt_out: false, job_match_mode: 'alerts', job_alerts: [phxAlert(), { keywords: '', place: 'x' }, 'junk'] });
  assert.equal(p.mode, 'alerts');
  assert.equal(p.alerts.length, 1, 'malformed stored alerts are dropped');
  assert.equal(cleanMode('alerts'), 'alerts');
  assert.equal(cleanMode('everything'), null);
  assert.equal(cleanMiles(30), null);
  assert.equal(storedAlerts([{ keywords: 'cashier', place: 'Phoenix, AZ', miles: 30 }]).length, 0, 'a radius outside the set is dropped');
});

test('plain words for each alert and the email headline', () => {
  assert.equal(describeAlert(phxAlert('cashier', 25)), 'Jobs whose title has “cashier”, within 25 mi of Phoenix, AZ.');
  assert.equal(describeAlert(phxAlert('warehouse associate', 50)), 'Jobs whose title has the words “warehouse” and “associate”, within 50 mi of Phoenix, AZ.');
  assert.equal(describeAlert({ keywords: 'Cashier', place: 'remote' }), 'Remote jobs whose title has “cashier”.');
  assert.equal(alertHeadline(phxAlert('Cashier', 25)), 'cashier within 25 mi of Phoenix, AZ');
  assert.equal(alertDbTerm({ keywords: 'warehouse associate' }), 'warehouse');
});

test('with the real lib/geo/usPlaces.js: Phoenix alert takes Tempe, not Tucson; ZIP and state handled', async () => {
  const real = await import('../geo/usPlaces.js').catch(() => null);
  if (!real) return; // file not present in this checkout
  const r = cleanAlertsInput([alertIn('cashier', '85004', 25)], real);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.alerts[0].place, 'Phoenix, AZ');
  assert.equal(matchAlertJob({ id: 1, title: 'Cashier', location: 'Tempe, AZ' }, r.alerts[0], real).match, true);
  assert.equal(matchAlertJob({ id: 2, title: 'Cashier', location: 'Tucson, AZ' }, r.alerts[0], real).match, false);
  assert.equal(matchAlertJob({ id: 3, title: 'Cashier', location: 'Arizona' }, r.alerts[0], real).match, false, 'a whole state is not inside a radius');
  assert.equal(cleanAlertsInput([alertIn('cashier', 'Arizona', 25)], real).field, 'place');
});
