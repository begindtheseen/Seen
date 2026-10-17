import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName, editDistance, candidateReason, clusterNames, pickCanonical, makeProposal,
  buildDedupeRequests, proposalsFromVerdict, aliasRowsFor, VERDICT_SCHEMA, MODEL, ALIAS_SOURCE,
} from './company-dedupe.mjs';

test('normalizeName: apostrophes, punctuation, "the", legal suffixes, diacritics, .com', () => {
  assert.equal(normalizeName("macy's"), 'macys');
  assert.equal(normalizeName('macys'), 'macys');
  assert.equal(normalizeName("Macy’s, Inc."), 'macys');
  assert.equal(normalizeName('The Home Depot'), 'home depot');
  assert.equal(normalizeName('Acme Corp.'), 'acme');
  assert.equal(normalizeName('Acme Holdings LLC'), 'acme holdings'); // only legal forms are stripped
  assert.equal(normalizeName('Coca-Cola Co'), 'coca cola');
  assert.equal(normalizeName('Nestlé'), 'nestle');
  assert.equal(normalizeName('Amazon.com'), 'amazon');
  assert.equal(normalizeName('H&M'), 'h and m');
  assert.equal(normalizeName('The Company'), 'company'); // never reduced to empty
  assert.equal(normalizeName("Applebee's"), 'applebees');
});

test('editDistance with early exit', () => {
  assert.equal(editDistance('walgreen', 'walgreens', 2), 1);
  assert.equal(editDistance('acme', 'amce', 2), 1); // transposition
  assert.equal(editDistance('apple', 'applebees', 2), 3); // capped at max+1
});

test('candidateReason is conservative: apple vs applebees is never a candidate', () => {
  assert.equal(candidateReason('apple', 'applebees'), null);
  assert.equal(candidateReason('apple', 'apple bank'), null); // "bank" is distinctive, not generic
  assert.equal(candidateReason('t mobile', 'tmobile'), 'same_letters_different_spacing');
  assert.equal(candidateReason('walgreen', 'walgreens'), 'near_identical_spelling');
  assert.equal(candidateReason('target', 'target stores'), 'differs_by_generic_word');
  assert.equal(candidateReason('meta', 'beta'), null); // short keys never fuzzy-match
  assert.equal(candidateReason('district 9 pizza', 'district 8 pizza'), null); // digits differ → different entity
});

const rows = [
  { name: 'macys', report_count: 8433, first_party_report_count: 0, industry: 'Retail' },
  { name: "macy's", report_count: 8433, first_party_report_count: 0, industry: 'retail' },
  { name: 'apple', report_count: 120, first_party_report_count: 40, industry: 'Technology' },
  { name: "applebee's", report_count: 30, first_party_report_count: 12, industry: 'Restaurants' },
  { name: 'walgreens', report_count: 90, first_party_report_count: 20, industry: 'Retail' },
  { name: 'walgreen', report_count: 2, first_party_report_count: 1, industry: 'Retail' },
  { name: 'Walgreens', source: 'companies' },
];

test('clusterNames: macys/macy\'s is an exact cluster; apple and applebee\'s stay apart', () => {
  const { exact, ambiguous, tooLarge } = clusterNames(rows);
  const macys = exact.find((c) => c.key === 'macys');
  assert.deepEqual(macys.members.map((m) => m.name).sort(), ["macy's", 'macys']);
  assert.ok(!exact.some((c) => c.members.some((m) => /apple/.test(m.name))));
  assert.ok(!ambiguous.some((c) => c.members.some((m) => /apple/.test(m.name))));
  // walgreens (2 spellings in one key: scores + companies table) is exact; walgreen is an ambiguous neighbour.
  assert.ok(exact.some((c) => c.key === 'walgreens'));
  const wal = ambiguous.find((c) => c.keys.includes('walgreen'));
  assert.deepEqual(wal.keys.sort(), ['walgreen', 'walgreens']);
  assert.equal(wal.members.length, 2); // one representative per key
  assert.equal(tooLarge.length, 0);
});

test('pickCanonical: most real reports, then most reports, then the punctuated spelling', () => {
  assert.equal(pickCanonical(rows.slice(0, 2)).name, "macy's"); // tie on counts → keeps the apostrophe
  assert.equal(pickCanonical(rows.slice(4, 6)).name, 'walgreens');
});

test('makeProposal: high confidence, flags identical counts, merge plan by stored name', () => {
  const p = makeProposal(rows.slice(0, 2), { method: 'normalized_exact', confidence: 'high' });
  assert.equal(p.canonical, "macy's");
  assert.deepEqual(p.aliases, ['macys']);
  assert.equal(p.confidence, 'high');
  assert.ok(p.evidence.flags.includes('identical_report_count'));
  assert.ok(!p.evidence.flags.includes('industry_conflict')); // "Retail" vs "retail" is the same label
  assert.deepEqual(p.merge_plan, [{ primary: "macy's", secondary: 'macys' }]);
  const conflict = makeProposal([{ name: 'delta', industry: 'Airlines', report_count: 5 }, { name: 'delta inc', industry: 'Plumbing', report_count: 1 }], { method: 'normalized_exact', confidence: 'high' });
  assert.equal(conflict.confidence, 'medium'); // industry conflict downgrades
});

test('dedupe requests: Haiku 5.5, structured output, fenced names', () => {
  const { ambiguous } = clusterNames(rows);
  const reqs = buildDedupeRequests(ambiguous);
  assert.equal(MODEL, 'claude-haiku-5-5');
  for (const r of reqs) {
    assert.match(r.custom_id, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(r.params.model, 'claude-haiku-5-5');
    assert.deepEqual(r.params.output_config, { format: { type: 'json_schema', schema: VERDICT_SCHEMA }, effort: 'medium' });
    assert.equal(r.params.thinking, undefined);
    assert.match(r.params.messages[0].content, /«UNTRUSTED NAMES/);
  }
  assert.ok(!/minItems|maxItems|minLength|minimum/.test(JSON.stringify(VERDICT_SCHEMA)));
});

test('proposalsFromVerdict keeps only names from the cluster and never reuses a name', () => {
  const { ambiguous } = clusterNames(rows);
  const wal = ambiguous.find((c) => c.keys.includes('walgreen'));
  const ps = proposalsFromVerdict(wal, { groups: [
    { members: ['walgreens', 'walgreen', 'invented co'], confidence: 'high', reason: 'Spelling variant.' },
    { members: ['walgreen', 'walgreens'], confidence: 'high', reason: 'dup' },
  ] });
  assert.equal(ps.length, 1);
  assert.equal(ps[0].canonical, 'walgreens');
  assert.deepEqual(ps[0].aliases, ['walgreen']);
  assert.equal(ps[0].method, 'llm');
  assert.deepEqual(proposalsFromVerdict(wal, { groups: [] }), []);
});

test('aliasRowsFor: company_aliases shape, high only, lowercased, skips existing + scoreless canonicals', () => {
  const props = [
    makeProposal(rows.slice(0, 2), { method: 'normalized_exact', confidence: 'high' }),
    { canonical: 'walgreens', canonical_has_score: true, aliases: ['walgreen'], confidence: 'medium' },
    { canonical: 'Acme', canonical_has_score: true, aliases: ['ACME INC', 'acme'], confidence: 'high' },
    { canonical: 'ghost co', canonical_has_score: false, aliases: ['ghost company'], confidence: 'high' },
    { canonical: 'Other', canonical_has_score: true, aliases: ['aws'], confidence: 'high' },
  ];
  const out = aliasRowsFor(props, new Set(['aws']));
  assert.deepEqual(out, [
    { canonical: "macy's", alias: 'macys', source: ALIAS_SOURCE },
    { canonical: 'acme', alias: 'acme inc', source: ALIAS_SOURCE },
  ]);
  // Columns match migration 006 (id/created_at are defaulted by the DB).
  for (const r of out) assert.deepEqual(Object.keys(r).sort(), ['alias', 'canonical', 'source']);
  assert.throws(() => aliasRowsFor(props, new Set(), { minConfidence: 'medium' }));
});
