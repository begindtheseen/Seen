// The fit read groups and words ONLY what the reader and the verdict decided — pinned on real readings
// (persona résumés × their real postings in lib/fixtures/personas) plus an invariant over the sample postings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runOptimizer } from '../../lib/optimizer/index.js'
import { canonicalResumeText } from '../../lib/resume/canonical.js'
import { fitGroups, gateRows, askQuestion, missingWords, differentField, verdictSentence, groupHeading } from './fitRead.js'

const P = (f) => fs.readFileSync(new URL(`../../lib/fixtures/personas/${f}`, import.meta.url), 'utf8')
const run = (who, jd, title, company) => runOptimizer({ resumeText: canonicalResumeText(P(who)), jobDescription: jd, jobTitle: title, company })

test('Maria × Fry\'s: required, then duties, then what only she can say, then preferred; every row keeps the server\'s status', () => {
  const out = run('maria.txt', P('maria-frys-jd.txt'), 'Assistant Store Manager', "Fry's Food Stores")
  const m = fitGroups(out)
  assert.ok(m, 'the answer carries statements')
  const order = m.groups.map((g) => g.key)
  const want = ['required', 'duty', 'ask', 'preferred'].filter((k) => order.includes(k))
  assert.deepEqual(order, want)
  const byId = new Map(out.statements.map((s) => [s.id, s]))
  for (const g of m.groups) for (const r of g.rows) {
    const st = byId.get(r.id)
    const map = { shown: 'shown', partly: 'partly', not_shown: 'not_shown', cannot_tell: 'ask' }
    assert.equal(r.state, map[st.status] || 'not_shown', `${r.id} state follows the server`)
    assert.equal(r.text, st.text.replace(/\s+/g, ' ').trim(), 'the statement as the reader wrote it')
  }
})

test('one résumé line is quoted once; later rows point back to the first', () => {
  for (const [who, jd, t, c] of [['maria.txt', 'maria-frys-jd.txt', 'Assistant Store Manager', "Fry's"], ['dev.txt', 'dev-stripe-jd.txt', 'Backend Engineer', 'Stripe'], ['tasha.txt', 'tasha-groupon-jd.txt', 'Marketing Coordinator', 'Groupon']]) {
    const m = fitGroups(run(who, P(jd), t, c))
    if (!m) continue
    const quoted = new Set()
    for (const g of m.groups) for (const r of g.rows) {
      if (!r.line) continue
      const k = r.line.toLowerCase()
      if (r.sameAs) assert.ok(quoted.has(k), `${who}: a reference points at a line already quoted`)
      else { assert.ok(!quoted.has(k), `${who}: "${r.line.slice(0, 40)}" quoted twice`); quoted.add(k) }
    }
  }
})

test('a statement only the person can answer is a question, never a failure', () => {
  assert.equal(askQuestion('Stand, walk, and smile for extended periods of time'), 'Can you stand, walk, and smile for extended periods of time?')
  assert.equal(askQuestion('Travel up to 80% of the time'), 'Can you travel up to 80% of the time?')
  assert.match(askQuestion('Valid driver\'s license'), /is that true for you\?$/)
})

test('"what is missing" leaves out fragments the reader carries ("find", "give") and says at most three', () => {
  // the reader's real `missing` for Saxbys s4 (quality assurance checks)
  const w = missingWords({ missing: ['hospitality,quality assurance checks at each cafe,audit,find,correct inconsistencies'] })
  assert.ok(!w.includes('find'))
  assert.ok(w.length <= 3)
  assert.equal(w[0], 'hospitality')
})

test('gates come from graded constraints, worded by the server, the one that decides first', () => {
  const rows = gateRows([
    { kind: 'years', grade: 'met', sentence: 'You show about 11 years of work in all; they ask for 2+.' },
    { kind: 'physical', grade: 'cannot_tell', sentence: 'Physical requirement: lift 35 lbs.' },
    { kind: 'certification', grade: 'not_shown', caps: true, sentence: 'Requires a Texas Journeyman or Master electrical license; your résumé shows an Arizona Journeyman licence.' },
  ])
  assert.equal(rows.length, 2, 'physical asks are statements, not gates')
  assert.equal(rows[0].caps, true)
  assert.equal(rows[1].state, 'shown')
})

test('different field only when the reader KNOWS; the sentence drops its leading score', () => {
  assert.equal(differentField({ level: 'different', known: false, sentence: 'x' }), null)
  assert.ok(differentField({ level: 'different', known: true, sentence: 'This is a software engineering role…', transferable: ['scheduling'] }))
  assert.equal(verdictSentence({ sentence: '51 — You show customer service', withheld: null }), 'You show customer service')
})

test('invariant over the persona × sample postings: no row both shown and asked, headings count their own rows', () => {
  const sample = JSON.parse(P('postings-sample.json'))
  for (const who of ['maria.txt', 'dev.txt', 'warehouse.txt']) {
    for (const p of sample.slice(0, 6)) {
      const out = run(who, p.description || p.text || '', p.title || '', p.company || '')
      const m = fitGroups(out)
      if (!m) continue
      for (const g of m.groups) {
        const h = groupHeading(g)
        if (g.key !== 'ask') assert.match(h.tally, new RegExp(`of ${g.rows.length} shown`))
        for (const r of g.rows) {
          assert.ok(!(r.state === 'ask' && r.line), 'a question carries no proof line')
          assert.ok(!(r.state === 'not_shown' && r.line), 'a not-shown row quotes nothing')
        }
      }
    }
  }
})

test('a statement the reader marks display:false never reaches the screen', async () => {
  const { fitGroups } = await import('./fitRead.js')
  const m = fitGroups({ statements: [
    { id: 'a', text: 'Forklift certification', kind: 'requirement', importance: 'required', status: 'shown', evidence: [{ line: 'Forklift certified' }] },
    { id: 'b', text: 'Additional tasks may be assigned', kind: 'requirement', importance: 'required', status: 'not_shown', display: false },
  ] })
  assert.deepEqual(m.groups.flatMap((g) => g.rows.map((r) => r.id)), ['a'])
})

test('the first five: required before duties; not shown and partly before shown; a gate\'s own statement is not repeated', async () => {
  const { fitGroups, topRows } = await import('./fitRead.js')
  const st = (id, importance, status) => ({ id, text: `line ${id}`, kind: importance === 'duty' ? 'duty' : 'requirement', importance, status, evidence: status === 'not_shown' ? [] : [{ line: `proof ${id}` }] })
  const m = fitGroups({ statements: [st('r1', 'required', 'shown'), st('r2', 'required', 'not_shown'), st('r3', 'required', 'partly'), st('d1', 'duty', 'shown'), st('d2', 'duty', 'not_shown'), st('d3', 'duty', 'shown')] })
  assert.deepEqual(topRows(m, 5).map((r) => r.id), ['r2', 'r3', 'r1', 'd2', 'd1'])
  assert.deepEqual(topRows(m, 5, ['r2']).map((r) => r.id), ['r3', 'r1', 'd2', 'd1', 'd3'])
})
