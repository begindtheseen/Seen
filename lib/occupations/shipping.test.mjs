// Shipping guard: every Vercel function (api/*.js) that reaches, through its import graph, a module that reads
// lib/occupations/data or lib/text/data at runtime must carry BOTH globs in its vercel.json `includeFiles`
// (one glob string per function; several are combined as "{a,b,c}"). The repo has shipped functions that crashed
// in production because a data file was not bundled — this test fails before that can happen again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// module (repo-relative) → the data globs it reads at runtime
const DATA_READERS = {
  'lib/occupations/index.js': ['lib/occupations/data/**'],
  'lib/occupations/activities.js': ['lib/occupations/data/**'],
  'lib/text/synonyms.js': ['lib/text/data/**'],
  'lib/text/workFamilies.js': ['lib/text/data/**'],
  'lib/text/tradeTalk.js': ['lib/text/data/**'],
  'lib/optimizer/judge2/idf.js': ['lib/optimizer/judge2/data/**'],
};

/** @param {string} file absolute */
function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1] || m[2] || m[3] || m[4];
    if (!spec || !spec.startsWith('.')) continue;
    const base = resolve(dirname(file), spec);
    const cand = [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, join(base, 'index.js')].find((p) => existsSync(p) && statSync(p).isFile());
    if (cand) out.push(cand);
  }
  return out;
}

/** @param {string} entry absolute @returns {Set<string>} repo-relative files reachable */
function reach(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = /** @type {string} */ (stack.pop());
    if (seen.has(f)) continue;
    seen.add(f);
    for (const g of importsOf(f)) if (!seen.has(g)) stack.push(g);
  }
  return new Set([...seen].map((f) => relative(ROOT, f)));
}

/** @param {string} includeFiles @param {string} glob */
function covers(includeFiles, glob) {
  const parts = includeFiles.startsWith('{') && includeFiles.endsWith('}') ? includeFiles.slice(1, -1).split(',') : [includeFiles];
  return parts.map((x) => x.trim()).includes(glob);
}

test('vercel.json parses and every includeFiles is one glob string', () => {
  const v = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  for (const [fn, cfg] of Object.entries(v.functions || {})) {
    if (cfg.includeFiles !== undefined) assert.equal(typeof cfg.includeFiles, 'string', `${fn} includeFiles must be one string`);
  }
});

test('every function that reaches occupation / word data bundles both data folders', () => {
  const v = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const fns = v.functions || {};
  const missing = [];
  for (const f of readdirSync(join(ROOT, 'api')).filter((x) => /\.(m?js|ts)$/.test(x) && !/\.test\./.test(x))) {
    const files = reach(join(ROOT, 'api', f));
    const needed = new Set(Object.entries(DATA_READERS).filter(([m]) => files.has(m)).flatMap(([, g]) => g));
    if (!needed.size) continue;
    // occupations reads the work thesaurus too: one reader means both folders
    needed.add('lib/occupations/data/**');
    needed.add('lib/text/data/**');
    const inc = fns[`api/${f}`]?.includeFiles || '';
    for (const g of needed) if (!covers(inc, g)) missing.push(`api/${f} reaches ${[...files].filter((x) => DATA_READERS[x]).join(', ')} but includeFiles "${inc}" lacks ${g}`);
  }
  assert.deepEqual(missing, []);
});

test('the guard itself works: a function importing lib/occupations would need both globs', () => {
  assert.ok(covers('{lib/geo/data/**,lib/occupations/data/**,lib/text/data/**}', 'lib/text/data/**'));
  assert.ok(!covers('lib/geo/data/**', 'lib/occupations/data/**'));
  assert.ok(reach(join(ROOT, 'lib', 'occupations', 'index.js')).has('lib/text/workFamilies.js'));
});
