// Per-account checklist dismissal inside profiles.onboarding_survey (string or object), survey answers kept.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isChecklistDismissed, withChecklistDismissed, parseSurveyBlob, CHECKLIST_DISMISSED_KEY } from './onboardingPrefs.ts'

const NOW = new Date('2026-10-23T17:00:00Z')

test('nothing dismissed yet: null, empty, garbage and an unrelated survey all read false', () => {
  for (const v of [null, undefined, '', 'not json', '[1,2]', '{}', { frustration: 'ghosting' }, '{"frustration":"ghosting"}']) {
    assert.equal(isChecklistDismissed(v), false, JSON.stringify(v))
  }
})

test('dismissing keeps the survey answers and stamps the time; both blob shapes round-trip', () => {
  const asString = withChecklistDismissed('{"frustration":"ghosting"}', NOW)
  assert.equal(typeof asString, 'string')
  assert.deepEqual(JSON.parse(asString), { frustration: 'ghosting', [CHECKLIST_DISMISSED_KEY]: '2026-10-23T17:00:00.000Z' })
  assert.equal(isChecklistDismissed(asString), true)
  const asObject = withChecklistDismissed({ frustration: 'ghosting', role: 'retail' }, NOW)
  assert.deepEqual(parseSurveyBlob(asObject), { frustration: 'ghosting', role: 'retail', [CHECKLIST_DISMISSED_KEY]: '2026-10-23T17:00:00.000Z' })
  // a second device reading the saved value (as text or as jsonb object) sees the dismissal
  assert.equal(isChecklistDismissed(JSON.parse(asObject)), true)
  // garbage is replaced, never crashed on
  assert.equal(isChecklistDismissed(withChecklistDismissed('not json', NOW)), true)
})
