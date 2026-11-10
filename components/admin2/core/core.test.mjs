// The admin core's contract, pinned. Each test names the audit defect (director/reports/admin-audit.md,
// Deliverable 2) it makes impossible. Run: node --test components/admin2/core/core.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseItem, parseSection, formatItem, sectionFilters, searchForSection, filterParam } from './url.ts'
import { toResult, createAdminApi, createReauthGate, createAdminDownload, filenameFrom } from './api.ts'
import { QueryCache, keyMatches, mergeListRefresh } from './cache.ts'
import { createActionRunner } from './action.ts'
import { createJobManager, jobKey, jobProgressText, jobSummary } from './jobs.ts'
const untilJ = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 0)) } }
import { readLogin } from './login.ts'

const tick = () => new Promise((r) => setTimeout(r, 0))
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await tick() }

// A fake fetch answering from a queue of [status, body|Error|'hang'].
function fakeFetch(answers) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), token: init.headers['X-Admin-Token'] })
    const a = answers.length ? answers.shift() : [200, { ok: true }]
    if (a instanceof Error) throw a
    if (a === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    }
    const [status, body] = a
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return { status, ok: status >= 200 && status < 300, text: async () => text }
  }
  return { impl, calls }
}

// ── URL places (defect 4: tab state not in the URL) ──────────────────────────────────────────────

test('url: sections and items parse strictly; unknown is never guessed', () => {
  assert.equal(parseSection('review'), 'review')
  assert.equal(parseSection('REVIEW '), 'review')
  assert.equal(parseSection('nope'), 'today')
  assert.equal(parseSection(''), 'today')
  assert.equal(parseSection('lab'), 'today', 'the lab is not a production section')
  assert.equal(parseSection('lab', ['today', 'lab']), 'lab')
  assert.deepEqual(parseItem('report:5f2a'), { ok: true, ref: { kind: 'report', id: '5f2a' } })
  assert.deepEqual(parseItem('company:https://x.com/a:b'), { ok: true, ref: { kind: 'company', id: 'https://x.com/a:b' } }, 'id keeps later colons')
  assert.equal(parseItem('wizard:1').ok, false)
  assert.equal(parseItem('wizard:1').reason, 'unknown_kind')
  assert.equal(parseItem('report:').reason, 'no_id')
  assert.equal(parseItem('').reason, 'empty')
  assert.equal(formatItem({ kind: 'user', id: 'u1' }), 'user:u1')
})

test('url: filters are namespaced per section; a queue row opens its section with exactly its filter', () => {
  assert.equal(filterParam('review', 'kind'), 'review.kind')
  assert.deepEqual(sectionFilters('?s=review&review.kind=reports&listings.q=x', 'review'), { kind: 'reports' })
  const qs = searchForSection('s=listings&review.kind=old&review.sort=new&listings.q=x&item=job:1', 'review', { kind: 'reports' })
  const p = new URLSearchParams(qs)
  assert.equal(p.get('s'), 'review')
  assert.equal(p.get('review.kind'), 'reports')
  assert.equal(p.get('review.sort'), null, 'the section’s old filters are cleared')
  assert.equal(p.get('listings.q'), 'x', 'other sections keep theirs')
  assert.equal(new URLSearchParams(searchForSection('s=review', 'today')).get('s'), null)
})

// ── The api: every failure is a contract error with a true sentence (defect 12, class g) ──────────

test('api: success fills the contract; JSON errors keep the server words', () => {
  const ok = toResult(200, JSON.stringify({ ok: true, changed: 3, message: 'Approved 3.', touched: ['held'] }))
  assert.equal(ok.ok, true); assert.equal(ok.changed, 3); assert.deepEqual(ok.skipped, []); assert.deepEqual(ok.touched, ['held'])
  const legacy = toResult(200, JSON.stringify({ rows: [1] }))
  assert.equal(legacy.ok, true, 'a legacy answer without `ok` is a success'); assert.equal(legacy.changed, 0); assert.deepEqual(legacy.rows, [1])
  const e = toResult(502, JSON.stringify({ error: 'could not read the reports (0)' }))
  assert.equal(e.ok, false); assert.equal(e.code, 'upstream'); assert.equal(e.retryable, true); assert.equal(e.error, 'could not read the reports (0)')
  const partial = toResult(500, JSON.stringify({ ok: false, error: 'stopped', changed: 40, remaining: 160, code: 'timeout' }))
  assert.equal(partial.changed, 40); assert.equal(partial.remaining, 160); assert.equal(partial.code, 'timeout')
})

test('api: empty body, HTML, 401, 500 without words — each a sentence, never "Unexpected token"', () => {
  for (const [status, body] of [[200, ''], [200, '<html>oops</html>'], [500, ''], [504, '<html>Gateway</html>'], [401, ''], [403, '']]) {
    const r = toResult(status, body)
    assert.equal(r.ok, false, `${status} ${body}`)
    assert.ok(r.error.length > 20 && /[.!]$/.test(r.error), `a full sentence for ${status}: ${r.error}`)
    assert.ok(!/unexpected token|json/i.test(r.error), r.error)
  }
  assert.equal(toResult(200, '').code, 'upstream')
  assert.equal(toResult(401, '').code, 'unauthorized')
  assert.equal(toResult(504, '').code, 'timeout')
})

test('api: network failure and timeout become retryable contract errors', async () => {
  const { impl } = fakeFetch([new TypeError('Failed to fetch'), 'hang'])
  const api = createAdminApi({ fetchImpl: impl, getToken: () => 't' })
  const n = await api('x')
  assert.equal(n.code, 'network'); assert.equal(n.retryable, true); assert.ok(!/failed to fetch/i.test(n.error))
  const t = await api('x', {}, { timeoutMs: 20 })
  assert.equal(t.code, 'timeout'); assert.equal(t.retryable, true)
})

test('api: the action name and token travel in the body/header; ids stay in the POST body (defect 1)', async () => {
  const { impl, calls } = fakeFetch([[200, { ok: true }]])
  const api = createAdminApi({ fetchImpl: impl, getToken: () => 'tok' })
  const ids = Array.from({ length: 1000 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`)
  await api('review_held', { ids, decision: 'approve' })
  assert.equal(calls[0].url, '/api/admin-stats', 'no ids in the URL')
  assert.equal(calls[0].body.action, 'review_held'); assert.equal(calls[0].body.ids.length, 1000); assert.equal(calls[0].token, 'tok')
})

test('api: a 401 asks for ONE sign-in and replays the same call with the new token (class d)', async () => {
  let token = 'old'
  const { impl, calls } = fakeFetch([[401, { error: 'Session expired — log in again' }], [401, { error: 'x' }], [200, { ok: true, changed: 1, touched: ['held'] }], [200, { ok: true }]])
  const gate = createReauthGate()
  const api = createAdminApi({ fetchImpl: impl, getToken: () => token, reauth: () => gate.wait() })
  const a = api('approve', { ids: ['1'] })
  const b = api('list_held')
  await flush()
  assert.equal(gate.isWaiting(), true, 'the sheet is up')
  token = 'new'; gate.settle(true)
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(ra.ok, true); assert.equal(rb.ok, true)
  assert.equal(calls.length, 4)
  assert.deepEqual(calls.slice(2).map((c) => c.token), ['new', 'new'])
  assert.deepEqual(calls[2].body, calls[0].body, 'the replay is the same request')
})

test('api: cancelling the sign-in leaves the call unauthorized with a plain sentence', async () => {
  const { impl, calls } = fakeFetch([[401, {}]])
  const gate = createReauthGate()
  const api = createAdminApi({ fetchImpl: impl, getToken: () => 't', reauth: () => gate.wait() })
  const p = api('x'); await flush(); gate.settle(false)
  const r = await p
  assert.equal(r.code, 'unauthorized'); assert.match(r.error, /signed out/); assert.equal(calls.length, 1)
})

test('login: one outcome per answer — wrong vs locked (with the time) vs disabled', () => {
  assert.deepEqual(readLogin({ ok: true, token: 'abc', username: 'owner', changed: 0, skipped: [], touched: [], message: '' }), { kind: 'ok', token: 'abc', username: 'owner' })
  assert.equal(readLogin(toResult(401, JSON.stringify({ error: 'Invalid credentials' }))).kind, 'wrong')
  assert.equal(readLogin(toResult(401, JSON.stringify({ error: 'Account disabled' }))).kind, 'disabled')
  const now = new Date('2026-11-10T18:00:00Z')
  const locked = readLogin(toResult(429, JSON.stringify({ error: 'Too many failed attempts — try again in 15 minutes' })), now)
  assert.equal(locked.kind, 'locked'); assert.equal(locked.until.toISOString(), '2026-11-10T18:15:00.000Z'); assert.match(locked.text, /10:15 AM/)
  const exact = readLogin(toResult(429, JSON.stringify({ error: 'Too many', locked_until: '2026-11-10T18:07:00Z' })), now)
  assert.match(exact.text, /10:07 AM/)
})

// ── The cache: invalidation ONLY by touched keys; old data stays (defects 3, 13; class b/c) ───────

test('cache: touched keys match by prefix and nothing else is re-read', async () => {
  assert.ok(keyMatches('held?sort=new', 'held')); assert.ok(keyMatches('company:acme:reports', 'company:acme'))
  assert.ok(keyMatches('company:zeta', 'company:')); assert.ok(!keyMatches('heldover', 'held')); assert.ok(!keyMatches('company:acmeco', 'company:acme'))
  const c = new QueryCache()
  const reads = []
  for (const k of ['overview', 'held?sort=new', 'listings', 'company:acme', 'company:zeta']) {
    c.register(k, async () => { reads.push(k); return { ok: true, changed: 0, skipped: [], touched: [], message: '', k } })
    c.subscribe(k, () => {})
    await c.fetch(k)
  }
  reads.length = 0
  const re = c.invalidate(['held', 'company:acme', 'overview'])
  await flush()
  assert.deepEqual(re.sort(), ['company:acme', 'held?sort=new', 'overview'])
  assert.deepEqual(reads.sort(), ['company:acme', 'held?sort=new', 'overview'], 'listings and company:zeta are not re-read')
  assert.deepEqual(c.invalidate([]), [])
})

test('cache: a failed refresh keeps the last good data beside the error; the newest read wins', async () => {
  const c = new QueryCache()
  const answers = [{ ok: true, v: 1 }, { ok: false, code: 'upstream', error: 'down', retryable: true }]
  c.register('k', async () => ({ changed: 0, skipped: [], touched: [], message: '', ...answers.shift() }))
  await c.fetch('k')
  await c.fetch('k')
  const e = c.get('k')
  assert.equal(e.data.v, 1, 'old data still on screen'); assert.equal(e.error.error, 'down'); assert.equal(e.status, 'ok')
  // slow old answer must not overwrite a newer one
  let release
  const slow = new Promise((r) => { release = r })
  let n = 0
  c.register('s', async () => { n++; if (n === 1) { await slow; return { ok: true, v: 'old', changed: 0, skipped: [], touched: [], message: '' } } return { ok: true, v: 'new', changed: 0, skipped: [], touched: [], message: '' } })
  const p1 = c.fetch('s'); await c.fetch('s'); release(); await p1
  assert.equal(c.get('s').data.v, 'new')
})

test('cache: a list refresh never re-orders under the finger — new rows wait as "N new"', () => {
  const r = (id) => ({ id })
  const cur = [r('a'), r('b'), r('c'), r('d')]
  // b was decided elsewhere; x, y are new at the top; d may have slid to page 2
  const m = mergeListRefresh(cur, [r('x'), r('y'), r('a'), r('c')], {})
  assert.deepEqual(m.rows.map((x) => x.id), ['a', 'c', 'd'])
  assert.deepEqual(m.pending.map((x) => x.id), ['x', 'y'])
  const done = mergeListRefresh(cur, [r('a')], { complete: true })
  assert.deepEqual(done.rows.map((x) => x.id), ['a'], 'a complete page is the whole list')
  assert.deepEqual(mergeListRefresh([], [r('x')]).rows.map((x) => x.id), ['x'], 'nothing on screen → shown directly')
  // a bulk approve emptied most of the page: page 2 slides up BELOW the survivors, it is not "new"
  const slid = mergeListRefresh([r('a'), r('b'), r('c')], [r('c'), r('d'), r('e')])
  assert.deepEqual(slid.rows.map((x) => x.id), ['c', 'd', 'e']); assert.deepEqual(slid.pending, [])
  const none = mergeListRefresh([r('a'), r('b')], [r('d'), r('e')])
  assert.deepEqual(none.rows.map((x) => x.id), ['d', 'e'], 'nothing survived → the fresh page'); assert.deepEqual(none.pending, [])
  // rows past the fresh page (loaded by "Load more") are kept, after the slid-up rows — never dropped on a guess
  const keep = mergeListRefresh([r('a'), r('b'), r('z')], [r('a'), r('c')])
  assert.deepEqual(keep.rows.map((x) => x.id), ['a', 'c', 'b', 'z'])
})

test('action: a large Undo answers in rounds and is called until complete', async () => {
  const calls = []
  const answers = [
    [200, { ok: true, changed: 300, message: 'Approved 300.', touched: ['held'], undo: { action: 'undo', args: { audit_id: '9' }, label: 'Undo' } }],
    [200, { ok: true, changed: 200, remaining: 100, complete: false, message: 'Undid 200 · 100 left.', touched: ['held'] }],
    [200, { ok: true, changed: 100, remaining: 0, complete: true, message: 'Undid 100.', touched: ['held', 'overview'] }],
  ]
  const api = async (action, body) => { calls.push({ action, body }); const [st, b] = answers.shift(); return toResult(st, JSON.stringify(b)) }
  const r = createActionRunner({ api, cache: new QueryCache(), action: 'review_held' })
  await r.run({ ids: ['*'] }); await r.undo()
  assert.deepEqual(calls.slice(1).map((c) => c.body), [{ audit_id: '9' }, { audit_id: '9' }])
  assert.equal(r.state().result.changed, 300); assert.match(r.state().result.message, /Undone: 300 rows put back\./); assert.equal(r.state().undone, true)
})

test('cache: keyset loadMore appends after the rows on screen, dedupes, and refresh keeps them', async () => {
  const c = new QueryCache()
  const pages = { '': { rows: [{ id: 1 }, { id: 2 }], next: 'c2' }, c2: { rows: [{ id: 2 }, { id: 3 }], next: null } }
  c.register('l', async ({ after }) => ({ ok: true, changed: 0, skipped: [], touched: [], message: '', ...pages[after || ''] }), { list: true })
  c.subscribe('l', () => {})
  await c.fetch('l'); await c.loadMore('l')
  assert.deepEqual(c.get('l').data.rows.map((x) => x.id), [1, 2, 3]); assert.equal(c.get('l').data.next, null)
  pages[''] = { rows: [{ id: 0 }, { id: 1 }, { id: 2 }], next: 'c2' }
  await c.fetch('l')
  assert.deepEqual(c.get('l').data.rows.map((x) => x.id), [1, 2, 3]); assert.deepEqual(c.get('l').pending.map((x) => x.id), [0])
  c.showPending('l')
  assert.deepEqual(c.get('l').data.rows.map((x) => x.id), [0, 1, 2, 3])
  // the owner's own action (touched) or Refresh reveals new rows at once — Undo puts rows back in place
  pages[''] = { rows: [{ id: -1 }, { id: 0 }, { id: 1 }], next: 'c2' }
  c.invalidate(['l']); await flush()
  assert.deepEqual(c.get('l').data.rows.map((x) => x.id), [-1, 0, 1, 2, 3]); assert.equal(c.get('l').pending.length, 0)
})

// ── The action pipeline (defects 1, 3, 12; classes b/d/g) ────────────────────────────────────────

function listCache(rows) {
  const c = new QueryCache()
  c.register('held', async () => ({ ok: true, changed: 0, skipped: [], touched: [], message: '', rows }), { list: true })
  return c
}

test('action: a double tap on the same target is blocked; different targets run side by side', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  const calls = []
  const api = async (action, body) => { calls.push(body); await gate; return toResult(200, JSON.stringify({ ok: true, changed: 1, message: 'Approved 1.', touched: [] })) }
  const r = createActionRunner({ api, cache: new QueryCache(), action: 'approve' })
  const a = r.run({ id: 1 }, 'r1')
  const b = await r.run({ id: 1 }, 'r1')
  assert.equal(b.code, 'busy'); assert.equal(r.isBusy('r1'), true)
  const c = r.run({ id: 2 }, 'r2')
  release(); await Promise.all([a, c])
  assert.equal(calls.length, 2); assert.equal(r.state('r1').status, 'done'); assert.equal(r.state('r1').result.message, 'Approved 1.')
})

test('action: optimistic removal is rolled back when the server says no, and kept when it says yes', async () => {
  const c = listCache([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  c.subscribe('held', () => {}); await c.fetch('held')
  const answers = [[500, { error: 'boom' }], [200, { ok: true, changed: 1, message: 'Approved 1.', touched: [] }]]
  const api = async () => { const [s, b] = answers.shift(); return toResult(s, JSON.stringify(b)) }
  const r = createActionRunner({ api, cache: c, action: 'approve', options: { optimistic: (tx, args) => tx.removeRows('held', args.ids) } })
  const p = r.run({ ids: ['b'] }, 'b')
  assert.deepEqual(c.get('held').data.rows.map((x) => x.id), ['a', 'c'], 'gone at once')
  await p
  assert.deepEqual(c.get('held').data.rows.map((x) => x.id), ['a', 'b', 'c'], 'back after the error')
  assert.equal(r.state('b').status, 'error'); assert.equal(r.state('b').error.retryable, true)
  await r.retry('b')
  assert.deepEqual(c.get('held').data.rows.map((x) => x.id), ['a', 'c']); assert.equal(r.state('b').status, 'done')
})

test('action: success re-reads only touched keys; Undo is itself an action that re-reads its keys', async () => {
  const c = new QueryCache()
  const reads = []
  for (const k of ['held', 'overview', 'listings']) { c.register(k, async () => { reads.push(k); return { ok: true, changed: 0, skipped: [], touched: [], message: '' } }); c.subscribe(k, () => {}); await c.fetch(k) }
  reads.length = 0
  const sent = []
  const api = async (action, body) => {
    sent.push({ action, body })
    if (action === 'approve') return toResult(200, JSON.stringify({ ok: true, changed: 142, skipped: [{ reason: 'possible_duplicate', count: 46 }], message: 'Approved 142 of 188.', touched: ['held', 'overview'], undo: { action: 'undo', args: { audit_id: 'a1' }, label: 'Undo' } }))
    return toResult(200, JSON.stringify({ ok: true, changed: 142, message: 'Put 142 reports back in the queue.', touched: ['held'] }))
  }
  const r = createActionRunner({ api, cache: c, action: 'approve' })
  await r.run({ ids: ['x'] }); await flush()
  assert.deepEqual(reads.sort(), ['held', 'overview'])
  assert.equal(r.state().result.skipped[0].count, 46)
  reads.length = 0
  await r.undo(); await flush()
  assert.deepEqual(sent[1], { action: 'undo', body: { audit_id: 'a1' } })
  assert.deepEqual(reads, ['held']); assert.equal(r.state().undone, true); assert.equal(r.state().result.undo, undefined, 'no second Undo')
})

test('action: a 401 mid-action replays after sign-in; the state ends done, nothing reloads', async () => {
  let token = 'old'
  const { impl, calls } = fakeFetch([[401, {}], [200, { ok: true, changed: 1, message: 'Approved 1.', touched: [] }]])
  const gate = createReauthGate()
  const api = createAdminApi({ fetchImpl: impl, getToken: () => token, reauth: () => gate.wait() })
  const r = createActionRunner({ api, cache: new QueryCache(), action: 'approve' })
  const p = r.run({ ids: ['1'] }, '1'); await flush()
  assert.equal(r.state('1').status, 'running', 'still running while the sheet is up')
  token = 'new'; gate.settle(true); await p
  assert.equal(r.state('1').status, 'done'); assert.equal(calls.length, 2)
})

// ── Jobs (defects 4, 8; class f) ──────────────────────────────────────────────────────────────────

function memStorage() { let v = null; return { get: () => v, set: (x) => { v = x }, raw: () => v } }
function jobServer({ backlog, per = 4000, failAt = [], zeroAt = -1, fatalAt = -1, scanAt = -1 }) {
  let left = backlog; let n = 0; let cursor
  const calls = []
  const api = async (action, body) => {
    n++; calls.push(body)
    if (failAt.includes(n)) return toResult(504, '')
    if (n === fatalAt) return toResult(500, JSON.stringify({ error: 'sweep_stale_jobs failed (HTTP 500)' }))
    const d = n === zeroAt || n === scanAt ? 0 : Math.min(left, per); left -= d
    if (n !== zeroAt) cursor = `c${n}` // a stuck round does not move its cursor; a scan round does
    return toResult(200, JSON.stringify({ ok: true, changed: d, remaining: left, complete: left === 0, cursor, message: n === scanAt ? 'Scanned 61,000 listings so far — keep going.' : `Cleared ${d}.`, touched: ['listing_counts'] }))
  }
  return { api, calls, left: () => left }
}
const SPEC = { action: 'purge_stale_jobs', label: 'Clearing stale listings', past: 'Cleared', noun: 'stale listings' }
async function until(fn, ms = 2000) { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await tick() } }

test('jobs: one press drains the whole backlog, retries lost rounds, sums the totals', async () => {
  const s = jobServer({ backlog: 20982, failAt: [2] })
  const touched = []
  const m = createJobManager({ api: s.api, sleep: async () => {}, invalidate: (t) => touched.push(...t) })
  const id = m.start(SPEC)
  await until(() => m.get(id).status !== 'running')
  const j = m.get(id)
  assert.equal(j.status, 'done'); assert.equal(j.changed, 20982); assert.equal(j.remaining, 0); assert.equal(j.lost_rounds, 1)
  assert.equal(s.calls[2].cursor, 'c1', 'the cursor rides into the next round')
  assert.match(j.message, /^Cleared 20,982 stale listings in \d+ rounds\.$/)
  assert.ok(touched.includes('listing_counts'))
})

test('jobs: a second press returns the running job instead of starting another loop', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  let calls = 0
  const api = async () => { calls++; await gate; return toResult(200, JSON.stringify({ ok: true, changed: 1, complete: true, touched: [] })) }
  const m = createJobManager({ api })
  const focused = []
  m.onFocus((id) => focused.push(id))
  const a = m.start(SPEC); const b = m.start(SPEC)
  assert.equal(a, b); assert.deepEqual(focused, [a])
  release(); await until(() => m.get(a).status === 'done')
  assert.equal(calls, 1)
  assert.equal(jobKey('a', { x: 1, y: 2 }), jobKey('a', { y: 2, x: 1 }))
})

test('jobs: no progress stops instead of spinning; 3 lost rounds in a row is a failure with the work kept', async () => {
  const s = jobServer({ backlog: 10000, zeroAt: 2 })
  const m = createJobManager({ api: s.api, sleep: async () => {} })
  const id = m.start(SPEC); await until(() => m.get(id).status !== 'running')
  assert.equal(m.get(id).status, 'error'); assert.equal(m.get(id).stopped, 'no_progress'); assert.equal(m.get(id).changed, 4000)
  assert.match(m.get(id).message, /changed nothing/)
  const f = jobServer({ backlog: 10000, failAt: [2, 3, 4] })
  const m2 = createJobManager({ api: f.api, sleep: async () => {} })
  const id2 = m2.start(SPEC); await until(() => m2.get(id2).status !== 'running')
  assert.equal(m2.get(id2).status, 'error'); assert.equal(m2.get(id2).changed, 4000); assert.match(m2.get(id2).message, /Cleared 4,000 stale listings before it stopped/)
})

test('jobs: Cancel stops after the current round; a reload offers Resume from the cursor with totals kept', async () => {
  const s = jobServer({ backlog: 20982 })
  let hold
  const slowApi = async (a, b) => { await new Promise((r) => { hold = r }); return s.api(a, b) }
  const store = memStorage()
  const m = createJobManager({ api: slowApi, storage: store, sleep: async () => {} })
  const id = m.start(SPEC)
  await until(() => hold); hold(); hold = null
  await until(() => m.get(id).rounds === 1)
  await until(() => hold)
  m.cancel(id)
  assert.equal(m.get(id).status, 'cancelling')
  hold(); await until(() => m.get(id).status === 'cancelled')
  assert.equal(m.get(id).changed, 8000, 'the round in flight finished'); assert.equal(m.get(id).stopped, 'cancel')
  assert.match(m.get(id).message, /^Cancelled: cleared 8,000 stale listings, 12,982 left\.$/)

  // a reload while running: rebuild from storage
  const s2 = jobServer({ backlog: 20982 })
  const store2 = memStorage()
  let hold2
  const m2 = createJobManager({ api: async (a, b) => { await new Promise((r) => { hold2 = r }); return s2.api(a, b) }, storage: store2, sleep: async () => {} })
  const id2 = m2.start(SPEC)
  await until(() => hold2); hold2(); hold2 = null
  await until(() => m2.get(id2).rounds === 1)
  // the page dies here; a new manager reads storage
  const fresh = jobServer({ backlog: 16982 })
  const m3 = createJobManager({ api: fresh.api, storage: store2, sleep: async () => {} })
  const back = m3.get(id2)
  assert.equal(back.status, 'cancelled'); assert.equal(back.stopped, 'reload'); assert.equal(back.resumable, true)
  assert.equal(jobProgressText(back), '4,000 of 20,982')
  m3.resume(id2)
  await until(() => m3.get(id2).status === 'done')
  assert.equal(fresh.calls[0].cursor, 'c1', 'resumed from the saved cursor')
  assert.equal(m3.get(id2).changed, 20982, 'totals carried across the reload')
})

test('jobs: the round cap pauses (resumable), never silently stops', async () => {
  const s = jobServer({ backlog: 100000, per: 10 })
  const m = createJobManager({ api: s.api, sleep: async () => {}, limits: { maxRounds: 3 } })
  const id = m.start(SPEC); await until(() => m.get(id).status !== 'running')
  const j = m.get(id)
  assert.equal(j.status, 'cancelled'); assert.equal(j.stopped, 'cap'); assert.equal(j.resumable, true); assert.equal(j.changed, 30)
  assert.match(jobSummary(j), /Resume to continue/)
})

test('action: an Undo that answers in rounds continues as a visible, resumable job (Restoring 400 of 1,200)', async () => {
  const sent = []
  let restored = 0
  const api = async (action, body) => {
    sent.push({ action, body })
    if (action === 'review_held') return toResult(200, JSON.stringify({ ok: true, changed: 1200, message: 'Approved 1,200.', touched: ['held'], undo: { action: 'undo', args: { audit_id: '7' }, label: 'Undo' } }))
    restored += 400
    const done = restored >= 1200
    return toResult(200, JSON.stringify({ ok: true, changed: 400, restored, total: 1200, remaining: 1200 - restored, complete: done, cursor: done ? undefined : `c${restored}`, message: `Restoring ${restored} of 1,200.`, touched: ['held', 'overview'] }))
  }
  const store = memStorage()
  const jobs = createJobManager({ api, storage: store, sleep: async () => {} })
  const r = createActionRunner({ api, cache: new QueryCache(), action: 'review_held', jobs })
  await r.run({ ids: ['*'] }); await r.undo()
  const st = r.state()
  assert.ok(st.jobId, 'the undo was handed to the job manager'); assert.equal(st.undone, true)
  assert.match(st.result.message, /400 of 1,200 restored so far/)
  await untilJ(() => jobs.get(st.jobId).status === 'done')
  const j = jobs.get(st.jobId)
  assert.equal(j.changed, 1200); assert.equal(j.remaining, 0)
  assert.deepEqual(sent.slice(2).map((c) => c.body), [{ audit_id: '7', cursor: 'c400' }, { audit_id: '7', cursor: 'c800' }], 'same audit_id, cursor passed back')
  assert.match(j.message, /^Restored 1,200 rows in 3 rounds\./)
})

test('jobs: a round that moves its cursor with nothing changed is progress; the server sentence is kept', async () => {
  const s = jobServer({ backlog: 8000, scanAt: 2 })
  const m = createJobManager({ api: s.api, sleep: async () => {} })
  const id = m.start(SPEC)
  let sawScan = false
  m.subscribe(() => { if (m.get(id)?.last_message?.startsWith('Scanned')) sawScan = true })
  await until(() => m.get(id).status !== 'running')
  assert.equal(m.get(id).status, 'done'); assert.equal(m.get(id).changed, 8000); assert.ok(sawScan, 'last_message carried the scan sentence')
  assert.equal(m.get(id).last_message, 'Cleared 4000.')
})

test('download: filename from Content-Disposition, errors as sentences, empty file refused, 401 replays', async () => {
  assert.equal(filenameFrom('attachment; filename="walmart-audit.pdf"'), 'walmart-audit.pdf')
  assert.equal(filenameFrom("attachment; filename*=UTF-8''Fry%27s%20audit.zip"), "Fry's audit.zip")
  assert.equal(filenameFrom('attachment; filename=a/b.csv'), 'a_b.csv')
  assert.equal(filenameFrom(null), null)
  const saved = []
  let token = 'old'
  const queue = [
    { status: 401, body: '{"error":"Session expired"}', type: 'application/json' },
    { status: 200, body: '%PDF-1.7 fake', type: 'application/pdf', cd: 'attachment; filename="acme.pdf"' },
    { status: 500, body: '<html>boom</html>', type: 'text/html' },
    { status: 200, body: '', type: 'application/pdf' },
    { status: 503, body: JSON.stringify({ ok: false, code: 'upstream', retryable: true, error: "Couldn't reach the database. Try again." }), type: 'application/json' },
  ]
  const fetchImpl = async (url, init) => {
    const a = queue.shift()
    return { status: a.status, headers: new Map([['content-type', a.type], ['content-disposition', a.cd || '']]), text: async () => a.body, blob: async () => new Blob([a.body]), sent: init.headers['X-Admin-Token'] }
  }
  const gate = createReauthGate()
  const dl = createAdminDownload({ fetchImpl, getToken: () => token, reauth: () => gate.wait(), save: (b, n) => saved.push(n) })
  const p = dl('/api/admin-company-audit-pdf', { company: 'Acme' })
  await flush(); token = 'new'; gate.settle(true)
  const r1 = await p
  assert.equal(r1.ok, true); assert.deepEqual(saved, ['acme.pdf']); assert.match(r1.message, /^Downloaded acme\.pdf \(1 KB\)\.$/)
  const r2 = await dl('/x'); assert.equal(r2.code, 'upstream'); assert.match(r2.error, /HTTP 500/)
  const r3 = await dl('/x'); assert.match(r3.error, /empty file/)
  const r4 = await dl('/x'); assert.equal(r4.retryable, true); assert.match(r4.error, /Couldn't reach the database/)
  assert.equal(saved.length, 1, 'nothing saved on a failure')
})

test('a 503 session check (upstream, retryable) is an error to retry — never the sign-in step', async () => {
  const { impl } = fakeFetch([[503, { ok: false, code: 'upstream', retryable: true, error: "Couldn't check the session — the database did not answer. Try again." }]])
  let asked = 0
  const api = createAdminApi({ fetchImpl: impl, getToken: () => 't', reauth: async () => { asked++; return true } })
  const r = await api('overview')
  assert.equal(r.code, 'upstream'); assert.equal(r.retryable, true); assert.equal(asked, 0)
})

test('jobs: a known total shows the same "N of M" from the first moment, kept current by the server', async () => {
  let done = 0; const seen = []
  const api = async () => { done += 20; const c = Math.min(done, 58); return toResult(200, JSON.stringify({ ok: true, changed: 20, complete: c >= 58, cursor: `c${c}`, touched: [] })) }
  const m = createJobManager({ api, sleep: async () => {} })
  const id = m.start({ ...SPEC, action: 'company_recompute_all', label: 'Updating company scores', past: 'Updated', noun: 'company scores', total: 58 })
  assert.equal(jobProgressText(m.get(id)), '0 of 58', 'never "0 so far" when the size is known')
  m.subscribe(() => { const j = m.get(id); if (j.status === 'running') seen.push(jobProgressText(j)) })
  await until(() => m.get(id).status === 'done')
  assert.deepEqual(seen, ['20 of 58', '40 of 58'])
  // the server's remaining wins when it says one
  const m2 = createJobManager({ api: async () => toResult(200, JSON.stringify({ ok: true, changed: 10, remaining: 70, complete: false, cursor: 'x1' })), sleep: async () => {}, limits: { maxRounds: 1 } })
  const id2 = m2.start({ ...SPEC, total: 58 }); await until(() => m2.get(id2).status !== 'running')
  assert.equal(jobProgressText(m2.get(id2)), '10 of 80')
})
