#!/usr/bin/env node
// Admin foundation smoke test (components/admin2). Drives the NEW admin in a real browser against a
// FIXTURE SERVER — Playwright answers every POST /api/admin-stats from a seeded in-memory store that
// really changes (approve removes rows, Undo restores them, a job drains a backlog) — with switches for
// 500 / 401 / timeout / empty body / slow answers. Nothing leaves the machine.
//
// Needs a build with the core's lab compiled in:
//   NEXT_PUBLIC_ADMIN_LAB=1 npx next build && npx next start -p 3400
//   node scripts/admin-smoke.mjs [--base http://127.0.0.1:3400] [--shots <dir>] [--only phone|desktop] [--skip-timeout]
//
// What it proves, at 390×844 and 1280×800: sign-in submits once (wrong vs locked); every overlay closes
// four ways (✕, Esc, backdrop, Back) and returns focus; refresh and Back restore section + filter + item;
// section state (filter, typed text, scroll) survives leaving and returning; Approve all → result line,
// rows leave in place, Undo restores; forced 500 / 401 / timeout / empty body each leave the page usable
// with a true sentence (401 → sign in → the action replays); a sentinel planted on window survives every
// action and section change (no reload, no document navigation); a long job runs across sections,
// cancels, and resumes after a reload; per-element overflow 0, tap targets ≥44px, text ≥12px, one <h1>,
// ≤1 filled button in the viewport.
import { chromium } from 'playwright'
import { mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def }
const BASE = arg('--base', 'http://127.0.0.1:3400')
const SHOTS = arg('--shots', '')
const ONLY = arg('--only', '')
const SKIP_TIMEOUT = process.argv.includes('--skip-timeout')
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

// ── The fixture server ─────────────────────────────────────────────────────────────────────────────
const COMPANIES = ['Acme Logistics', 'Northwind Test Labs', 'Globex', 'Initech', 'Umbrella Retail', 'Hooli', 'Stark Freight', 'Wayne Foods']
const OUTCOMES = ['offer', 'interview', 'rejected', 'ghosted']
function makeStore() {
  const held = []
  for (let i = 1; i <= 300; i++) {
    held.push({ id: `r${String(i).padStart(3, '0')}`, company: COMPANIES[i % COMPANIES.length], outcome: OUTCOMES[i % OUTCOMES.length],
      text: `Applied in October; ${OUTCOMES[i % OUTCOMES.length] === 'ghosted' ? 'never heard back after the phone screen' : 'heard back within two weeks'} (fixture row ${i}).`,
      dupe: i % 7 === 0, related: i < 300 ? `r${String(i + 1).padStart(3, '0')}` : undefined })
  }
  return {
    held, gone: new Map(), batches: new Map(), batchSeq: 0,
    token: null, logins: 0, faults: [], slowMs: 0, degraded: false,
    stale: 20982, staleDelayMs: 400, requests: [],
  }
}
let S = makeStore()
const live = (kind) => S.held.filter((r) => !S.gone.has(r.id) && (kind === 'positive' ? ['offer', 'interview'].includes(r.outcome) : kind === 'dupes' ? r.dupe : true))
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function answer(req) {
  if (req.method() === 'GET') {
    // The legacy admin's dashboard read. The fixture has no legacy stats: a valid session gets a 500
    // (the legacy page shows its own error + Retry and keeps the token), no session gets the 401.
    const ok = req.headers()['x-admin-token'] && req.headers()['x-admin-token'] === S.token
    return ok ? json(500, { error: 'the fixture has no legacy dashboard data' }) : json(401, { error: 'Session expired — log in again' })
  }
  const body = JSON.parse(req.postData() || '{}')
  const action = body.action
  S.requests.push(action)
  if (action === 'admin_login') {
    S.logins++
    if (body.password === 'locked') return json(429, { error: 'Too many failed attempts — try again in 15 minutes' })
    if (body.username !== 'owner' || body.password !== 'right') return json(401, { error: 'Invalid credentials' })
    S.token = `tok-${S.logins}`
    return json(200, { token: S.token, role: 'super_admin', username: 'owner' })
  }
  const token = req.headers()['x-admin-token']
  if (!token || token !== S.token) return json(401, { error: 'Session expired — log in again' })
  if (action === 'admin_logout') { S.token = null; return json(200, { ok: true, message: 'Signed out.' }) }

  const fi = S.faults.findIndex((f) => !f.action || f.action === action)
  if (fi >= 0) {
    const f = S.faults.splice(fi, 1)[0]
    if (f.kind === '500') return json(500, { error: 'The database refused the write (HTTP 500). Nothing was changed.' })
    if (f.kind === '401') { S.token = null; return json(401, { error: 'Session expired — log in again' }) }
    if (f.kind === '503') return json(503, { ok: false, code: 'upstream', retryable: true, error: "Couldn't reach the server — the session check timed out. Try again." })
    if (f.kind === 'empty') return { status: 200, contentType: 'application/json', body: '' }
    if (f.kind === 'html') return { status: 502, contentType: 'text/html', body: '<html><body>Bad gateway</body></html>' }
    if (f.kind === 'timeout') { await sleep(32_000); return json(200, { ok: true }) }
  }
  if (S.slowMs) await sleep(S.slowMs)

  switch (action) {
    case 'whoami': return json(200, { ok: true, changed: 0, skipped: [], message: 'Signed in as owner.', touched: [], rows: [{ admin_id: '1', username: 'owner', role: 'super_admin' }] })
    case 'overview': {
      const heldN = live('all').length
      return json(200, {
        ok: true, as_of: new Date().toISOString(), degraded: S.degraded, failed: S.degraded ? ['signups_24h'] : [],
        stats: { listings_live: 136865, listings_stale: S.stale, reports_24h: 122, signups_24h: S.degraded ? null : 3, revenue_7d_cents: 4997 },
        queues: [
          { key: 'held_reports', label: 'Held reports', count: heldN, section: 'review', filter: { kind: 'held' } },
          { key: 'listing_tickets', label: 'Listing tickets', count: 4, section: 'review', filter: { kind: 'listings' } },
          { key: 'reddit_disputes', label: 'Reddit disputes', count: 0, section: 'review' },
          { key: 'employer_claims', label: 'Employer claims', count: 0, section: 'review' },
          { key: 'employer_replies', label: 'Employer replies', count: 1, section: 'review', filter: { kind: 'employers' } },
          { key: 'purchases_to_fulfil', label: 'Purchases to fulfil', count: 0, section: 'review' },
          { key: 'data_issues', label: 'Data issues', count: S.degraded ? null : 0, section: 'review' },
          { key: 'account_clusters', label: 'Account clusters', count: 0, section: 'people' },
        ],
        system: { ok: false, line: '1 of 14 scheduled jobs failed its last run.', failing: [{ name: 'Archive reports', last_run: '2026-11-10T11:35:00Z', detail: 'every archive search was refused' }] },
      })
    }
    case 'search': {
      const q = String(body.q || '').toLowerCase()
      const hits = S.held.filter((r) => !S.gone.has(r.id) && (r.company.toLowerCase().includes(q) || r.id === q)).slice(0, 5)
        .map((r) => ({ kind: 'labitem', id: r.id, title: `${r.company} — ${r.outcome}`, sub: `Report ${r.id}` }))
      if ('owner@seenjobs.io'.includes(q)) hits.push({ kind: 'user', id: 'u1', title: 'owner@seenjobs.io', sub: 'Account' })
      return json(200, { ok: true, q: body.q, results: hits })
    }
    case 'lab_list': {
      const rows = live(body.kind || 'all')
      const start = body.after ? rows.findIndex((r) => r.id === body.after) + 1 : 0
      const page = rows.slice(start, start + 25)
      return json(200, { ok: true, rows: page, next: start + 25 < rows.length ? page[page.length - 1].id : null, total: rows.length })
    }
    case 'lab_report': {
      const r = S.held.find((x) => x.id === body.id && !S.gone.has(x.id))
      return r ? json(200, { ok: true, report: r }) : json(404, { ok: false, code: 'not_found', error: 'No report with that id.', retryable: false })
    }
    case 'lab_decide': {
      const all = body.ids?.[0] === '*all*'
      let ids = all ? live(body.kind || 'all').map((r) => r.id) : (body.ids || [])
      const skipped = []
      if (all) {
        const d = ids.filter((id) => S.held.find((r) => r.id === id)?.dupe)
        if (d.length) skipped.push({ reason: 'possible_duplicate', count: d.length })
        ids = ids.filter((id) => !d.includes(id))
      }
      const already = ids.filter((id) => S.gone.has(id))
      ids = ids.filter((id) => !S.gone.has(id))
      if (already.length) skipped.push({ reason: 'already_decided', count: already.length })
      for (const id of ids) S.gone.set(id, body.decision)
      const batch = `b${++S.batchSeq}`
      S.batches.set(batch, ids)
      const verb = body.decision === 'reject' ? 'Rejected' : body.decision === 'delete' ? 'Deleted' : 'Approved'
      const n = ids.length
      const total = n + skipped.reduce((a, s) => a + s.count, 0)
      const message = all ? `${verb} ${n} of ${total} held reports.` : n === 1 ? `${verb} the ${S.held.find((r) => r.id === ids[0]).company} report.` : `${verb} ${n} reports.`
      return json(200, { ok: true, changed: n, skipped, message, touched: ['lab_held', 'overview', ...ids.map((id) => `report:${id}`)],
        undo: body.decision === 'delete' ? undefined : { action: 'lab_undo', args: { batch }, label: 'Undo' } })
    }
    case 'lab_undo': {
      // Like the real server: a big undo answers in rounds (≤100 per round, running totals, cursor).
      const all = S.batches.get(body.batch) || []
      const total = all.length
      const left = all.filter((id) => S.gone.has(id))
      const now = left.slice(0, 100)
      for (const id of now) S.gone.delete(id)
      const restored = total - left.length + now.length
      const complete = restored >= total
      if (complete) S.batches.delete(body.batch)
      if (total > 100) await sleep(500)
      return json(200, { ok: true, changed: now.length, restored, total, remaining: total - restored, complete, cursor: complete ? undefined : `u${restored}`,
        message: complete && total <= 100 ? `Put ${total} ${total === 1 ? 'report' : 'reports'} back in the queue.` : `Restoring ${restored} of ${total}.`, touched: ['lab_held', 'overview'] })
    }
    case 'lab_clear': {
      await sleep(S.staleDelayMs)
      const d = Math.min(S.stale, 1500)
      S.stale -= d
      S.cleared = (S.cleared || 0) + d
      return json(200, { ok: true, changed: d, remaining: S.stale, complete: S.stale === 0, cursor: `c${S.stale}`, message: `Cleared ${d}.`, touched: ['overview'],
        request_id: body.request_id, undo: { action: 'lab_unclear', args: { request_id: body.request_id }, label: 'Undo' } })
    }
    case 'lab_unclear': {
      const n = S.cleared || 0; S.stale += n; S.cleared = 0
      return json(200, { ok: true, changed: n, complete: true, message: `Put ${n} stale listings back.`, touched: ['overview'] })
    }
    default:
      return json(400, { ok: false, code: 'unknown_action', error: `Unknown action: ${action}`, retryable: false })
  }
}

// ── Checks ─────────────────────────────────────────────────────────────────────────────────────────
const results = []
let currentPage = null
let failures = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    const visible = (el) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && !el.closest('[hidden]')
    }
    const clipped = (el) => { // inside a scroll/clip container narrower than the element (its own overflow handles it)
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX
        if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') return true
      }
      return false
    }
    const all = [...document.querySelectorAll('body *')].filter(visible)
    const overflow = all.filter((el) => { const r = el.getBoundingClientRect(); return (r.right > vw + 1 || r.left < -1) && !clipped(el) && getComputedStyle(el).position !== 'fixed' })
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className && el.className.baseVal === undefined ? el.className : '').toString().slice(0, 40)}`)
    const dlg = document.querySelector('[role=dialog][aria-modal=true]')
    // Every control itself, checkboxes included (a 20px box is not a 44px target unless the input is).
    const targets = [...(dlg || document).querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')]
      .filter(visible)
      .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw })
    const small = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5 })
      .map((el) => `${el.tagName.toLowerCase()}[${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}] ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`)
    const tiny = all.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 11.9)
      .map((el) => `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 20)}" ${getComputedStyle(el).fontSize}`)
    const h1 = [...document.querySelectorAll('h1')].filter(visible).length
    const CTA = 'rgb(37, 99, 235)'
    // With a sheet open, what is behind its dim is not on the screen the owner is using.
    const scope = document.querySelector('[role=dialog][aria-modal=true]') || document
    const filled = [...scope.querySelectorAll('button, a')].filter(visible)
      .filter((el) => getComputedStyle(el).backgroundColor === CTA)
      .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh })
      .map((el) => (el.textContent || '').trim().slice(0, 30))
    return { overflow: overflow.slice(0, 6), small: small.slice(0, 8), tiny: tiny.slice(0, 6), h1, filled }
  })
}
async function screenCheck(page, label, { sheet = false } = {}) {
  const m = await measure(page)
  check(`${label}: no element overflows the viewport`, m.overflow.length === 0, m.overflow.join(', '))
  check(`${label}: every tap target ≥44px`, m.small.length === 0, m.small.join(', '))
  check(`${label}: no text under 12px`, m.tiny.length === 0, m.tiny.join(', '))
  if (!sheet) check(`${label}: exactly one <h1>`, m.h1 === 1, `found ${m.h1}`)
  check(`${label}: at most one filled button in view`, m.filled.length <= 1, m.filled.join(' | '))
}
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }) }
const sentinelAlive = (page) => page.evaluate(() => window.__seenSentinel === 'alive')
const url = (page) => new URL(page.url())

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────
async function run(vp) {
  const phone = vp.name === 'phone'
  S = makeStore()
  const exe = ['/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find((p) => existsSync(p))
  const browser = await chromium.launch(exe ? { executablePath: exe } : {})
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, hasTouch: phone, isMobile: phone })
  await ctx.route('**/api/admin-stats**', async (route) => { route.fulfill(await answer(route.request())) })
  await ctx.route((u) => u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/admin-stats'), (route) => {
    const req = route.request()
    if (new URL(req.url()).pathname === '/api/admin-company-audit-pdf') {
      S.downloads = (S.downloads || 0) + 1
      if (req.headers()['x-admin-token'] !== S.token) return route.fulfill(json(401, { error: 'Session expired — log in again' }))
      const f = S.faults.findIndex((x) => x.action === 'audit_pdf')
      if (f >= 0) { S.faults.splice(f, 1); return route.fulfill(json(500, { ok: false, code: 'upstream', retryable: true, error: 'The PDF could not be built (HTTP 500). Nothing was downloaded.' })) }
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="acme-logistics-audit.pdf"' }, body: '%PDF-1.7\n% fixture audit\n' + 'x'.repeat(2000) })
    }
    return route.fulfill(json(404, { error: 'not in the fixture' }))
  })
  const page = await ctx.newPage()
  currentPage = page
  const docNavs = []
  page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) docNavs.push(r.url()) })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const tag = (s) => `[${vp.name}] ${s}`
  const go = async (sectionKey) => {
    if (phone) {
      const tab = page.getByTestId(`tab-${sectionKey}`)
      if (await tab.count()) await tab.click()
      else { await page.getByTestId('tab-more').click(); await page.getByTestId(`more-${sectionKey}`).click() }
    } else await page.getByTestId(`rail-${sectionKey}`).click()
  }

  // 1 · Sign-in
  await page.goto(`${BASE}/admin`)
  await page.getByTestId('login-form').waitFor()
  await screenCheck(page, tag('sign-in screen'))
  await shot(page, `${vp.name}-01-login`)
  await page.getByTestId('login-user').fill('owner')
  await page.getByTestId('login-pass').fill('wrong')
  await page.getByTestId('login-pass').press('Enter')
  await page.getByTestId('login-error').waitFor()
  check(tag('Enter submits the sign-in exactly once'), S.logins === 1, `${S.logins} requests`)
  check(tag('wrong password says so'), /don't match/.test(await page.getByTestId('login-error').innerText()))
  await page.getByTestId('login-pass').fill('locked')
  await page.getByTestId('login-submit').click()
  await page.waitForFunction(() => document.querySelector('[data-testid=login-error]')?.getAttribute('data-kind') === 'locked')
  check(tag('a lockout says when to try again'), /try again after \d/.test(await page.getByTestId('login-error').innerText()), await page.getByTestId('login-error').innerText())
  await shot(page, `${vp.name}-02-login-locked`)
  await page.getByTestId('login-pass').fill('right')
  await page.getByTestId('login-pass').press('Enter')
  await page.getByTestId('section-today').waitFor()
  check(tag('the token is stored where the legacy admin reads it'), await page.evaluate(() => sessionStorage.getItem('admin_token')) === S.token)
  await page.evaluate(() => { window.__seenSentinel = 'alive' })
  const navsAtStart = docNavs.length

  // 2 · Today
  await page.getByTestId('queue-held_reports').waitFor()
  await screenCheck(page, tag('Today'))
  await shot(page, `${vp.name}-03-today`)
  check(tag('Today shows the queues with work and folds the empty ones into one line'),
    (await page.getByTestId('today-empty-queues').innerText()).startsWith('Nothing waiting in'))
  check(tag('Today: failing scheduled job is named'), /Archive reports/.test(await page.getByTestId('today-system').innerText()))
  S.degraded = true
  await page.getByTestId('today-refresh').click()
  await page.getByTestId('today-degraded').waitFor()
  check(tag('a number that could not be read says "couldn\'t read", never 0'), /couldn.t read/.test(await page.getByTestId('stat-signups').innerText()))
  await shot(page, `${vp.name}-04-today-degraded`)
  S.degraded = false
  // A session check that timed out answers 503 upstream: a Retry line, the page kept — never the sign-in step
  S.faults.push({ kind: '503', action: 'overview' })
  await page.getByTestId('today-refresh').click()
  await page.getByTestId('refresh-failed').waitFor()
  check(tag('a 503 (session check timed out) keeps the page and offers Retry, no sign-in step'),
    /Couldn.t reach the server/.test(await page.getByTestId('refresh-failed').innerText()) && await page.getByTestId('sheet-session').count() === 0 && await page.getByTestId('stat-listings').count() === 1 && await sentinelAlive(page),
    (await page.getByTestId('refresh-failed').innerText()).replace(/\s+/g, ' '))
  await shot(page, `${vp.name}-04b-today-503`)
  await page.getByTestId('refresh-failed').getByRole('button', { name: 'Retry' }).click()
  await page.getByTestId('refresh-failed').waitFor({ state: 'detached' })
  check(tag('Retry after the 503 reads again and clears the line'), true)
  await page.getByTestId('queue-held_reports').click()
  check(tag('a queue row opens its section with its filter in the URL'), url(page).searchParams.get('s') === 'review' && url(page).searchParams.get('review.kind') === 'held', page.url())
  await page.waitForFunction(() => document.querySelector('[data-section-active] h1')?.textContent?.trim() === 'Review')
  check(tag('the queue row lands on the Review section'), true)

  // 3 · A section whose code cannot be downloaded shows ErrorState + Retry inside it; the shell stays
  let blockChunks = true
  await page.route('**/_next/static/chunks/**', (route) => (blockChunks ? route.abort('internetdisconnected') : route.continue()))
  await go('lab')
  const activeErr = page.locator('[data-section-active] [data-testid=error-state]')
  await activeErr.waitFor()
  check(tag('a section that fails to load shows Retry inside the section; the shell stays'),
    /could not be downloaded/.test(await activeErr.innerText()) && await page.getByTestId('admin-shell').isVisible() && await sentinelAlive(page))
  await shot(page, `${vp.name}-05a-section-load-failed`)
  blockChunks = false
  await page.locator('[data-section-active] [data-testid=error-retry]').click()

  // 4 · Lab: section state survives leaving and returning
  await page.getByTestId('section-lab').waitFor()
  await page.getByTestId('lab-row-r001').waitFor()
  await screenCheck(page, tag('Lab list'))
  await shot(page, `${vp.name}-05-lab`)
  await page.getByTestId('lab-note').fill('half-typed note')
  await page.getByRole('button', { name: 'Positive' }).click()
  await page.waitForFunction(() => new URLSearchParams(location.search).get('lab.kind') === 'positive')
  await page.getByTestId('lab-row-r004').waitFor()
  await page.mouse.wheel(0, 900); await page.waitForTimeout(400)
  const y1 = await page.evaluate(() => window.scrollY)
  await go('today'); await page.getByTestId('section-today').waitFor({ state: 'visible' })
  await go('lab'); await page.waitForTimeout(400)
  check(tag('a half-typed field survives a section round trip'), await page.getByTestId('lab-note').inputValue() === 'half-typed note')
  check(tag('the filter survives a section round trip'), url(page).searchParams.get('lab.kind') === 'positive')
  const y2 = await page.evaluate(() => window.scrollY)
  check(tag('scroll comes back per section'), Math.abs(y2 - y1) < 8 && y1 > 100, `${y1} → ${y2}`)
  await page.reload(); await page.getByTestId('lab-row-r004').waitFor()
  check(tag('a refresh keeps section + filter'), url(page).searchParams.get('s') === 'lab' && url(page).searchParams.get('lab.kind') === 'positive')
  await page.evaluate(() => { window.__seenSentinel = 'alive'; window.scrollTo(0, 0) })
  const navsAfterReload = docNavs.length
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('lab-row-r001').waitFor()

  // Downloads: the file arrives with its server name; a failure is a sentence; a 401 signs in and replays
  {
    const [d1] = await Promise.all([page.waitForEvent('download'), page.getByTestId('lab-download').click()])
    check(tag('a binary download saves the file under the server\'s name'), d1.suggestedFilename() === 'acme-logistics-audit.pdf', d1.suggestedFilename())
    await page.waitForFunction(() => /Downloaded acme-logistics-audit\.pdf/.test(document.body.textContent || ''))
    S.faults.push({ kind: 'x', action: 'audit_pdf' })
    await page.getByTestId('lab-download').click()
    await page.waitForFunction(() => /could not be built/.test(document.body.textContent || ''))
    check(tag('a failed download says so and offers Retry'), await page.getByRole('button', { name: 'Retry' }).count() >= 1)
    S.token = 'expired-by-test'
    const dlP = page.waitForEvent('download')
    await page.getByTestId('lab-download').click()
    await page.getByTestId('sheet-session').waitFor()
    await page.getByTestId('login-pass').fill('right'); await page.getByTestId('login-submit').click()
    const d2 = await dlP
    check(tag('a 401 during a download → sign in → the file still arrives'), d2.suggestedFilename() === 'acme-logistics-audit.pdf' && await sentinelAlive(page))
    await page.locator('[data-testid=result-dismiss]').first().click().catch(() => {})
  }

  // Scroll memory never fights the person: switch kind, scroll 400px at 100 ms, still there at 1.5 s
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.getByRole('button', { name: 'Positive' }).click()
  await page.waitForTimeout(100)
  if (phone) await page.evaluate(() => { window.dispatchEvent(new Event('touchstart')); window.scrollBy(0, 400) })
  else await page.mouse.wheel(0, 400)
  await page.waitForTimeout(1400)
  const yKind = await page.evaluate(() => window.scrollY)
  check(tag('a scroll right after a kind switch is not pulled back'), yKind >= 300, `scrollY ${yKind} at 1.5 s`)
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('lab-row-r001').waitFor()
  await page.evaluate(() => window.scrollTo(0, 0))

  // 4 · Approve all → result line, rows leave in place, Undo restores, a second press cannot double-run
  await page.getByTestId('lab-approve-all').click()
  await page.getByTestId('confirm-step').waitFor()
  await shot(page, `${vp.name}-06-confirm`)
  const before = S.requests.filter((a) => a === 'lab_decide').length
  await page.getByTestId('confirm-go').dblclick().catch(() => {})
  await page.waitForFunction(() => document.querySelector('[data-testid=result-line]')?.getAttribute('data-state') === 'done')
  const line = await page.getByTestId('result-line').first().innerText()
  check(tag('Approve all: one request even on a double tap'), S.requests.filter((a) => a === 'lab_decide').length - before === 1)
  check(tag('Approve all: the result line says what changed with counts'), /Approved 258 of 300 held reports/.test(line), line.replace(/\s+/g, ' '))
  check(tag('Approve all: skipped duplicates are offered as a link'), await page.getByRole('button', { name: 'Review them' }).count() === 1)
  await page.getByTestId('section-lab').getByTestId('lab-row-r007').waitFor()
  check(tag('Approve all: approved rows left the list without a reload'), await page.getByTestId('lab-row-r001').count() === 0 && await sentinelAlive(page))
  await shot(page, `${vp.name}-07-approved`)
  await page.getByTestId('result-undo').click()
  await page.waitForFunction(() => /Undo is running: 100 of 258 restored so far/.test(document.querySelector('[data-testid=result-line]')?.textContent || ''))
  await page.locator('[data-testid=job-chip]:visible').waitFor()
  const chipU = await page.locator('[data-testid=job-chip]:visible').innerText()
  check(tag('a big Undo runs as a visible job ("Restoring rows · N of 258")'), /Restoring rows/.test(chipU) && /of 258/.test(chipU), chipU.replace(/\s+/g, ' '))
  await shot(page, `${vp.name}-07b-undo-job`)
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=job-chip]')].some((c) => /Done: Restoring rows/.test(c.textContent || '')), null, { timeout: 15000 })
  await page.getByTestId('lab-row-r001').waitFor()
  check(tag('the Undo job puts every row back, in place, without a reload'), S.batches.size === 0 && await page.getByTestId('lab-row-r001').count() === 1 && await sentinelAlive(page))
  await page.locator('[data-testid=job-chip]:visible').click(); await page.getByTestId('sheet-panel').getByTestId('job-dismiss').click(); await page.getByTestId('sheet-close').click()
  await page.getByTestId('result-dismiss').first().click()

  // 5 · Row action: optimistic removal, then forced failures
  await page.getByTestId('lab-approve-r001').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid=lab-row-r001]'))
  check(tag('a row approve removes the row at once'), true)
  await page.getByTestId('result-undo').click(); await page.getByTestId('lab-row-r001').waitFor()

  const forced = [['500', /database refused the write/i], ['empty', /answer was empty/i], ['html', /server failed \(HTTP 502\)/i]]
  if (!SKIP_TIMEOUT) forced.push(['timeout', /No answer from the server after 30 seconds/])
  for (const [kind, re] of forced) {
    S.faults.push({ kind, action: 'lab_decide' })
    await page.getByTestId('lab-approve-r002').click()
    const errLine = page.getByTestId('lab-row-r002').getByTestId('result-line')
    await errLine.waitFor({ timeout: 40_000 })
    const txt = await errLine.innerText()
    check(tag(`forced ${kind}: a true sentence, the row is back, the page is usable`), re.test(txt) && await page.getByTestId('lab-row-r002').count() === 1 && await sentinelAlive(page), txt.replace(/\s+/g, ' '))
    if (kind === '500') await shot(page, `${vp.name}-08-error-500`)
    await errLine.getByTestId('result-retry').click()
    await page.waitForFunction(() => !document.querySelector('[data-testid=lab-row-r002]'))
    check(tag(`forced ${kind}: Retry then works`), true)
    await page.getByTestId('result-undo').click(); await page.getByTestId('lab-row-r002').waitFor()
    await page.getByTestId('result-dismiss').first().click().catch(() => {})
  }

  // 401 mid-action: the sign-in step replays the action; the page stays
  S.faults.push({ kind: '401', action: 'lab_decide' })
  await page.getByTestId('lab-approve-r003').click()
  await page.getByTestId('sheet-session').waitFor()
  await screenCheck(page, tag('session-ended sheet'), { sheet: true })
  await shot(page, `${vp.name}-09-session-ended`)
  await page.getByTestId('login-pass').fill('right')
  await page.getByTestId('login-submit').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid=lab-row-r003]'))
  await page.getByTestId('sheet-session').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  check(tag('401: sign in, and the pressed action finishes'), await sentinelAlive(page) && await page.getByTestId('sheet-session').count() === 0,
    `sentinel ${await sentinelAlive(page)}, session sheets ${await page.getByTestId('sheet-session').count()}, url ${page.url()}`)

  // 6 · The item sheet: four ways out, focus back, refresh reopens, replace + Back
  const opener = page.getByTestId('lab-row-r004').locator('button').first()
  const openIt = async () => { await opener.click(); await page.getByTestId('lab-item').waitFor() }
  await openIt()
  check(tag('an item opens in the URL'), url(page).searchParams.get('item') === 'labitem:r004')
  await screenCheck(page, tag('item sheet'), { sheet: true })
  await shot(page, `${vp.name}-10-item`)
  await page.getByTestId('sheet-close').click()
  await page.getByTestId('sheet-item').waitFor({ state: 'detached' })
  check(tag('✕ closes the sheet and clears the URL'), !url(page).searchParams.get('item'))
  check(tag('focus returns to the row that opened it'), await page.evaluate(() => document.activeElement?.closest('[data-testid=lab-row-r004]') != null))
  await openIt(); await page.keyboard.press('Escape'); await page.getByTestId('sheet-item').waitFor({ state: 'detached' })
  check(tag('Esc closes the sheet'), !url(page).searchParams.get('item'))
  await openIt(); await page.mouse.click(phone ? vp.w / 2 : 20, phone ? 20 : vp.h / 2); await page.getByTestId('sheet-item').waitFor({ state: 'detached' })
  check(tag('a backdrop tap closes the sheet'), !url(page).searchParams.get('item'))
  await openIt(); await page.goBack(); await page.getByTestId('sheet-item').waitFor({ state: 'detached' })
  check(tag('Back closes the sheet and stays in the admin'), !url(page).searchParams.get('item') && url(page).pathname === '/admin' && url(page).searchParams.get('s') === 'lab')
  await openIt()
  await page.reload(); await page.getByTestId('lab-item').waitFor()
  check(tag('a refresh reopens the open item'), url(page).searchParams.get('item') === 'labitem:r004')
  await page.evaluate(() => { window.__seenSentinel = 'alive' })
  const navsAfterReload2 = docNavs.length
  await page.getByTestId('lab-item-related').click()
  await page.waitForFunction(() => new URLSearchParams(location.search).get('item') === 'labitem:r005')
  check(tag('opening a related item replaces the sheet (still one sheet)'), await page.locator('[role=dialog]').count() === 1)
  await page.goBack(); await page.waitForFunction(() => new URLSearchParams(location.search).get('item') === 'labitem:r004')
  check(tag('Back from the related item returns to the previous one'), true)
  await page.getByTestId('lab-item-related').click(); await page.waitForFunction(() => new URLSearchParams(location.search).get('item') === 'labitem:r005')
  await page.getByTestId('sheet-close').click(); await page.getByTestId('sheet-item').waitFor({ state: 'detached' })
  check(tag('✕ closes the whole stack, including an item opened from a link'), !url(page).searchParams.get('item'))
  // destructive step inside the sheet, type-to-confirm
  await page.getByTestId('lab-row-r006').locator('button').first().click(); await page.getByTestId('lab-item').waitFor()
  await page.getByTestId('lab-item-delete').click()
  check(tag('a type-to-confirm step blocks the button until the word is typed'), await page.getByTestId('confirm-go').isDisabled())
  await shot(page, `${vp.name}-11-type-to-confirm`)
  await page.keyboard.press('Escape')
  check(tag('Esc inside a confirm step cancels the step, not the sheet'), await page.getByTestId('lab-item').count() === 1 && await page.getByTestId('confirm-step').count() === 0)
  await page.getByTestId('sheet-close').click()
  // unknown kinds and kinds with no view
  await page.goto(`${BASE}/admin?s=lab&item=wizard:1`); await page.getByTestId('sheet-item').getByTestId('empty-state').waitFor()
  check(tag('an unknown item kind shows a plain "not found" in the sheet'), /Nothing to open at this link/.test(await page.getByTestId('sheet-item').innerText()))
  await page.getByTestId('sheet-close').click()
  await page.goto(`${BASE}/admin?s=lab&item=labitem:nope`); await page.getByTestId('sheet-item').getByTestId('empty-state').waitFor()
  check(tag('an id the server does not know shows "not found"'), /Lab report not found/.test(await page.getByTestId('sheet-item').innerText()))
  await page.getByTestId('sheet-close').click()
  await page.evaluate(() => { window.__seenSentinel = 'alive' })
  const navsAfterGoto = docNavs.length

  // 7 · Search, More, jobs panel: each closes four ways
  const openSearch = async () => { if (phone) await page.getByTestId('top-search').click(); else await page.keyboard.press('/'); await page.getByTestId('search-input').waitFor() }
  for (const way of ['x', 'esc', 'backdrop', 'back']) {
    await openSearch()
    if (way === 'x') await page.getByTestId('sheet-close').click()
    if (way === 'esc') await page.keyboard.press('Escape')
    if (way === 'backdrop') await page.mouse.click(phone ? vp.w / 2 : 20, phone ? 20 : vp.h / 2)
    if (way === 'back') await page.goBack()
    await page.getByTestId('sheet-panel').waitFor({ state: 'detached' })
    check(tag(`search sheet closes by ${way}`), url(page).pathname === '/admin' && await sentinelAlive(page))
  }
  await openSearch()
  await page.getByTestId('search-input').fill('globex')
  await page.getByTestId('search-result').first().waitFor()
  await shot(page, `${vp.name}-12-search`)
  await page.getByTestId('search-input').press('Enter')
  await page.getByTestId('lab-item').waitFor()
  check(tag('a search result opens its item'), /^labitem:/.test(url(page).searchParams.get('item') || ''))
  await page.goBack(); await page.getByTestId('sheet-item').waitFor({ state: 'detached' })
  check(tag('Back from a searched item closes it (no stale search entry)'), !url(page).searchParams.get('item') && url(page).pathname === '/admin')
  if (phone) {
    await page.getByTestId('tab-more').click(); await page.getByTestId('more-system').waitFor()
    await shot(page, `${vp.name}-13-more`)
    await page.goBack(); await page.getByTestId('sheet-panel').waitFor({ state: 'detached' })
    check(tag('More closes by Back'), url(page).pathname === '/admin')
  }

  // 8 · A long job across sections, cancel, resume after a reload
  await go('lab'); await page.getByTestId('lab-job').click()
  await page.locator('[data-testid=job-chip]:visible').waitFor()
  await page.waitForFunction(() => /of 20,982/.test(document.querySelector('[data-testid=job-progress]')?.textContent || ''))
  check(tag('a job shows live counts "N of 20,982"'), true)
  await page.getByTestId('lab-job').click()
  await page.getByTestId('sheet-panel').waitFor()
  check(tag('a second press opens the running job instead of starting another'), S.requests.filter((a) => a === 'lab_clear').length >= 1 && await page.locator('[data-testid=sheet-panel] [data-testid=job-progress]').count() === 1)
  await page.getByTestId('sheet-close').click()
  await go('today'); await page.waitForTimeout(1200)
  const chip1 = await page.locator('[data-testid=job-chip]:visible').innerText()
  await page.waitForTimeout(1200)
  const chip2 = await page.locator('[data-testid=job-chip]:visible').innerText()
  check(tag('the job keeps running while another section is open'), chip1 !== chip2, `${chip1.replace(/\s+/g, ' ')} → ${chip2.replace(/\s+/g, ' ')}`)
  await shot(page, `${vp.name}-14-job-chip`)
  await page.locator('[data-testid=job-chip]:visible').click(); await page.getByTestId('sheet-panel').getByTestId('job-cancel').click()
  await page.waitForFunction(() => document.querySelector('[data-testid=sheet-panel] [data-testid=job-progress]')?.getAttribute('data-status') === 'cancelled', null, { timeout: 5000 })
  check(tag('Cancel stops after the current round'), /^Cancelled: cleared/.test(await page.locator('[data-testid=sheet-panel] [data-testid=job-progress]').innerText().then((t) => t.split('\n').find((l) => l.startsWith('Cancelled')) || '')))
  await page.getByTestId('sheet-panel').getByTestId('job-resume').click()
  await page.getByTestId('sheet-close').click()
  await page.waitForTimeout(900)
  await page.reload(); await page.getByTestId('section-today').waitFor()
  await page.locator('[data-testid=job-chip]:visible').click()
  const resumeBtn = page.getByTestId('sheet-panel').getByTestId('job-resume')
  await resumeBtn.waitFor()
  const rl = await resumeBtn.innerText()
  check(tag('after a reload the job offers "Resume … — N left"'), /^Resume clearing stale listings — [\d,]+ left$/.test(rl.trim()), rl)
  await shot(page, `${vp.name}-15-resume`)
  S.staleDelayMs = 30
  await resumeBtn.click()
  await page.waitForFunction(() => document.querySelector('[data-testid=sheet-panel] [data-testid=job-progress]')?.getAttribute('data-status') === 'done', null, { timeout: 20_000 })
  const doneTxt = await page.locator('[data-testid=sheet-panel] [data-testid=job-progress]').innerText()
  check(tag('the resumed job finishes; the server has nothing left'), S.stale === 0 && /Cleared [\d,]+ stale listings/.test(doneTxt), doneTxt.split('\n').slice(-2).join(' '))
  await page.getByTestId('sheet-close').click()
  if (phone) {
    for (const w of [360, 390, 430]) {
      await page.setViewportSize({ width: w, height: 844 }); await page.waitForTimeout(250)
      const o = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' }
        const header = document.querySelector('[data-testid=admin-shell] header')
        const items = [...header.querySelectorAll('button, a, span, input')].filter(vis).filter((el) => ![...el.children].some((c) => vis(c) && c.tagName !== 'svg') || el.matches('button, a, input'))
          .filter((el, _, arr) => !arr.some((p) => p !== el && p.contains(el)))
        const hits = []
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
          const a = items[i].getBoundingClientRect(), b = items[j].getBoundingClientRect()
          if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) hits.push(`${items[i].textContent.trim().slice(0, 12)} × ${items[j].textContent.trim().slice(0, 12)}`)
        }
        const bar = document.querySelector('[data-testid=job-bar]')?.getBoundingClientRect()
        const top = header.getBoundingClientRect()
        const bottom = document.querySelector('[data-testid=tab-today]')?.parentElement?.getBoundingClientRect()
        const chip = document.querySelector('[data-testid=job-bar] [data-testid=job-chip]')
        return { hits, bar: bar && { top: bar.top, bottom: bar.bottom, h: bar.height }, headerBottom: top.bottom, bottomTop: bottom?.top, chipH: chip?.getBoundingClientRect().height, chipInHeader: !!header.querySelector('[data-testid=job-chip]') }
      })
      check(tag(`header at ${w}px: no two elements intersect, the job chip is not in it`), o.hits.length === 0 && !o.chipInHeader, o.hits.join(', '))
      check(tag(`job bar at ${w}px: one line, between the header and the bottom bar, touching neither`), !!o.bar && o.bar.top >= o.headerBottom && Math.abs(o.bar.bottom - o.bottomTop) < 1.5 && o.chipH <= 48, JSON.stringify(o))
    }
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await shot(page, `${vp.name}-15b-job-bar`)
  }
  await page.locator('[data-testid=job-chip]:visible').click()
  // A finished multi-round job offers the server's Undo for the whole press (one request_id on every round)
  await page.getByTestId('sheet-panel').getByTestId('job-undo').click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=sheet-panel] [data-testid=job-progress]')].some((e) => /Put back 20,982 rows/.test(e.textContent || '')), null, { timeout: 10000 })
  check(tag('a finished job offers Undo, and the Undo runs (every listing back)'), S.stale === 20982 && await page.getByTestId('sheet-panel').getByTestId('job-undo').count() === 0)
  for (let i = 0; i < 2; i++) await page.getByTestId('sheet-panel').getByTestId('job-dismiss').first().click()
  await page.getByTestId('sheet-close').click()

  // 9 · No document navigation happened except the reloads/gotos the test made itself
  const extra = docNavs.length - navsAtStart - 4 // 4 = the reloads/gotos above (lab reload, item reload, two gotos)
  // (a download is not a document navigation; Playwright reports it as a download)
  check(tag('no action or section change caused a page load'), extra <= 1 && errors.length === 0, `${docNavs.length - navsAtStart} document loads (expected 4–5 from the test's own reloads); page errors: ${errors.slice(0, 3).join(' | ')}`)
  void navsAfterReload; void navsAfterReload2; void navsAfterGoto

  // 10 · Sign out, legacy
  if (phone) { await page.getByTestId('tab-more').click(); await page.getByTestId('more-signout').click() }
  else await page.getByTestId('rail-signout').click()
  await page.getByTestId('login-form').waitFor()
  check(tag('sign out returns to the sign-in screen'), await page.evaluate(() => !sessionStorage.getItem('admin_token')))
  await page.goto(`${BASE}/admin/legacy`)
  await page.getByPlaceholder('Username').waitFor()
  await page.getByPlaceholder('Username').fill('owner'); await page.getByPlaceholder('Password').fill('right')
  await page.getByRole('button', { name: /Sign in/ }).click()
  await page.waitForFunction(() => !!sessionStorage.getItem('admin_token'))
  check(tag('/admin/legacy still renders and signs in (same token key)'), await page.evaluate(() => sessionStorage.getItem('admin_token')) === S.token)
  await shot(page, `${vp.name}-16-legacy`)
  await browser.close()
}

const VIEWPORTS = [{ name: 'phone', w: 390, h: 844 }, { name: 'desktop', w: 1280, h: 800 }].filter((v) => !ONLY || v.name === ONLY)
for (const vp of VIEWPORTS) {
  try { await run(vp) } catch (e) {
    check(`[${vp.name}] run finished`, false, e.message.split('\n').slice(0, 3).join(' / '))
    if (SHOTS && currentPage) await currentPage.screenshot({ path: path.join(SHOTS, `${vp.name}-FAIL.png`) }).catch(() => {})
    await currentPage?.context().browser()?.close().catch(() => {})
  }
}
console.log(`\n${results.length - failures} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
