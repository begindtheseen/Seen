// The résumé viewer and the résumé picker, server-rendered. Run: node --test components/resume/resumeViews.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTsx, render, h } from '../ui/tsxForTest.mjs'

const el = await h()
const { default: ResumeView } = await loadTsx('components/resume/ResumeView.tsx')
const { default: ResumePicker } = await loadTsx('components/resume/ResumePicker.tsx')

const TEXT = `Jordan Avery
jordan@example.com | (602) 555-0100 | Phoenix, AZ

EXPERIENCE
Warehouse Lead — Ross Stores | Jan 2019 – Present
- Led a team of 12 associates through peak season receiving.
- Cut mispicks by 30% with a daily cycle count.

EDUCATION
Phoenix College — A.A.S. Business Management | 2018

SKILLS
Forklift, WMS, Inventory control`

test('the viewer shows the résumé by section, words as written', async () => {
  const html = await render(el(ResumeView, { text: TEXT }))
  assert.match(html, /Jordan Avery/)
  assert.match(html, /Experience/)
  assert.match(html, /Warehouse Lead/)
  assert.match(html, /Cut mispicks by 30% with a daily cycle count\./)
  assert.match(html, /Education/)
  assert.match(html, /Forklift/)
})

test('the viewer falls back to the plain text when nothing parses', async () => {
  const html = await render(el(ResumeView, { text: '' }))
  assert.doesNotMatch(html, /Experience/)
})

const row = (id, is_default, usable = true) => ({ id, name: `Résumé ${id}`, file_name: null, word_count: 300, is_default, created_at: null, updated_at: null, usable })

test('the picker: nothing when not live, the name for one, a select with Pro rows disabled for several', async () => {
  assert.equal(await render(el(ResumePicker, { list: { ready: false, pro: false, max: 1, resumes: [] }, selectedId: null, onPick() {} })), '')
  const one = await render(el(ResumePicker, { list: { ready: true, pro: false, max: 1, resumes: [row('a', true)] }, selectedId: 'a', onPick() {} }))
  assert.match(one, /data-testid="resume-picker-name"/)
  assert.doesNotMatch(one, /<select/)
  const many = await render(el(ResumePicker, { list: { ready: true, pro: false, max: 1, resumes: [row('a', true), row('b', false, false)] }, selectedId: 'a', onPick() {} }))
  assert.match(many, /<select/)
  assert.match(many, /<option value="b" disabled="">Résumé b · Pro<\/option>/)
  assert.match(many, /only your default can be used without Pro/)
})
