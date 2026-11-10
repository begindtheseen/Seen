// node --test lib/geo/radius.test.mjs — where a listing is, and whether it is inside a radius (lib/geo/radius.js).
// The location strings are real ones from Seen's listings (production, read-only, 2026-11-10) and the
// 682-posting corpus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeListing, withinRadius, placeSearch, isNonUsLocation, isRemoteListing, inState, RADIUS_OPTIONS } from './radius.js';
import { geocodePlace, distanceMiles, areaTextPatterns } from './usPlaces.js';

const where = (loc) => placeListing({ location: loc }).points.map((p) => `${p.name}, ${p.state}`);

// [location as stored, every place it names (in order)] — [] = no point (remote, country, a whole state, abroad).
const TABLE = [
  ['San Francisco, CA', ['San Francisco, CA']], ['Oshkosh, WI', ['Oshkosh, WI']], ['Rexburg, ID', ['Rexburg, ID']],
  ['Irvine, California, United States', ['Irvine, CA']], ['Eglin AFB, Florida, United States', ['Eglin AFB, FL']],
  ['Southaven, MS; Memphis, TN', ['Southaven, MS', 'Memphis, TN']],
  ['Chicago; Los Angeles; Minneapolis; New York', ['Chicago, IL', 'Los Angeles, CA', 'Minneapolis, MN', 'New York, NY']],
  ['Remote - USA; Santa Clara, California, USA', ['Santa Clara, CA']],
  ['Nashua, NH 03060 | 42.743827445 | -71.460572965', ['Nashua, NH']], ['Foxborough, MA 02035 | 42.063506338 | -71.242577636', ['Foxborough, MA']],
  ['Greater Seattle Area', ['Seattle, WA']], ['Greater Seattle Area, WA', ['Seattle, WA']], ['Greater Philadelphia, PA Area', ['Philadelphia, PA']],
  ['New York Metro Area', ['New York, NY']], ['New York Metropolitan - Hybrid', ['New York, NY']], ['Washington, DC Metro Area', ['Washington, DC']],
  ['WA - Seattle Metropolitan Area', ['Seattle, WA']], ['Denver Metro, CO', ['Denver, CO']], ['NC - Raleigh', ['Raleigh, NC']], ['AZ - Phoenix', ['Phoenix, AZ']],
  ['Phoenix Arizona', ['Phoenix, AZ']], ['phoenix az', ['Phoenix, AZ']], ['Phoenix, AZ 85004', ['Phoenix, AZ']], ['Hybrid - Phoenix', ['Phoenix, AZ']],
  ['Phoenix, AZ; Tempe, AZ', ['Phoenix, AZ', 'Tempe, AZ']], ['Denver, CO or Long Beach, CA', ['Denver, CO', 'Long Beach, CA']],
  ['San Francisco, CA | New York City, NY | Seattle, WA', ['San Francisco, CA', 'New York, NY', 'Seattle, WA']],
  ['San Francisco, CA, New York, NY, Portland, OR, or Remote within Canada or United States', ['San Francisco, CA', 'New York, NY', 'Portland, OR']],
  ['US - San Francisco, California, United States', ['San Francisco, CA']], ['SoHo, New York, NY (10004)', ['SoHo, NY', 'New York, NY']],
  ['7955 W Grand Ave, Elmwood Park, IL 60707', ['Elmwood Park, IL']], ['9701 Veirs Dr, Rockville, MD 20850', ['Rockville, MD']],
  ['10777 Westheimer Road, Suite 400, Houston, Texas 77042', ['Houston, TX']], ['13945 W Sunrise Blvd Sunrise, FL 33323', ['Sunrise, FL']],
  ['8174 Clarcona Ocoee Road, Orlando, FL 32818, USA', ['Orlando, FL']], ['Emeryville, California, United States; Hybrid (2-3 days on-site)', ['Emeryville, CA']],
  ['Hybrid - New York, NY', ['New York, NY']], ['Chicago, IL (Hybrid workplace)', ['Chicago, IL']], ['Phoenix, Maricopa County', ['Phoenix, AZ']],
  ['Los Angeles, Los Angeles County', ['Los Angeles, CA']], ['Houston, Harris County', ['Houston, TX']], ['Fort Collins, Colorado, United States', ['Fort Collins, CO']],
  ['Hill AFB, UT', ['Hill AFB, UT']], ['Fort Meade, MD; Chambersburg, PA; Alexandria, VA', ['Fort Meade, MD', 'Chambersburg, PA', 'Alexandria, VA']],
  ['US > Arizona > Phoenix', ['Phoenix, AZ']], ['US > Idaho > Boise', ['Boise, ID']], ['US > New Jersey > Mt Laurel', ['Mount Laurel, NJ']],
  ['Provo, UT, USA', ['Provo, UT']], ['Cambridge, MA USA', ['Cambridge, MA']], ['San Mateo, CA United States', ['San Mateo, CA']],
  ['Orlando, FL (North)', ['Orlando, FL']], ['Seymour, MO (Forge & Build)', ['Seymour, MO']], ['Moberly, MO (Industrial & Upfitting)', ['Moberly, MO']],
  ['Monaca, PA (Tooling Solutions) (Onsite Yard)', ['Monaca, PA']], ['US-Remote, US-Chicago', ['Chicago, IL']], ['US-CA-Dublin', ['Dublin, CA']],
  ['US-CA-Menlo Park', ['Menlo Park, CA']], ['US CA San Mateo', ['San Mateo, CA']], ['US Broomfield, CO', ['Broomfield, CO']],
  ['Bozeman, MT', ['Bozeman, MT']], ['Missoula, MT (Core Solutions)', ['Missoula, MT']], ['Indianapolis, IN', ['Indianapolis, IN']],
  ['Boise, ID', ['Boise, ID']], ['Starbase, TX', ['Starbase, TX']], ['Playa Vista, California, United States', ['Playa Vista, CA']],
  ['Edison, NJ', ['Edison, NJ']], ['Mt. Juliet, TN', ['Mount Juliet, TN']], ['Austin, in-person', ['Austin, TX']], ['San Francisco - 1800 Owens', ['San Francisco, CA']],
  ['KPNX-TV Phoenix', ['Phoenix, AZ']], ['WXIA WATL-TV Atlanta', ['Atlanta, GA']], ['Remote (Austin, TX)', ['Austin, TX']],
  ['Mather HQ (Evanston, IL)', ['Evanston, IL']], ['Woodfield Mall, Schaumburg, IL (10112)', ['Schaumburg, IL']],
  ['Glendale, Los Angeles County', ['Glendale, CA']], ["Mechanicsville, St. Mary's County", ['Mechanicsville, MD']],
  ['Fayetteville, Washington County', ['Fayetteville, AR']], ['Montpelier, Washington County', ['Montpelier, VT']],
  ['Pico Heights, Los Angeles County', ['Los Angeles, CA']], ['Stock Yards, Cook County', ['Chicago, IL']],
  ['Kansas City', ['Kansas City, MO']], ['Portland', ['Portland, OR']],
  // No point:
  ['United States', []], ['USA', []], ['Remote', []], ['Remote - US', []], ['US (Remote)', []], ['US Remote / Hybrid (NavVis Inc.)', []],
  ['Massachusetts - Hybrid', []], ['Arizona', []], ['Remote - FL; Remote - MA; Remote - MD', []], ['Multiple Locations', []],
  ['Glendale', []], ['Springfield', []], ['Progress, Washington County', []], ['US - Southeast (Region: Atlanta, GA)', ['Atlanta, GA']],
  ['Toronto, ON', []], ['London, UK', []], ['Remote - European Region', []], ['Dakar, Senegal', []], ['Virginia Water, Surrey, England', []],
  ['near me', []], ['Gladstone, VA (Nelson County)', []],
];

test(`placeListing: ${TABLE.length} real location strings`, () => {
  assert.ok(TABLE.length >= 60);
  for (const [loc, want] of TABLE) assert.deepEqual(where(loc), want, loc);
});

test('a state named in the line holds the place chosen (homonyms resolve inside it)', () => {
  for (const [loc, st] of [['Glendale, AZ', 'AZ'], ['Glendale, CA', 'CA'], ['Springfield, IL', 'IL'], ['Aurora, IL', 'IL'], ['Columbia, MO', 'MO'],
    ['Mechanicsville, MD', 'MD'], ['Portland, ME', 'ME'], ['Kansas City, KS', 'KS'], ['Arlington, VA', 'VA'], ['Phoenix, OR', 'OR']]) {
    const p = placeListing({ location: loc }).points;
    assert.ok(p.length && p.every((x) => x.state === st), `${loc} → ${p.map((x) => x.state)}`);
  }
});

test('non-US lines are marked us:false and have no point; US lines are not', () => {
  for (const t of ['Remote - European Region', 'Remote, Senegal', 'Dakar, Senegal', 'Remote - EMEA', 'London office', 'Remote - Canada', 'Virginia Water, Surrey, England']) {
    assert.equal(isNonUsLocation(t), true, t);
    assert.equal(placeListing({ location: t }).us, false, t);
  }
  for (const t of ['Lebanon, PA', 'New England', 'Remote - US', 'Phoenix, AZ', 'Mexico, MO', 'Remote']) assert.equal(isNonUsLocation(t), false, t);
});

test('remote: says remote and not hybrid', () => {
  assert.equal(isRemoteListing({ location: 'Remote - Phoenix, AZ' }), true);
  assert.equal(isRemoteListing({ location: 'Phoenix, AZ', type: 'Remote' }), true);
  assert.equal(isRemoteListing({ location: 'Hybrid remote in Phoenix, AZ' }), false);
  assert.equal(isRemoteListing({ location: 'Phoenix, AZ' }), false);
});

test('withinRadius: coordinates first, else text; any named place counts; state-only never; exact edge', () => {
  const phx = geocodePlace('Phoenix, AZ');
  assert.deepEqual(withinRadius({ location: 'Tempe, AZ' }, phx, 25), { in: true, miles: 9.8, by: 'text', place: 'Tempe, AZ' });
  assert.equal(withinRadius({ location: 'Tucson, AZ' }, phx, 25).in, false);
  assert.equal(withinRadius({ location: 'Phoenix, AZ', lat: 32.22, lng: -110.97 }, phx, 25).in, false, 'one named place + coordinates → the coordinates');
  assert.equal(withinRadius({ location: 'Austin, TX; Tempe, AZ' }, phx, 25).in, true, 'any place of a multi-place listing');
  assert.equal(withinRadius({ location: 'Arizona', lat: 34.17, lng: -111.93 }, phx, 500).in, false, 'a state is never a point');
  assert.equal(withinRadius({ location: 'Remote' }, phx, 100).in, false);
  const c = withinRadius({ location: 'Pico Heights, Los Angeles County' }, geocodePlace('Los Angeles, CA'), 10);
  assert.equal(c.in, true); assert.equal(c.by, 'county'); assert.equal(c.place, 'Los Angeles County, CA');
  assert.equal(withinRadius({ location: 'Glendale, Los Angeles County' }, geocodePlace('Mesa, AZ'), 25).in, false, 'Glendale CA is not near Mesa');
  assert.equal(withinRadius({ location: 'Glendale, Los Angeles County' }, geocodePlace('Los Angeles, CA'), 25).in, true);
  // the edge is the distance as shown, in tenths of a mile: Tempe shows 9.8 mi → in at 9.8, out at 9.7
  const t = withinRadius({ location: 'Tempe, AZ' }, phx, 100);
  assert.equal(withinRadius({ location: 'Tempe, AZ' }, phx, 9.8).in, true);
  assert.equal(withinRadius({ location: 'Tempe, AZ' }, phx, 9.7).in, false);
  assert.equal(t.miles, 9.8);
  assert.equal(withinRadius({ location: 'KPNX-TV Phoenix' }, phx, 10).in, true);
  assert.equal(withinRadius({ location: 'Our Phoenix newsroom' }, phx, 10, { nameKey: 'phoenix' }).by, 'name', 'unplaceable text naming the city');
});

test('property: widening 10 → 25 → 50 → 100 never drops a row (every table string × 12 centres)', () => {
  const centres = ['Phoenix, AZ', 'Los Angeles, CA', 'Houston, TX', 'New York, NY', 'Chicago, IL', 'Seattle, WA', 'Denver, CO', 'Edison, NJ', 'Boise, ID', 'Atlanta, GA', '85004', 'Bozeman, MT'].map(geocodePlace);
  const rows = [...TABLE.map(([location]) => ({ location })), { location: 'Mesa, AZ', lat: 33.42, lng: -111.83 }, { location: 'Remote (Austin, TX)' }];
  for (const c of centres) {
    let prev = null;
    for (const m of RADIUS_OPTIONS) {
      const ins = new Set(rows.filter((r) => withinRadius(r, c, m).in).map((r) => r.location));
      if (prev) for (const l of prev) assert.ok(ins.has(l), `${l} dropped at ${m} mi`);
      prev = ins;
    }
  }
});

test('placeSearch: what a person types', () => {
  const s = (t) => { const r = placeSearch(t); return `${r.kind}:${r.label}${r.reason ? `:${r.reason}` : ''}`; };
  assert.equal(s('Phoenix'), 'point:Phoenix, AZ');
  assert.equal(s('phoenix az'), 'point:Phoenix, AZ');
  assert.equal(s('Tempe'), 'point:Tempe, AZ');
  assert.equal(s('85004'), 'point:85004 (Phoenix, AZ)');
  assert.equal(s('Missoula MT'), 'point:Missoula, MT');
  assert.equal(s('Arizona'), 'state:Arizona');
  assert.equal(s('TX'), 'state:Texas');
  assert.equal(s('Remote'), 'remote:Remote jobs in the US');
  for (const t of ['near me', 'nearby', 'my location', 'Current location']) assert.equal(placeSearch(t).reason, 'needs_position', t);
  // A clear near-miss resolves, saying what was understood (round 7).
  assert.equal(placeSearch('Pheonix').label, 'Phoenix, AZ'); assert.equal(placeSearch('Pheonix').understood, 'Pheonix');
  assert.equal(placeSearch('Los Angles').label, 'Los Angeles, CA');
  assert.equal(placeSearch('Phoenix, TX').reason, 'not_in_state');
  assert.ok(placeSearch('Phoenix, TX').suggestions.every((x) => x.endsWith(', TX')), 'suggestions only from the state named');
  assert.equal(placeSearch('Toronto, ON').reason, 'non_us');
  assert.deepEqual(placeSearch('Toronto, ON').suggestions, []);
  assert.equal(placeSearch('Glendale').reason, 'ambiguous');
  assert.deepEqual(placeSearch('Glendale').suggestions.slice(0, 2), ['Glendale, AZ', 'Glendale, CA']);
  assert.equal(placeSearch('').reason, 'empty');
  assert.equal(placeSearch('00000').kind, 'none');
});

test('inState: a place in the state or the state named alone', () => {
  assert.equal(inState({ location: 'Flagstaff, AZ' }, 'AZ'), true);
  assert.equal(inState({ location: 'Arizona' }, 'AZ'), true);
  assert.equal(inState({ location: 'Remote - Arizona' }, 'AZ'), true);
  assert.equal(inState({ location: 'Austin, TX; Tempe, AZ' }, 'AZ'), true);
  assert.equal(inState({ location: 'Austin, TX' }, 'AZ'), false);
});

test('areaTextPatterns: a wider circle carries every pattern of a narrower one', () => {
  const c = geocodePlace('Phoenix, AZ');
  const p10 = new Set(areaTextPatterns(c, 10));
  const p25 = new Set(areaTextPatterns(c, 25));
  for (const p of p10) assert.ok(p25.has(p), p);
  assert.ok(p25.has('*phoenix*') && p25.has('*tempe*'), 'big places bare');
  const chi = new Set(areaTextPatterns(geocodePlace('Chicago, IL'), 25));
  assert.ok(chi.has('*lombard*il*') && chi.has('*il*lombard*') && chi.has('*lombard*illinois*'), 'short small-place names read beside their state');
  assert.ok(p25.has('*fountain hills*'), 'distinctive names read bare');
  assert.ok(p25.has('*guadalupe*az*') && !p25.has('*guadalupe*'), 'a name a bigger place elsewhere shares is read beside its state');
  assert.ok(new Set(areaTextPatterns(geocodePlace('Lexington Park, MD'), 25)).has('*california*maryland*') && !new Set(areaTextPatterns(geocodePlace('Lexington Park, MD'), 25)).has('*california*'), 'California, MD never reads every California row');
  assert.ok(p25.has('*maricopa county*'), 'counties in reach');
  assert.ok(p25.has('850__') && p25.has('850__-*'), 'ZIP-only lines by 3-digit prefix, whole value');
});

test('round 2: a known town in its county is the town; a county alone is its largest city, never its middle', () => {
  const la = geocodePlace('Los Angeles, CA');
  const corona = withinRadius({ location: 'Corona, Riverside County' }, la, 50);
  assert.equal(corona.in, true); assert.equal(corona.by, 'text'); assert.equal(corona.place, 'Corona, CA');
  assert.ok(corona.miles > 35 && corona.miles < 45, `${corona.miles}`);
  for (const [loc, city] of [['Somewhere, Riverside County', 'Riverside'], ['Nowhere, Maricopa County', 'Phoenix'], ['Strip, Clark County', 'Las Vegas'],
    ['Oilfield, Kern County', 'Bakersfield'], ['Palms, Los Angeles County', 'Los Angeles'], ['Orange County, CA', 'Anaheim']]) {
    const p = placeListing({ location: loc }).points[0];
    assert.equal(p && p.name, city, loc);
    assert.equal(p.by, 'county', loc);
  }
  assert.equal(where('Henderson, Clark County')[0], 'Henderson, NV');
  assert.equal(where('Orlando, Orange County')[0], 'Orlando, FL');
});

test('round 3: remote ONLY vs an office with a remote option; "West New York"; distance as shown', () => {
  const r = (loc) => placeListing({ location: loc });
  assert.equal(r('New York, NY/Remote').remoteOnly, false);
  assert.equal(r('San Francisco, CA, New York, NY, Portland, OR, or Remote within United States').remoteOnly, false);
  assert.equal(r('Phoenix, AZ or Remote').remoteOnly, false);
  assert.equal(r('Remote - Phoenix, AZ').remoteOnly, true);
  assert.equal(r('Remote (Austin, TX)').remoteOnly, true);
  assert.equal(r('Remote').remoteOnly, true);
  assert.deepEqual(where('West New York, Hudson County'), ['West New York, NJ']);
  assert.deepEqual(where('Salt Lake City Utah'), ['Salt Lake City, UT']);
  // Downey is 10.016 mi from downtown Los Angeles: shown as "10.0 mi", so inside a 10-mile search.
  const d = withinRadius({ location: 'Downey, Los Angeles County' }, geocodePlace('Los Angeles, CA'), 10);
  assert.equal(d.miles, 10); assert.equal(d.in, true);
});

test('round 6: a ZIP is its own city and state; a non-ZCTA ZIP by its neighbours; a ZIP with a state is the ZIP', () => {
  const L = (t) => placeSearch(t).label;
  assert.equal(L('10001'), '10001 (New York, NY)', 'never Hoboken across the river');
  assert.equal(L('07030'), '07030 (Hoboken, NJ)');
  assert.equal(L('66101'), '66101 (Kansas City, KS)');
  assert.equal(L('64106'), '64106 (Kansas City, MO)');
  assert.equal(L('41011'), '41011 (Covington, KY)');
  assert.equal(L('98661'), '98661 (Vancouver, WA)');
  assert.equal(L('62201'), '62201 (Fairmont City, IL)', 'round 7: the place holding the largest share of the ZIP area');
  assert.equal(L('37201'), '37201 (Nashville, TN)');
  const po = placeSearch('85001');
  assert.equal(po.label, '85001 (Phoenix, AZ)');
  assert.ok(distanceMiles(po, geocodePlace('Phoenix, AZ')) < 15, 'Phoenix PO boxes sit among the Phoenix ZIPs');
  assert.equal(L('12345'), '12345 (Schenectady, NY)');
  assert.equal(placeSearch('00501').reason, 'unknown', 'no ZIP area shares 005');
  for (const t of ['85001 AZ', 'AZ 85001', '85001, Arizona']) { assert.equal(placeSearch(t).kind, 'point', t); assert.equal(L(t), '85001 (Phoenix, AZ)', t); }
  assert.equal(placeSearch('85001 TX').reason, 'not_in_state');
});

test('round 6: every ZIP in the data is labelled in its own state (33,774 ZIP areas)', async () => {
  const { allZips } = await import('./usPlaces.js');
  const { prefixState } = await import('./zipPrefixes.js');
  const wrong = [], prefixOff = [];
  for (const [zip, own] of allZips()) {
    const r = placeSearch(zip);
    if (r.state !== own.state) wrong.push(`${zip}: ${r.label} (own ${own.state})`);
    const ps = prefixState(zip);
    if (ps && r.state !== ps) prefixOff.push(zip);
  }
  assert.ok(allZips().length > 33000);
  assert.deepEqual(wrong, []);
  // ZIP areas whose land lies wholly outside their USPS prefix state (Fishers Island NY uses CT's 063; Alta WY uses
  // ID's 834; Texhoma's 73960 area lies in Texas): labelled where the place is.
  assert.deepEqual(prefixOff.sort(), ['06390', '73960', '83414']);
});

// Round 7: understanding the input.
const MISSPELT = [
  ['New Yrok', 'New York', 'NY'], ['Los Angles', 'Los Angeles', 'CA'], ['Chicgo', 'Chicago', 'IL'], ['Huston', 'Houston', 'TX'],
  ['Pheonix', 'Phoenix', 'AZ'], ['Philidelphia', 'Philadelphia', 'PA'], ['San Antono', 'San Antonio', 'TX'], ['San Deigo', 'San Diego', 'CA'],
  ['Dalas', 'Dallas', 'TX'], ['Jacksonvile', 'Jacksonville', 'FL'], ['Austn', 'Austin', 'TX'], ['Fort Wroth', 'Fort Worth', 'TX'],
  ['San Jsoe', 'San Jose', 'CA'], ['Columbis', 'Columbus', 'OH'], ['Charolette', 'Charlotte', 'NC'], ['Indianapolous', 'Indianapolis', 'IN'],
  ['San Fransisco', 'San Francisco', 'CA'], ['Seatle', 'Seattle', 'WA'], ['Denvr', 'Denver', 'CO'], ['Oklahoma Cty', 'Oklahoma City', 'OK'],
  ['Nashvile', 'Nashville', 'TN'], ['El Paos', 'El Paso', 'TX'], ['Las Vagas', 'Las Vegas', 'NV'], ['Bostn', 'Boston', 'MA'],
  ['Detriot', 'Detroit', 'MI'], ['Portand', 'Portland', 'OR'], ['Louisvile', 'Louisville', 'KY'], ['Memphs', 'Memphis', 'TN'],
  ['Baltimor', 'Baltimore', 'MD'], ['Milwakee', 'Milwaukee', 'WI'], ['Albuquerqe', 'Albuquerque', 'NM'], ['Tuscon', 'Tucson', 'AZ'],
  ['Fresnoo', 'Fresno', 'CA'], ['Sacremento', 'Sacramento', 'CA'], ['Kansas Cty', 'Kansas City', 'MO'], ['Altanta', 'Atlanta', 'GA'],
  ['Omahaa', 'Omaha', 'NE'], ['Colorado Sprngs', 'Colorado Springs', 'CO'], ['Raliegh', 'Raleigh', 'NC'], ['Maimi', 'Miami', 'FL'],
  ['Cincinatti', 'Cincinnati', 'OH'], ['Pittsburg', 'Pittsburgh', 'PA'],
];
test(`round 7: ${MISSPELT.length} misspellings of the largest cities, with and without a comma and state`, () => {
  const bad = [];
  for (const [typo, city, st] of MISSPELT) {
    const want = `${city}, ${st}`;
    for (const t of [`${typo} ${st}`, `${typo}, ${st}`]) {
      const r = placeSearch(t);
      if (r.kind !== 'point' || r.label.replace('St. ', 'St. ') !== want.replace(/^St /, 'St. ') || r.understood !== t) bad.push(`${t} → ${r.kind} ${r.label} ${r.reason || ''} ${r.suggestions.join('/')}`);
    }
    // Bare: resolves to the city, or asks with the city first — never another place silently, never the state.
    if (typo === 'Pittsburg') continue; // Pittsburg, CA is a real city of 76,000: a bare "Pittsburg" is it
    const b = placeSearch(typo);
    const ok = (b.kind === 'point' && b.label === want) || (b.kind === 'none' && b.suggestions[0] === want);
    if (!ok) bad.push(`${typo} → ${b.kind} ${b.label} ${b.reason || ''} ${b.suggestions.slice(0, 3).join('/')}`);
  }
  assert.deepEqual(bad, []);
});

test('round 7: a state beside words is a place to find, never the whole state; suggestions stay in the state named', () => {
  for (const t of ['Tuscon AZ', 'Chicgo IL', 'Huston TX', 'Sacremento CA', 'Pheonix AZ']) assert.notEqual(placeSearch(t).kind, 'state', t);
  assert.equal(placeSearch('Tuscon AZ').understood, 'Tuscon AZ');
  for (const t of ['Arizona', 'AZ', 'az', 'New Mexico', 'Texas']) assert.equal(placeSearch(t).kind, 'state', t);
  const r = placeSearch('Zzyzxville, CA');
  assert.equal(r.reason, 'not_in_state');
  assert.ok(r.suggestions.every((x) => x.endsWith(', CA')));
});

test('round 7: neighbourhoods, nicknames, "LA", remote words', () => {
  const L = (t) => placeSearch(t).label;
  assert.equal(L('Hollywood, CA'), 'Hollywood, CA'); assert.ok(distanceMiles(placeSearch('Hollywood, CA'), geocodePlace('Los Angeles, CA')) < 8);
  assert.equal(L('Venice, CA'), 'Venice, CA'); assert.equal(L('Venice CA'), 'Venice, CA');
  assert.equal(L('North Hollywood'), 'North Hollywood, CA');
  assert.equal(L('Brooklyn Heights, NY'), 'Brooklyn Heights, NY');
  assert.equal(L('Capitol Hill, Seattle'), 'Capitol Hill, WA');
  assert.equal(placeSearch('Capitol Hill').reason, 'ambiguous');
  assert.equal(L('Buckhead'), 'Buckhead, GA');
  assert.equal(geocodePlace('Ahwatukee Foothills, Phoenix').name, 'Ahwatukee', 'the neighbourhood, not the city centre');
  assert.equal(geocodePlace('Bellevue, Seattle').name, 'Bellevue');
  for (const [t, want] of [['NYC', 'New York, NY'], ['SF', 'San Francisco, CA'], ['Philly', 'Philadelphia, PA'], ['Vegas', 'Las Vegas, NV'], ['KC', 'Kansas City, MO'], ['ATL', 'Atlanta, GA'], ['NOLA', 'New Orleans, LA']]) assert.equal(L(t), want, t);
  assert.deepEqual(placeSearch('LA').suggestions, ['Los Angeles, CA', 'Louisiana']);
  assert.equal(placeSearch('LA').reason, 'ambiguous');
  for (const t of ['remote', 'Remote US', 'Remote - US', 'Remote, USA', 'work from home', 'anywhere', 'Remote in the US', 'fully remote']) assert.equal(placeSearch(t).kind, 'remote', t);
});

test('round 7: ZIP labels — largest land share, NYC boroughs, no fake ZIPs', () => {
  const L = (t) => placeSearch(t).label;
  // 90210: 61% of the ZIP area's land is in the City of Los Angeles (the hills), 38% in Beverly Hills.
  assert.equal(L('90210'), '90210 (Los Angeles, CA)');
  assert.equal(L('10001'), '10001 (New York, NY)');
  assert.equal(L('11201'), '11201 (Brooklyn, NY)');
  assert.equal(L('10451'), '10451 (Bronx, NY)');
  assert.equal(L('11368'), '11368 (Queens, NY)');
  assert.equal(L('10301'), '10301 (Staten Island, NY)');
  assert.equal(placeSearch('99999').reason, 'unknown', 'no ZIP area within reach of 99999');
  assert.equal(L('85001'), '85001 (Phoenix, AZ)');
  assert.equal(L('85004 Phoenix AZ'), '85004 (Phoenix, AZ)');
  assert.equal(L('Phoenix AZ 85004'), '85004 (Phoenix, AZ)');
});
