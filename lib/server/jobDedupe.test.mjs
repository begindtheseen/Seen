import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planJobDedupe, normalizeApplyUrl, locationKey, dupKeys, describeGroups } from './jobDedupe.js';

let n = 0;
const job = (o = {}) => ({
  id: o.id || `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  title: 'Chief Officer', company: 'CSMCY', location: 'Constanta', apply_url: null, source: 'Lever', external_id: null,
  is_employer_posted: false, availability_status: 'active', expires_at: '2099-01-01T00:00:00Z',
  last_seen_at: '2026-10-19T00:00:00Z', created_at: '2026-10-18T00:00:00Z', ...o,
});

test('the same title at the same company in DIFFERENT places is not a duplicate (the old city rule deleted these)', () => {
  const rows = [job({ location: 'Constanta' }), job({ location: 'Rijeka' }), job({ location: 'Saint Petersburg' })];
  const p = planJobDedupe(rows);
  assert.equal(p.groups.length, 0);
  assert.deepEqual(p.deleteIds, []);
});

test('database identity: title + company + location key (case and punctuation ignored)', () => {
  assert.equal(locationKey('Austin, TX'), locationKey('austin tx'));
  const a = job({ title: 'Barista', company: 'Starbucks', location: 'Austin, TX' });
  const b = job({ title: 'BARISTA', company: 'starbucks', location: 'austin tx', last_seen_at: '2026-10-20T00:00:00Z' });
  const p = planJobDedupe([a, b]);
  assert.deepEqual(p.deleteIds, [a.id], 'the most recently seen copy is kept');
});

test('same listing link + title with drifted company/location text is one listing (prod Adzuna pairs)', () => {
  const url = 'https://www.adzuna.com/details/5928726948?utm_medium=api&utm_source=be8427c6';
  const a = job({ title: 'Senior Advisor Onboarding Manager', company: 'Savvy', location: 'New York City, New York', apply_url: url, last_seen_at: '2026-10-17T02:00:48Z' });
  const b = job({ title: 'Senior Advisor Onboarding Manager', company: 'Savvy Wealth', location: 'New York City, New York', apply_url: url.replace('be8427c6', 'other'), last_seen_at: '2026-10-15T14:00:32Z' });
  assert.deepEqual(planJobDedupe([a, b]).deleteIds, [b.id]);
  // Same link, DIFFERENT title is not the same listing.
  assert.equal(planJobDedupe([a, { ...b, title: 'Something else' }]).groups.length, 0);
});

test('URL identity drops tracking params only — a different job id in the query is a different job', () => {
  assert.equal(normalizeApplyUrl('https://WWW.Adzuna.com/details/1/?utm_source=x&utm_medium=api'), 'adzuna.com/details/1');
  assert.equal(normalizeApplyUrl('https://jobs.x.com/apply?jobId=2&gh_src=abc&b=1'), 'jobs.x.com/apply?b=1&jobId=2');
  assert.notEqual(normalizeApplyUrl('https://jobs.x.com/apply?jobId=1'), normalizeApplyUrl('https://jobs.x.com/apply?jobId=2'));
  assert.equal(normalizeApplyUrl('javascript:alert(1)'), null);
  assert.equal(normalizeApplyUrl('not a url'), null);
  const a = job({ location: 'Houston', apply_url: 'https://jobs.x.com/apply?jobId=1' });
  const b = job({ location: 'Dallas', apply_url: 'https://jobs.x.com/apply?jobId=2' });
  assert.equal(planJobDedupe([a, b]).groups.length, 0);
});

test('never deletes employer-posted rows or rows a user saved/applied to; prefers them as the keeper', () => {
  const live = job({ last_seen_at: '2026-10-20T00:00:00Z' });
  const saved = job({ last_seen_at: '2026-09-01T00:00:00Z', availability_status: 'stale' });
  const employer = job({ is_employer_posted: true, last_seen_at: '2026-08-01T00:00:00Z' });
  const p = planJobDedupe([live, saved, employer], new Set([saved.id]));
  assert.equal(p.groups.length, 1);
  assert.ok([saved.id, employer.id].includes(p.groups[0].keep.id), 'a protected row is the keeper');
  assert.deepEqual(p.deleteIds, [live.id]);
  assert.equal(p.protectedExtras, 1, 'the other protected copy is kept and counted');
  const only = planJobDedupe([saved, job({ last_seen_at: '2026-10-20T00:00:00Z' })], new Set([saved.id]));
  assert.equal(only.groups[0].keep.id, saved.id, 'the copy the user holds survives even if older');
});

test('keeper without protection: still-serving beats a newer hidden copy', () => {
  const serving = job({ last_seen_at: '2026-10-10T00:00:00Z' });
  const hidden = job({ availability_status: 'stale', expires_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-10-12T00:00:00Z' });
  assert.deepEqual(planJobDedupe([hidden, serving], new Set(), Date.parse('2026-10-20T00:00:00Z')).deleteIds, [hidden.id]);
});

test('rows chained through different keys form one group; blank titles never group', () => {
  const a = job({ title: 'Nurse', company: 'Takeda', location: 'Houston', apply_url: 'https://a.com/1' });
  const b = job({ title: 'Nurse', company: 'BioLife', location: 'Houston', apply_url: 'https://a.com/1' });     // url+title = a
  const c = job({ title: 'Nurse', company: 'BioLife', location: 'Houston, TX!', apply_url: 'https://b.com/9' }); // loc key ≠ b ("houstontx")
  const d = job({ title: 'Nurse', company: 'biolife', location: 'HOUSTON', apply_url: null });                  // loc key = b
  const p = planJobDedupe([a, b, c, d]);
  assert.equal(p.groups.length, 1);
  assert.equal(p.deleteIds.length, 2, 'a, b, d are one listing; c is a different location');
  assert.ok(!p.deleteIds.includes(c.id));
  assert.deepEqual(dupKeys({ title: '  ', company: 'X', location: 'Y', apply_url: 'https://x.com/1' }), []);
  const s = describeGroups(p.groups);
  assert.equal(s[0].remove.length, 2);
  assert.deepEqual(Object.keys(s[0].keep).sort(), ['company', 'id', 'location', 'source', 'status', 'title']);
});

test('same source + external id is one listing', () => {
  const a = job({ title: 'Lead Artist', location: 'Montréal', external_id: '7856225003', source: 'Greenhouse' });
  const b = job({ title: 'Lead Artist (Remote)', location: 'Novato', external_id: '7856225003', source: 'Greenhouse', last_seen_at: '2026-10-01T00:00:00Z' });
  const c = job({ title: 'Lead Artist', location: 'Novato', external_id: '7856226003', source: 'Greenhouse' });
  const p = planJobDedupe([a, b, c]);
  assert.deepEqual(p.deleteIds, [b.id]);
});
