// The paid result's toggles move exactly the text the server listed — built on a real package
// (lib/fixtures/personas/warehouse.txt × the Integrity Staffing "Warehouse Associate" posting in the corpus
// fixture set), not a hand-made change list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildPaidOptimize } from '../../lib/server/optimizePackage.js'
import { canonicalResumeText } from '../../lib/resume/canonical.js'
import { parseResume } from '../../lib/resume/parse/index.js'
import { renderText } from '../../lib/resume/render/text.js'
import { bulletFromAnswer } from '../../lib/resume/tailor/optimizer.js'
import { applyToggles, isToggleable, defaultOn, promptFor, questionKind, blankLine } from './applyChanges.js'

const raw = fs.readFileSync(new URL('../../lib/fixtures/personas/warehouse.txt', import.meta.url), 'utf8')
const resume = canonicalResumeText(raw)
// a warehouse associate posting (pick/pack/ship, inventory, trucks) — the shape of the corpus row the browser run uses
const posting = `Warehouse Associate
Integrity Staffing Solutions is hiring Warehouse Associates for a fulfillment center.
Responsibilities:
- Receive and put away inventory
- Pack and ship orders according to customer specifications
- Load boxes into trucks for shipment
- Maintain accurate inventory records
- Operate a forklift or pallet jack safely
Requirements:
- At least 1 year of experience in a warehouse or similar environment
- High school diploma or GED
- Able to lift up to 50 lbs
- Able to stand for long periods`
const pkg = buildPaidOptimize({ resume, resumeIsCanonical: true, original: raw, jobDescription: posting, job: 'Warehouse Associate', company: 'Integrity Staffing Solutions', jobId: 't' })
const T = pkg.tailored
const base = parseResume({ text: resume, source: 'text' })
const body = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !/^[A-Z][A-Z &/]+$/.test(l))

test('the package has a finished document and toggleable changes', () => {
  assert.ok(T && T.doc && Array.isArray(T.changes))
  assert.ok(T.changes.some(isToggleable), 'at least one change a person can undo')
})

test('with every change at its default the document is exactly the server\'s', () => {
  const { doc, stuck } = applyToggles(T.doc, T.changes, {})
  assert.equal(renderText(doc), renderText(T.doc))
  assert.deepEqual(stuck, [])
})

test('undoing each applied change restores exactly the text it listed as "before"', () => {
  for (const c of T.changes.filter((x) => isToggleable(x) && defaultOn(x))) {
    const { doc, stuck } = applyToggles(T.doc, T.changes, { [c.id]: false })
    assert.deepEqual(stuck, [], `${c.id} could not be undone`)
    const text = renderText(doc)
    if (c.type === 'summary') assert.equal(doc.basics.summary, c.before)
    if (c.type === 'reorder') {
      const e = doc.experience.find((x) => `reorder:${x.id}` === c.id)
      assert.deepEqual(e.bullets.map((b) => b.text).slice(0, c.before.split('\n').length), c.before.split('\n'))
    }
    if (c.type === 'skills') assert.ok(text.includes(c.before), 'the skills line reads as before')
    // nothing else moved: the other changes are still in
    for (const o of T.changes.filter((x) => x.id !== c.id && x.type === 'summary')) assert.equal(doc.basics.summary, o.after)
  }
})

test('undoing every change gives the person\'s own lines back (only the re-typesetting stays)', () => {
  const off = Object.fromEntries(T.changes.filter(isToggleable).map((c) => [c.id, false]))
  const { doc } = applyToggles(T.doc, T.changes, off)
  const mine = body(renderText(doc))
  const theirs = body(renderText(base))
  assert.deepEqual([...mine].sort(), [...theirs].sort())
})

test('a number answer completes the line it was asked about; nothing else changes', (t) => {
  const q = (pkg.questions || []).find((x) => questionKind(x) === 'number' && x.bulletId && x.slot === 'insert')
    || (pkg.questions || []).find((x) => questionKind(x) === 'number' && x.bulletId)
  if (!q) { t.skip('this build of the engine asks no number question on this posting'); return }
  const line = bulletFromAnswer(promptFor(q), q.slot === 'insert' ? '25' : 'about 25 trailers a shift')
  assert.ok(line && line.includes('25'), line)
  const { doc, marks } = applyToggles(T.doc, T.changes, {}, [{ id: q.id, itemId: q.itemId, bulletId: q.bulletId, kind: q.kind, line }])
  const texts = doc.experience.flatMap((e) => e.bullets.map((b) => b.text))
  assert.ok(texts.includes(line))
  assert.ok(!texts.includes(q.line), 'the old line is replaced, not duplicated')
  assert.equal(marks.bullets[q.bulletId], `q:${q.id}`)
  assert.equal(blankLine(q.template).includes('___'), true)
})

test('a credential answer is a certification; a duty answer is a new first line in its role', () => {
  const role = T.doc.experience[0]
  const { doc } = applyToggles(T.doc, T.changes, {}, [
    { id: 'c1', kind: 'gap', answerKind: 'credential', line: 'CPR' },
    { id: 'd1', kind: 'gap', itemId: role.id, line: 'Handled returns for 3 docks.' },
  ])
  assert.ok(doc.certifications.some((c) => c.text === 'CPR'))
  assert.equal(doc.experience.find((e) => e.id === role.id).bullets[0].text, 'Handled returns for 3 docks.')
  assert.equal(T.doc.experience[0].bullets[0].text !== 'Handled returns for 3 docks.', true, 'the server document is never mutated')
})

test('question kinds: a number never gets a text field; a tool / credential / duty never gets a number', () => {
  assert.equal(questionKind({ kind: 'metric', unit: 'line', template: 'Do [number] cycle counts' }), 'number')
  assert.equal(questionKind({ kind: 'gap', answer_kind: 'tool' }), 'tool')
  assert.equal(questionKind({ kind: 'gap', answer_kind: 'credential' }), 'credential')
  assert.equal(questionKind({ kind: 'gap', answer_kind: null }), 'duty')
})
