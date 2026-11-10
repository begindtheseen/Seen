// One tap re-files a line the parser was unsure of — the words never change, only where they sit.
// Built on a real parse: a "Tickets and training" heading and a council line under a job (t2-parse.md, class 4 / Dana).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseResume } from '../../lib/resume/parse/index.js'
import { renderText } from '../../lib/resume/render/text.js'
import { uncertainQuestion, refile } from './refile.js'

const TEXT = `Dana Ruiz
Phoenix, AZ | dana@example.com

EXPERIENCE
Warehouse Lead — Amazon | 2021 – Present
- Led a crew of 12 pickers
Safety Council, 2022 – present
Picker — Target DC | 2018 – 2021
- Picked 150 orders a shift

TICKETS AND TRAINING
Forklift certified 2020
Rio Salado College, Logistics courses 2019

SKILLS
RF scanner, forklift
`
const doc = parseResume({ text: TEXT, source: 'text' })
const unc = doc.meta.fidelity.uncertain || []
const u = (re) => unc.find((x) => re.test(x.line))

test('the parser asks about the council line and the college line', () => {
  assert.ok(u(/Safety Council/), JSON.stringify(unc))
  assert.ok(u(/Rio Salado/))
})

test('"Is Safety Council a job of its own?" — yes makes it an entry after Warehouse Lead, words unchanged', () => {
  const q = uncertainQuestion(doc, u(/Safety Council/))
  assert.equal(q.kind, 'part')
  assert.match(q.question, /^Is “Safety Council, 2022 – present” a job of its own\?$/)
  const d = refile(doc, u(/Safety Council/), 'yes')
  const i = d.experience.findIndex((e) => /Safety Council/.test(e.title))
  assert.ok(i > 0, 'a new entry')
  assert.ok(/Warehouse Lead/.test(d.experience[i - 1].title), 'right after the job it sat under')
  assert.ok(!d.experience[i - 1].bullets.some((b) => /Safety Council/.test(b.text)))
  assert.ok(!(d.meta.fidelity.uncertain || []).some((x) => /Safety Council/.test(x.line)), 'answered: not asked again')
})

test('"no" keeps the document exactly as parsed and stops asking', () => {
  const d = refile(doc, u(/Safety Council/), 'no')
  assert.equal(renderText(d), renderText(doc))
  assert.ok(!(d.meta.fidelity.uncertain || []).some((x) => /Safety Council/.test(x.line)))
})

test('a line filed under Education by what it says: "No — it\'s a job" moves it to Experience', () => {
  const q = uncertainQuestion(doc, u(/Rio Salado/))
  assert.equal(q.kind, 'section')
  assert.match(q.question, /belong under Education\?$/)
  const d = refile(doc, u(/Rio Salado/), 'no')
  assert.ok(d.experience.some((e) => /Rio Salado College/.test(e.title)))
  assert.ok(!d.education.some((e) => /Rio Salado/.test(e.school)))
})
