// Run: node --test lib/reportCardOutcome.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportCardOutcome } from './reportCardOutcome.ts'

test('Amazon (prod 2026-10-24): a "human" report with a stray ghost_stage shows ONE outcome — Got a response, no "ghosted at"', () => {
  const c = reportCardOutcome({ outcome: 'human', ghost_stage: 'application' })
  assert.equal(c.label, 'Got a response')
  assert.equal(c.tone, 'good')
  assert.equal(c.ghostStage, '')
})

test('a ghosted report keeps its stage and reads as bad', () => {
  assert.deepEqual(reportCardOutcome({ outcome: 'ghosted', ghost_stage: 'after_interview' }), { label: 'Ghosted', tone: 'bad', icon: 'ghost', ghostStage: 'after interview' })
  assert.equal(reportCardOutcome({ outcome: 'ghosted', ghost_stage: null }).ghostStage, '')
})

test('no outcome word, no stage, on commentary or an employee review', () => {
  assert.deepEqual(reportCardOutcome({ outcome: 'ghosted', ghost_stage: 'application' }, { commentary: true }), { label: 'Commentary', tone: 'neutral', icon: 'message-square', ghostStage: '' })
  assert.deepEqual(reportCardOutcome({ outcome: 'human', ghost_stage: 'application' }, { employee: true }), { label: 'Employee review', tone: 'neutral', icon: 'briefcase', ghostStage: '' })
})

test('every non-ghosted outcome drops the stage; tones follow what the outcome says about the company', () => {
  for (const oc of ['hired', 'offer', 'interview', 'rejected', 'autoreject', 'waiting', 'human']) {
    assert.equal(reportCardOutcome({ outcome: oc, ghost_stage: 'application' }).ghostStage, '', oc)
  }
  for (const oc of ['hired', 'offer', 'interview', 'human']) assert.equal(reportCardOutcome({ outcome: oc }).tone, 'good', oc)
  for (const oc of ['rejected', 'autoreject']) assert.equal(reportCardOutcome({ outcome: oc }).tone, 'caution', oc)
  assert.equal(reportCardOutcome({ outcome: 'waiting' }).tone, 'neutral')
  assert.equal(reportCardOutcome({ outcome: 'Something_else' }).label, 'Something_else')
  for (const oc of ['ghosted', 'hired', 'rejected']) assert.doesNotMatch(reportCardOutcome({ outcome: oc }).label, /[\u{1F300}-\u{1FAFF}☀-➿]/u, 'no emoji')
})
