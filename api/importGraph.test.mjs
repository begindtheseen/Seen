// Import-graph guard — the regression test for the class of bug that took down the résumé
// optimizer in production (a serverless .js importing a .ts, which Vercel's Node runtime can't
// load → the function 500s at MODULE LOAD, before any handler runs, so nothing is logged and
// api_errors stays empty — an invisible outage).
//
// This test makes that whole class LOUD and pre-deploy:
//   (a) every production .js/.mjs module is imported; a load-time throw fails the build.
//   (b) no production .js/.mjs may statically import a '.ts' file.
//
// Run: node --test api/importGraph.test.mjs  (also part of the default `npm test`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Directories whose .js modules run in the serverless / server runtime and must load cleanly.
const RUNTIME_DIRS = ['api', 'api/_utils', 'lib/server', 'lib/optimizer', 'lib/humanizer'];

function jsFiles(relDir) {
  const abs = join(ROOT, relDir);
  let names = [];
  try { names = readdirSync(abs); } catch { return []; }
  return names
    .filter(n => n.endsWith('.js') && !n.endsWith('.test.js'))
    .map(n => join(abs, n))
    .filter(p => { try { return statSync(p).isFile(); } catch { return false; } });
}

// Benign env so a module that constructs a client at top level loads instead of throwing on
// missing config — this test is about LOAD-ability, not runtime configuration.
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

test('every production server module imports without throwing at load', async () => {
  const failures = [];
  for (const dir of RUNTIME_DIRS) {
    for (const file of jsFiles(dir)) {
      try {
        await import(pathToFileURL(file).href);
      } catch (e) {
        failures.push(`${relative(ROOT, file)} → ${e.message}`);
      }
    }
  }
  assert.equal(failures.length, 0, `module(s) fail to load (a Vercel serverless 500 at cold start):\n  ${failures.join('\n  ')}`);
});

test('no production .js/.mjs statically imports a .ts file (Vercel serverless cannot load .ts)', () => {
  const offenders = [];
  const scan = (relDir, recurse) => {
    const abs = join(ROOT, relDir);
    let names = [];
    try { names = readdirSync(abs); } catch { return; }
    for (const n of names) {
      const p = join(abs, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (recurse && n !== 'node_modules' && !n.startsWith('.')) scan(join(relDir, n), recurse);
        continue;
      }
      if (!/\.(js|mjs)$/.test(n)) continue;
      if (/\.test\.(js|mjs)$/.test(n)) continue; // test files may reference .ts in strings/imports
      const src = readFileSync(p, 'utf8');
      // import ... from '….ts'  |  require('….ts')  |  import('….ts')
      if (/from\s+['"][^'"]+\.ts['"]|require\(\s*['"][^'"]+\.ts['"]\s*\)|import\(\s*['"][^'"]+\.ts['"]\s*\)/.test(src)) {
        offenders.push(relative(ROOT, p));
      }
    }
  };
  scan('api', true);
  scan('lib', true);
  assert.equal(offenders.length, 0, `production .js/.mjs must not import .ts (crashes on Vercel):\n  ${offenders.join('\n  ')}`);
});
