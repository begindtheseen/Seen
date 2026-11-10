// US spelling in every sentence a person reads (owner rule; X, 2026-11-10): no printed string in lib/ or components/
// says "licence". Regexes keep matching BOTH spellings in postings and résumés — only printed copy is checked: a string
// literal with a space in it ("a security guard licence", `The licence is the gate here`), outside comments and regexes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
// files whose owners are mid-round on this exact item (reported, not mine to edit): remove when they land
const PENDING = new Set(['lib/server/jobKeys.js', 'lib/server/resumeMatches.js', 'lib/server/jobMatchEmails.js',
  // reader data (a `source` note on an alias row, lib/optimizer is the reader/scoring engineers')
  'lib/optimizer/fieldAliases.js']);

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|fixtures/.test(e.name)) out.push(...files(rel)); continue; }
    if (/\.(?:m?js|tsx?)$/.test(e.name) && !/\.test\.|Harness/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Printed strings that say "licence": quoted literals with a space, comments and regex literals removed. */
export function printedLicence(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
    // a regex literal: a slash after an operator / bracket / start, to the next unescaped slash on the line
    .replace(/(^|[=(,:;!&|?{}\[\s])\/(?![/*])(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\n\\])+\/[gimsuy]*/g, '$1""');
  const hits = [];
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const s = m[2];
    // a word inside an identifier (isLicence) is code; a long bare word list (a stop list) is data, not a sentence
    const wordList = s.split(/\s+/).length >= 25 && !/[.,:;!?"“”]/.test(s);
    if (/(?<![A-Za-z])licenc/i.test(s) && /\s/.test(s) && !wordList && !/licen\[|licenc\(|\\b|\(\?:/.test(s)) hits.push(s.slice(0, 100));
  }
  return hits;
}

test('no printed string says "licence" (US spelling: "license")', () => {
  const bad = [];
  for (const f of [...files('lib'), ...files('components'), ...files('app')]) {
    if (PENDING.has(f)) continue;
    for (const h of printedLicence(fs.readFileSync(path.join(ROOT, f), 'utf8'))) bad.push(`${f}: ${h}`);
  }
  assert.deepEqual(bad, []);
});

test('the scanner sees printed copy and ignores regexes and comments', () => {
  assert.deepEqual(printedLicence("const t = `The licence is the gate here: ${q}`;"), ['The licence is the gate here: ${q}']);
  assert.deepEqual(printedLicence("const re = /\\b(?:licence|license)\\b/i; // a licence comment"), []);
  assert.deepEqual(printedLicence("if (k === 'licence') x();"), []);
});
