// The knowledge modules are isomorphic: with no Node built-ins (a browser bundle) they import cleanly and answer
// "no knowledge" values; under Node they load the data. No static `node:` import anywhere in lib/occupations or lib/text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('no shipped module in lib/occupations or lib/text imports a Node built-in or names a data file for the bundler', () => {
  for (const dir of ['lib/occupations', 'lib/text']) {
    for (const f of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.js'))) {
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      assert.ok(!/^\s*import[^;]*from\s*['"](node:|fs|path|url)['"]/m.test(src), `${dir}/${f} imports a Node built-in`);
      assert.ok(!/new URL\(\s*['"`]/.test(src.replace(/\/\/.*$/gm, '')), `${dir}/${f} names a file with new URL(literal)`);
    }
  }
});

test('without process.getBuiltinModule (a browser) every function degrades, never throws, never logs', () => {
  const code = `
    process.getBuiltinModule = undefined;
    const errors = []; console.error = (...a) => errors.push(a.join(' '));
    const o = await import(${JSON.stringify(join(ROOT, 'lib/occupations/index.js'))});
    const s = await import(${JSON.stringify(join(ROOT, 'lib/text/synonyms.js'))});
    const w = await import(${JSON.stringify(join(ROOT, 'lib/text/workFamilies.js'))});
    const out = {
      occ: o.occupationOf('Registered Nurse'), rel: o.relation('Cashier', 'Store Manager'), duties: o.impliedDuties('Registered Nurse'),
      mil: o.militaryOccupation('88M Motor Transport Operator'), lvl: o.levelOf('Senior Accountant').marker,
      phr: w.relatePhrases('teach students', 'instruct students').same, ww: w.sameWorkWord('teach', 'educate'),
      sw: s.sameWord('teach', 'instruct'), has: o.hasOccupationData(), errors,
    };
    console.log(JSON.stringify(out));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.equal(r.occ, null);
  assert.equal(r.rel, null);
  assert.equal(r.duties, null);
  assert.equal(r.mil, null);
  assert.equal(r.lvl, 'senior');          // levelOf is a rule over words: it needs no data
  assert.equal(r.phr, false);
  assert.equal(r.ww, null);
  assert.equal(r.sw, false);
  assert.equal(r.has, false);
  assert.deepEqual(r.errors, []);
});

test('on the server a missing file is reported once and the module answers without it', () => {
  const code = `
    const errors = []; console.error = (...a) => errors.push(a.join(' '));
    process.chdir('/');
    const k = await import(${JSON.stringify(join(ROOT, 'lib/text/knowledgeData.js'))});
    const a = k.loadKnowledge('lib/occupations/data', 'nope.json', 'file:///nonexistent/x.js');
    const b = k.loadKnowledge('lib/occupations/data', 'nope.json', 'file:///nonexistent/x.js');
    console.log(JSON.stringify({ a, b, n: errors.length, msg: errors[0] }));`;
  const r = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.equal(r.a, null);
  assert.equal(r.n, 1);
  assert.match(r.msg, /could not read lib\/occupations\/data\/nope\.json/);
});

test('under Node the data loads from the module location even when cwd is elsewhere', () => {
  const code = `process.chdir('/'); const o = await import(${JSON.stringify(join(ROOT, 'lib/occupations/index.js'))}); console.log(o.occupationOf('Registered Nurse')?.code);`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim(), '29-1141.00');
});
