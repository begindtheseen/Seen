#!/usr/bin/env node
// Optimizer eval — renders the PAID Optimize package (the thing a job seeker spends a credit on) for one
// résumé × one posting into a readable Markdown file, split into what the review screen SHOWS and what
// the package carries but never renders, so a person can judge the purchase the way the buyer sees it.
// Read-only and offline by default; `--live-taxonomy` reads the shared skill taxonomy + company context
// from Supabase (GET only — the same inputs api/resume.js handleOptimizeTool passes).
//
//   node scripts/optimizer-eval.mjs --resume <file> (--posting <file> | --corpus <all.json> --id <id-or-prefix>)
//        [--title "…"] [--company "…"] [--out <file.md>] [--live-taxonomy] [--json]
//   node scripts/optimizer-eval.mjs --cases <cases.json> --corpus <all.json> --outdir <dir> [--live-taxonomy]
//        cases.json = [{ "name": "nurse-a", "resume": "lib/fixtures/personas/nurse.txt", "id": "1ef83e4f" }, …]
//        (a case may carry "posting": "<file>", "title", "company" instead of an id)
//
// What the review screen renders is read from components/ApplyOptimizeModal.tsx (review step) and
// components/optimizer/Verdict.tsx at the time of writing:
//   VerdictCard (score, band, sentence, gate) · WhyYouMatch (matched, not inferred, exact before related, first 6,
//   evidence cut at 140 chars) · MissingList (unmatched, hard first then required, first 8) · Checklist (constraints
//   with status ask, or unmet and not a gate, first 6) · PaidPlanView (availability, reorder, number questions,
//   summary, rewrite_plan) · "Same thing, different word" (wording_notes, first 3) · Safe improvements
//   (optimized_bullets that are real rewrites) · guidance cards (optimized_bullets placeholders).
// NOT rendered: application_message (only HumanProof's), keywords_missing / keywords_added, job_priorities.
// The "Apply — your resume downloads first" PDF is action:'download_resume' on the ORIGINAL résumé text.
import fs from 'node:fs';
import path from 'node:path';
import { buildPaidOptimize, unoptimizableListing } from '../lib/server/optimizePackage.js';
import { canonicalResumeText } from '../lib/resume/canonical.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);

async function liveInputs(company, jobDescription) {
  if (!flag('live-taxonomy')) return { taxonomy: null, fit: null };
  const { loadSkillTaxonomy } = await import('../lib/server/skillTaxonomy.js');
  const { fitContext } = await import('../lib/server/fitContext.js');
  const [taxonomy, fit] = await Promise.all([loadSkillTaxonomy(), fitContext({ company, jobDescription }).catch(() => null)]);
  return { taxonomy, fit };
}

function loadPosting({ posting, corpus, id, title, company }) {
  if (posting) return { description: fs.readFileSync(posting, 'utf8'), title: title || '', company: company || '', source: 'file', id: path.basename(posting) };
  const rows = JSON.parse(fs.readFileSync(corpus, 'utf8'));
  const row = rows.find((r) => r.id === id) || rows.find((r) => String(r.id).startsWith(id));
  if (!row) throw new Error(`no corpus row ${id}`);
  return { description: String(row.description || ''), title: title || row.title, company: company || row.company, source: row.source, id: row.id, location: row.location };
}

const q = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = q(s).replace(/^[•\-*\s]+/, ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
const show = (s) => String(s || '').replace(/^term:/, '');

/** The rows WhyYouMatch / MissingList / Checklist would render, in their order and caps. */
export function renderedView(pk) {
  const why = (pk.matched_requirements || []).filter((m) => m.matched && !m.inferred).sort((a, b) => Number(a.via === 'related') - Number(b.via === 'related')).slice(0, 6);
  const missing = (pk.unsupported_requirements || []).filter((m) => !m.matched).sort((a, b) => Number(!!b.hard) - Number(!!a.hard) || Number(a.importance !== 'required') - Number(b.importance !== 'required')).slice(0, 8);
  const checklist = (pk.constraints || []).filter((c) => c.status === 'ask' || (c.status === 'unmet' && !c.gate)).slice(0, 6);
  const guidance = /^\(|no existing bullet/i;
  const real = (pk.optimized_bullets || []).filter((b) => !guidance.test(b.original) && !guidance.test(b.optimized));
  const guide = (pk.optimized_bullets || []).filter((b) => guidance.test(b.original) || guidance.test(b.optimized));
  return { why, missing, checklist, real, guide, notes: (pk.wording_notes || []).slice(0, 3) };
}

/** Substantive work the credit bought, counted the way the modal's "this credit bought …" line counts it. */
export function workCount(pk) {
  const v = renderedView(pk);
  return {
    rewrites: (pk.rewrite_plan || []).length,
    reorder: (pk.reorder || []).length,
    questions: (pk.questions || []).length,
    availability: pk.availability ? 1 : 0,
    summary: pk.summary && !pk.summary.kept ? 1 : 0,
    safe_bullets: v.real.length,
  };
}

export function renderCase({ name, resumeText, posting, pk, refused }) {
  const L = [];
  L.push(`# ${name} — ${posting.title} @ ${posting.company}`);
  L.push(`source ${posting.source} · id \`${posting.id}\`${posting.location ? ` · ${posting.location}` : ''} · posting ${posting.description.length} chars`);
  L.push('');
  if (refused) { L.push(`**REFUSED before the credit:** ${refused.message}`); L.push(''); }
  if (pk) {
    const v = renderedView(pk);
    const w = workCount(pk);
    L.push('## Verdict (rendered)');
    L.push(`**${pk.verdict?.score ?? '–'} · ${pk.verdict?.band || 'No score'}** — ${q(pk.verdict?.sentence)}`);
    if (pk.verdict?.gate) L.push(`⚠ gate: ${pk.verdict.gate}`);
    L.push(`requirements read: ${pk.requirement_count} (matched ${(pk.matched_requirements || []).length}, unsupported ${(pk.unsupported_requirements || []).length}) · engine ${pk._engine}`);
    L.push(`work: rewrites ${w.rewrites} · reorders ${w.reorder} · number questions ${w.questions} · availability ${w.availability} · new summary ${w.summary} · safe bullet rewrites ${w.safe_bullets}`);
    L.push('');
    L.push('## Why you match (rendered: first 6, not inferred)');
    for (const m of v.why) L.push(`- ✓ **${show(m.surface)}**${m.via === 'related' ? ' (related experience)' : ''} — “${clip(m.evidence, 140)}”`);
    L.push('');
    L.push('## All matched requirements (JSON — judge every proof)');
    L.push('| requirement | label | via | imp | hard | inferred | résumé proof | posting line |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const m of pk.matched_requirements || []) L.push(`| ${show(m.surface)} | ${m.requirement} | ${m.via}${m.relatedTo ? `→${m.relatedTo}` : ''} | ${m.importance} | ${m.hard ? 'y' : ''} | ${m.inferred ? 'y' : ''} | ${clip(m.evidence, 110)} | ${clip(m.postingEvidence, 110)} |`);
    L.push('');
    L.push('## The posting asks for — add only if true (rendered: first 8)');
    L.push(v.missing.map((m) => `\`${show(m.surface)}${m.importance === 'preferred' ? ' · preferred' : ''}\``).join(' '));
    L.push('');
    L.push('## All unsupported requirements (JSON)');
    L.push('| requirement | label | imp | hard | soft | posting line |');
    L.push('|---|---|---|---|---|---|');
    for (const m of pk.unsupported_requirements || []) L.push(`| ${show(m.surface)} | ${m.requirement} | ${m.importance} | ${m.hard ? 'y' : ''} | ${m.soft ? 'y' : ''} | ${clip(m.postingEvidence, 130)} |`);
    L.push('');
    L.push('## Constraints / hard gates');
    for (const c of pk.constraints || []) L.push(`- [${c.status}${c.gate ? ', gate' : ''}] ${c.kind}: ${q(c.label)} → ${q(c.message)}${v.checklist.includes(c) ? '  **(rendered in checklist)**' : ''}`);
    if ((pk.hard_gates || []).length) L.push(`hard_gates: ${JSON.stringify(pk.hard_gates)}`);
    L.push('');
    L.push('## Paid plan (rendered)');
    if (pk.availability) L.push(`**Availability line:** ${pk.availability.text}${pk.availability.conflict ? ` ⚠ ${pk.availability.conflict}` : ''}`);
    if ((pk.reorder || []).length) { L.push('**Move to the top:**'); for (const r of pk.reorder) L.push(`- ${r.role} · ${r.company} · line ${r.from} → 1: “${clip(r.text, 160)}”`); }
    if ((pk.questions || []).length) { L.push('**Number questions:**'); for (const x of pk.questions) L.push(`- ${x.question} → “${x.template}”`); }
    if (pk.summary) {
      L.push(`**Summary${pk.summary.kept ? ' (kept)' : ''}:** ${q(pk.summary.text)}`);
      if (pk.summary.replaces) L.push(`  _replaces:_ ${q(pk.summary.replaces)}`);
    } else L.push('**Summary:** none');
    if ((pk.rewrite_plan || []).length) { L.push('**Wording proposals:**'); for (const r of pk.rewrite_plan) { L.push(`- FROM: ${q(r.from)}`); L.push(`  TO:   ${q(r.to)}  _(${(r.rules || []).join(', ')})_`); } }
    L.push('');
    L.push('## Same thing, different word (rendered: first 3)');
    for (const n of v.notes) L.push(`- ${q(n)}`);
    L.push('');
    L.push('## Safe improvements (rendered when real) / guidance cards');
    for (const b of v.real) { L.push(`- BEFORE: ${q(b.original)}`); L.push(`  AFTER (${b.addresses}): ${q(b.optimized)}`); }
    if (v.guide.length) L.push(`guidance cards: ${v.guide.map((g) => `“Write a bullet for ${g.addresses}”`).join(' · ')}`);
    L.push('');
    L.push('## Carried but NOT rendered');
    L.push(`- application_message: ${pk.application_message ? q(typeof pk.application_message === 'string' ? pk.application_message : pk.application_message.text || JSON.stringify(pk.application_message)) : 'none'}`);
    L.push(`- keywords_missing: ${(pk.keywords_missing || []).join(', ')}`);
    L.push(`- keywords_added: ${(pk.keywords_added || []).join(', ')}`);
    L.push(`- job_priorities: ${(pk.job_priorities || []).join(', ')}`);
    L.push('- PDF on Apply: the ORIGINAL résumé re-rendered (download_resume) — none of the above applied.');
    L.push('');
  }
  L.push('<details><summary>Résumé</summary>\n\n```\n' + resumeText + '\n```\n</details>');
  L.push('');
  L.push('<details><summary>Posting</summary>\n\n```\n' + posting.description + '\n```\n</details>');
  return L.join('\n');
}

async function runOne({ name, resume, posting, corpus, id, title, company }) {
  const resumeText = canonicalResumeText(fs.readFileSync(resume, 'utf8'));
  const p = loadPosting({ posting, corpus, id, title, company });
  const { taxonomy, fit } = await liveInputs(p.company, p.description);
  const refused = unoptimizableListing({ resume: resumeText, jobDescription: p.description, job: p.title, company: p.company, taxonomy });
  const pk = refused ? null : buildPaidOptimize({ resume: resumeText, jobDescription: p.description, job: p.title, company: p.company, pro: true, jobId: p.id, taxonomy, fit });
  return { name: name || path.basename(resume, '.txt'), resumeText, posting: p, pk, refused };
}

async function main() {
  const cases = opt('cases');
  if (cases) {
    const list = JSON.parse(fs.readFileSync(cases, 'utf8'));
    const outdir = opt('outdir', 'optimizer-eval');
    fs.mkdirSync(outdir, { recursive: true });
    const summary = [];
    for (const c of list) {
      const r = await runOne({ ...c, corpus: c.corpus || opt('corpus') });
      fs.writeFileSync(path.join(outdir, `${r.name}.md`), renderCase(r));
      if (flag('json')) fs.writeFileSync(path.join(outdir, `${r.name}.json`), JSON.stringify(r.pk, null, 1));
      const w = r.pk ? workCount(r.pk) : null;
      summary.push({ case: r.name, posting: `${r.posting.title} @ ${r.posting.company}`, source: r.posting.source, score: r.pk?.verdict?.score ?? null, reqs: r.pk?.requirement_count ?? 0, refused: !!r.refused, ...w });
    }
    console.table(summary);
    fs.writeFileSync(path.join(outdir, 'summary.json'), JSON.stringify(summary, null, 1));
    return;
  }
  const r = await runOne({ resume: opt('resume'), posting: opt('posting'), corpus: opt('corpus'), id: opt('id'), title: opt('title'), company: opt('company'), name: opt('name') });
  const md = renderCase(r);
  if (opt('out')) fs.writeFileSync(opt('out'), md); else process.stdout.write(md + '\n');
  if (flag('json')) process.stderr.write(JSON.stringify(r.pk, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
