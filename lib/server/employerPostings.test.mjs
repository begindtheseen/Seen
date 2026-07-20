import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNewListing, buildEmployerListingRow, applyCounts, annotateListings,
} from './employerPostings.js';

test('validateNewListing requires a title and a real apply URL', () => {
  assert.equal(validateNewListing({ title: 'x', apply_url: 'https://a.com' }).ok, false); // title too short
  assert.equal(validateNewListing({ title: 'Cook', apply_url: 'nope' }).ok, false);        // bad url
  assert.equal(validateNewListing({ title: 'Cook' }).ok, false);                           // no url
  const ok = validateNewListing({ title: '  Line Cook  ', apply_url: 'https://acme.com/apply', description: 'Great role' });
  assert.ok(ok.ok);
  assert.equal(ok.listing.title, 'Line Cook');
  assert.equal(ok.listing.location, 'Remote'); // default
  assert.equal(ok.listing.type, 'Full-time');
  assert.equal(ok.listing.apply_url, 'https://acme.com/apply');
});

test('validateNewListing infers part-time', () => {
  const ok = validateNewListing({ title: 'Barista', apply_url: 'https://a.com', type: 'Part Time', location: 'Denver' });
  assert.equal(ok.listing.type, 'Part-time');
  assert.equal(ok.listing.location, 'Denver');
});

test('buildEmployerListingRow stamps ownership + source Employer', () => {
  const { listing } = validateNewListing({ title: 'Line Cook', apply_url: 'https://acme.com/apply' });
  const row = buildEmployerListingRow(listing, {
    uid: 'u-123', company: 'Acme Corp', companyKey: 'acme corp',
    nowISO: '2026-07-19T00:00:00Z', expiresISO: '2026-09-17T00:00:00Z',
  });
  assert.equal(row.source, 'Employer');
  assert.equal(row.is_employer_posted, true);
  assert.equal(row.employer_user_id, 'u-123');
  assert.equal(row.company, 'Acme Corp');
  assert.equal(row.availability_status, 'active');
  assert.equal(row.apply_url, 'https://acme.com/apply');
  assert.equal(row.url, 'https://acme.com/apply'); // legacy alias kept in lockstep
  assert.equal(row.expires_at, '2026-09-17T00:00:00Z');
});

test('applyCounts dedupes an apply_event against the same user+job application', () => {
  const applyEvents = [
    { user_id: 'u1', job_id: 'j1', role: 'Cook' },
    { user_id: 'u2', job_id: 'j1', role: 'Cook' },
  ];
  const applications = [
    { user_id: 'u1', job_id: 'j1', role: 'Cook' }, // duplicate of the first click → not double counted
    { user_id: 'u3', job_id: 'j2', role: 'Server' },
  ];
  const c = applyCounts({ applyEvents, applications });
  assert.equal(c.total, 3);           // u1(once), u2, u3 — NOT 4
  assert.equal(c.perJob.j1, 2);       // u1 + u2
  assert.equal(c.perJob.j2, 1);       // u3
  assert.equal(c.perRole.cook, 2);
  assert.equal(c.perRole.server, 1);
});

test('applyCounts counts undedupable rows (no user/job) rather than dropping signal', () => {
  const c = applyCounts({
    applyEvents: [{ job_id: 'j1', role: 'Cook' }],       // no user_id → can't dedupe
    applications: [{ job_id: 'j1', role: 'Cook' }],      // no user_id → counts separately
  });
  assert.equal(c.total, 2);
  assert.equal(c.perJob.j1, 2);
});

test('annotateListings surfaces origin, apply count, open dispute; no PII', () => {
  const jobs = [
    { id: 'j1', title: 'Cook', company: 'Acme', source: 'Adzuna', availability_status: 'active', apply_url: 'https://a/1' },
    { id: 'j2', title: 'Server', company: 'Acme', source: 'Employer', is_employer_posted: true, apply_url: 'https://a/2' },
  ];
  const rows = annotateListings(jobs, {
    openDisputesByJob: { j2: { id: 9, kind: 'inactive', status: 'open' } },
    applyCountsByJob: { j1: 5 },
  });
  assert.equal(rows[0].origin, 'aggregated');
  assert.equal(rows[0].applications, 5);
  assert.equal(rows[0].openDispute, null);
  assert.equal(rows[1].origin, 'employer');
  assert.equal(rows[1].is_employer_posted, true);
  assert.equal(rows[1].openDispute.kind, 'inactive');
  // never leak applicant identity fields
  for (const r of rows) {
    assert.equal('user_id' in r, false);
    assert.equal('applicant' in r, false);
  }
});
