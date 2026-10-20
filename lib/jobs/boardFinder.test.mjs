// Run: node --test lib/jobs/boardFinder.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, sameCompanyName, slugCandidates, findBoards } from './boardFinder.js';

test('names compare without legal suffixes or a leading "The"', () => {
  assert.equal(nameKey('The Home Depot, Inc.'), 'home depot');
  assert.ok(sameCompanyName('The Home Depot', 'Home Depot Inc'));
  assert.ok(!sameCompanyName('Tesla', 'Tesla Exteriors'));
  assert.deepEqual(slugCandidates('The Home Depot, Inc.'), ['homedepot', 'home-depot', 'thehomedepot', 'home_depot']);
  assert.deepEqual(slugCandidates('Tesla'), ['tesla']);
});

// Fake job-board APIs, shaped like the live answers recorded 2026-10-20.
function fake(boards) {
  return async (url) => {
    const u = String(url);
    const hit = (re) => boards.find((b) => re.test(u) && u.includes(`/${b.slug}`) || (re.test(u) && u.includes(`//${b.slug}.`)));
    const json = (body, status = 200) => ({ ok: status === 200, status, async json() { return body; } });
    if (/boards-api\.greenhouse\.io/.test(u)) { const b = boards.find((x) => x.p === 'greenhouse' && u.includes(`/boards/${x.slug}`)); if (!b) return json({}, 404); return u.endsWith('/jobs') ? json({ jobs: Array(b.jobs).fill({}) }) : json({ name: b.name }); }
    if (/apply\.workable\.com/.test(u)) { const b = boards.find((x) => x.p === 'workable' && u.endsWith(`/${x.slug}`)); return b ? json({ name: b.name, jobs: Array(b.jobs).fill({}) }) : json({}, 404); }
    if (/smartrecruiters/.test(u)) return json({ totalFound: 0, content: [] }); // answers 200 for anything
    if (/ashbyhq/.test(u)) { const b = boards.find((x) => x.p === 'ashby' && u.includes(`/job-board/${x.slug}`)); return b ? json({ jobs: Array(b.jobs).fill({}) }) : json({}, 404); }
    void hit; return json({}, 404);
  };
}

test('a board counts only with open jobs and, when it says, the right name', async () => {
  const fetchImpl = fake([
    { p: 'greenhouse', slug: 'stripe', name: 'Stripe', jobs: 723 },
    { p: 'workable', slug: 'stripe', name: 'Stripe', jobs: 0 },          // abandoned account
    { p: 'workable', slug: 'tesla', name: 'Tesla', jobs: 0 },            // 200, zero jobs
  ]);
  assert.deepEqual((await findBoards('Stripe', { fetchImpl })).found, [{ provider: 'greenhouse', tenant: 'stripe', jobs: 723, name: 'Stripe', nameVerified: true }]);
  assert.deepEqual((await findBoards('Tesla', { fetchImpl })).found, [], 'Workable 200 with 0 jobs and SmartRecruiters 200 are not boards');
});

test('a board naming another company is ignored; a nameless board needs the whole-name slug', async () => {
  const fetchImpl = fake([
    { p: 'greenhouse', slug: 'tesla', name: 'Tesla Exteriors LLC', jobs: 4 },
    { p: 'ashby', slug: 'notion', jobs: 133 },
  ]);
  assert.deepEqual((await findBoards('Tesla', { fetchImpl })).found, []);
  const n = (await findBoards('Notion', { fetchImpl })).found;
  assert.equal(n.length, 1); assert.equal(n[0].nameVerified, false);
});
