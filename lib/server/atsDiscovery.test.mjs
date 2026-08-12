import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nameCore,
  candidateSlugs,
  tenantFromUrl,
  tenantsFromHtml,
  namesMatch,
  verdictFor,
  sourceRow,
  probePlan,
  PROVIDERS,
  canVerifyName,
} from './atsDiscovery.js';

// ── nameCore ────────────────────────────────────────────────────────────────────
test('nameCore strips legal suffixes, punctuation, and case', () => {
  assert.equal(nameCore('Stripe, Inc.'), 'stripe');
  assert.equal(nameCore('MY Humancapital GmbH'), 'my humancapital');
  assert.equal(nameCore('JPMorgan Chase Bank, N.A.'), 'jpmorgan chase bank');
  assert.equal(nameCore('Ben & Jerry’s'), 'ben and jerry s');
  assert.equal(nameCore(''), '');
  assert.equal(nameCore(null), '');
});

// ── candidateSlugs ──────────────────────────────────────────────────────────────
test('candidateSlugs emits squashed and hyphenated forms as exact', () => {
  const c = candidateSlugs('Capital One');
  const exact = c.filter((x) => x.strength === 'exact').map((x) => x.slug);
  assert.deepEqual(exact, ['capitalone', 'capital-one']);
});

test('candidateSlugs never emits a generic first word, even as weak', () => {
  // The live false positive this guards: "Capital One" -> lever/capital is somebody else's board.
  const slugs = candidateSlugs('Capital One').map((x) => x.slug);
  assert.ok(!slugs.includes('capital'), 'bare "capital" must never be probed');
});

test('candidateSlugs allows a distinctive first word only as weak', () => {
  const c = candidateSlugs('Databricks Analytics');
  const weak = c.filter((x) => x.strength === 'weak').map((x) => x.slug);
  assert.ok(weak.includes('databricks'));
  assert.equal(c[0].strength, 'exact');
});

test('candidateSlugs is empty for unusable names', () => {
  assert.deepEqual(candidateSlugs(''), []);
  assert.deepEqual(candidateSlugs('!!!'), []);
  assert.deepEqual(candidateSlugs('X'), []);
});

test('candidateSlugs de-duplicates single-word names', () => {
  const c = candidateSlugs('Figma');
  assert.deepEqual(c, [{ slug: 'figma', strength: 'exact' }]);
});

// ── tenantFromUrl ───────────────────────────────────────────────────────────────
test('tenantFromUrl reads every Greenhouse board shape', () => {
  assert.deepEqual(tenantFromUrl('https://boards.greenhouse.io/figma'),
    { provider: 'greenhouse', tenant: 'figma', strength: 'exact' });
  assert.deepEqual(tenantFromUrl('https://boards.greenhouse.io/embed/job_board?for=vercel'),
    { provider: 'greenhouse', tenant: 'vercel', strength: 'exact' });
  assert.deepEqual(tenantFromUrl('https://boards-api.greenhouse.io/v1/boards/stripe/jobs'),
    { provider: 'greenhouse', tenant: 'stripe', strength: 'exact' });
});

test('tenantFromUrl reads Lever and Ashby boards', () => {
  assert.deepEqual(tenantFromUrl('https://jobs.lever.co/plaid'),
    { provider: 'lever', tenant: 'plaid', strength: 'exact' });
  assert.deepEqual(tenantFromUrl('https://api.lever.co/v0/postings/motive'),
    { provider: 'lever', tenant: 'motive', strength: 'exact' });
  assert.deepEqual(tenantFromUrl('https://jobs.ashbyhq.com/notion'),
    { provider: 'ashby', tenant: 'notion', strength: 'exact' });
});

test('tenantFromUrl rejects non-ATS and malformed URLs', () => {
  assert.equal(tenantFromUrl('https://example.com/careers'), null);
  assert.equal(tenantFromUrl('not a url'), null);
  assert.equal(tenantFromUrl('javascript:alert(1)'), null);
  assert.equal(tenantFromUrl('https://boards.greenhouse.io/'), null);
});

test('tenantFromUrl rejects a path segment that is not slug-shaped', () => {
  assert.equal(tenantFromUrl('https://jobs.lever.co/has%20space'), null);
});

// ── tenantsFromHtml ─────────────────────────────────────────────────────────────
test('tenantsFromHtml finds and de-duplicates board links in a careers page', () => {
  const html = `
    <a href="https://boards.greenhouse.io/acme">Open roles</a>
    <a href="https://boards.greenhouse.io/acme">Same board again</a>
    <iframe src="https://jobs.ashbyhq.com/acme-labs"></iframe>
    <a href="https://twitter.com/acme">Twitter</a>`;
  assert.deepEqual(tenantsFromHtml(html), [
    { provider: 'greenhouse', tenant: 'acme', strength: 'exact' },
    { provider: 'ashby', tenant: 'acme-labs', strength: 'exact' },
  ]);
});

test('tenantsFromHtml tolerates empty and junk input', () => {
  assert.deepEqual(tenantsFromHtml(''), []);
  assert.deepEqual(tenantsFromHtml(null), []);
});

// ── namesMatch ──────────────────────────────────────────────────────────────────
test('namesMatch accepts the same company written differently', () => {
  assert.ok(namesMatch('Stripe', 'Stripe, Inc.'));
  assert.ok(namesMatch('Scale AI', 'Scale AI'));
  assert.ok(namesMatch('Datadog', 'Datadog Inc'));
});

test('namesMatch rejects a truncation collision', () => {
  // The exact live failure mode: a board named "Capital" is not Capital One.
  assert.ok(!namesMatch('Capital One', 'Capital'));
  assert.ok(!namesMatch('Bank of America', 'Bank'));
});

test('namesMatch rejects unrelated names', () => {
  assert.ok(!namesMatch('Figma', 'Notion'));
  assert.ok(!namesMatch('Plaid', ''));
  assert.ok(!namesMatch('', 'Plaid'));
});

// ── verdictFor ──────────────────────────────────────────────────────────────────
const GH = { nameEndpointSupported: true };
const LEVER = { nameEndpointSupported: false };

test('verdictFor accepts a name-verified board with high confidence', () => {
  const v = verdictFor({ companyName: 'Stripe', strength: 'weak', jobCount: 561, boardName: 'Stripe', ...GH });
  assert.deepEqual(v, { accept: true, confidence: 'high', reason: 'board-name-verified' });
});

test('verdictFor rejects a name mismatch even on an exact slug with jobs', () => {
  const v = verdictFor({ companyName: 'Capital One', strength: 'exact', jobCount: 42, boardName: 'Capital Partners', ...GH });
  assert.equal(v.accept, false);
  assert.match(v.reason, /board-name-mismatch/);
});

test('verdictFor rejects a weak slug when the provider cannot verify a name', () => {
  // This is what stops lever/capital being filed under Capital One.
  const v = verdictFor({ companyName: 'Capital One', strength: 'weak', jobCount: 42, boardName: null, ...LEVER });
  assert.deepEqual(v, { accept: false, confidence: null, reason: 'weak-slug-unverifiable' });
});

test('verdictFor accepts an exact slug without a name endpoint', () => {
  const v = verdictFor({ companyName: 'Notion', strength: 'exact', jobCount: 128, boardName: null, ...LEVER });
  assert.deepEqual(v, { accept: true, confidence: 'high', reason: 'exact-slug' });
});

test('verdictFor never accepts an empty or unparseable board', () => {
  assert.equal(verdictFor({ companyName: 'Plaid', strength: 'exact', jobCount: 0, boardName: null, ...LEVER }).reason, 'board-empty');
  assert.equal(verdictFor({ companyName: 'Plaid', strength: 'exact', jobCount: null, boardName: null, ...LEVER }).reason, 'unparseable-response');
});

// ── probePlan ───────────────────────────────────────────────────────────────────
test('probePlan puts careers-page hits before any slug guessing', () => {
  const plan = probePlan('Acme Rocket', { careersUrls: ['https://jobs.lever.co/acme-rocket-co'] });
  assert.deepEqual(plan[0], { provider: 'lever', tenant: 'acme-rocket-co', strength: 'exact', via: 'careers-url' });
});

test('probePlan omits weak candidates for providers that cannot verify a board name', () => {
  const plan = probePlan('Databricks Analytics');
  const unverifiableWeak = plan.filter((p) => p.strength === 'weak' && !canVerifyName(p.provider));
  assert.deepEqual(unverifiableWeak, [], 'unverifiable weak probes must not be planned');
  // Lever/Ashby can never confirm a name, so they must only ever appear as exact-slug probes.
  for (const p of plan.filter((x) => ['lever', 'ashby'].includes(x.provider))) assert.equal(p.strength, 'exact');
  assert.ok(plan.some((p) => p.strength === 'weak' && p.provider === 'greenhouse'));
});

test('probePlan never repeats a provider/tenant pair', () => {
  const plan = probePlan('Figma', { careersUrls: ['https://boards.greenhouse.io/figma'] });
  const keys = plan.map((p) => `${p.provider}/${p.tenant}`);
  assert.equal(keys.length, new Set(keys).size);
});

test('probePlan honours a provider filter', () => {
  const plan = probePlan('Notion', { providers: ['ashby'] });
  assert.ok(plan.length > 0);
  assert.ok(plan.every((p) => p.provider === 'ashby'));
});

test('probePlan is empty for an unusable company name', () => {
  assert.deepEqual(probePlan('!!'), []);
});

// ── providers ───────────────────────────────────────────────────────────────────
test('SmartRecruiters counts totalFound, not the page of content', () => {
  // It answers 200 for ANY tenant, so the status code proves nothing — only totalFound does.
  const p = PROVIDERS.smartrecruiters;
  assert.equal(p.countJobs({ offset: 0, limit: 1, totalFound: 2, content: [{}] }), 2);
  assert.equal(p.countJobs({ offset: 0, limit: 1, totalFound: 0, content: [] }), 0);
  assert.equal(p.countJobs({}), null);
});

test('a SmartRecruiters 200 for a nonexistent tenant is rejected, not accepted', () => {
  const p = PROVIDERS.smartrecruiters;
  const body = { totalFound: 0, content: [] };
  const v = verdictFor({
    companyName: 'Definitely Not A Company', strength: 'exact',
    jobCount: p.countJobs(body), boardName: p.nameFromJobs(body), nameEndpointSupported: true,
  });
  assert.deepEqual(v, { accept: false, confidence: null, reason: 'board-empty' });
});

test('SmartRecruiters verifies ownership from the posting company name', () => {
  const p = PROVIDERS.smartrecruiters;
  const body = { totalFound: 2, content: [{ company: { identifier: 'Visa', name: 'Visa' } }] };
  assert.equal(p.nameFromJobs(body), 'Visa');
  const v = verdictFor({
    companyName: 'Visa', strength: 'weak',
    jobCount: p.countJobs(body), boardName: p.nameFromJobs(body), nameEndpointSupported: true,
  });
  assert.equal(v.accept, true);
  assert.equal(v.reason, 'board-name-verified');
});

test('canVerifyName reflects real provider capability, not a defined-function accident', () => {
  assert.equal(canVerifyName('greenhouse'), true);
  assert.equal(canVerifyName('smartrecruiters'), true);
  assert.equal(canVerifyName('workable'), true);
  assert.equal(canVerifyName('lever'), false);   // nameFromJobs exists but always returns null
  assert.equal(canVerifyName('ashby'), false);
  assert.equal(canVerifyName('nope'), false);
});

test('every provider exposes the full contract', () => {
  for (const [name, p] of Object.entries(PROVIDERS)) {
    assert.equal(typeof p.jobsUrl, 'function', `${name}.jobsUrl`);
    assert.equal(typeof p.countJobs, 'function', `${name}.countJobs`);
    assert.equal(typeof p.nameFromJobs, 'function', `${name}.nameFromJobs`);
    assert.equal(typeof p.verifiesName, 'boolean', `${name}.verifiesName`);
    assert.ok(p.jobsUrl('acme').startsWith('https://'), `${name} must use https`);
    assert.equal(p.countJobs(null), null, `${name}.countJobs must be null-safe`);
  }
});

test('tenant slugs are URL-encoded so a hostile name cannot escape the path', () => {
  const url = PROVIDERS.greenhouse.jobsUrl('../../evil');
  assert.ok(!url.includes('../'), url);
});

// ── sourceRow ───────────────────────────────────────────────────────────────────
test('sourceRow builds an ingestable ATS_DIRECT row', () => {
  const r = sourceRow({ companyName: 'Figma', provider: 'greenhouse', tenant: 'figma', jobCount: 166, confidence: 'high', discoveredVia: 'slug-probe' });
  assert.equal(r.source_type, 'ATS_DIRECT');
  assert.equal(r.ingestable, true);
  assert.equal(r.status, 'active');
  assert.equal(r.consecutive_failures, 0);
  assert.equal(r.discovered_via, 'slug-probe');
  assert.equal(r.job_count, 166);
  assert.ok(!Number.isNaN(Date.parse(r.last_verified_at)));
});
