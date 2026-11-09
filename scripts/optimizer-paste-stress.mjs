#!/usr/bin/env node
// Paste stress — does the optimizer read the same requirements whatever way a posting was copied?
// Takes real postings (a corpus file from scripts/optimizer-corpus-pull.mjs) and re-formats each one the way
// people paste: one flat line, hard-wrapped PDF lines, a LinkedIn copy with its UI text, an Indeed/markdown
// copy, CRLF line ends with odd bullets, numbered lists, and an email forward. Reports, per format, how many
// postings lose more than a third of their requirements or flip to "no requirements".
//   node scripts/optimizer-paste-stress.mjs <corpus.json> [--n 120] [--show flat] [--max 5]
import fs from 'node:fs';
import { runOptimizer } from '../lib/optimizer/index.js';
import { isDescriptionPreview } from '../lib/jobs/descriptionText.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const rows = JSON.parse(fs.readFileSync(args[0], 'utf8')).filter((r) => r.description && r.description.length > 800 && !isDescriptionPreview(r)).slice(0, Number(opt('n', 120)));
const show = opt('show', ''); const max = Number(opt('max', 5));

const bullets = (t, glyph) => t.replace(/^\s*[•▪◦·‣*-]\s+/gm, glyph);
export const FORMATS = {
  flat: (t) => t.replace(/\s*\n+\s*/g, ' '),
  pdf_wrap: (t) => t.split('\n').map((line) => { const out = []; let cur = ''; for (const w of line.split(' ')) { if ((cur + ' ' + w).length > 72 && cur) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; } if (cur) out.push(cur); return out.join('\n'); }).join('\n'),
  linkedin: (t) => `About the job\n\n${bullets(t, '• ')}\n\n…show more\nShow less\nSee how you compare to 1,247 applicants\nTry Premium for $0\nApply\nSave\nSet alert for similar jobs`,
  markdown: (t) => bullets(t, '- ').replace(/^([A-Z][A-Za-z ,'&/()-]{2,60}):?$/gm, '## $1'),
  crlf_odd_bullets: (t) => bullets(t, 'o ').replace(/\n/g, '\r\n'),
  numbered: (t) => { let n = 0; return t.replace(/^\s*[•▪◦·‣*-]\s+/gm, () => `${++n}. `); },
  email_forward: (t) => `---------- Forwarded message ---------\nFrom: Recruiter <recruiter@example.com>\nDate: Mon, Nov 3, 2026\nSubject: Opportunity\n\nHi there,\n\nSaw your profile — here's the role:\n\n${t.replace(/^/gm, '> ')}\n\nBest,\nSam`,
};

const reqs = (r, text) => runOptimizer({ resumeText: 'x', jobTitle: r.title, company: r.company, jobDescription: text }).requirement_count || 0;
const stats = {};
const bad = [];
for (const r of rows) {
  const base = reqs(r, r.description);
  if (base < 3) continue;
  for (const [name, fn] of Object.entries(FORMATS)) {
    const n = reqs(r, fn(r.description));
    const s = (stats[name] ||= { n: 0, lost: 0, withheld: 0, ratio: 0 });
    s.n++; s.ratio += n / base;
    if (n < 3) s.withheld++;
    if (n < base * 0.67) { s.lost++; bad.push({ name, r, base, n }); }
  }
}
for (const [k, s] of Object.entries(stats)) console.log(`${k.padEnd(18)} postings ${s.n} · lost >1/3: ${s.lost} · now refused: ${s.withheld} · avg kept ${(100 * s.ratio / s.n).toFixed(0)}%`);
if (show) for (const b of bad.filter((x) => x.name === show).slice(0, max)) console.log(`\n── ${b.name} · ${b.r.title} · ${b.base} → ${b.n} · ${b.r.id}`);
