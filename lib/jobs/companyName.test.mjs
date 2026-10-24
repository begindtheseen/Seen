// Run: node --test lib/jobs/companyName.test.mjs
// Every case is a real company value from prod jobs/company_sources (read-only SQL, 2026-10-24) or a
// real brand that must NOT be split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeSlug, splitSlugWords, pickCompanyName, isTenantName } from './companyName.js';

test('looksLikeSlug: lowercase run of letters/digits, no spaces, ≥ 7 chars', () => {
  for (const s of ['plscareers', 'aloyoga', 'karllagerfeld', 'tactilemedical', 'jpmorganchase', 'k2spacecorporation']) assert.equal(looksLikeSlug(s), true, s);
  for (const s of ['Target', 'pls', 'xai', 'PLS Financial', 'alo yoga', '12345678', '', null]) assert.equal(looksLikeSlug(s), false, String(s));
});

test('splitSlugWords: board noise dropped, category words split off, unknown letters kept together', () => {
  assert.deepEqual(splitSlugWords('plscareers'), ['pls']);
  assert.deepEqual(splitSlugWords('aloyoga'), ['alo', 'yoga']);
  assert.deepEqual(splitSlugWords('tactilemedical'), ['tactile', 'medical']);
  assert.deepEqual(splitSlugWords('jpmorganchase'), ['jpmorgan', 'chase']);
  assert.deepEqual(splitSlugWords('storycannabis'), ['story', 'cannabis']);
  assert.deepEqual(splitSlugWords('andurilindustries'), ['anduril', 'industries']);
  assert.deepEqual(splitSlugWords('accenturefederalservices'), ['accenture', 'federal', 'services']);
  assert.deepEqual(splitSlugWords('langanengineeringandenvironmentalservicesllc'), ['langan', 'engineering', 'and', 'environmental', 'services']);
  assert.deepEqual(splitSlugWords('housebuyersofamerica'), ['house', 'buyers', 'of', 'america']);
  assert.deepEqual(splitSlugWords('morganmorganjobsapplynow'), ['morganmorgan']);
  assert.deepEqual(splitSlugWords('skilledwoundcare'), ['skilled', 'wound', 'care']);
  assert.deepEqual(splitSlugWords('connectionshealthsolutions'), ['connections', 'health', 'solutions']);
  assert.deepEqual(splitSlugWords('warehousejobs'), ['warehouse']);
  // No brand guessing: an unknown run stays one word (Title Cased upstream — never the raw slug).
  assert.deepEqual(splitSlugWords('karllagerfeld'), ['karllagerfeld']);
  assert.deepEqual(splitSlugWords('ivcevidensia'), ['ivcevidensia']);
});

test('splitSlugWords: real one-word brands never split', () => {
  for (const b of ['snowflake', 'databricks', 'instacart', 'doordash', 'starbucks', 'salesforce', 'speechify', 'svetness', 'aerospace']) {
    assert.deepEqual(splitSlugWords(b), [b], b);
  }
  // "and" is a joiner only between two category words — never the start of a brand.
  assert.deepEqual(splitSlugWords('andurilindustries'), ['anduril', 'industries']);
  // Not slug-shaped → returned whole.
  assert.deepEqual(splitSlugWords('PLS Financial Services'), ['PLS Financial Services']);
  assert.deepEqual(splitSlugWords(''), []);
});

test('pickCompanyName: a real registered name wins; a slug-named board takes the feed name; else the tenant', () => {
  assert.equal(pickCompanyName({ registered: 'Target', feed: 'Target Corporation', tenant: 'target' }), 'Target');
  assert.equal(pickCompanyName({ registered: 'plscareers', feed: 'PLS', tenant: 'plscareers' }), 'PLS');
  assert.equal(pickCompanyName({ registered: 'aloyoga', feed: ' ALO ', tenant: 'aloyoga' }), 'ALO'); // Greenhouse pads the name
  assert.equal(pickCompanyName({ registered: 'tactilemedical', feed: 'Tactile Medical', tenant: 'tactilemedical' }), 'Tactile Medical');
  assert.equal(pickCompanyName({ registered: 'netflix', feed: '', tenant: 'netflix' }), 'netflix');
  assert.equal(pickCompanyName({ registered: '', feed: null, tenant: 'karllagerfeld' }), 'karllagerfeld');
  // A feed name in the brand's own casing counts ("ALO"); a feed that repeats the lowercase slug does not.
  assert.equal(pickCompanyName({ registered: 'acme', feed: 'ACME', tenant: 'acme' }), 'ACME');
  assert.equal(pickCompanyName({ registered: 'acme', feed: 'acme', tenant: 'acme' }), 'acme');
  assert.equal(isTenantName('aloyoga', 'aloyoga'), true);
  assert.equal(isTenantName('Alo Yoga', 'aloyoga'), false); // a person wrote this one
  assert.equal(isTenantName('ALO', 'aloyoga'), false);
  assert.equal(isTenantName('', 'aloyoga'), true);
});
