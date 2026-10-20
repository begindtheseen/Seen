// Run: node --test lib/server/usajobs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchUsaJobs, mapUsajobsItem, usajobsSalary, usajobsCredentials } from './usajobs.js';
import { usajobsTopUp } from '../jobs/expand.js';

// Shaped like the documented SearchResult.SearchResultItems[] entry (developer.usajobs.gov).
const item = (over = {}) => ({
  MatchedObjectId: '812345600',
  MatchedObjectDescriptor: {
    PositionID: 'VHA-25-1234',
    PositionTitle: 'Warehouse Worker',
    PositionURI: 'https://www.usajobs.gov/job/812345600',
    ApplyURI: ['https://www.usajobs.gov:443/GetJob/ViewDetails/812345600?PostingChannelID='],
    PositionLocationDisplay: 'Houston, Texas',
    PositionLocation: [{ LocationName: 'Houston, Texas', CityName: 'Houston, Texas', Latitude: 29.76, Longitude: -95.37 }],
    OrganizationName: 'Veterans Health Administration',
    DepartmentName: 'Department of Veterans Affairs',
    PositionSchedule: [{ Name: 'Full-time', Code: '1' }],
    PositionRemuneration: [{ MinimumRange: '18.5', MaximumRange: '22', RateIntervalCode: 'PH', Description: 'Per Hour' }],
    QualificationSummary: 'You must have one year of specialized experience operating forklifts and moving supplies in a warehouse.',
    UserArea: { Details: { JobSummary: 'Receives, stores and issues supplies for the medical center.', MajorDuties: ['Operates forklifts', 'Keeps stock records'] } },
    ...over,
  },
});

test('maps a posting to a Seen row with real pay, place, apply link and a stable id', () => {
  const r = mapUsajobsItem(item(), 'warehouse');
  assert.equal(r.title, 'Warehouse Worker');
  assert.equal(r.company, 'Veterans Health Administration');
  assert.equal(r.location, 'Houston, Texas');
  assert.equal(r.salary, '$18.50 – $22 / hour');
  assert.equal(r.source, 'USAJOBS');
  assert.equal(r.external_id, 'usajobs-812345600');
  assert.equal(new URL(r.apply_url).hostname, 'www.usajobs.gov');
  assert.match(r.description, /forklifts/);
  assert.equal(r.lat, 29.76);
});

test('"Multiple Locations" falls back to the first listed place', () => {
  const r = mapUsajobsItem(item({ PositionLocationDisplay: 'Multiple Locations', PositionLocation: [{ LocationName: 'Denver, Colorado' }] }));
  assert.equal(r.location, 'Denver, Colorado');
});

test('salary text and yearly minimum for hourly and annual postings', () => {
  assert.deepEqual(usajobsSalary({ MinimumRange: '52000', MaximumRange: '68000', RateIntervalCode: 'PA' }), { text: '$52k – $68k / year', yearlyMin: 52000 });
  assert.equal(usajobsSalary({ MinimumRange: '20', MaximumRange: '20', RateIntervalCode: 'PH' }).text, '$20 / hour');
  assert.equal(usajobsSalary(null).text, null);
});

test('no key → no request, empty result (ships safely before the key exists)', async () => {
  assert.equal(usajobsCredentials({}), null);
  let called = false;
  const out = await fetchUsaJobs('nurse', 'Austin, TX', { credentials: null, fetchImpl: async () => { called = true; } });
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test('sends the three documented headers and the right query; Remote searches nationwide', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url: new URL(url), headers: opts.headers }); return { ok: true, async json() { return { SearchResult: { SearchResultItems: [item()] } }; } }; };
  const creds = { key: 'k123', email: 'owner@example.com' };
  const rows = await fetchUsaJobs('warehouse', 'Houston, TX', { credentials: creds, radiusMiles: 50, fetchImpl });
  assert.equal(rows.length, 1);
  const { url, headers } = seen[0];
  assert.equal(url.host, 'data.usajobs.gov');
  assert.equal(url.searchParams.get('Keyword'), 'warehouse');
  assert.equal(url.searchParams.get('LocationName'), 'Houston, TX');
  assert.equal(url.searchParams.get('Radius'), '50');
  assert.equal(headers.Host, 'data.usajobs.gov');
  assert.equal(headers['User-Agent'], 'owner@example.com');
  assert.equal(headers['Authorization-Key'], 'k123');
  await fetchUsaJobs('nurse', 'Remote', { credentials: creds, fetchImpl });
  assert.equal(seen[1].url.searchParams.get('LocationName'), null);
});

test('HTTP errors and thrown fetches return [] instead of breaking a search', async () => {
  const creds = { key: 'k', email: 'e@x' };
  assert.deepEqual(await fetchUsaJobs('x', '', { credentials: creds, fetchImpl: async () => ({ ok: false, status: 401 }) }), []);
  assert.deepEqual(await fetchUsaJobs('x', '', { credentials: creds, fetchImpl: async () => { throw new Error('down'); } }), []);
});

test('on-site top-up saves USAJOBS rows and stitches their DB ids back', async () => {
  const fetchImpl = async () => ({ ok: true, async json() { return { SearchResult: { SearchResultItems: [item()] } }; } });
  const upsert = async (rows) => ({ upserted: rows.length, rows: rows.map((r) => ({ id: 'db-1', title: r.title, company: r.company, location: r.location, created_at: 't' })) });
  const out = await usajobsTopUp({ query: 'Warehouse', location: 'Houston, TX', distanceKm: 80, supabaseUrl: 'u', serviceKey: 'k', credentials: { key: 'k', email: 'e' }, fetchImpl, upsert });
  assert.equal(out.upserted, 1);
  assert.equal(out.jobs[0].id, 'db-1');
  assert.equal(out.jobs[0].search_query, 'warehouse');
  assert.deepEqual(await usajobsTopUp({ query: 'x', credentials: null }), { jobs: [], upserted: 0 });
});
