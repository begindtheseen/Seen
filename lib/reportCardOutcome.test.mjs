// Run: node --test lib/reportCardOutcome.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportCardOutcome } from './reportCardOutcome.ts'

test('Amazon (prod 2026-10-24): a "human" report with a stray ghost_stage shows ONE outcome — Got response, no "ghosted at"', () => {
  const c = reportCardOutcome({ outcome: 'human', ghost_stage: 'application' })
  assert.equal(c.label, '✅ Got response')
  assert.equal(c.cls, 'v-g')
  assert.equal(c.ghostStage, '')
})

test('a ghosted report keeps its stage', () => {
  assert.deepEqual(reportCardOutcome({ outcome: 'ghosted', ghost_stage: 'after_interview' }), { label: '👻 Ghosted', cls: 'v-r', ghostStage: 'after interview' })
  assert.equal(reportCardOutcome({ outcome: 'ghosted', ghost_stage: null }).ghostStage, '')
})

test('no outcome word, no stage, on commentary or an employee review', () => {
  assert.deepEqual(reportCardOutcome({ outcome: 'ghosted', ghost_stage: 'application' }, { commentary: true }), { label: '💬 Commentary', cls: 'v-n', ghostStage: '' })
  assert.deepEqual(reportCardOutcome({ outcome: 'human', ghost_stage: 'application' }, { employee: true }), { label: '💼 Employee review', cls: 'v-n', ghostStage: '' })
})

test('every non-ghosted outcome drops the stage', () => {
  for (const oc of ['hired', 'offer', 'interview', 'rejected', 'autoreject', 'waiting', 'human']) {
    assert.equal(reportCardOutcome({ outcome: oc, ghost_stage: 'application' }).ghostStage, '', oc)
  }
  assert.equal(reportCardOutcome({ outcome: 'Something_else' }).label, 'Something_else')
})
