import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { formatBuildStamp } from './types.ts'

// The admin hero's build stamp is the in-app proof of "current deployment / build number".
// These tests pin the two things that broke it before: (1) the slice/fallback formatting,
// and (2) the exact Vercel env var name AdminHero reads (a review caught a prior attempt
// reading the non-existent *_VERCEL_GITHUB_COMMIT_SHA, which strands the stamp on "local").

test('formatBuildStamp slices the deployed SHA to a 7-char build number', () => {
  const { build } = formatBuildStamp('0c38a8ae1234567890abcdef1234567890abcdef', undefined)
  assert.equal(build, '0c38a8a')
})

test('formatBuildStamp trims the commit message to 32 chars', () => {
  const msg = formatBuildStamp('abc', 'fix(brain): the briefing reports the NEWEST changes').msg
  assert.equal(msg.length, 32)
  assert.equal(msg, 'fix(brain): the briefing reports')
})

test('formatBuildStamp falls back to local/dev when the env vars are absent', () => {
  assert.deepEqual(formatBuildStamp(undefined, undefined), { build: 'local', msg: 'dev' })
})

test('formatBuildStamp keeps a short SHA and short message intact', () => {
  assert.deepEqual(formatBuildStamp('abc123', 'hotfix'), { build: 'abc123', msg: 'hotfix' })
})

// Regression guard tied to overview.tsx itself: AdminHero must read the deployed commit
// from the real Vercel system env var, verbatim, so Next inlines it into the client bundle.
test('AdminHero reads the correct Vercel commit-SHA env var (verbatim, for build-time inlining)', () => {
  const src = readFileSync(fileURLToPath(new URL('./overview.tsx', import.meta.url)), 'utf8')
  assert.ok(
    src.includes('process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA'),
    'overview.tsx must read process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA verbatim',
  )
  assert.ok(
    !src.includes('NEXT_PUBLIC_VERCEL_GITHUB_COMMIT_SHA'),
    'overview.tsx must NOT use the non-existent *_VERCEL_GITHUB_COMMIT_SHA var',
  )
})
