// The merged judge through runOptimizer's seam: duties with no gate from judge2, everything else from the incumbent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOptimizer } from '../index.js';
import { statementVerdicts as merged } from './merged.js';
import { statementVerdicts as incumbent } from '../statements.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const persona = (f) => fs.readFileSync(path.join(ROOT, 'lib/fixtures/personas', f), 'utf8');
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/fixtures/personas/postings-sample.json'), 'utf8'));
const POSTINGS = (Array.isArray(SAMPLE) ? SAMPLE : Object.values(SAMPLE)).filter((p) => p && p.description).slice(0, 6);
const RESUMES = ['maria.txt', 'dev.txt', 'nurse.txt', 'warehouse.txt', 'accountant.txt'].map((f) => persona(f));

test('with the seam unset nothing changes', () => {
  const input = { resumeText: RESUMES[0], jobTitle: POSTINGS[0].title, company: POSTINGS[0].company, jobDescription: POSTINGS[0].description };
  assert.equal(JSON.stringify(runOptimizer(input)), JSON.stringify(runOptimizer(input, {})));
  assert.equal(JSON.stringify(runOptimizer(input)), JSON.stringify(runOptimizer(input, { statementJudge: undefined })));
});

test('merged invariants over persona × posting pairs', () => {
  let duties = 0; let replaced = 0;
  for (const resume of RESUMES) for (const p of POSTINGS) {
    const input = { resumeText: resume, jobTitle: p.title, company: p.company, jobDescription: p.description };
    // the incumbent's rows and the merged rows on the very same inputs
    let incRows = null; let mergedRows = null; let cons = null; let level = null;
    runOptimizer(input, { statementJudge: (st, m, c, f, o) => { incRows = incumbent(st, m, c, f, o); mergedRows = merged(st, m, c, f, o); cons = c; level = o.field && o.field.level; return mergedRows; } });
    assert.deepEqual(mergedRows.map((r) => r.id), incRows.map((r) => r.id), 'order and ids are the incumbent\'s');
    const gated = new Set(cons.map((c) => c.statementId));
    for (let i = 0; i < mergedRows.length; i++) {
      const m = mergedRows[i]; const r = incRows[i];
      if (m.kind !== 'duty' || gated.has(m.id)) { assert.deepEqual(m, r, `not a gate-free duty, so the incumbent's row: ${m.text}`); continue; }
      duties++;
      if (JSON.stringify(m) !== JSON.stringify(r)) replaced++;
      if (m.status === 'shown' || m.status === 'partly') assert.ok(m.evidence.some((e) => e.line && resume.includes(e.line.split(' ').slice(0, 3).join(' '))), `credit carries a résumé line: ${m.text}`);
      const words = new Set(m.text.toLowerCase().match(/[a-z0-9+#]+/g) || []);
      for (const x of m.missing) for (const w of String(x).toLowerCase().match(/[a-z0-9+#]+/g) || []) assert.ok(words.has(w), `"${x}" is whole words of "${m.text}"`);
      if (level === 'different') assert.ok(!m.candidate, `no closest-line question on a known different field: ${m.text}`);
    }
  }
  assert.ok(duties > 20 && replaced > 0, `duties ${duties}, replaced ${replaced}`);
});

