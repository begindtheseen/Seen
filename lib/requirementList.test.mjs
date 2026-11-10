// UX audit F4/F8/F9 — one requirement list whose counts add up, proof quoted once, and a read row that
// never puts another posting under this job's name. Built on the audit's real cases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { requirementCounts, groupByProof, countHeadline, proofLine } from './requirementList.js'
import { linkHost, readFacts, readLine, sameHost, isLinkPaste } from './postingRead.js'
import { runOptimizer } from './optimizer/index.js'

const row = (surface, o = {}) => ({ requirement: surface, surface, importance: 'required', matched: true, via: 'exact', evidence: null, ...o })

test('Dev × astranis: two requirements citing one line are one group, the line quoted once', () => {
  const fast = '• Wrote Python (FastAPI) services handling 40M requests a day'
  const apis = 'Built idempotent payment-orchestration APIs for 1.2M transactions/day'
  const { shown } = requirementCounts({ matched: [row('security', { evidence: fast }), row('Python', { evidence: fast }), row('APIs', { evidence: apis }), row('performance', { evidence: apis })] })
  const groups = groupByProof(shown)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].rows.map((r) => r.surface), ['security', 'Python'])
  assert.equal(groups[0].line, proofLine(fast))
})

test('counts add up to the rows shown; inferred rows are listed but not quoted; duplicates collapse', () => {
  const c = requirementCounts({
    matched: [row('scheduling', { evidence: 'x' }), row('teamwork', { inferred: true, via: 'related' }), row('scheduling', { evidence: 'y' })],
    missing: [row('payroll', { matched: false, importance: 'preferred' }), row('P&L', { matched: false, hard: true })],
  })
  assert.equal(c.shown.length, 2, 'the inferred row is listed (the verdict sentence names it)…')
  assert.equal(groupByProof(c.shown).find((g) => g.rows[0].surface === 'teamwork').line, '', '…but never quoted as proof')
  assert.deepEqual(c.missing.map((r) => r.surface), ['P&L', 'payroll'], 'hard first, preferred last')
  assert.equal(c.total, 4)
  assert.equal(countHeadline(c), 'You show 2 of 4 requirements this posting states')
})

test('the real fixture: the headline count equals the verdict’s rows, for every persona × sample posting', () => {
  const personas = ['maria', 'dev', 'tasha'].map((n) => readFileSync(new URL(`./fixtures/personas/${n}.txt`, import.meta.url), 'utf8'))
  const postings = JSON.parse(readFileSync(new URL('./fixtures/personas/postings-sample.json', import.meta.url), 'utf8'))
  for (const r of personas) for (const p of postings) {
    const out = runOptimizer({ resumeText: r, jobDescription: p.description || p.jd || '', jobTitle: p.title, company: p.company })
    const c = requirementCounts({ matched: out.matched_requirements, missing: out.unsupported_requirements })
    const shownSet = new Set(c.shown.map((x) => x.surface.toLowerCase()))
    for (const m of c.missing) assert.ok(!shownSet.has(m.surface.toLowerCase()), `${m.surface} is both shown and missing`)
    assert.equal(c.total, c.shown.length + c.missing.length)
    const groups = groupByProof(c.shown)
    assert.equal(groups.reduce((n, g) => n + g.rows.length, 0), c.shown.length, 'every shown row is in exactly one group')
    const lines = groups.map((g) => g.line.toLowerCase()).filter(Boolean)
    assert.equal(new Set(lines).size, lines.length, 'no proof line is quoted twice')
  }
})

test('read row: a Saxbys link pasted in the Petco sheet never carries Petco’s name', () => {
  const link = 'https://job-boards.greenhouse.io/saxbys/jobs/4567'
  assert.equal(isLinkPaste(link), true)
  assert.equal(linkHost(link), 'job-boards.greenhouse.io')
  const f = readFacts({ pasted: link, server: null, job: { title: 'Sales Associate', company: 'Petco' }, requirements: 14 })
  assert.equal(f.title, '')
  assert.equal(f.company, '')
  assert.equal(readLine(f), 'from job-boards.greenhouse.io · 14 requirements read')
  const withServer = readFacts({ pasted: link, server: { title: 'Area Operations Manager', company: 'Saxbys' }, job: { title: 'Sales Associate', company: 'Petco' }, requirements: 14 })
  assert.equal(readLine(withServer), 'Area Operations Manager · Saxbys · from job-boards.greenhouse.io · 14 requirements read')
})

test('read row: pasted text inside a job’s sheet is that job’s posting', () => {
  const f = readFacts({ pasted: 'We are hiring a cashier… '.repeat(20), job: { title: 'Cashier', company: 'El Rio Grande' }, requirements: 6 })
  assert.equal(readLine(f), 'Cashier · El Rio Grande · from the text you pasted · 6 requirements read')
  assert.equal(sameHost('https://www.petco.com/jobs/1', 'www.petco.com/careers/x'), true)
  assert.equal(sameHost('https://jobs.lever.co/a', 'https://petco.com/x'), false)
})

test('the offer names this job and this résumé’s own requirements, and never claims to add a gap', async () => {
  const { offerSentence } = await import('./requirementList.js')
  const t = offerSentence({ shown: [{ surface: 'scheduling' }, { surface: 'customer service' }], missing: [{ surface: 'P&L' }], title: 'Area Operations Manager', company: 'Saxbys' })
  assert.match(t, /scheduling and customer service/)
  assert.match(t, /Area Operations Manager at Saxbys/)
  assert.match(t, /will not add P&L/)
})

test('Dev × Sargent Lundy Staff Accountant: 0 shown → the offer says the credit will not change that', async () => {
  const { offerSentence } = await import('./requirementList.js')
  const t = offerSentence({ shown: [], missing: [{ surface: 'accounting' }, { surface: 'journal entries' }, { surface: 'GAAP' }], title: 'Staff Accountant', company: 'Sargent Lundy' })
  assert.match(t, /none of the 3 requirements Seen read in Staff Accountant at Sargent Lundy/)
  assert.doesNotMatch(t, /moves them up/)
})
