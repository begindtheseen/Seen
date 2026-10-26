// Live evaluation of the résumé optimizer v3 (/api/optimize) with simulated job seekers.
//
//   node scripts/eval/v3.mjs diagnose --out=<dir> [--base=<url>] [--only=01-retail-manager,…] [--fresh]
//        → <dir>/<fixture>/diagnosis.json + questions.md (what Seen asks the person)
//   (a persona answers each fixture's questions in <dir>/<fixture>/answers.json: [{ id, answer }])
//   node scripts/eval/v3.mjs rewrite --out=<dir> [--base=<url>] [--only=…] [--fresh]
//        → <dir>/<fixture>/rewrite.json + review.md (every change before → after, for the graders)
//   --local runs Seen's engine in this process (no deploy, no network, no model): the same functions
//   /api/optimize calls.
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

const LOCAL = !!args.local;
const engine = LOCAL ? { ...(await import('../../lib/resume/optimize/engine.js')), ...(await import('../../lib/resume/optimize/local.js')) } : null;
async function localCall(b) {
  const t0 = Date.now();
  const ctx = engine.buildContext({ resumeText: b.resume, jobTitle: b.job, company: b.company, jobDescription: b.jobDescription });
  const diagnosis = { ...engine.localDiagnosis(ctx), model: false };
  if (b.action === 'diagnose') return { resp: { status: 200, ms: Date.now() - t0, body: { ok: true, diagnosis } } };
  const byId = new Map(diagnosis.questions.map((q) => [q.id, q]));
  const answers = (b.answers || []).map((a) => ({ q: byId.get(String(a.id)), answer: String(a.answer || '').trim() }))
    .filter((a) => a.q && a.answer && !/^(?:skip|n\/?a|not sure|don'?t know|idk)$/i.test(a.answer)).map(({ q, answer }) => ({ id: q.id, bullet: q.bullet, ask: q.ask, answer }));
  const g = engine.localRewrite(ctx, diagnosis, answers);
  const body = { ok: true, proposals: g.proposals, summary: g.summary, skills: g.skills,
    order: diagnosis.bullets.filter((x) => x.action === 'move_up').map((x) => x.id), cut: diagnosis.bullets.filter((x) => x.action === 'cut').map((x) => ({ id: x.id, why: x.why })),
    gaps: engine.gapsAfterAnswers(diagnosis.gaps, answers), requirements: diagnosis.requirements, rejected_count: g.rejected.length,
    refused: g.rejected.filter((r) => r.text).map((r) => ({ id: r.id, text: r.text, reason: r.reason })) };
  return { resp: { status: 200, ms: Date.now() - t0, body } };
}
const client = new ProdClient({ base: typeof args.base === 'string' ? args.base : 'https://seenjobs.io', accounts: process.env.EVAL_ACCOUNTS_FILE, fresh: !!args.fresh, paceMs: Number(args.pace ?? 5) * 1000, wait: !!args.wait });
const body = (fx) => ({ resume: fx.resumeText, job: fx.job.title, company: fx.job.company, jobDescription: fx.jd, jobId: `eval-v3-${fx.id}` });
const dir = (fx) => { const d = `${OUT}/${fx.id}`; mkdirSync(d, { recursive: true }); return d; };

const summary = [];
for (const fx of fixtures) {
  const d = dir(fx);
  if (phase === 'diagnose') {
    const b = { action: 'diagnose', ...body(fx), fresh: !!args.fresh };
    const res = LOCAL ? await localCall(b).then((rec) => ({ rec })) : await client.call('optimize_v3_diagnose', fx, hash({ v: 1, b }), () => client.post('/api/optimize', b, { model: true }));
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
    let answers = existsSync(`${d}/answers.json`) ? JSON.parse(readFileSync(`${d}/answers.json`, 'utf8')) : [];
    // answers were written against the questions in this folder's diagnosis.json; when the engine's
    // questions have changed since, each answer follows its question TEXT to the new id (an answer whose
    // question is gone is dropped) — matching by id fed the travel answer to "Have you used Concur?"
    if (LOCAL && existsSync(`${d}/diagnosis.json`)) {
      const asked = new Map((JSON.parse(readFileSync(`${d}/diagnosis.json`, 'utf8')).diagnosis?.questions || []).map((q) => [q.id, q.ask]));
      const ctx = engine.buildContext({ resumeText: fx.resumeText, jobTitle: fx.job.title, company: fx.job.company, jobDescription: fx.jd });
      const now = new Map(engine.localDiagnosis(ctx).questions.map((q) => [q.ask, q.id]));
      const moved = answers.map((a) => ({ ...a, id: now.get(asked.get(a.id)) })).filter((a) => a.id);
      if (moved.length !== answers.length || moved.some((a, i) => a.id !== answers[i].id)) console.log(`${fx.id}: ${answers.length - moved.length} answer(s) dropped, ids remapped by question text`);
      answers = moved;
    }
    const b = { action: 'rewrite', ...body(fx), answers, fresh: !!args.fresh };
    const res = LOCAL ? await localCall(b).then((rec) => ({ rec })) : await client.call('optimize_v3_rewrite', fx, hash({ v: 1, b }), () => client.post('/api/optimize', b, { model: true }));
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
