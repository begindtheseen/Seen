#!/usr/bin/env node
// Builds lib/text/data/actFamilies.json from the reviewed source scripts/text/act-families.txt (format in its header).
// No network; output written only from parsed, validated lines; deterministic.
//   node scripts/text/build-act-families.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { words } from '../../lib/text/morph.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'act-families.txt');
const OUT = join(HERE, '..', '..', 'lib', 'text', 'data', 'actFamilies.json');

const norm = (/** @type {string} */ s) => words(s).join(' ');
const list = (/** @type {string} */ s) => [...new Set(s.split(',').map((x) => norm(x)).filter(Boolean))];
const ID = /^[a-z][a-z0-9_]*$/;

export function build(text = readFileSync(SRC, 'utf8')) {
  /** @type {Array<{ id: string, broad: boolean, nouns: string[], fam: Array<{ id: string, same: string[], near: string[] }>, edges: string[][] }>} */
  const classes = [];
  const errors = [];
  /** @type {string[][]} */
  const links = [];
  for (const [n, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = `line ${n + 1}`;
    const cur = classes[classes.length - 1];
    if (line.startsWith('@link')) {
      const m = line.match(/^@link\s+([a-z0-9_]+\.[a-z0-9_]+)\s*~\s*([a-z0-9_]+\.[a-z0-9_]+)$/);
      if (!m) { errors.push(`${at}: "@link class.family ~ class.family"`); continue; }
      links.push([m[1], m[2], at]);
      continue;
    }
    if (line.startsWith('@class')) {
      const m = line.match(/^@class\s+([a-z0-9_]+)(\s+\[broad\])?\s*:\s*(.+)$/);
      if (!m) { errors.push(`${at}: cannot read the class line`); continue; }
      if (classes.some((c) => c.id === m[1])) errors.push(`${at}: class "${m[1]}" defined twice`);
      const nouns = list(m[3]);
      if (nouns.length < 3) errors.push(`${at}: a class needs at least three nouns`);
      classes.push({ id: m[1], broad: !!m[2], nouns, fam: [], edges: [] });
      continue;
    }
    if (!cur) { errors.push(`${at}: line before any @class`); continue; }
    if (line.startsWith('edges:')) {
      for (const e of line.slice(6).split(',').map((x) => x.trim()).filter(Boolean)) {
        const [a, b] = e.split('=>').map((x) => norm(x || ''));
        if (!a || !b) { errors.push(`${at}: edge "${e}" needs "a => b"`); continue; }
        cur.edges.push([a, b]);
      }
      continue;
    }
    const m = line.match(/^([a-z0-9_]+)\s*:\s*(.+)$/);
    if (!m || !ID.test(m[1])) { errors.push(`${at}: cannot read "${line.slice(0, 50)}"`); continue; }
    if (cur.fam.some((f) => f.id === m[1])) errors.push(`${at}: family "${m[1]}" defined twice in ${cur.id}`);
    const [sameRaw, nearRaw = ''] = m[2].split(/;\s*near\s*:/);
    const same = list(sameRaw);
    const near = list(nearRaw).filter((v) => !same.includes(v));
    if (!same.length) errors.push(`${at}: family "${m[1]}" has no same-act verbs`);
    cur.fam.push({ id: m[1], same, near });
  }
  for (const c of classes) {
    const known = new Set(c.fam.flatMap((f) => [...f.same, ...f.near]));
    for (const [a, b] of c.edges) {
      if (!known.has(a)) errors.push(`${c.id}: edge verb "${a}" is in no family of the class`);
      if (!known.has(b)) errors.push(`${c.id}: edge verb "${b}" is in no family of the class`);
      if (a === b) errors.push(`${c.id}: edge "${a} => ${b}" joins a verb to itself`);
    }
    if (!c.fam.length) errors.push(`${c.id}: a class needs at least one family`);
  }
  const famIds = new Set(classes.flatMap((c) => c.fam.map((f) => `${c.id}.${f.id}`)));
  for (const [a, b, at] of links) for (const x of [a, b]) if (!famIds.has(x)) errors.push(`${at}: link names unknown family "${x}"`);
  if (errors.length) throw new Error(`act-families.txt:\n  ${errors.join('\n  ')}`);
  return {
    h: {
      source: 'Seen action families by object class, hand-reviewed (scripts/text/act-families.txt) from (verb, head-object) pairs mined from 959 real job postings and the résumé fixtures',
      retrieved: '2026-11-11',
      licence: 'Seen original compilation',
      format: 'c = [[classId, nouns, families, edges, broad (1: two different things of the class are not the same thing)]]; family = [familyId, sameActVerbs, nearVerbs]; edge = [résuméVerb, postingVerb] (one way); l = [[class.family, class.family]] related across classes (a guess, both ways); members are lower-case word sequences',
      build: 'scripts/text/build-act-families.mjs',
    },
    c: classes.map((c) => [c.id, c.nouns, c.fam.map((f) => [f.id, f.same, f.near]), c.edges, c.broad ? 1 : 0]),
    l: links.map(([a, b]) => [a, b]),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const file = build();
    const body = JSON.stringify(file);
    writeFileSync(OUT, body);
    const fams = file.c.reduce((n, c) => n + c[2].length, 0);
    console.log(`actFamilies.json: ${(body.length / 1024).toFixed(0)} KB, ${file.c.length} classes, ${fams} families`);
  } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
