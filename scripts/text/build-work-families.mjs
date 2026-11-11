#!/usr/bin/env node
// Builds lib/text/data/workFamilies.json from the reviewed source scripts/text/work-families.txt (format in its
// header). No network; the output is written only from parsed, validated families. Deterministic.
//
//   node scripts/text/build-work-families.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { words } from '../../lib/text/morph.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'work-families.txt');
const OUT = join(HERE, '..', '..', 'lib', 'text', 'data', 'workFamilies.json');

/** "Look-ahead" → "look ahead": members are matched as word sequences. @param {string} s */
const norm = (s) => words(s).join(' ');

export function build(text = readFileSync(SRC, 'utf8')) {
  /** @type {Record<string, Array<[string] | [string, string]>>} */
  const a = {};
  /** @type {Record<string, { f: string[], m: Array<[string] | [string, string]> }>} */
  const o = {};
  let section = '';
  const errors = [];
  for (const [n, line] of text.split('\n').entries()) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    if (l === '@actions' || l === '@objects') { section = l.slice(1); continue; }
    const m = l.match(/^([a-z0-9_]+)\s*(?:\[([a-z_,]+)\])?\s*:\s*(.+)$/);
    if (!m || !section) { errors.push(`line ${n + 1}: cannot read "${l.slice(0, 60)}"`); continue; }
    const [, id, fields, body] = m;
    if (a[id] || o[id]) errors.push(`line ${n + 1}: duplicate family id ${id}`);
    /** @type {Array<[string] | [string, string]>} */
    const members = [];
    const seen = new Set();
    for (const raw of body.split(',')) {
      const [w, cond] = raw.trim().split('?');
      const k = norm(w || '');
      if (!k) { errors.push(`line ${n + 1}: empty member in ${id}`); continue; }
      const key = `${k}?${cond || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      members.push(cond ? [k, cond.trim()] : [k]);
    }
    if (members.length < 2) errors.push(`line ${n + 1}: family ${id} has fewer than two members`);
    if (section === 'actions') a[id] = members;
    else o[id] = { f: fields ? fields.split(',') : [], m: members };
  }
  // a condition is a list of object words / object family ids / fields; it must not be empty
  for (const [id, ms] of [...Object.entries(a), ...Object.entries(o).map(([k, v]) => [k, v.m])]) {
    for (const [w, c] of /** @type {any[]} */ (ms)) if (c !== undefined && !c.split('|').every((x) => /^[a-z0-9_ -]+$/.test(x))) errors.push(`${id}: bad condition "${w}?${c}"`);
  }
  if (errors.length) throw new Error(`work-families.txt:\n  ${errors.join('\n  ')}`);
  const sorted = (/** @type {Record<string, any>} */ r) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]]));
  return {
    h: {
      source: 'Seen work thesaurus, hand-reviewed (scripts/text/work-families.txt); vocabulary from the most frequent verbs and nouns of O*NET 31.0 task statements (USDOL/ETA, CC BY 4.0) and Seen\'s posting corpus; WordNet 3.1 consulted for candidates',
      retrieved: '2026-11-10',
      licence: 'Seen original compilation; O*NET-derived vocabulary under CC BY 4.0 (attribution on /methods)',
      format: 'a[actionFamily] = [[member] | [member, "objFamily|objFamily"]]: a conditional member counts only when the object it acts on is in one of those object families; o[objectFamily] = { f: fields where it holds, m: [[member] | [member, "field|family"]] }: a conditional member counts only in that field or next to that family. Members are lower-case word sequences.',
      build: 'scripts/text/build-work-families.mjs',
    },
    a: sorted(a),
    o: sorted(o),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const file = build();
    const body = JSON.stringify(file);
    writeFileSync(OUT, body);
    console.log(`workFamilies.json: ${(body.length / 1024).toFixed(0)} KB, ${Object.keys(file.a).length} action families, ${Object.keys(file.o).length} object families`);
  } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
