// Round 12d — ONE READING: the job keys take their roles from THE role reader the fit check uses
// (lib/optimizer/extractResumeFacts.js rolesFromText, with its one date reader). Differential over every résumé fixture:
// keys.roles are exactly the fit reader's roles — same count, same titles in the same order, same current flag.
// (The scratchpad working sets — DEV, fresh-1, old hidden — were checked with the same comparison: 0 differences.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJobKeys } from './jobKeys.js';
import { rolesFromText } from '../optimizer/extractResumeFacts.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.txt')) files.push(p); } };
walk(ROOT);

test('one reading: keys.roles ≡ the fit reader\'s roles on every résumé fixture (count, titles, order, current)', () => {
  assert.ok(files.length >= 30, `fixtures found: ${files.length}`);
  const diffs = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const a = rolesFromText(text, { now: NOW }).map((r) => [r.title, !!r.current]);
    const b = buildJobKeys({ resumeText: text, now: NOW }).roles.map((r) => [r.title, !!r.current]);
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${path.relative(ROOT, f)}\n  reader ${JSON.stringify(a)}\n  keys   ${JSON.stringify(b)}`);
  }
  assert.deepEqual(diffs, []);
});

test('one reading: the class that dropped a current role — "Employer — Title", dates on the next line, bullets', () => {
  const resume = 'Mae Lund\nOmaha, NE\nEXPERIENCE\nNebraska Medicine — Surgical Technologist II\nApr 2023 – Present\n- Scrub for orthopedic and spine cases\nNebraska Medicine — Surgical Technologist I\nJun 2020 – Mar 2023\n- Set up sterile fields and instrument trays\nCHI Health — Sterile Processing Technician\n2018 – 2020\n- Decontaminated and assembled instrument sets';
  const k = buildJobKeys({ resumeText: resume, now: NOW });
  assert.deepEqual(k.roles.map((r) => [r.title, r.company, r.current]), [
    ['Surgical Technologist II', 'Nebraska Medicine', true],
    ['Surgical Technologist I', 'Nebraska Medicine', false],
    ['Sterile Processing Technician', 'CHI Health', false],
  ]);
});
