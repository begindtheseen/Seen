import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPUTE_KINDS, DISPUTE_STATUSES,
  isDisputeKind, isDisputeStatus, isDisputeDecision,
  isHttpUrl, classifyListingOrigin, sanitizeProposedChanges,
  validateDisputeInput, resolveDisputeEffect,
  disputeStatusCounts, orderDisputesOpenFirst,
} from './listingDisputes.js';

test('kind/status/decision guards', () => {
  assert.ok(DISPUTE_KINDS.every(isDisputeKind));
  assert.ok(DISPUTE_STATUSES.every(isDisputeStatus));
  assert.equal(isDisputeKind('nope'), false);
  assert.equal(isDisputeStatus('reviewed'), false); // reddit status, not a listing-dispute status
  assert.ok(isDisputeDecision('approved') && isDisputeDecision('denied'));
  assert.equal(isDisputeDecision('open'), false); // 'open' is not an admin verdict
});

test('isHttpUrl only accepts http(s)', () => {
  assert.ok(isHttpUrl('https://acme.com/jobs/1'));
  assert.ok(isHttpUrl('http://x.io'));
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('ftp://x'), false);
  assert.equal(isHttpUrl('acme.com'), false);
  assert.equal(isHttpUrl(''), false);
  assert.equal(isHttpUrl(null), false);
});

test('classifyListingOrigin distinguishes employer/imported/aggregated', () => {
  assert.equal(classifyListingOrigin({ is_employer_posted: true, source: 'Employer' }), 'employer');
  assert.equal(classifyListingOrigin({ employer_user_id: 'u1' }), 'employer');
  assert.equal(classifyListingOrigin({ source: 'Imported' }), 'imported');
  assert.equal(classifyListingOrigin({ source: 'Adzuna' }), 'aggregated');
  assert.equal(classifyListingOrigin({ source: 'Remotive' }), 'aggregated');
  assert.equal(classifyListingOrigin(null), 'aggregated');
});

test('sanitizeProposedChanges whitelists, caps, drops junk + bad urls', () => {
  const out = sanitizeProposedChanges({
    title: '  New title ', description: 'x'.repeat(9000), location: 'Remote',
    salary: '$100k', apply_url: 'https://acme.com/apply', evil: 'DROP', status: 'active',
  });
  assert.equal(out.title, 'New title');
  assert.equal(out.description.length, 8000);
  assert.equal(out.location, 'Remote');
  assert.equal(out.salary, '$100k');
  assert.equal(out.apply_url, 'https://acme.com/apply');
  assert.equal('evil' in out, false);
  assert.equal('status' in out, false); // status is not employer-editable
  // a non-URL apply_url is dropped, not stored
  assert.equal('apply_url' in sanitizeProposedChanges({ apply_url: 'not-a-url' }), false);
});

test('validateDisputeInput enforces required fields per kind', () => {
  assert.equal(validateDisputeInput({ job_id: '', kind: 'inactive', detail: 'gone' }).ok, false);
  assert.equal(validateDisputeInput({ job_id: 'j1', kind: 'bogus', detail: 'x' }).ok, false);
  assert.equal(validateDisputeInput({ job_id: 'j1', kind: 'inactive', detail: 'no' }).ok, false); // detail too short
  const ok = validateDisputeInput({ job_id: 'j1', kind: 'inactive', detail: 'This role was filled weeks ago' });
  assert.ok(ok.ok);
  assert.equal(ok.dispute.job_id, 'j1');
  assert.deepEqual(ok.dispute.proposed_changes, {}); // non-edit → no changes
  // edit disputes need at least one proposed change
  assert.equal(validateDisputeInput({ job_id: 'j1', kind: 'edit', detail: 'fix title', proposed_changes: {} }).ok, false);
  const edit = validateDisputeInput({ job_id: 'j1', kind: 'edit', detail: 'fix title', proposed_changes: { title: 'Correct Title' } });
  assert.ok(edit.ok);
  assert.equal(edit.dispute.proposed_changes.title, 'Correct Title');
});

test('resolveDisputeEffect: takedown vs edit vs clear-reports vs none', () => {
  for (const kind of ['inactive', 'delete', 'not_ours']) {
    const e = resolveDisputeEffect({ kind });
    assert.equal(e.takedown, true, `${kind} → takedown`);
    assert.equal(e.edit, false);
    assert.equal(e.clearReports, false);
  }
  const edit = resolveDisputeEffect({ kind: 'edit', proposed_changes: { title: 'X' } });
  assert.equal(edit.takedown, false);
  assert.equal(edit.edit, true);
  assert.deepEqual(edit.patch, { title: 'X' });
  // an edit with no valid changes applies nothing
  assert.equal(resolveDisputeEffect({ kind: 'edit', proposed_changes: {} }).edit, false);
  // still_active = the employer's rebuttal to a seeker report — approval clears the reports
  const rebut = resolveDisputeEffect({ kind: 'still_active' });
  assert.equal(rebut.takedown, false);
  assert.equal(rebut.edit, false);
  assert.equal(rebut.clearReports, true);
  // 'other' never mutates automatically
  const other = resolveDisputeEffect({ kind: 'other' });
  assert.equal(other.takedown, false);
  assert.equal(other.edit, false);
  assert.equal(other.clearReports, false);
});

test('still_active is a valid kind end-to-end (validate accepts it)', () => {
  assert.ok(isDisputeKind('still_active'));
  const v = validateDisputeInput({ job_id: 'j1', kind: 'still_active', detail: 'Role is open — we interviewed yesterday' });
  assert.ok(v.ok);
  assert.equal(v.dispute.kind, 'still_active');
});

test('queue counts + open-first ordering', () => {
  const rows = [
    { id: 1, status: 'denied', created_at: '2026-07-01T00:00:00Z' },
    { id: 2, status: 'open', created_at: '2026-07-02T00:00:00Z' },
    { id: 3, status: 'approved', created_at: '2026-07-03T00:00:00Z' },
    { id: 4, status: 'open', created_at: '2026-07-04T00:00:00Z' },
  ];
  assert.deepEqual(disputeStatusCounts(rows), { open: 2, approved: 1, denied: 1 });
  const ordered = orderDisputesOpenFirst(rows).map((r) => r.id);
  assert.deepEqual(ordered, [4, 2, 3, 1]); // both opens first (newest first), then the rest by date
});
