// Tests for Chronos, the bi-temporal fact engine. The point-in-time and supersede tests are
// the load-bearing ones — they prove the vault can answer "what was true on date X".
// Run: node --test lib/server/memoryGraph.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYamlSubset, parseFrontmatter, extractWikiLinks, normalizeFacts,
  parseTimelineEpisode, buildIndex, factTrueAsOf, searchFacts, whatsChanged,
  findContradictions, getTimeline, getEntity,
} from './memoryGraph.js';

test('parseYamlSubset: scalars, inline arrays, null', () => {
  const y = parseYamlSubset(`title: Deployment\ntags: [deploy, meta]\nupdated: 2026-07-06\nsessions: 3\nempty:`);
  assert.equal(y.title, 'Deployment');
  assert.deepEqual(y.tags, ['deploy', 'meta']);
  assert.equal(y.updated, '2026-07-06');
  assert.equal(y.sessions, 3);
  assert.equal(y.empty, null);
});

test('parseYamlSubset: block sequence of mappings (facts)', () => {
  const y = parseYamlSubset([
    'title: Seen',
    'facts:',
    '  - id: seen-prod-branch',
    '    subject: Seen',
    '    predicate: deploys_from',
    '    object: next-migration',
    '    valid_from: 2026-06-30',
    '    valid_to: null',
    '    confidence: high',
    '  - id: seen-stack',
    '    subject: Seen',
    '    predicate: framework',
    '    object: Next.js 15',
    '    valid_from: 2026-06-01',
  ].join('\n'));
  assert.equal(y.title, 'Seen');
  assert.equal(y.facts.length, 2);
  assert.equal(y.facts[0].id, 'seen-prod-branch');
  assert.equal(y.facts[0].object, 'next-migration');
  assert.equal(y.facts[0].valid_to, null);
  assert.equal(y.facts[1].predicate, 'framework');
});

test('parseYamlSubset: quoted value with wiki-link + comment stripping', () => {
  const y = parseYamlSubset(`source: "[[deployment]]"\nobject: next-migration  # the prod branch`);
  assert.equal(y.source, '[[deployment]]');
  assert.equal(y.object, 'next-migration');
});

test('parseFrontmatter splits data and body', () => {
  const { data, body } = parseFrontmatter(`---\ntitle: X\n---\n# Heading\ntext`);
  assert.equal(data.title, 'X');
  assert.match(body, /# Heading/);
});

test('extractWikiLinks: aliases and anchors', () => {
  const links = extractWikiLinks('See [[deployment]] and [[operation-50|Operation 50%]] and [[#Timeline|t]] and [[timeline/2026-07-06#Next|x]]');
  assert.deepEqual(links, ['deployment', 'operation-50', 'timeline/2026-07-06']);
});

test('normalizeFacts: defaults + missing-field errors', () => {
  const { facts, errors } = normalizeFacts({
    facts: [
      { id: 'ok', subject: 'A', predicate: 'is', object: 'B', valid_from: '2026-01-01' },
      { id: 'bad', subject: 'A', predicate: 'is', valid_from: '2026-01-01' }, // missing object
    ],
  }, 'knowledge/x.md');
  assert.equal(facts.length, 2);
  assert.equal(facts[0].confidence, 'medium'); // defaulted
  assert.equal(facts[0].note, 'knowledge/x.md');
  assert.ok(errors.some((e) => e.includes('object')));
});

test('factTrueAsOf: half-open validity window', () => {
  const f = { valid_from: '2026-07-02', valid_to: null };
  assert.equal(factTrueAsOf(f, '2026-07-01'), false); // before it began
  assert.equal(factTrueAsOf(f, '2026-07-02'), true);
  assert.equal(factTrueAsOf(f, null), true); // "currently true" (open valid_to)
  const closed = { valid_from: '2026-06-01', valid_to: '2026-07-02' };
  assert.equal(factTrueAsOf(closed, '2026-07-01'), true);
  assert.equal(factTrueAsOf(closed, '2026-07-02'), false); // half-open: end is exclusive
  assert.equal(factTrueAsOf(closed, null), false); // not currently true
});

// The headline capability: point-in-time recall of a superseded fact.
const CREDIT_FACTS = [
  { id: 'free-credits-3', subject: 'Seen free tier', predicate: 'daily_ai_credits', object: '3',
    valid_from: '2026-06-01', valid_to: '2026-07-02', confidence: 'high', recorded: '2026-06-01',
    invalidated: '2026-07-02' },
  { id: 'free-credits-1', subject: 'Seen free tier', predicate: 'daily_ai_credits', object: '1',
    valid_from: '2026-07-02', valid_to: null, confidence: 'high', recorded: '2026-07-02' },
];

test('point-in-time: free-tier credit policy before vs after the supersede', () => {
  const before = searchFacts(CREDIT_FACTS, { subject: 'Seen free tier', asOf: '2026-07-01' });
  assert.equal(before.length, 1);
  assert.equal(before[0].object, '3'); // was 3/day

  const now = searchFacts(CREDIT_FACTS, { subject: 'Seen free tier', asOf: '2026-12-01' });
  assert.equal(now.length, 1);
  assert.equal(now[0].object, '1'); // is 1/day

  const current = searchFacts(CREDIT_FACTS, { subject: 'Seen free tier' }); // no asOf → current
  assert.equal(current.length, 1);
  assert.equal(current[0].object, '1');
});

test('searchFacts: query token match', () => {
  const r = searchFacts(CREDIT_FACTS, { query: 'daily credits' });
  assert.ok(r.length >= 1);
});

test('whatsChanged: transaction-time delta', () => {
  const { added, invalidated } = whatsChanged(CREDIT_FACTS, '2026-07-02');
  assert.ok(added.some((f) => f.id === 'free-credits-1'));
  assert.ok(invalidated.some((f) => f.id === 'free-credits-3'));
  assert.equal(added.some((f) => f.id === 'free-credits-3'), false); // recorded before `since`
});

test('findContradictions: closed supersede is clean; open overlap flags', () => {
  assert.equal(findContradictions(CREDIT_FACTS).length, 0); // properly closed → no conflict

  const dirty = [
    { subject: 'Seen', predicate: 'deploys_from', object: 'next-migration', valid_from: '2026-06-30', valid_to: null },
    { subject: 'Seen', predicate: 'deploys_from', object: 'main', valid_from: '2026-01-01', valid_to: null },
  ];
  const conflicts = findContradictions(dirty);
  assert.equal(conflicts.length, 1); // two open windows, different object → flagged
});

test('parseTimelineEpisode + buildIndex + getTimeline/getEntity end to end', () => {
  const notes = [
    { path: 'knowledge/deployment.md', text: `---\ntitle: Deployment\ntags: [deploy]\nupdated: 2026-07-06\nfacts:\n  - id: prod-branch\n    subject: Seen\n    predicate: deploys_from\n    object: next-migration\n    valid_from: 2026-06-30\n    valid_to: null\n    confidence: high\n    recorded: 2026-07-06\n---\nMerging to next-migration deploys. See [[architecture]].` },
    { path: 'timeline/2026-07-06.md', text: `---\ntitle: 2026-07-06\ndate: 2026-07-06\ntype: daily\ntags: [timeline]\nsessions: 1\n---\n## Shipped\n- Built the temporal layer. [[deployment]]\n## Next\n- Confirm PR #163.` },
    { path: 'knowledge/architecture.md', text: `---\ntitle: Architecture\n---\nStack notes.` },
  ];
  const index = buildIndex(notes);
  assert.equal(index.errors.length, 0);
  assert.equal(index.facts.length, 1);
  assert.equal(index.episodes.length, 1);
  assert.equal(index.episodes[0].date, '2026-07-06');
  assert.ok(index.episodes[0].sections['Shipped'].includes('temporal layer'));

  const tl = getTimeline(index.episodes, { from: '2026-07-01' });
  assert.equal(tl.length, 1);

  const ent = getEntity(index, 'deployment');
  assert.ok(ent);
  assert.equal(ent.facts.length, 1);
  assert.ok(ent.links.includes('architecture'));

  // Edge from timeline note points at deployment → deployment has a backlink.
  const dep = getEntity(index, 'deployment');
  assert.ok(dep.backlinks.includes('timeline/2026-07-06.md'));
});

test('directTimelineEpisode ignores non-daily notes', () => {
  assert.equal(parseTimelineEpisode({ title: 'x' }, 'body', 'p.md'), null);
});
