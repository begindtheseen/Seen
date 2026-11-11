// The fixed pair set for the cross-tool agreement test: 4 personas × the 8 sample postings, plus 20 public corpus
// postings across fields, each with a résumé from its field.
import fs from 'node:fs';
const P = new URL('../fixtures/personas/', import.meta.url);
const C = new URL('../fixtures/crosstool/corpus-pairs.json', import.meta.url);
const read = (name) => fs.readFileSync(new URL(`${name}.txt`, P), 'utf8');
const sample = JSON.parse(fs.readFileSync(new URL('postings-sample.json', P), 'utf8'));
const corpus = JSON.parse(fs.readFileSync(C, 'utf8'));
export const PAIRS = [
  ...['dev', 'maria', 'tasha', 'warehouse'].flatMap((who) => sample.map((p) => ({ id: `${who}×${p.id}`, resume: read(who), title: p.title, company: p.company, description: p.description }))),
  ...corpus.map((p) => ({ id: `${p.resume}×c${p.corpus_idx}`, resume: read(p.resume), title: p.title, company: p.company, description: p.description })),
];
