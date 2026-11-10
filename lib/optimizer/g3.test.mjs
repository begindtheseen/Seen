// G3 (2026-11-10): no false "shown" from the years gate, sentence counts that add up to the count on screen, statements
// said as phrases, and one generic shared word never shows a duty. Invariants over every fixture résumé × a corpus
// sample of 27 postings (594 pairs). Run: node --test lib/optimizer/g3.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer } from './index.js';
import { tokenize } from './lemma.js';
import { displayedRequirementCount } from './statements.js';
import { experienceProfile } from '../resume/years.js';
import { roleField } from './fieldMatch.js';
import { loadPostings, resumeText } from '../fixtures/calibration/load.mjs';

const NOW = '2026-11-10';
const P = loadPostings();
const run = (who, job) => runOptimizer({ resumeText: resumeText(who), jobTitle: job.title, company: job.company, jobDescription: job.description, now: NOW });

test('G3 item 1: a retail lead never "shows 3+ years of infrastructure management or backend software development"', () => {
  const o = run('maria', P[140]);
  const y = o.constraints.find((c) => c.kind === 'years');
  assert.notEqual(y.grade, 'met');
  assert.doesNotMatch(y.message, /\b(?:in|of|with)\s*\(|experience in\b/);
  assert.match(y.message, /3\+ years in infrastructure management or backend software development;/);
  const st = o.statements.find((s) => /infrastructure management/.test(s.text));
  if (st) assert.notEqual(st.status, 'shown');
});

test('G3 items 2–3: the sentence\'s numbers add up to the count on screen; statements are said as phrases', () => {
  const o = run('maria', P[12]);
  const n = displayedRequirementCount(o.statements);
  assert.equal(o.requirement_count, n);
  assert.match(o.verdict.sentence, new RegExp(`of the ${n} things they list, your résumé shows`));
  assert.doesNotMatch(o.verdict.sentence, /what's missing[^;]*\bdemonstrate, load\b/);
  assert.match(o.verdict.sentence, /demonstrating, loading and unloading equipment/);
});

test('G3 item 4: one shared skills-list word ("inventory") never shows "Maintain equipment inventory systems…"', () => {
  const o = run('maria', P[12]);
  const s = o.statements.find((x) => /inventory systems/i.test(x.text));
  assert.ok(s && s.status !== 'shown', JSON.stringify(s));
});

// ── invariants over every fixture résumé × 27 corpus postings ────────────────────────────────────────────────
const corpus = (() => { try { return JSON.parse(fs.readFileSync(new URL('../fixtures/calibration/postings.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const people = ['personas', 'calibration'].flatMap((d) => fs.readdirSync(new URL(`../fixtures/${d}/`, import.meta.url)).filter((f) => f.endsWith('.txt') && !/-jd\.txt$/.test(f)).map((f) => f.replace('.txt', '')));
const ids = Object.keys(corpus).filter((_, k) => k % 4 === 0).slice(0, 27);
const stemsOf = (t) => new Set(tokenize(String(t || '')).map((x) => x.stem));

test(`G3 invariant: ${people.length} résumés × ${ids.length} postings — no years row of the posting's own field is met for a known-different field, and every met subject row lists a role that names the subject`, () => {
  assert.ok(people.length * ids.length >= 400, String(people.length * ids.length));
  for (const who of people) {
    const text = resumeText(who);
    const roles = experienceProfile(text, { now: new Date(NOW), fieldOf: roleField }).roles;
    for (const id of ids) {
      const o = run(who, corpus[id]);
      const f = o.field_match;
      for (const c of o.constraints.filter((x) => x.kind === 'years' && x.grade === 'met' && x.scope && x.scope !== 'generic' && x.scope !== 'management')) {
        if (f.known && f.level === 'different') assert.notEqual(c.reqField, f.postingFieldKey, `${who} × ${corpus[id].title}: ${c.message}`);
        const listed = (c.counted || []).map((r) => roles.find((x) => x.title === r.title)).filter(Boolean);
        assert.ok(listed.length, `${who} × ${corpus[id].title}: met with no role listed — ${c.message}`);
        const ok = listed.some((r) => (c.reqField && r.field === c.reqField) || (c.subjectStems || []).some((st) => stemsOf([r.title, r.header, ...r.bullets].join(' ')).has(st)));
        assert.ok(ok, `${who} × ${corpus[id].title}: no listed role names the subject — ${c.message}`);
      }
    }
  }
});
