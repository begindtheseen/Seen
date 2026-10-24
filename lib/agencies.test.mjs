// Run: node --test lib/agencies.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agencyPageSlug, STAFFING_AGENCIES } from './agencies.ts'

test('TEKsystems: a stored name with "/" never becomes the link (it 404ed as /company/teksystems-c%2Fo-allegis-group)', () => {
  assert.equal(agencyPageSlug('TEKsystems', 'teksystems c/o allegis group', 0), 'teksystems')
  assert.equal(agencyPageSlug('TEKsystems', 'teksystems c/o allegis group', 12), 'teksystems')
})

test('a stored name with reports is the page with the data; no reports → the display name', () => {
  assert.equal(agencyPageSlug('Robert Half', 'robert half', 20), 'robert-half')
  assert.equal(agencyPageSlug('Express Employment Professionals', 'express employment', 6), 'express-employment')
  assert.equal(agencyPageSlug('ManpowerGroup', 'manpower', 0), 'manpowergroup')
  assert.equal(agencyPageSlug('Kelly Services', null, 0), 'kelly-services')
})

test('every agency produces a slug with no encoded slash', () => {
  for (const a of STAFFING_AGENCIES) for (const alias of [null, ...a.aliases]) {
    for (const n of [0, 5]) assert.doesNotMatch(agencyPageSlug(a.name, alias, n), /%2F/i, `${a.name} / ${alias}`)
  }
})
