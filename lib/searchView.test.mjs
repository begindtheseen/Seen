import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { resultsView } from './searchView.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

test('a failed search is an error, never an empty state; results always win', () => {
  assert.equal(resultsView({ status: 'error', count: 0 }), 'error')
  assert.equal(resultsView({ status: 'done', count: 0 }), 'empty')
  assert.equal(resultsView({ status: 'loading', count: 0 }), 'loading')
  assert.equal(resultsView({ status: 'idle', count: 0 }), 'idle')
  // a cached list stays on screen while a refresh fails or loads
  assert.equal(resultsView({ status: 'error', count: 3 }), 'results')
  assert.equal(resultsView({ status: 'loading', count: 3 }), 'results')
  assert.equal(resultsView({ status: 'done', count: 3 }), 'results')
})

test('/jobs renders from resultsView and offers Retry on error', () => {
  const page = read('app/jobs/page.tsx')
  assert.match(page, /resultsView\(\{ status, count: filtered\.length \}\)/)
  assert.match(page, /view === 'error'/)
  assert.match(page, /view === 'empty'/)
  assert.match(page, /onRetry=\{retrySearch\}/)
  const hook = read('lib/hooks/useJobSearch.ts')
  assert.match(hook, /retrySearch/)
})
