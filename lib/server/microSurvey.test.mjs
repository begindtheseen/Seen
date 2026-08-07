import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GENERAL_QUESTIONS,
  CONTEXTUAL_QUESTION_KEY,
  CONTEXTUAL_CHOICES,
  normalizeCompany,
  buildContextualQuestion,
  isKnownQuestionKey,
  choicesForKey,
  isValidChoice,
  validateSubmission,
} from './microSurvey.js'

// Control chars are constructed via String.fromCharCode so NO literal control bytes live in
// this source file (they are invisible, corrupt diffs, and trip tooling).
const NUL = String.fromCharCode(0)
const BEL = String.fromCharCode(7)
const DEL = String.fromCharCode(127)

test('normalizeCompany trims, collapses whitespace, strips control chars, caps length', () => {
  assert.equal(normalizeCompany('  Acme   Corp '), 'Acme Corp')
  // control chars (NUL, BEL, DEL) become spaces, then collapse
  assert.equal(normalizeCompany('Acme' + NUL + BEL + 'Corp'), 'Acme Corp')
  assert.equal(normalizeCompany('A' + DEL + 'B'), 'A B')
  // tabs/newlines are whitespace and collapse to a single space
  assert.equal(normalizeCompany('Foo\t\nBar'), 'Foo Bar')
  assert.equal(normalizeCompany('\t\n  '), '') // whitespace-only becomes empty
  assert.equal(normalizeCompany(''), '')
  assert.equal(normalizeCompany(null), '') // non-string becomes empty
  assert.equal(normalizeCompany(42), '')
  assert.equal(normalizeCompany('x'.repeat(500)).length, 120) // capped at MAX_COMPANY_LEN
})

test('buildContextualQuestion builds a company question or returns null for junk', () => {
  const q = buildContextualQuestion('  Netflix ')
  assert.equal(q.key, CONTEXTUAL_QUESTION_KEY)
  assert.equal(q.company, 'Netflix')
  assert.match(q.text, /Netflix/)
  assert.deepEqual(q.choices, CONTEXTUAL_CHOICES)
  assert.notEqual(q.choices, CONTEXTUAL_CHOICES) // returns a copy, not the shared array
  assert.equal(buildContextualQuestion('   '), null)
  assert.equal(buildContextualQuestion(null), null)
  assert.equal(buildContextualQuestion(''), null)
})

test('the general pool is well-formed: unique keys, 2-4 unique choices, non-empty text', () => {
  const keys = new Set()
  for (const q of GENERAL_QUESTIONS) {
    assert.equal(typeof q.key, 'string')
    assert.ok(q.key.length > 0)
    assert.equal(keys.has(q.key), false, `duplicate key ${q.key}`)
    keys.add(q.key)
    assert.ok(Array.isArray(q.choices))
    assert.ok(q.choices.length >= 2 && q.choices.length <= 4, `${q.key} has ${q.choices.length} choices`)
    assert.equal(new Set(q.choices).size, q.choices.length, `${q.key} has duplicate choices`)
    assert.ok(typeof q.text === 'string' && q.text.length > 0)
  }
  assert.ok(GENERAL_QUESTIONS.length >= 3)
  // the contextual key must NOT collide with any general key
  assert.equal(keys.has(CONTEXTUAL_QUESTION_KEY), false)
})

test('key + choice validity guards', () => {
  const g = GENERAL_QUESTIONS[0]
  assert.ok(isKnownQuestionKey(g.key))
  assert.ok(isKnownQuestionKey(CONTEXTUAL_QUESTION_KEY))
  assert.equal(isKnownQuestionKey('nope'), false)
  assert.equal(isKnownQuestionKey(''), false)

  assert.deepEqual(choicesForKey(CONTEXTUAL_QUESTION_KEY), CONTEXTUAL_CHOICES)
  assert.deepEqual(choicesForKey(g.key), g.choices)
  assert.deepEqual(choicesForKey('nope'), [])

  assert.ok(isValidChoice(g.key, g.choices[0]))
  assert.equal(isValidChoice(g.key, 'not-an-option'), false)
  assert.ok(isValidChoice(CONTEXTUAL_QUESTION_KEY, CONTEXTUAL_CHOICES[0]))
  assert.equal(isValidChoice(CONTEXTUAL_QUESTION_KEY, 'maybe'), false)
  assert.equal(isValidChoice('nope', 'Yes'), false)
  assert.equal(isValidChoice(g.key, 123), false) // non-string choice
})

test('validateSubmission accepts a valid general answer and forces company to null', () => {
  const g = GENERAL_QUESTIONS[0]
  // a company is deliberately attached — it must be dropped for a general question
  const v = validateSubmission({ question_key: g.key, choice: g.choices[0], company: 'Ignored Inc' })
  assert.ok(v.ok)
  assert.equal(v.record.question_key, g.key)
  assert.equal(v.record.choice, g.choices[0])
  assert.equal(v.record.company, null)
})

test('validateSubmission accepts a contextual answer and normalizes the company', () => {
  const v = validateSubmission({
    question_key: CONTEXTUAL_QUESTION_KEY,
    choice: 'Still waiting',
    company: '  Spotify  ',
  })
  assert.ok(v.ok)
  assert.equal(v.record.company, 'Spotify')
  assert.equal(v.record.choice, 'Still waiting')
  assert.equal(v.record.question_key, CONTEXTUAL_QUESTION_KEY)
})

test('validateSubmission rejects junk: unknown key, bad choice, contextual missing company', () => {
  assert.equal(validateSubmission({ question_key: 'nope', choice: 'Yes' }).error, 'unknown_question')
  const g = GENERAL_QUESTIONS[0]
  assert.equal(validateSubmission({ question_key: g.key, choice: 'not-real' }).error, 'invalid_choice')
  assert.equal(
    validateSubmission({ question_key: CONTEXTUAL_QUESTION_KEY, choice: 'Yes', company: '   ' }).error,
    'company_required',
  )
  assert.equal(
    validateSubmission({ question_key: CONTEXTUAL_QUESTION_KEY, choice: 'Yes' }).error,
    'company_required',
  )
  assert.equal(validateSubmission(null).ok, false)
  assert.equal(validateSubmission({}).ok, false)
  assert.equal(validateSubmission('garbage').ok, false)
  assert.equal(validateSubmission(undefined).ok, false)
})
