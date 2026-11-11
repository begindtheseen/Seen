#!/usr/bin/env node
// Builds lib/text/data/tradeTalk.json from the reviewed source scripts/text/trade-talk.txt (format in its header).
// No network; output written only from parsed, validated groups; deterministic.
//   node scripts/text/build-trade-talk.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { words } from '../../lib/text/morph.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'trade-talk.txt');
const OUT = join(HERE, '..', '..', 'lib', 'text', 'data', 'tradeTalk.json');
export const FIELDS = ['food', 'retail', 'warehouse', 'healthcare', 'nursing', 'trades', 'office', 'support', 'sales', 'k12', 'itsupport', 'software', 'accounting', 'construction', 'security', 'military', 'general'];

const norm = (/** @type {string} */ s) => words(s).join(' ');

export function build(text = readFileSync(SRC, 'utf8')) {
  /** @type {Array<{ f: string[], k: '='|'>', i: string[], c: string[] }>} */
  const groups = [];
  const errors = [];
  let fields = /** @type {string[]} */ ([]);
  for (const [n, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@field')) {
      fields = line.slice(6).split(',').map((x) => x.trim()).filter(Boolean);
      for (const f of fields) if (!FIELDS.includes(f)) errors.push(`line ${n + 1}: unknown field "${f}"`);
      continue;
    }
    if (!fields.length) { errors.push(`line ${n + 1}: group before any @field`); continue; }
    const kind = line[0];
    if (kind !== '=' && kind !== '>') { errors.push(`line ${n + 1}: cannot read "${line.slice(0, 50)}"`); continue; }
    const body = line.slice(1).trim();
    const split = (/** @type {string} */ s) => [...new Set(s.split(',').map((x) => norm(x)).filter(Boolean))];
    if (kind === '=') {
      const m = split(body);
      if (m.length < 2) errors.push(`line ${n + 1}: an equivalence needs two members`);
      groups.push({ f: fields.slice(), k: '=', i: m, c: [] });
    } else {
      const [inst, cls] = body.split('=>');
      if (!cls) { errors.push(`line ${n + 1}: "> instance => class" needs "=>"`); continue; }
      const i = split(inst);
      const c = split(cls);
      if (!i.length || !c.length) errors.push(`line ${n + 1}: empty side`);
      groups.push({ f: fields.slice(), k: '>', i, c });
    }
  }
  if (errors.length) throw new Error(`trade-talk.txt:\n  ${errors.join('\n  ')}`);
  return {
    h: {
      source: 'Seen trade-talk table, hand-reviewed (scripts/text/trade-talk.txt); vocabulary informed by O*NET 31.0 task and tool text (USDOL/ETA, CC BY 4.0) and real job postings',
      retrieved: '2026-11-10',
      licence: 'Seen original compilation; O*NET-derived vocabulary under CC BY 4.0 (attribution on /methods)',
      format: 'f = field keys ("general" holds in every field); g = [[fieldIndexes, kind ("=" equivalents | ">" instance ⇒ class), members (equivalents, or instances), classMembers (">" only)]]; members are lower-case word sequences',
      build: 'scripts/text/build-trade-talk.mjs',
    },
    f: FIELDS,
    g: groups.map((x) => [x.f.map((f) => FIELDS.indexOf(f)), x.k, x.i, x.c]),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const file = build();
    const body = JSON.stringify(file);
    writeFileSync(OUT, body);
    console.log(`tradeTalk.json: ${(body.length / 1024).toFixed(0)} KB, ${file.g.length} groups`);
  } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
