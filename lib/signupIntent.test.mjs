// Run: node --test lib/signupIntent.test.mjs
// The sign-up screen's intent + the confirmation link's destination (conversion audit 2026-10-24).
import test from 'node:test'
import assert from 'node:assert/strict'
import { safeNextPath, parseSignupParams, signupHref, intentCopy, nextLabel, trialSignupHref, trialPath, cleanCompany } from './signupIntent.js'
import { PRO_TRIAL_DAYS, REFERRAL_REWARD_PRO_DAYS } from './server/creditRules.js'

const qs = (s) => new URLSearchParams(s)

test('safeNextPath keeps one same-origin path and its query, drops the hash', () => {
  assert.equal(safeNextPath('/company/walmart'), '/company/walmart')
  assert.equal(safeNextPath('/company/walmart?checkins=on'), '/company/walmart?checkins=on')
  assert.equal(safeNextPath('/trial?plan=yearly#x'), '/trial?plan=yearly')
  assert.equal(safeNextPath('/tracker'), '/tracker')
  assert.equal(safeNextPath('/company/coca-cola'), '/company/coca-cola')
  assert.equal(safeNextPath('/company/at%26t'), '/company/at%26t')
})

test('safeNextPath refuses other origins, schemes and every encoded way to reach one', () => {
  for (const bad of [
    '//evil.com', '//evil.com/path', '///evil.com', '/\\evil.com', '/\\/evil.com', '\\\\evil.com',
    'https://evil.com', 'http://evil.com/x', 'HTTPS://evil.com', 'javascript:alert(1)', 'data:text/html,hi',
    'evil.com', '', null, undefined, ' //evil.com',
    '/%2F%2Fevil.com', '/%2f%2fevil.com', '/%5Cevil.com', '/%5cevil.com', '/%2F%5Cevil.com', '/a%5Cb',
    '/%252F%252Fevil.com'.replace('%25', '%'), // /%2F%252Fevil → decodes to //%2Fevil
    '/\u0000x', '/x\ny', '/x\ty', '/%00evil', '/%0aevil',
    '/login', '/login?next=/x', '/reset', '/signup',
  ]) {
    assert.equal(safeNextPath(bad), null, `must refuse ${JSON.stringify(bad)}`)
  }
  // malformed escapes are refused, never thrown
  assert.equal(safeNextPath('/%E0%A4%A'), null)
})

test('parseSignupParams: intent / mode=signup / ?signup=1 / employer open sign-up; plain return stays sign-in', () => {
  assert.deepEqual(parseSignupParams(qs('mode=signup&intent=track&company=Walmart&next=%2Fcompany%2Fwalmart')),
    { mode: 'signup', intent: 'track', company: 'Walmart', next: '/company/walmart', employer: false })
  assert.equal(parseSignupParams(qs('intent=trial')).mode, 'signup')
  assert.equal(parseSignupParams(qs('signup=1')).mode, 'signup')
  assert.equal(parseSignupParams(qs('type=employer')).mode, 'signup')
  assert.equal(parseSignupParams(qs('type=employer'), { employerSignup: false }).employer, false)
  assert.equal(parseSignupParams(qs('return=%2Ftracker')).mode, 'signin')
  assert.equal(parseSignupParams(qs('return=%2Ftracker')).next, '/tracker')
  assert.equal(parseSignupParams(qs('')).mode, 'signin')
  // unknown intents are ignored; an unsafe next is dropped
  assert.equal(parseSignupParams(qs('intent=steal&next=%2F%2Fevil.com')).intent, null)
  assert.equal(parseSignupParams(qs('intent=steal&next=%2F%2Fevil.com')).next, null)
  // a pending invite names the sign-up headline only when nothing else does
  assert.equal(parseSignupParams(qs('signup=1'), { pendingRef: true }).intent, 'invite')
  assert.equal(parseSignupParams(qs('intent=trial'), { pendingRef: true }).intent, 'trial')
  assert.equal(parseSignupParams(qs(''), { pendingRef: true }).mode, 'signin')
})

test('signupHref round-trips through parseSignupParams', () => {
  const h = signupHref({ intent: 'track', company: 'Walmart', next: '/company/walmart' })
  assert.equal(h, '/login?mode=signup&intent=track&company=Walmart&next=%2Fcompany%2Fwalmart')
  const p = parseSignupParams(new URL(h, 'https://seenjobs.io').searchParams)
  assert.deepEqual(p, { mode: 'signup', intent: 'track', company: 'Walmart', next: '/company/walmart', employer: false })
  assert.equal(signupHref({ next: '//evil.com' }), '/login?mode=signup')
  assert.equal(trialPath('yearly'), '/trial?plan=yearly')
  assert.equal(trialPath('weird'), '/trial?plan=monthly')
  assert.equal(trialSignupHref('yearly'), '/login?mode=signup&intent=trial&next=%2Ftrial%3Fplan%3Dyearly')
})

test('intentCopy: one headline per intent, numbers from creditRules', () => {
  assert.deepEqual(intentCopy({ intent: 'trial' }), { title: `Start your ${PRO_TRIAL_DAYS}-day free trial`, sub: 'No card needed. Create your free account and the trial starts right after.' })
  assert.equal(intentCopy({ intent: 'track', company: 'Walmart' }).title, 'Track your Walmart application')
  assert.equal(intentCopy({ intent: 'track' }).title, 'Track your applications')
  assert.match(intentCopy({ intent: 'track' }).sub, /day 7, 14 and 30/)
  assert.equal(intentCopy({ intent: 'invite' }).title, 'Your friend invited you')
  assert.equal(intentCopy({ intent: 'invite' }).sub, `Sign up and track your first application, and you both get ${REFERRAL_REWARD_PRO_DAYS} days of Seen Pro.`)
  assert.equal(intentCopy({ intent: 'alert', company: 'Amazon' }).title, 'Keep an eye on Amazon')
  assert.equal(intentCopy({}).title, 'Create your account')
  // no headline ever carries markup or a 200-character name
  assert.equal(cleanCompany('<b>Acme</b>\n'), 'b Acme /b')
  assert.equal(cleanCompany('x'.repeat(200)).length, 80)
  // no dashes in the new sentences where a period works (owner copy rule)
  for (const i of ['trial', 'track', 'invite', 'alert', null]) {
    const c = intentCopy({ intent: i, company: 'Walmart' })
    assert.ok(!/ — | – /.test(c.title + c.sub), `${i}: ${c.title} / ${c.sub}`)
  }
})

test('nextLabel names where the confirmation link goes', () => {
  assert.equal(nextLabel('/trial?plan=monthly'), 'your free trial')
  assert.equal(nextLabel('/company/walmart', 'Walmart'), 'the Walmart page')
  assert.equal(nextLabel('/tracker'), 'your tracker')
  assert.equal(nextLabel(null), 'your dashboard')
  assert.equal(nextLabel('//evil.com'), 'your dashboard')
})
