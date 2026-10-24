// Run: node --test lib/siteIdentity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameAsProfiles, siteOrganization, siteOrganizationJsonLd, SITE_ORG_ID } from './siteIdentity.ts';

test('sameAs: empty by default, https URLs only, deduplicated', () => {
  assert.deepEqual(sameAsProfiles(''), []);
  assert.deepEqual(sameAsProfiles(undefined), []);
  assert.deepEqual(
    sameAsProfiles(' https://www.linkedin.com/company/seenjobs , http://x.com/seen, javascript:alert(1), not a url, https://www.linkedin.com/company/seenjobs,https://x.com/seenjobs'),
    ['https://www.linkedin.com/company/seenjobs', 'https://x.com/seenjobs'],
  );
});

test('Organization node: no sameAs key until a profile is configured', () => {
  const org = siteOrganization('');
  assert.equal(org['@type'], 'Organization');
  assert.equal(org['@id'], SITE_ORG_ID);
  assert.equal(org.url, 'https://seenjobs.io');
  assert.equal('sameAs' in org, false);
  assert.deepEqual(siteOrganization('https://x.com/seenjobs').sameAs, ['https://x.com/seenjobs']);
  assert.equal(siteOrganizationJsonLd('')['@context'], 'https://schema.org');
});
