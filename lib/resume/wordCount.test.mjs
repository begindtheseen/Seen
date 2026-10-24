// ONE word counter for every résumé surface. The 2026-10-23 audit saw "235 words" on /resume and
// "233 words" in the Studio for the same file; this pins (a) what a word is and (b) that no résumé
// surface hand-rolls its own split-and-count again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { countWords, docStats, serializeToText } from './model.js'
import { parseResume } from './parse/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

test('a word carries a letter or digit — glyphs, separators and bare punctuation are not words', () => {
  assert.equal(countWords('• Sold and renewed 40+ memberships'), 5)
  assert.equal(countWords('Customer service · POS systems (Square, Clover) · Cash handling'), 8)
  assert.equal(countWords('Phoenix, AZ 85004 · (602) 555-0148 · jordan@x.com | linkedin.com/in/j'), 7)
  assert.equal(countWords('— | · • ...'), 0)
  assert.equal(countWords(''), 0)
  assert.equal(countWords(null), 0)
})

test('the extractor count and the Studio count agree on the same résumé text', () => {
  const text = `Jordan Avery
Phoenix, AZ 85004 · (602) 555-0148 · jordan.avery.jobs@gmail.com

SUMMARY
Customer-focused retail professional with 5+ years across sales and guest operations.

EXPERIENCE
Membership Specialist — UFC Gym, Phoenix, AZ | Mar 2024 – Present
• Sold and renewed 40+ memberships per month; ranked top 3 of 12 on the sales floor
• Trained 4 new front-desk hires on the POS system and the daily opening and closing checklist

SKILLS
Customer service · POS systems (Square, Clover) · Cash handling · Scheduling`
  const doc = parseResume({ text, source: 'text', fileName: 'x.txt' })
  // The glyph-free count of the raw text equals the count of the canonical serialization
  // (what the Studio header shows) — one number on every screen.
  assert.equal(docStats(doc).words, countWords(serializeToText(doc)))
  assert.equal(countWords(text), docStats(doc).words, `raw ${countWords(text)} vs doc ${docStats(doc).words}\n${serializeToText(doc)}`)
})

test('no résumé surface counts words on its own — every count goes through countWords', () => {
  const surfaces = [
    'app/resume/page.tsx', 'app/resume/studio/page.tsx', 'app/profile/page.tsx',
    'lib/resumeUploadClient.ts', 'lib/stores/ResumeStore.ts', 'lib/resume/extract/index.js', 'lib/resume/model.js',
  ]
  for (const f of surfaces) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    // the only split-and-count allowed is the definition itself
    const hits = (src.match(/split\(\/\\s\+\/\)[^\n]*length/g) || []).filter((h) => !/\\p\{L\}/.test(h))
    assert.equal(hits.length, 0, `${f} counts words on its own: ${hits.join(' | ')}`)
  }
  assert.match(read('lib/resume/model.js'), /export function countWords\(text\)/)
  for (const f of ['app/resume/page.tsx', 'app/resume/studio/page.tsx', 'lib/resumeUploadClient.ts', 'lib/resume/extract/index.js']) {
    assert.ok(/countWords/.test(read(f)), `${f} must use countWords`)
  }
})
