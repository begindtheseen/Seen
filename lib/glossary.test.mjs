// The glossary rule: one name per feature, one word per idea, no retired term in user-facing copy
// (audit 2026-10-25 #3, #31, #32). Scans the string literals and JSX text of every app/ and components/
// source (plus the copy modules) — identifiers, comments and API field names are not copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RETIRED_TERMS, PENDING_REBUILD, INTERNAL, COPY_MODULES, FEATURES, accountsLabel, accountSources, accountsLine } from './glossary.js'
import { copyStrings } from './copyText.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const rel = (p) => relative(root, p).split('\\').join('/')
const sources = [...walk(join(root, 'app')), ...walk(join(root, 'components'))]
  .map(rel).filter((f) => /\.(tsx?|jsx?|mjs)$/.test(f) && !/\.test\./.test(f) && !f.endsWith('tsxForTest.mjs'))
  .concat(COPY_MODULES)
const skipped = (f) => [...PENDING_REBUILD, ...INTERNAL].some((s) => f === s || f.startsWith(s))

test('no retired term appears in user-facing copy', () => {
  const hits = []
  for (const f of sources) {
    if (skipped(f)) continue
    for (const { line, text } of copyStrings(readFileSync(join(root, f), 'utf8'))) {
      for (const t of RETIRED_TERMS) if (t.re.test(text)) hits.push(`${f}:${line} "${text.trim().slice(0, 90)}" → use ${t.use} (${t.why})`)
    }
  }
  assert.deepEqual(hits, [], `\n${hits.join('\n')}`)
})

test('the copy extractor sees copy, not code', () => {
  const src = `import HumanProofPanel from './HumanProofPanel'
// HumanProof is the component name
const k = feature === 'Human Voice' ? 1 : 0
export default () => <div className="waste risk"><HumanProofPanel label="HumanProof rewrite" />Résumé AI is retired</div>`
  const texts = copyStrings(src).map((x) => x.text)
  assert.ok(texts.some((t) => /Résumé AI is retired/.test(t)), 'JSX text is copy')
  assert.ok(texts.includes('HumanProof rewrite'), 'attribute strings are copy')
  assert.ok(!texts.some((t) => /Human Voice|HumanProofPanel/.test(t)), 'identifiers, imports, comments and comparison keys are not')
  assert.ok(!texts.some((t) => /waste risk/.test(t)), 'className values are not copy')
})

test('the skip lists only name files that exist (no stale exemptions)', () => {
  for (const s of [...PENDING_REBUILD, ...INTERNAL]) {
    const exists = sources.some((f) => f === s || f.startsWith(s)) || walk(join(root, s.split('/')[0])).some((p) => rel(p).startsWith(s))
    assert.ok(exists, s)
  }
})

test('applicant accounts: the split is named only when it is known, zeros are stated', () => {
  assert.equal(accountsLabel(1), '1 applicant account')
  assert.equal(accountsLabel(48), '48 applicant accounts')
  assert.equal(accountsLine(48, 48, 0), '48 applicant accounts from public posts · 0 from Seen users')
  assert.equal(accountsLine(48, 47, 1), '47 applicant accounts from public posts · 1 from a Seen user')
  assert.equal(accountsLine(12, 0, 12), '12 applicant accounts, all from Seen users')
  assert.equal(accountsLine(48, null, null), '48 applicant accounts')
  assert.equal(accountsLine(26, 26, 2), '26 applicant accounts · 2 from Seen users') // stale split → Seen count only
  assert.equal(accountSources(48, 47, 1), '47 from public posts · 1 from a Seen user')
  assert.equal(accountSources(48, 48, null), '')
  assert.equal(accountSources(0, 0, 0), '')
})

test('feature names are single words for single things', () => {
  assert.equal(FEATURES.humanProof, 'HumanProof')
  assert.equal(FEATURES.resume, 'Résumé')
  assert.equal(FEATURES.grade, 'Seen Grade')
  assert.equal(new Set(Object.values(FEATURES)).size, Object.values(FEATURES).length)
})
