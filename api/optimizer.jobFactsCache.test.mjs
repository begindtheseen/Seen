// The job_facts cache keeps posting terms working: a term row is marked in storage only, and reading it back
// gives the same identity (the term's own words) and matching data — never "term:…" in a fact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getCachedJobFacts, cacheJobFacts } from './optimizer.js';
import { extractJobFacts } from '../lib/optimizer/extractJobFacts.js';
import { runOptimizer } from '../lib/optimizer/index.js';

const P = JSON.parse(fs.readFileSync(new URL('../lib/fixtures/personas/postings-sample.json', import.meta.url), 'utf8'));
const RESUME = fs.readFileSync(new URL('../lib/fixtures/personas/rn-home-health.txt', import.meta.url), 'utf8');

function fakeDb() {
  let rows = [];
  return async (path, opts = {}) => {
    if (opts.method === 'DELETE') { rows = []; return { ok: true }; }
    if (opts.method === 'POST') { rows = JSON.parse(opts.body); return { ok: true }; }
    return { ok: true, json: async () => rows, rows: () => rows };
  };
}

test('cached posting terms read back as the same requirement, and score the same', async () => {
  const p = P.find((x) => /BAYADA/.test(x.company));
  const facts = extractJobFacts(p.description, { jobTitle: p.title, company: p.company });
  const db = fakeDb();
  await cacheJobFacts(db, 'job-1', facts);
  const back = await getCachedJobFacts(db, 'job-1');
  const terms = facts.filter((f) => f.term);
  assert.ok(terms.length >= 3);
  for (const t of terms) {
    const b = back.find((x) => x.normalizedLabel === t.normalizedLabel);
    assert.ok(b, `${t.label} read back`);
    assert.ok(b.term && b.term.stems.length, `${t.label} is still a term`);
    assert.ok(!/term:/.test(b.normalizedLabel));
  }
  const fit = runOptimizer({ resumeText: RESUME, jobTitle: p.title, company: p.company, jobDescription: p.description, jobFacts: back });
  assert.ok(fit.matched_requirements.some((m) => m.term && m.requirement === 'chf' && /CHF patients/.test(m.evidence)));
});
