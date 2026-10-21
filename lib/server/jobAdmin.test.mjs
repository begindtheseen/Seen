// Run: node --test lib/server/jobAdmin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browsePath, nextCursor, parseCursor, cleanTerm, validatePatch, restorePatch, RESTORE_DAYS } from './jobAdmin.js';

const ID = '3f2c1a9e-1b2c-4d5e-8f90-123456789abc';
const qs = (p) => new URLSearchParams(p.slice(p.indexOf('?') + 1));

test('browse: every filter becomes one PostgREST filter; text search is quoted inside and=(…)', () => {
  const b = browsePath({ q: 'software engineer', company: 'SpaceX', status: 'active', visible: 'on', since: '7d', source: 'Greenhouse', limit: 500 }, Date.parse('2026-10-21T16:00:00Z'));
  const p = qs(b.path);
  assert.equal(b.limit, 100, 'a page is at most 100 rows');
  assert.equal(p.get('availability_status'), 'eq.active');
  assert.equal(p.get('company'), 'ilike.*SpaceX*');
  assert.equal(p.get('source'), 'ilike.Greenhouse');
  assert.equal(p.get('expires_at'), 'gt.2026-10-21T16:00:00.000Z');
  assert.equal(p.get('created_at'), 'gte.2026-10-14T16:00:00.000Z');
  assert.equal(p.get('and'), '(or(title.ilike."*software*engineer*",company.ilike."*software*engineer*"))');
  assert.equal(p.get('order'), 'created_at.desc,id.desc');
  assert.match(browsePath({ status: 'removed' }).error, /status must be one of/);
  const today = qs(browsePath({ since: 'today' }, Date.parse('2026-10-21T16:00:00Z'), { todayStart: new Date('2026-10-21T07:00:00Z') }).path);
  assert.equal(today.get('created_at'), 'gte.2026-10-21T07:00:00.000Z', 'today = since midnight California time');
});

test('browse: characters that would change a filter are dropped from search text', () => {
  assert.equal(cleanTerm('a,b(c)*d:e"f\'g'), 'a b c d e f g');
  const p = qs(browsePath({ q: 'x),or(id.eq.1' }).path);
  assert.doesNotMatch(p.get('and'), /id\.eq\.1\)/);
});

test('pages: the cursor keeps microseconds exactly (rounding repeated rows of one batch insert)', () => {
  const at = '2026-10-21T07:00:00.123456+00:00';
  assert.deepEqual(parseCursor({ at, id: ID }), { at, id: ID });
  assert.equal(parseCursor({ at: 'yesterday', id: ID }), null);
  assert.equal(parseCursor({ at, id: 'x' }), null);
  const b = browsePath({ cursor: { at, id: ID } });
  assert.equal(qs(b.path).get('and'), `(or(created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${ID})))`);
  const asc = browsePath({ sort: 'oldest', cursor: { at, id: ID } });
  assert.match(qs(asc.path).get('and'), /created_at\.gt\./);
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: ID, created_at: at, n: i }));
  assert.deepEqual(nextCursor(rows, { sort: 'newest', limit: 50 }), { at, id: ID });
  assert.equal(nextCursor(rows.slice(0, 10), { sort: 'newest', limit: 50 }), null, 'a short page is the last');
});

test('edit: only listed fields, each checked against its column and CHECK constraint', () => {
  const ok = validatePatch({ title: '  Welder  II ', salary_min: '41683.4', availability_status: 'stale', apply_url: 'https://jobs.example.com/1', remote: true, salary: null });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.patch, { title: 'Welder II', salary_min: 41683, availability_status: 'stale', apply_url: 'https://jobs.example.com/1', remote: true, salary: null });
  const bad = validatePatch({ id: 'x', is_employer_posted: true, availability_status: 'removed', title: '', apply_url: 'javascript:alert(1)', salary_min: 90, salary_max: 10 });
  assert.equal(bad.errors.length, 6, bad.errors.join(' | '));
  assert.ok(bad.errors.some((e) => /id cannot be edited/.test(e)));
  assert.ok(bad.errors.some((e) => /salary_min is more than salary_max/.test(e)));
});

test('restore: active again for the normal 14-day listing lifetime', () => {
  const now = Date.parse('2026-10-21T16:00:00Z');
  const p = restorePatch(now);
  assert.equal(p.availability_status, 'active');
  assert.equal(Date.parse(p.expires_at) - now, RESTORE_DAYS * 86_400_000);
});
