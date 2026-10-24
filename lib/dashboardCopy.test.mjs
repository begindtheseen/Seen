import test from 'node:test'
import assert from 'node:assert/strict'
import { appsUntilHealth, healthUnlockLine, HEALTH_MIN_APPS } from './dashboardCopy.ts'

test('"Track N more" counts down from 3 and is singular at one', () => {
  assert.equal(HEALTH_MIN_APPS, 3)
  assert.equal(healthUnlockLine(0), 'Track 3 more applications and Seen scores how your search is going.')
  assert.equal(healthUnlockLine(1), 'Track 2 more applications and Seen scores how your search is going.')
  assert.equal(healthUnlockLine(2), 'Track 1 more application and Seen scores how your search is going.')
  // never a zero or negative count if the line is ever shown at the threshold
  assert.equal(appsUntilHealth(3), 1)
  assert.equal(appsUntilHealth(7), 1)
  assert.equal(appsUntilHealth(-2), 3)
})
