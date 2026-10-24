// Sign-out hygiene guard. Enumerates EVERY localStorage key the app writes (app/, lib/,
// components/) and requires each one to be swept on sign-out (SESSION_LOCAL_KEYS /
// SESSION_LOCAL_PREFIXES) or named in DEVICE_SCOPED_KEYS with the reason it may stay. A new
// per-user key that is not swept fails this test — the class (2026-10-23 audit: résumé text left
// in seen_resume_<uid> after sign-out) cannot regress silently.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SESSION_LOCAL_KEYS, SESSION_LOCAL_PREFIXES, DEVICE_SCOPED_KEYS, isSessionLocalKey } from './sessionLocalKeys.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out) } else if (/\.(tsx?|jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib')), ...walk(path.join(root, 'components'))]
const src = Object.fromEntries(files.map((f) => [path.relative(root, f), readFileSync(f, 'utf8')]))

// Every string / template literal that looks like a storage key: a `seen…` or `_seen…` or `ji_`
// literal, with any `${…}` suffix cut off (that is the user-id part). Collected from all source,
// not only from setItem call sites, because keys are usually defined once as a constant.
// Only lines that touch storage or define a storage key constant are read, so event names
// ("seen:credits-updated") and download file names never count as keys.
const KEY_LINE = /(localStorage|sessionStorage)\.(get|set|remove)Item\(|safeLocal(Get|Set)\(|\b[A-Z_]*(KEY|PREFIX)\b\s*=|function \w*[kK]ey\(|const \w*[kK]ey\s*=/
function keyPatterns(text) {
  const out = new Set()
  for (const line of text.split('\n')) {
    if (!KEY_LINE.test(line)) continue
    for (const m of line.matchAll(/[`'"](_?seen[A-Za-z0-9_:\-]*|ji_)(?:\$\{[^}]*\}[^`'"]*)?[`'"]/g)) out.add(m[1])
  }
  return out
}
const WRITERS = /localStorage\.setItem|safeLocalSet\(/
const allKeys = new Set()
const byFile = {}
for (const [f, text] of Object.entries(src)) {
  if (!WRITERS.test(text) && !/lastSeenKey|getKey|getMetaKey|PREFIX/.test(text)) continue
  const ks = keyPatterns(text)
  if (ks.size) { byFile[f] = [...ks]; ks.forEach((k) => allKeys.add(k)) }
}

const covered = (k) => isSessionLocalKey(k) || Object.keys(DEVICE_SCOPED_KEYS).some((d) => k === d || k.startsWith(d))

test('the sweep lists are the ones lib/auth.tsx clears on SIGNED_OUT', () => {
  const auth = src['lib/auth.tsx']
  assert.match(auth, /import \{ SESSION_LOCAL_KEYS, SESSION_LOCAL_PREFIXES \} from '\.\/sessionLocalKeys\.js'/)
  assert.match(auth, /SESSION_LOCAL_KEYS\.forEach\(k => localStorage\.removeItem\(k\)\)/)
  assert.match(auth, /SESSION_LOCAL_PREFIXES\.some\(p => k\.startsWith\(p\)\)\) localStorage\.removeItem\(k\)/)
})

test('every storage key the app writes is swept on sign-out or explicitly device-scoped', () => {
  assert.ok(allKeys.size >= 15, `expected to find the app's storage keys, found ${allKeys.size}: ${[...allKeys]}`)
  const missing = [...allKeys].filter((k) => !covered(k)).sort()
  assert.deepEqual(missing, [], `keys written but neither swept nor justified: ${missing.map((k) => `${k} (${Object.entries(byFile).filter(([, ks]) => ks.includes(k)).map(([f]) => f).join(', ')})`).join('; ')}`)
})

test('the audit\'s leaked keys are swept: résumé text/meta, Studio caches, profile cache, credit confirm', () => {
  for (const k of ['seen_resume_7aa38128-ec49-4d29-85b2-4d907c4fe713', 'seen_resume_meta_7aa38128-ec49-4d29-85b2-4d907c4fe713',
    'seen_resume_doc_u1:12:abc', 'seen_resume_variants_u1', 'seen_profile_v2_u1', 'seen_credit_ok_u1', 'seen_onboarding_hidden_u1', 'seen_notif_seen_u1',
    'seen_applications_v1', 'seen_saved_v1', 'seen_recent_v1', 'seen_job_location_v1']) {
    assert.ok(isSessionLocalKey(k), `${k} must be swept on sign-out`)
  }
  for (const k of ['ji_123', 'seen_ul_Fri Oct 24 2026', 'seen_msurvey_v1']) assert.ok(!isSessionLocalKey(k), `${k} is device-scoped`)
  assert.ok(SESSION_LOCAL_PREFIXES.includes('seen_resume_') && SESSION_LOCAL_KEYS.includes('seen_applications_v1'))
})
