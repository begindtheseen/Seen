// Place suggestions and the fixed "City, ST" format (lib/geo/placeSuggest.js, served by api/places.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const t0 = performance.now();
const { suggestPlaces, resolvePlace, warmPlaceIndex } = await import('./placeSuggest.js');
warmPlaceIndex();
const coldMs = performance.now() - t0;
const { geocodePlace, placesByPopulation } = await import('./usPlaces.js');

const labels = (q) => suggestPlaces(q).map((s) => s.label);
const R = (q) => resolvePlace(q)?.label ?? null;

test('the owner\'s inputs all lead to "Phoenix, AZ"', () => {
  for (const q of ['phoenix', 'Phoenix AZ', 'phoenix, arizona', 'PHX', '85004', 'Phoenix, AZ', 'phoenix az 85004']) {
    assert.equal(R(q), 'Phoenix, AZ', q);
    assert.equal(labels(q)[0], 'Phoenix, AZ', q);
  }
  assert.equal(resolvePlace('85004').kind, 'zip');
  assert.equal(suggestPlaces('85004')[0].detail, 'ZIP 85004');
});

test('typing "pho" offers Phoenix, AZ first', () => {
  const s = suggestPlaces('pho');
  assert.equal(s[0].label, 'Phoenix, AZ');
  assert.ok(s.length > 1 && s.length <= 8);
  assert.equal(R('pho'), null); // a fragment is never "resolved"
});

test('the everyday name, never the Census legal name', () => {
  const table = [
    ['boise', 'Boise, ID'], ['boise id', 'Boise, ID'], ['Boise City', 'Boise, ID'],
    ['nashville', 'Nashville, TN'], ['indianapolis', 'Indianapolis, IN'], ['louisville', 'Louisville, KY'],
    ['honolulu', 'Honolulu, HI'], ['lexington ky', 'Lexington, KY'], ['ventura', 'Ventura, CA'],
    ['st louis', 'St. Louis, MO'], ['saint louis', 'St. Louis, MO'], ['St. Louis, MO', 'St. Louis, MO'],
    ['ft worth', 'Fort Worth, TX'], ['fort worth', 'Fort Worth, TX'],
    ['new york', 'New York, NY'], ['nyc', 'New York, NY'], ['washington dc', 'Washington, DC'], ['dc', 'Washington, DC'],
    ['salt lake city utah', 'Salt Lake City, UT'], ['winston salem', 'Winston-Salem, NC'], ['springfield, il', 'Springfield, IL'],
  ];
  for (const [q, want] of table) {
    assert.equal(R(q), want, q);
    assert.equal(labels(q)[0], want, q);
  }
  for (const q of ['boi', 'boise', 'nash', 'nashville', 'indy', 'indianapolis', 'louisv', 'honol']) {
    for (const l of labels(q)) assert.ok(!/Boise City, ID|Nashville-Davidson|Indianapolis city|Louisville\/Jefferson|Urban Honolulu/.test(l), `${q}: ${l}`);
  }
});

test('a whole state stays a state; "Remote" stays "Remote"', () => {
  assert.deepEqual(resolvePlace('texas'), { label: 'Texas', kind: 'state' });
  assert.deepEqual(resolvePlace('TX'), { label: 'Texas', kind: 'state' });
  assert.deepEqual(resolvePlace('new york state'), { label: 'New York State', kind: 'state' });
  assert.equal(suggestPlaces('texas')[0].label, 'Texas');
  assert.equal(suggestPlaces('tex')[0].label, 'Texas');
  assert.ok(labels('new york').includes('New York State'));
  assert.deepEqual(resolvePlace('remote'), { label: 'Remote', kind: 'remote' });
  assert.deepEqual(resolvePlace('work from home'), { label: 'Remote', kind: 'remote' });
  assert.equal(suggestPlaces('rem')[0].label, 'Remote');
  assert.equal(suggestPlaces('remote')[0].kind, 'remote');
});

test('"Springfield" is ambiguous: several suggestions, resolve keeps the text (null)', () => {
  const s = labels('Springfield');
  assert.equal(R('Springfield'), null);
  assert.ok(s.filter((l) => /^Springfield, [A-Z]{2}$/.test(l)).length >= 5, s.join(' · '));
  assert.equal(s[0], 'Springfield, MO'); // the most populous first
  assert.deepEqual(labels('springfield, il'), ['Springfield, IL']);
  assert.equal(labels('springfield ma')[0], 'Springfield, MA');
});

test('garbage and non-places are kept as typed', () => {
  for (const q of ['zzqx qwrt', 'asdfgh', 'Paris, France', 'Toronto, ON', 'near me', 'Phoenix; Dallas', '', '   ', '!!!']) {
    assert.equal(R(q), null, q);
  }
  assert.deepEqual(suggestPlaces('zzqx qwrt'), []);
  assert.deepEqual(suggestPlaces(''), []);
  // A bare small-town name is not silently turned into that town (Toronto, OH has 5k people) — but it is offered.
  assert.equal(R('toronto'), null);
  assert.ok(labels('toronto').includes('Toronto, OH'));
  assert.equal(R('toronto oh'), 'Toronto, OH');
});

test('a state after the name narrows the list, even half typed', () => {
  assert.deepEqual(labels('phoenix a'), ['Phoenix, AZ']);
  assert.equal(labels('portland, or')[0], 'Portland, OR');
  assert.equal(labels('portland me')[0], 'Portland, ME');
  assert.equal(labels('albany new york')[0], 'Albany, NY');
  assert.deepEqual(labels('west virginia'), ['West Virginia']); // the whole text is a state, not "West … , VA"
});

test('ZIP digits: 5 → its place; 3–4 → the places those ZIPs belong to', () => {
  assert.equal(labels('850')[0], 'Phoenix, AZ');
  assert.ok(suggestPlaces('850').every((s) => s.kind === 'zip'));
  assert.equal(labels('10001')[0], 'New York, NY');
  assert.deepEqual(suggestPlaces('00000'), []);
  assert.deepEqual(suggestPlaces('12'), []); // too short to mean anything
});

test('later-word matches come after name-prefix matches ("louis" → St. Louis)', () => {
  const s = labels('louis');
  assert.ok(s.includes('St. Louis, MO'), s.join(' · '));
  assert.ok(s.indexOf('Louisville, KY') < s.indexOf('St. Louis, MO'));
});

test('every suggested label is read back as itself by the job search reader (a fixed point)', () => {
  const all = placesByPopulation(0);
  const seen = new Set();
  for (let i = 0; i < all.length; i += 41) for (const s of suggestPlaces(all[i].name)) if (s.kind === 'place') seen.add(s.label);
  assert.ok(seen.size > 1000);
  const bad = [];
  for (const l of seen) {
    if (R(l) !== l) bad.push(`${l} → ${R(l)}`);
    const g = geocodePlace(l);
    if (!g || g.stateOnly || g.state !== l.slice(-2)) bad.push(`${l} geocodes to ${JSON.stringify(g)}`);
  }
  assert.deepEqual(bad.slice(0, 20), []);
});

test('fast: a cold index under 1.5 s, a warm uncached query well under 5 ms', () => {
  assert.ok(coldMs < 1500, `cold ${coldMs.toFixed(0)} ms`);
  const words = placesByPopulation(20000).map((e) => e.name.toLowerCase());
  const qs = [];
  for (const w of words) for (let n = 2; n <= Math.min(6, w.length); n++) qs.push(`${w.slice(0, n)}`);
  const uniq = [...new Set(qs)].slice(0, 3000);
  suggestPlaces('85004'); // the ZIP table is read on first use
  const a = performance.now();
  for (const q of uniq) suggestPlaces(q);
  const per = (performance.now() - a) / uniq.length;
  assert.ok(per < 5, `warm ${per.toFixed(3)} ms per query`);
  console.log(`# placeSuggest: cold index ${coldMs.toFixed(0)} ms; warm ${per.toFixed(3)} ms per uncached query over ${uniq.length} prefixes`);
});
