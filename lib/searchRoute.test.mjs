// Run: node --test lib/searchRoute.test.mjs
// Candidates below are the production resolver's real answers (POST /api/reports {action:'resolve'},
// read 2026-10-24) for the queries the conversion audit typed into the homepage box.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeSearchRoute, knownCompany, jobsSearchHref, companySlug } from './searchRoute.ts'

const RESOLVE = {
  barista: [],
  cashier: [],
  driver: [],
  warehouse: [],
  'delivery driver': [],
  nurse: [{ name: 'cross country nurses', match_confidence: 23 }],
  'software engineer': [{ name: 'veeam software', match_confidence: 40 }],
  walmart: [{ name: 'walmart', match_confidence: 99 }],
  'home depot': [{ name: 'home depot', match_confidence: 99 }, { name: 'the home depot', match_confidence: 64 }],
  mcdonalds: [{ name: 'mcdonalds', match_confidence: 99 }],
  'robert half': [{ name: 'robert half', match_confidence: 99 }, { name: 'robert w. baird', match_confidence: 40 }],
  starbuck: [{ name: 'starbucks', match_confidence: 80 }],
  'whole foods': [{ name: 'whole foods', match_confidence: 99 }, { name: 'Amazon', match_confidence: 97, via_alias: true }],
  'amazon warehouse': [{ name: 'amazon', match_confidence: 34 }],
}

test('job titles go to job search with the query and city — never to a company page', () => {
  for (const q of ['barista', 'cashier', 'driver', 'warehouse', 'delivery driver', 'nurse', 'software engineer', 'amazon warehouse']) {
    const r = homeSearchRoute(q, 'Phoenix, AZ', RESOLVE[q])
    assert.equal(r.kind, 'jobs', q)
    assert.equal(r.href, `/jobs?q=${encodeURIComponent(q)}&loc=${encodeURIComponent('Phoenix, AZ')}`)
  }
  assert.equal(homeSearchRoute('barista', '', []).href, '/jobs?q=barista')
})

test('a known company goes to its page, slugged by the stored name', () => {
  assert.deepEqual(homeSearchRoute('Walmart', '', RESOLVE.walmart), { kind: 'company', href: '/company/walmart' })
  assert.deepEqual(homeSearchRoute('home depot', 'Phoenix', RESOLVE['home depot']), { kind: 'company', href: '/company/home-depot' })
  assert.deepEqual(homeSearchRoute('Robert Half', '', RESOLVE['robert half']), { kind: 'company', href: '/company/robert-half' })
  assert.equal(homeSearchRoute('starbuck', '', RESOLVE.starbuck).href, '/company/starbucks')
  assert.equal(homeSearchRoute('whole foods', '', RESOLVE['whole foods']).href, '/company/whole-foods')
})

test('punctuation and legal suffixes never decide a match', () => {
  assert.equal(knownCompany("McDonald's", [{ name: 'mcdonalds', match_confidence: 0 }]), 'mcdonalds')
  assert.equal(knownCompany('walmart inc', [{ name: 'walmart', match_confidence: 57 }]), 'walmart')
  assert.equal(knownCompany('software engineer', RESOLVE['software engineer']), null)
})

test('a failed lookup keeps the old company route (that page verifies the name and links to jobs)', () => {
  assert.deepEqual(homeSearchRoute('Sheetz', '', null), { kind: 'company', href: '/company/sheetz' })
})

test('empty query: nothing, or job search in that city', () => {
  assert.equal(homeSearchRoute('  ', '', []), null)
  assert.deepEqual(homeSearchRoute('', 'Phoenix, AZ', []), { kind: 'jobs', href: '/jobs?loc=Phoenix%2C%20AZ' })
})

test('helpers follow the one slug scheme', () => {
  assert.equal(companySlug('Robert Half'), 'robert-half')
  assert.equal(jobsSearchHref(' barista ', ' '), '/jobs?q=barista')
})
