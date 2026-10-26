// Live evaluation of the résumé optimizer v3 (/api/optimize) with simulated job seekers.
//
//   node scripts/eval/v3.mjs diagnose --out=<dir> [--base=<url>] [--only=01-retail-manager,…] [--fresh]
//        → <dir>/<fixture>/diagnosis.json + questions.md (what Seen asks the person)
//   (a persona answers each fixture's questions in <dir>/<fixture>/answers.json: [{ id, answer }])
//   node scripts/eval/v3.mjs rewrite --out=<dir> [--base=<url>] [--only=…] [--fresh]
//        → <dir>/<fixture>/rewrite.json + review.md (every change before → after, for the graders)
//
// Same account file, preview cookie, pacing and rate-limit rules as prod.mjs (EVAL_ACCOUNTS_FILE,
// EVAL_VERCEL_SHARE_FILE). Every call is cached under scripts/eval/.cache/ unless --fresh.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ProdClient } from './prod.mjs';

const EVAL = new URL('./', import.meta.url);
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const phase = process.argv[2];
if (!['diagnose', 'rewrite'].includes(phase) || typeof args.out !== 'string') {
  console.error('usage: node scripts/eval/v3.mjs diagnose|rewrite --out=<dir> [--base=<url>] [--only=a,b] [--fresh]');
  process.exit(2);
}
const OUT = args.out.replace(/\/$/, '');
const only = typeof args.only === 'string' ? args.only.split(',') : null;
const hash = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);

const FX_DIR = new URL('fixtures/', EVAL);
const raw = Object.fromEntries(readdirSync(FX_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => { const j = JSON.parse(readFileSync(new URL(f, FX_DIR), 'utf8')); return [j.id, j]; }));
const fixtures = Object.values(raw)
  .filter((f) => !f.gold?.expect_no_requirements && (!only || only.includes(f.id)))
  .map((f) => ({ ...f, resumeText: (f.resume || raw[f.resume_from].resume).join('\n'), jd: f.job.description.join('\n') }));

const client = new ProdClient({ base: typeof args.base === 'string' ? args.base : 'https://seenjobs.io', accounts: process.env.EVAL_ACCOUNTS_FILE, fresh: !!args.fresh, paceMs: Number(args.pace ?? 5) * 1000, wait: !!args.wait });
const body = (fx) => ({ resume: fx.resumeText, job: fx.job.title, company: fx.job.company, jobDescription: fx.jd, jobId: `eval-v3-${fx.id}` });
const dir = (fx) => { const d = `${OUT}/${fx.id}`; mkdirSync(d, { recursive: true }); return d; };

const summary = [];
for (const fx of fixtures) {
  const d = dir(fx);
  if (phase === 'diagnose') {
    const b = { action: 'diagnose', ...body(fx), fresh: !!args.fresh };
    const res = await client.call('optimize_v3_diagnose', fx, hash({ v: 1, b }), () => client.post('/api/optimize', b, { model: true }));
    const r = res.rec?.resp;
    if (!r) { summary.push(`${fx.id}: deferred — ${res.deferred}`); continue; }
    writeFileSync(`${d}/diagnosis.json`, JSON.stringify({ status: r.status, ms: r.ms, ...r.body }, null, 2));
    const dg = r.body?.diagnosis || {};
    const md = [`# ${fx.id} — ${fx.job.title} at ${fx.job.company}`, '', `status ${r.status} · ${r.ms} ms · model ${dg.model}`, '', '## Questions Seen asks', ''];
    for (const q of dg.questions || []) md.push(`- **${q.id}** (about ${q.bullet}): ${q.ask}${q.why ? ` _(why: ${q.why})_` : ''}`);
    md.push('', '## Gaps it names', '', ...(dg.gaps || []).map((g) => `- ${g.label}: ${g.advice}`));
    writeFileSync(`${d}/questions.md`, md.join('\n'));
    summary.push(`${fx.id}: ${r.status} ${r.ms}ms · ${(dg.questions || []).length} questions · ${(dg.requirements || []).length} requirements · model ${dg.model}`);
  } else {
    const answers = existsSync(`${d}/answers.json`) ? JSON.parse(readFileSync(`${d}/answers.json`, 'utf8')) : [];
    const b = { action: 'rewrite', ...body(fx), answers, fresh: !!args.fresh };
    const res = await client.call('optimize_v3_rewrite', fx, hash({ v: 1, b }), () => client.post('/api/optimize', b, { model: true }));
    const r = res.rec?.resp;
    if (!r) { summary.push(`${fx.id}: deferred — ${res.deferred}`); continue; }
    writeFileSync(`${d}/rewrite.json`, JSON.stringify({ status: r.status, ms: r.ms, ...r.body }, null, 2));
    const o = r.body || {};
    const md = [`# ${fx.id} — ${fx.job.title} at ${fx.job.company}`, '', `status ${r.status} · ${r.ms} ms · ${(o.proposals || []).length} changes shipped · ${o.rejected_count ?? '?'} refused by the gates`, ''];
    if (o.summary?.text) md.push('## Summary', '', `> ${o.summary.text}`, '');
    md.push('## Changes (before → after)', '');
    for (const p of o.proposals || []) md.push(`- **${p.id}**`, `  - before: ${p.before}`, `  - after: ${p.after}`, ...(p.why ? [`  - why: ${p.why}`] : []), ...(p.uses?.length ? [`  - uses: ${p.uses.join(', ')}`] : []));
    if (o.skills?.length) md.push('', `## Skills added: ${o.skills.join(', ')}`);
    if (o.order?.length) md.push('', `## Move up: ${o.order.join(', ')}`);
    if (o.cut?.length) md.push('', '## Cut', '', ...o.cut.map((c) => `- ${c.id}: ${c.why}`));
    if (o.gaps?.length) md.push('', '## Gaps', '', ...o.gaps.map((g) => `- ${g.label}: ${g.advice}`));
    md.push('', '## Answers the person gave', '', ...(answers.length ? answers.map((a) => `- ${a.id}: ${a.answer}`) : ['(none)']));
    writeFileSync(`${d}/review.md`, md.join('\n'));
    summary.push(`${fx.id}: ${r.status} ${r.ms}ms · ${(o.proposals || []).length} shipped · ${o.rejected_count ?? '?'} refused${r.status >= 400 ? ' · ' + JSON.stringify(r.body).slice(0, 160) : ''}`);
  }
  console.log(summary[summary.length - 1]);
}
writeFileSync(`${OUT}/${phase}-summary.txt`, summary.join('\n') + '\n');
