// Tests for the graph-view builder. Run: node --test lib/server/memoryGraphView.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphView } from './memoryGraphView.js';

const index = {
  entities: [
    { path: 'knowledge/seen.md', title: 'Seen', aliases: ['SeenJobs'], tags: ['product'] },
    { path: 'knowledge/deployment.md', title: 'Deployment', aliases: [], tags: ['deploy'] },
    { path: 'people/brandon.md', title: 'Brandon', aliases: ['owner'], tags: ['person'] },
    { path: 'timeline/2026-07-06.md', title: '2026-07-06', aliases: [], tags: ['timeline'] },
  ],
  edges: [
    { from: 'timeline/2026-07-06.md', to: 'deployment' },   // resolves by basename
    { from: 'knowledge/seen.md', to: 'Deployment' },        // resolves by title
    { from: 'knowledge/seen.md', to: 'nonexistent' },       // dropped
  ],
  facts: [
    { note: 'knowledge/deployment.md', id: 'prod-branch', subject: 'Seen', predicate: 'deploys_from', object: 'next-migration', valid_from: '2026-06-30', valid_to: null, confidence: 'high' },
    { note: 'people/brandon.md', id: 'role', subject: 'Brandon', predicate: 'role', object: 'owner', valid_from: '2026-05-01', valid_to: null },
    { note: 'knowledge/x.md', id: 'orphan', subject: 'Some SKU', predicate: 'price', object: '79', valid_from: '2026-07-05', valid_to: null },
  ],
  episodes: [{ id: 'timeline/2026-07-06.md', date: '2026-07-06' }],
};

test('buildGraphView: note nodes + resolved structural links', () => {
  const g = buildGraphView(index, { today: '2026-07-07' });
  const linkEdges = g.links.filter((l) => l.kind === 'link');
  assert.equal(linkEdges.length, 2); // two resolve, "nonexistent" dropped
  assert.ok(linkEdges.some((l) => l.source === 'knowledge/seen.md' && l.target === 'knowledge/deployment.md'));
});

test('buildGraphView: fact edges carry validity + create value nodes', () => {
  const g = buildGraphView(index, { today: '2026-07-07' });
  const factEdges = g.links.filter((l) => l.kind === 'fact');
  assert.equal(factEdges.length, 3);
  const pb = factEdges.find((l) => l.factId === 'prod-branch');
  assert.equal(pb.source, 'knowledge/seen.md'); // subject "Seen" resolves to the note
  assert.equal(pb.valid_from, '2026-06-30');
  assert.ok(g.nodes.some((n) => n.id === pb.target && n.type === 'value'));
});

test('buildGraphView: unresolved subject becomes an entity node', () => {
  const g = buildGraphView(index, { today: '2026-07-07' });
  assert.ok(g.nodes.some((n) => n.type === 'entity' && n.label === 'Some SKU'));
});

test('buildGraphView: dateRange spans earliest fact/episode to today', () => {
  const g = buildGraphView(index, { today: '2026-07-07' });
  assert.equal(g.dateRange.from, '2026-05-01'); // earliest valid_from
  assert.equal(g.dateRange.to, '2026-07-07');
  assert.equal(g.counts.notes, 4);
  assert.equal(g.counts.facts, 3);
});
