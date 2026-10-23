import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

// The redirect rule, re-stated here from lib/sessionExpired.ts (TypeScript, not importable
// under node --test without a loader): /login and /reset never redirect; everything else goes
// to /login?return=<path+search>.
function sessionExpiredRedirect(pathname, search = '') {
  if (pathname.startsWith('/login') || pathname.startsWith('/reset')) return null
  return `/login?return=${encodeURIComponent(`${pathname}${search || ''}`)}`
}

test('expired session routes to /login with the current path, never from /login or /reset', () => {
  assert.equal(sessionExpiredRedirect('/tracker'), '/login?return=%2Ftracker')
  assert.equal(sessionExpiredRedirect('/company/amazon', '?tab=reports'), '/login?return=%2Fcompany%2Famazon%3Ftab%3Dreports')
  assert.equal(sessionExpiredRedirect('/login'), null)
  assert.equal(sessionExpiredRedirect('/login?signup=1'), null)
  assert.equal(sessionExpiredRedirect('/reset'), null)
  // pin the TS source to the same rule
  const src = read('lib/sessionExpired.ts')
  assert.match(src, /pathname\.startsWith\('\/login'\) \|\| pathname\.startsWith\('\/reset'\)/)
  assert.match(src, /`\/login\?return=\$\{encodeURIComponent\(here\)\}`/)
})

test('every sign-out in the app is LOCAL unless it is the explicit "all devices" action', () => {
  const files = ['components/Nav.tsx', 'app/profile/page.tsx', 'components/employer/EmployerNav.tsx', 'lib/sessionExpired.ts']
  const calls = files.flatMap(f => [...read(f).matchAll(/supabase\.auth\.signOut\(([^)]*)\)/g)].map(m => ({ f, args: m[1].trim() })))
  assert.ok(calls.length >= 5, `expected sign-out call sites, got ${calls.length}`)
  for (const c of calls) {
    assert.notEqual(c.args, '', `${c.f}: signOut() without a scope is GLOBAL and logs the user out of every device`)
  }
  const globals = calls.filter(c => c.args.includes("'global'"))
  assert.equal(globals.length, 1, 'exactly one global sign-out: Settings → Sign out of all devices')
  assert.equal(globals[0].f, 'app/profile/page.tsx')
})

test('a 401 from user-sync triggers the one-shot expiry handler', () => {
  const sync = read('lib/sync.ts')
  assert.match(sync, /r\.status === 401\) void handleSessionExpired\(\)/)
  const auth = read('lib/auth.tsx')
  assert.match(auth, /if \(hadUser && !intentional\) void handleSessionExpired\(\)/)
})

test('login lands seekers on /dashboard after email confirmation and polls for it', () => {
  const login = read('app/login/page.tsx')
  assert.match(login, /effectiveType === 'employer' \? '\/employers\/dashboard' : '\/dashboard'/)
  assert.match(login, /VERIFY_POLL_MS = 5_000/)
  assert.match(login, /autoComplete="given-name"/)
  assert.match(login, /autoComplete: 'new-password'/)
  assert.match(login, /autoComplete: 'current-password'/)
  assert.doesNotMatch(login, /straight to your dashboard/)
})

test('FAQ names the founder, links contact, and does not describe the hidden Inbox Autopilot', () => {
  const faq = read('app/faq/page.tsx')
  assert.match(faq, /Brandon, Seen&apos;s founder, in California/)
  assert.match(faq, /href="\/contact"/)
  assert.doesNotMatch(faq, /Inbox Autopilot/)
  assert.doesNotMatch(faq, /track-…@seenjobs\.io/)
  const footer = read('components/Footer.tsx')
  assert.match(footer, /href: '\/contact'/)
  assert.doesNotMatch(footer, /mailto:/)
})
