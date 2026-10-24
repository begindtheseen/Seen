// "Yes, I applied" pre-fill: the tracked card carries the listing's full title, location, id, link
// and the platform its apply link points at. Run: node --test lib/stores/listingApplication.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { applicationFromListing, platformFromUrl, stripCounty, cleanApplyUrl } from './listingApplication.ts'

const WALMART = { id: 'j_6c1f', title: 'Cosmetics Cashier', company: 'Walmart', location: 'Glendale, Maricopa County', apply_url: 'https://careers.walmart.com/us/jobs/WD1234?src=adzuna' }

test('the audit listing: full title, location, id and link all reach the application', () => {
  const a = applicationFromListing(WALMART)
  assert.equal(a.role, 'Cosmetics Cashier', 'never "Cashier"')
  assert.equal(a.location, 'Glendale', 'the city, without the aggregator\'s county (never dropped entirely)')
  assert.equal(a.company, 'Walmart')
  assert.equal(a.jobId, 'j_6c1f')
  assert.equal(a.jobUrl, WALMART.apply_url, 'a non-tracking query (src=) is kept as it is')
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

test('county / parish / borough suffixes are dropped from the location, nothing else is', () => {
  assert.equal(stripCounty('Mesa, Maricopa County'), 'Mesa')
  assert.equal(stripCounty('Glendale, Maricopa County, AZ'), 'Glendale, AZ')
  assert.equal(stripCounty('New Orleans, Orleans Parish'), 'New Orleans')
  assert.equal(stripCounty('Maricopa County'), 'Maricopa County', 'only a county → kept rather than blanked')
  assert.equal(stripCounty('Phoenix, AZ'), 'Phoenix, AZ')
  assert.equal(stripCounty('Remote'), 'Remote')
  assert.equal(stripCounty(''), '')
})

test('tracking parameters leave the apply link through the URL parser; the rest of the URL is untouched', () => {
  assert.equal(cleanApplyUrl('https://www.adzuna.com/details/123?utm_source=seen&utm_medium=feed&v=1'), 'https://www.adzuna.com/details/123?v=1')
  assert.equal(cleanApplyUrl('https://x.example/job?fbclid=abc&gclid=def'), 'https://x.example/job')
  assert.equal(cleanApplyUrl('https://boards.greenhouse.io/spacex/jobs/1?gh_src=abc'), 'https://boards.greenhouse.io/spacex/jobs/1?gh_src=abc', 'a board\'s own param is not ours to drop')
  assert.equal(cleanApplyUrl('not a url'), 'not a url')
  assert.equal(cleanApplyUrl(null), '')
})
