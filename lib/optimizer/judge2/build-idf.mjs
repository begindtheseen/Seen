#!/usr/bin/env node
// Builds lib/optimizer/judge2/data/idf.json: how SPECIFIC each word stem is, from document frequencies over real job
// postings. Word statistics only — no labels, no model. Deterministic: the same corpus files give the same bytes.
//   node lib/optimizer/judge2/build-idf.mjs <postings.json> [<postings.json> …]
// Each input is a JSON array of postings with a `description` (and `title`). A stem's specificity is
//   spec = ln((N + 1) / (df + 1)) / ln(N + 1)          (0 = in every posting, 1 = in none)
// rounded to 2 decimals. Stems in fewer than 3 postings are left out: the judge reads a missing stem as rare (specific).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { words, stem } from '../../text/morph.js';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node build-idf.mjs <postings.json> …'); process.exit(2); }
const df = new Map();
let N = 0;
for (const f of files) {
  for (const p of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    const text = `${p.title || ''}\n${p.description || ''}`;
    if (text.trim().length < 200) continue;
    N++;
    for (const s of new Set(words(text).map(stem).filter((x) => x.length >= 2))) df.set(s, (df.get(s) || 0) + 1);
  }
}
const out = {};
for (const [s, n] of [...df.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (n >= 3) out[s] = Math.round((100 * Math.log((N + 1) / (n + 1))) / Math.log(N + 1)) / 100;
const here = path.dirname(fileURLToPath(import.meta.url));
const doc = { about: `Word-stem specificity from document frequencies over ${N} job postings (stems in 3+ postings). Built by lib/optimizer/judge2/build-idf.mjs.`, n: N, s: out };
fs.writeFileSync(path.join(here, 'data', 'idf.json'), JSON.stringify(doc) + '\n');
console.log(`postings ${N}, stems ${Object.keys(out).length}`);
