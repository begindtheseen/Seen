// "Yes, I applied" pre-fill: the tracked card carries the listing's full title, location, id, link
// and the platform its apply link points at. Run: node --test lib/stores/listingApplication.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { applicationFromListing, platformFromUrl } from './listingApplication.ts'

const WALMART = { id: 'j_6c1f', title: 'Cosmetics Cashier', company: 'Walmart', location: 'Glendale, Maricopa County', apply_url: 'https://careers.walmart.com/us/jobs/WD1234?src=adzuna' }

test('the audit listing: full title, location, id and link all reach the application', () => {
  const a = applicationFromListing(WALMART)
  assert.equal(a.role, 'Cosmetics Cashier', 'never "Cashier"')
  assert.equal(a.location, 'Glendale, Maricopa County', 'never dropped')
  assert.equal(a.company, 'Walmart')
  assert.equal(a.jobId, 'j_6c1f')
  assert.equal(a.jobUrl, WALMART.apply_url)
  assert.equal(a.platform, 'Direct')
  assert.equal(a.stage, 'Applied')
  assert.equal(a.status, 'active')
})

test('the platform follows the apply link host; the caller may override it', () => {
  assert.equal(platformFromUrl('https://www.linkedin.com/jobs/view/123'), 'LinkedIn')
  assert.equal(platformFromUrl('https://www.indeed.com/viewjob?jk=abc'), 'Indeed')
  assert.equal(platformFromUrl('https://seenjobs.io/jobs/11111111-1111-4111-8111-111111111111'), 'Seen')
  assert.equal(platformFromUrl('/jobs/11111111-1111-4111-8111-111111111111'), 'Seen')
  assert.equal(platformFromUrl('https://boards.greenhouse.io/spacex/jobs/1'), 'Direct')
  assert.equal(platformFromUrl(''), 'Direct')
  assert.equal(platformFromUrl('not a url'), 'Direct')
  assert.equal(applicationFromListing(WALMART, { platform: 'Referral' }).platform, 'Referral')
})

test('missing pieces are honest blanks, never invented; whitespace is normalised', () => {
  const a = applicationFromListing({ title: '  Guest  Advocate ', company: 'Target', location: null, apply_url: null, id: null })
  assert.equal(a.role, 'Guest Advocate')
  assert.equal(a.location, '')
  assert.equal('jobId' in a, false)
  assert.equal('jobUrl' in a, false)
  assert.equal(a.platform, 'Direct')
  assert.equal(applicationFromListing({ id: 42, title: 'x', company: 'y' }).jobId, '42')
})
