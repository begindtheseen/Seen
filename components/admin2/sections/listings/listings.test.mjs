// Listings adapter: unread counts stay null, the browser's filters reach the server exactly as the URL says,
// an id / apply link / words are told apart, an edit sends only what changed, the duplicate plan reads as a
// sentence, and a source's health is never guessed.
// Run: node --test components/admin2/sections/listings/listings.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readListingCounts, browseFilters, browseKey, classifyQuery, activeFilterCount, jobState, jobTitle, formValues, buildPatch,
  readJobDetail, holdersLine, readDupePlan, planSentence, readSourceRow, sourceCounts, staleConfirm,
} from './adapter.ts'

const U = { q: '', status: 'all', visible: '', employer: '', since: '', sort: 'newest', source: '' }

test('counts: a missing or malformed number is null and named in failed — never 0', () => {
  const c = readListingCounts({ counts: { total: 158082, active: 136865, added_today: 951, stale_clearable: null, expired_kept: 'x', stale_overdue: -1 } })
  assert.equal(c.active, 136865)
  assert.equal(c.stale_clearable, null)
  assert.equal(c.expired_kept, null)
  assert.equal(c.stale_overdue, null)
  assert.deepEqual(c.failed, ['stale_clearable', 'expired_kept', 'stale_overdue'])
  assert.equal(readListingCounts(null).total, null)
})

test('filters: only what is set reaches the server; each combination is its own cache key', () => {
  assert.deepEqual(browseFilters(U), { limit: 100 })
  const f = browseFilters({ ...U, q: ' cashier ', status: 'stale', visible: 'on', employer: 'only', since: 'today', sort: 'seen', source: ' adzuna ' })
  assert.deepEqual(f, { limit: 100, q: 'cashier', status: 'stale', visible: 'on', employer: 'only', since: 'today', sort: 'seen', source: 'adzuna' })
  assert.notEqual(browseKey(U), browseKey({ ...U, status: 'stale' }))
  assert.ok(browseKey(U).startsWith('listings?'), 'touched "listings" must re-read every browser key')
  assert.equal(activeFilterCount({ ...U, status: 'stale', source: 'x' }), 2)
  // An id or a link is not sent as title words.
  assert.equal(browseFilters({ ...U, q: '9a1b0000-0000-4000-8000-000000000001' }).q, undefined)
})

test('a listing id, an apply link and words are told apart', () => {
  assert.equal(classifyQuery(''), 'empty')
  assert.equal(classifyQuery('9A1B0000-0000-4000-8000-000000000001'), 'id')
  assert.equal(classifyQuery('https://jobs.lever.co/acme/1'), 'url')
  assert.equal(classifyQuery('walmart cashier'), 'text')
})

test('state words: on the site = expires in the future; colour never alone', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  assert.deepEqual(jobState({ id: 'a', availability_status: 'active', expires_at: '2026-11-20T00:00:00Z' }, now), { label: 'Live', tone: 'good' })
  assert.equal(jobState({ id: 'a', availability_status: 'stale', expires_at: '2026-11-20T00:00:00Z' }, now).tone, 'caution')
  assert.equal(jobState({ id: 'a', availability_status: 'active', expires_at: '2026-11-01T00:00:00Z' }, now).label, 'Off the site')
  assert.equal(jobTitle({ id: 'a', title: 'Cashier', company: 'Walmart' }), 'Cashier — Walmart')
  assert.equal(jobTitle({ id: 'a' }), 'Untitled listing')
})

test('edit: only changed fields, typed; a cleared optional field is null', () => {
  const before = formValues({ title: 'Cashier', company: 'Walmart', salary_min: 30000, remote: false, expires_at: '2026-11-24T07:59:59Z', location: 'Phoenix' })
  assert.equal(before.salary_min, '30000'); assert.equal(before.remote, 'false'); assert.equal(before.expires_at, '2026-11-24')
  assert.deepEqual(buildPatch(before, before), {})
  const p = buildPatch(before, { ...before, title: 'Head Cashier', salary_min: '$32,000', remote: 'true', location: '' })
  assert.deepEqual(p, { title: 'Head Cashier', salary_min: 32000, remote: true, location: null })
})

test('detail and holders: an unread holder count says so', () => {
  const d = readJobDetail({ ok: true, rows: [{ job: { id: 'j1', title: 'X' }, holders: [{ table: 'saved_jobs', label: 'saved', count: 3 }, { table: 'applications', label: 'tracked', count: null }], history: [], suppressed: null, on_site: true }] })
  assert.equal(d.job.id, 'j1'); assert.equal(d.onSite, true)
  assert.equal(holdersLine(d.holders), 'Held by people: saved 3×. Couldn\'t read: tracked.')
  assert.equal(holdersLine([{ table: 't', label: 'saved', count: 0 }]), 'Nobody has saved, tracked, applied to or reported this listing.')
  assert.equal(readJobDetail({ rows: [] }), null)
})

test('duplicate plan: counts, examples, protected copies in one sentence', () => {
  const p = readDupePlan({ ok: true, complete: true, suspected: 408, groups: 300, protected: 12, scanned: 6000,
    rows: [{ keep: { id: 'k', title: 'Cashier', company: 'Acme', location: 'Phoenix', source: 'lever', status: 'active' }, remove: [{ id: 'r', title: 'Cashier' }], kept: [] }] })
  assert.equal(p.sample.length, 1); assert.equal(p.sample[0].remove[0].id, 'r')
  assert.equal(planSentence(p), '408 duplicate listings can be removed in 300 groups. 12 more copies are kept because someone saved, tracked or applied to them, or an employer posted them.')
  assert.match(planSentence({ suspected: 0, groups: 0, protected: 0, scanned: 6000, sample: [] }), /^No duplicate listings among 6,000 read\.$/)
  assert.match(planSentence(readDupePlan({})), /did not say/)
})

test('source health: the server’s failing flag and why; an unread count is "couldn’t read", never 0', () => {
  const ok = readSourceRow({ source: 'lever', live: 120, added_24h: 4, added_today: 2, last_seen: '2026-11-10T02:00:00Z', failing: false, why: null })
  assert.equal(ok.state, 'ok'); assert.match(ok.line, /^Last seen /)
  const bad = readSourceRow({ source: 'adzuna', live: 0, added_24h: 0, added_today: 0, last_seen: '2026-11-01T02:00:00Z', failing: true, why: 'no live listings' })
  assert.equal(bad.state, 'failing'); assert.match(bad.line, /^No live listings\. Last seen/)
  const unk = readSourceRow({ source: 'x', live: null, added_24h: 3, failing: null })
  assert.equal(unk.state, 'unknown')
  assert.equal(sourceCounts(unk), 'live couldn’t be read · 3 added in 24 h · added today couldn’t be read')
})

test('Clear stale confirm: the total AND its parts from the server plan; the kept count alone for the tile', () => {
  const c = readListingCounts({ counts: { stale_clearable: 1000, expired_kept: 350 }, clear_plan: { will_delete: 1325, stale_delete: 1000, expired_delete: 325, aging_delete: 0, kept_referenced: 50, expired_kept_referenced: 50 } })
  assert.equal(c.plan.expiredKept, 50)
  const t = staleConfirm(c.plan, c.stale_clearable)
  assert.equal(t.title, 'Delete 1,325 listings?')
  assert.equal(t.body, '1,000 stale listings and 325 expired listings, none of them saved by anyone. 50 listings someone saved or tracked are kept, hidden.')
  const none = staleConfirm(null, 1000)
  assert.match(none.title, /^Clear 1,000 stale listings and any expired ones nobody saved\?$/)
  assert.match(none.body, /can be larger/)
  assert.equal(readListingCounts({ counts: {} }).plan, null)
})
