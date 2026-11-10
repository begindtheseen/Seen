// Nothing the browser bundles may reach a module that needs Node.
//
// 2026-11-10: the knowledge-base modules (lib/occupations, lib/text/workFamilies, lib/text/synonyms) read their data with
// node:fs. They were wired into the statement judge, and two screens imported ONE helper from explainScore.js — which
// imports the whole engine — so `next build` failed with "UnhandledSchemeError: node:fs" on every page that opens the
// Optimize sheet. No test saw it, because `node --test` and `tsc` are happy with node:fs anywhere.
// This test walks the static and dynamic imports of every "use client" file and fails on the first Node-only module
// it can reach, printing the import chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXT = ['.tsx', '.ts', '.js', '.jsx', '.mjs'];
const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'scripts', 'supabase', 'public', 'security']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT.includes(path.extname(name)) && !/\.test\.[a-z]+$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const cache = new Map();
const read = (f) => { if (!cache.has(f)) cache.set(f, readFileSync(f, 'utf8')); return cache.get(f); };
const isClient = (src) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src);
// import … from 'x' | import 'x' | export … from 'x' | import('x') — type-only imports are erased and do not count
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const NODE_ONLY_RE = /(?:from\s+|require\(\s*|import\(\s*)['"](?:node:[a-z_/]+|fs|fs\/promises|path|crypto|child_process|worker_threads|zlib|os|net|tls|dns|stream)['"]/;

function resolve(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null; // a package: the bundler's business, not this test's
  const tries = [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, 'index' + e))];
  // "./x.js" written for a file that is really x.ts / x.tsx
  if (/\.js$/.test(base)) tries.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
  for (const t of tries) if (existsSync(t) && statSync(t).isFile()) return t;
  return null;
}

function importsOf(file) {
  const out = [];
  const src = read(file);
  for (const m of src.matchAll(IMPORT_RE)) {
    const r = resolve(file, m[1] || m[2]);
    if (r && EXT.includes(path.extname(r))) out.push(r);
  }
  return out;
}

test('no "use client" file can reach a module that imports node:fs or another Node-only module', () => {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'lib'))];
  const clients = files.filter((f) => isClient(read(f)));
  assert.ok(clients.length > 20, `found only ${clients.length} client files — the detector is broken`);
  const seen = new Map(); // file → the file that imported it
  const queue = [];
  for (const c of clients) { seen.set(c, null); queue.push(c); }
  const bad = [];
  while (queue.length) {
    const f = queue.shift();
    if (NODE_ONLY_RE.test(read(f))) {
      const chain = []; for (let x = f; x; x = seen.get(x)) chain.unshift(path.relative(ROOT, x));
      bad.push(chain.join(' → '));
      continue;
    }
    for (const dep of importsOf(f)) if (!seen.has(dep)) { seen.set(dep, f); queue.push(dep); }
  }
  assert.deepEqual(bad, [], `the browser bundle reaches Node-only code:\n  ${bad.join('\n  ')}`);
});

test('the display-spelling helper the screens use imports nothing but vocabulary', () => {
  const f = path.join(ROOT, 'lib/optimizer/displaySkill.js');
  const deps = importsOf(f).map((d) => path.relative(ROOT, d));
  assert.deepEqual(deps, ['lib/optimizer/professionalVocabulary.js']);
});
