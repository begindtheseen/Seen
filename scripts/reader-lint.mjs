#!/usr/bin/env node
// Label-free reader lint (R8): run the reader over every posting in the given corpus files and count, per stratum, the
// displayed statements with a defect a person can see without a gold label (clipped, run-on, junk-shaped, duplicate, the
// same sentence under two importances). The steering number: defects per 100 displayed lines.
//   node scripts/reader-lint.mjs <corpus.json> [<corpus2.json> …] [--json] [--examples N]
import fs from 'node:fs';
import { extractJobFacts } from '../lib/optimizer/extractJobFacts.js';
import { lintReading, postingStratum } from '../lib/optimizer/readerLint.js';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const asJson = args.includes('--json');
const exN = Number(args[args.indexOf('--examples') + 1]) || 0;
if (!files.length) { console.error('usage: node scripts/reader-lint.mjs <corpus.json> [...] [--json] [--examples N]'); process.exit(2); }

const table = {};
const examples = {};
let postings = 0;
for (const f of files) {
  for (const p of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    if (!p || !p.description) continue;
    postings++;
    const st = postingStratum(p);
    const sts = extractJobFacts(p.description, { jobTitle: p.title, company: p.company }).statements || [];
    const { per, counts } = lintReading(sts);
    const row = (table[st] ||= { postings: 0, shown: 0, defective: 0, clipped: 0, run_on: 0, junk: 0, duplicate: 0, two_importances: 0 });
    row.postings++;
    for (const k of Object.keys(counts)) row[k] += counts[k];
    if (exN) for (const s of sts) if (per.has(s.id)) for (const k of per.get(s.id)) { (examples[k] ||= []); if (examples[k].length < exN) examples[k].push(`${p.title.slice(0, 30)} | ${s.text.slice(0, 120)}`); }
  }
}
const total = Object.values(table).reduce((a, r) => { for (const k of Object.keys(r)) a[k] = (a[k] || 0) + r[k]; return a; }, {});
table.ALL = total;
if (asJson) { console.log(JSON.stringify({ postings, table }, null, 1)); process.exit(0); }
const per100 = (r, k) => (r.shown ? (100 * r[k] / r.shown).toFixed(1) : '–');
console.log(`reader lint over ${postings} postings (defects per 100 displayed lines)`);
console.log('stratum            postings  shown  defective  clipped  run_on  junk  dup  two_imp');
for (const [k, r] of Object.entries(table)) console.log(`${k.padEnd(18)} ${String(r.postings).padStart(8)} ${String(r.shown).padStart(6)} ${per100(r, 'defective').padStart(10)} ${per100(r, 'clipped').padStart(8)} ${per100(r, 'run_on').padStart(7)} ${per100(r, 'junk').padStart(5)} ${per100(r, 'duplicate').padStart(4)} ${per100(r, 'two_importances').padStart(8)}`);
if (exN) for (const [k, xs] of Object.entries(examples)) { console.log(`\n== ${k}`); for (const x of xs) console.log('  ' + x); }
