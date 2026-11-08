#!/usr/bin/env node
// Optimizer corpus harness — runs the résumé optimizer over a file of REAL postings and reports where it
// gives the person nothing. Read-only and offline: the corpus is a JSON array of job rows
// ({ id, title, company, source, description }), pulled once with scripts/optimizer-corpus-pull.mjs.
//
//   node scripts/optimizer-corpus.mjs <corpus.json> [--persona dev|maria|tasha|best] [--show withheld|thin|all] [--n 20] [--free]
//
// 2026-11-08 baseline on 324 live postings: before — 58.6% optimizable, median 5 requirements read;
// after the fetch + posting-terms work — 85.5% optimizable, median 12 (the rest: closed Adzuna ads, and
// postings that truly state almost nothing).
//
// Per posting it records what the person would get: refused as a teaser, refused as "no requirements",
// how many requirements were read, and how much work the paid package proposes (rewrites, summary,
// reorders, questions). Exit code 0 always; this is a measuring tool, the tests pin the rules.
import fs from 'node:fs';
import { isDescriptionPreview } from '../lib/jobs/descriptionText.js';
import { unoptimizableListing, buildPaidOptimize } from '../lib/server/optimizePackage.js';
import { runOptimizer } from '../lib/optimizer/index.js';
import { canonicalResumeText } from '../lib/resume/canonical.js';

const args = process.argv.slice(2);
const file = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const personaArg = opt('persona', 'best');
const show = opt('show', '');
const showN = Number(opt('n', 15));
const paid = !args.includes('--free');
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const P = (n) => canonicalResumeText(fs.readFileSync(new URL(`../lib/fixtures/personas/${n}.txt`, import.meta.url), 'utf8'));
const personas = { dev: P('dev'), maria: P('maria'), tasha: P('tasha') };

const stats = { total: 0, teaser: 0, withheld: 0, ok: 0, reqs: [], noWork: 0, bySource: {} };
const bad = [];
for (const row of rows) {
  stats.total++;
  const src = row.source || 'employer';
  const s = (stats.bySource[src] ||= { n: 0, teaser: 0, withheld: 0, reqSum: 0, ok: 0 });
  s.n++;
  const jd = String(row.description || '');
  if (isDescriptionPreview(row)) { stats.teaser++; s.teaser++; continue; }
  const names = personaArg === 'all' || personaArg === 'best' ? Object.keys(personas) : [personaArg];
  let best = null;
  for (const name of names) {
    const out = runOptimizer({ resumeText: personas[name], jobTitle: row.title, company: row.company, jobDescription: jd });
    if (!best || (out.fit_score ?? -1) > (best.out.fit_score ?? -1)) best = { name, out };
  }
  const n = best.out.requirement_count || 0;
  stats.reqs.push(n); s.reqSum += n;
  const un = unoptimizableListing({ resume: personas[best.name], jobDescription: jd, job: row.title, company: row.company });
  if (un) { stats.withheld++; s.withheld++; bad.push({ kind: 'withheld', row, n }); continue; }
  stats.ok++; s.ok++;
  if (paid) {
    const pk = buildPaidOptimize({ resume: personas[best.name], jobDescription: jd, job: row.title, company: row.company, pro: true, jobId: row.id });
    const work = (pk.rewrite_plan?.length || 0) + (pk.summary && !pk.summary.kept ? 1 : 0) + (pk.reorder?.length || 0) + (pk.questions?.length || 0);
    if (work === 0) { stats.noWork++; bad.push({ kind: 'thin', row, n, persona: best.name }); }
  }
}
const pct = (a) => `${((100 * a) / Math.max(1, stats.total)).toFixed(1)}%`;
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
console.log(`postings ${stats.total} · teaser ${stats.teaser} (${pct(stats.teaser)}) · no-requirements ${stats.withheld} (${pct(stats.withheld)}) · optimizable ${stats.ok} (${pct(stats.ok)})${paid ? ` · paid package with no work ${stats.noWork}` : ''}`);
console.log(`requirements read: median ${med(stats.reqs)} · under 5: ${stats.reqs.filter((x) => x < 5).length} · under 8: ${stats.reqs.filter((x) => x < 8).length}`);
for (const [k, s] of Object.entries(stats.bySource)) console.log(`  ${k.padEnd(12)} n=${s.n} teaser=${s.teaser} withheld=${s.withheld} ok=${s.ok} avgReqs=${(s.reqSum / Math.max(1, s.n - s.teaser)).toFixed(1)}`);
if (show) {
  for (const b of bad.filter((x) => show === 'all' || x.kind === show).slice(0, showN)) {
    console.log(`\n── ${b.kind} · ${b.row.source} · ${b.row.title} @ ${b.row.company} · reqs ${b.n} · ${b.row.id}`);
    console.log(String(b.row.description).slice(0, 900).replace(/\n/g, ' ⏎ '));
  }
}
