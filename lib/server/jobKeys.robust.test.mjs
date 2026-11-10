// Round 11: no single listing may remove a person's rail or email. (1) a listing whose judgement throws is skipped
// and counted; (2) a fuzz pass: every résumé fixture × 200 corpus-style listings through matchListing, no exception.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJobKeys, matchListing } from './jobKeys.js';
import { judgeEach } from './resumeMatches.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'fixtures');
const NOW = new Date('2026-11-10T12:00:00Z');

test('a listing that makes a helper throw is skipped and counted; the other listings still judge', () => {
  const keys = buildJobKeys({ resumeText: fs.readFileSync(path.join(FIX, 'matching', 'cashier.txt'), 'utf8'), now: NOW });
  const boom = { id: 'x', get title() { throw new Error('helper threw'); }, description: 'x' };
  const fine = { id: 'y', title: 'Cashier', company: 'Safeway', location: 'Phoenix, AZ', description: `${'Run the register and help guests at the front end. '.repeat(16)}\nRequirements\n• No experience required.` };
  const r = judgeEach([boom, fine], (j) => matchListing(j, keys, { now: NOW }));
  assert.equal(r.skippedError, 1);
  assert.equal(r.out.length, 1);
});

// The corpus file is in the director's scratchpad on this machine; the fixtures' own postings sample is the fallback.
const CORPUS_PATH = process.env.SEEN_MATCH_CORPUS || '/tmp/claude-0/-home-user-Seen/b30eccfc-31e3-5e58-94c8-e02565dad614/scratchpad/corpus/all.json';
const corpus = (fs.existsSync(CORPUS_PATH) ? JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8')) : JSON.parse(fs.readFileSync(path.join(FIX, 'personas', 'postings-sample.json'), 'utf8')).map((p) => ({ title: p.title || p.jobTitle || '', company: p.company || '', description: p.description || p.text || p.jd || '' })))
  .filter((_, i) => i % 3 === 0).slice(0, 200);
const resumes = [];
for (const dir of ['matching', 'personas']) for (const f of fs.readdirSync(path.join(FIX, dir))) if (f.endsWith('.txt') && !/-jd\.txt$/.test(f)) resumes.push([`${dir}/${f}`, fs.readFileSync(path.join(FIX, dir, f), 'utf8')]);

test(`fuzz: ${resumes.length} résumé fixtures × ${corpus.length} listings through matchListing (rail and email) without an exception`, () => {
  let calls = 0;
  for (const [name, text] of resumes) {
    const keys = buildJobKeys({ resumeText: text, now: NOW });
    for (const j of corpus) for (const mode of ['rail', 'email']) {
      try { matchListing(j, keys, { now: NOW, mode }); calls++; } catch (e) { assert.fail(`${name} × "${j.title}" (${mode}): ${e.message}`); }
    }
  }
  assert.ok(calls > 0);
});
