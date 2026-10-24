// Run: node --test lib/webReviewQuotes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitWebReviews, webResearchNote } from './webReviewQuotes.ts'

// Walmart's stored web_reviews (prod 2026-10-24): 6 unlinked "Aggregated research" entries first, then
// linked Reddit comments.
const research = (t) => ({ text: t, year: '2025', source: 'Aggregated research', sentiment: 'mixed' })
const reddit = (t, i) => ({ text: t, url: `https://www.reddit.com/r/walmart/comments/x${i}/t/`, kind: 'public_commentary', source: 'Reddit r/r/walmart', year: '2026' })

test('unlinked research paraphrase is never a quote; linked comments keep their order; nothing is dropped', () => {
  const all = [research('Applicants say the first step is heavily availability-driven.'), research('Offers are often conditional.'), reddit('It depends.', 1), reddit('You got the job.', 2)]
  const { quotes, summaries } = splitWebReviews(all)
  assert.deepEqual(quotes.map(q => q.text), ['It depends.', 'You got the job.'])
  assert.equal(summaries.length, 2)
  assert.equal(quotes.length + summaries.length, all.length)
})

test('a non-http url is not a source link', () => {
  const { quotes, summaries } = splitWebReviews([{ text: 'x', url: 'javascript:alert(1)' }, { text: 'y', url: '' }, { text: 'z' }])
  assert.equal(quotes.length, 0)
  assert.equal(summaries.length, 3)
  assert.deepEqual(splitWebReviews(null), { quotes: [], summaries: [] })
})

test('the note says what they are', () => {
  assert.equal(webResearchNote(6), '6 summaries from web research — no source link, so not shown as quotes')
  assert.equal(webResearchNote(1), '1 summary from web research — no source link, so not shown as quotes')
})
