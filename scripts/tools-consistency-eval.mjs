#!/usr/bin/env node
// Tools consistency eval — one résumé + one posting through EVERY Seen tool, in process, no network.
//
//   node scripts/tools-consistency-eval.mjs --resume lib/fixtures/personas/maria.txt \
//        --posting lib/fixtures/personas/maria-frys-jd.txt --title "Assistant Store Manager" --company "Fry's Food Stores"
//   node scripts/tools-consistency-eval.mjs --cases cases.json --corpus all.json --out <dir> [--taxonomy tax.json]
//
// --posting takes a file path or a corpus id (with --corpus). A cases file is a JSON array of
// { id, resume, posting, title?, company?, stage? } (title/company default to the corpus row's).
//
// For each case it runs exactly what production runs:
//   • the free fit check  — api/optimizer.js: runOptimizer over canonicalResumeText + extractJobFacts (+ taxonomy)
//   • Job Insights        — api/job-insights.js: buildJobInsights({ title, company, description })
//   • Interview Prep      — api/interview-prep.js build: localPack({ company, role, resumeText, jobText, pay:null, stage })
//                           twice: the posting as the card sends it (job_text, lines kept, 6000 chars) and as the
//                           server reads it from `jobs` by job_id (clean(): control chars → spaces, 6000 chars)
//   • the free preview    — previewFrom({ company, role, resumeText, stage })
//   • paid Optimize       — api/resume.js tool:optimize: buildPaidOptimize over canonicalResumeText (+ taxonomy)
// and writes one Markdown file per case (side by side + consistency table + automatic findings) and
// summary.json / summary.md over all cases. Pure reads; writes only under --out.

import fs from 'node:fs';
import path from 'node:path';
import { runOptimizer } from '../lib/optimizer/index.js';
import { extractJobFacts } from '../lib/optimizer/extractJobFacts.js';
import { canonicalResumeText } from '../lib/resume/canonical.js';
import { buildJobInsights } from '../lib/server/jobInsights.js';
import { localPack } from '../lib/server/prepLocal.js';
import { buildPaidOptimize } from '../lib/server/optimizePackage.js';
import { previewFrom } from '../api/interview-prep.js';
import { numbersBacked } from '../lib/server/interviewPrep.js';
import { SOFT_SKILL_RE, SCREENING_RE } from '../lib/resume/optimize/engine.js';

// ── args ────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const outDir = arg('out', 'scripts/_tools-eval-out');
const corpus = arg('corpus') ? JSON.parse(fs.readFileSync(arg('corpus'), 'utf8')) : [];
const taxonomy = arg('taxonomy') ? JSON.parse(fs.readFileSync(arg('taxonomy'), 'utf8')) : null;
let cases;
if (arg('cases')) cases = JSON.parse(fs.readFileSync(arg('cases'), 'utf8'));
else cases = [{ id: arg('id', 'case'), resume: arg('resume'), posting: arg('posting'), title: arg('title'), company: arg('company'), stage: arg('stage', 'Interview') }];
fs.mkdirSync(outDir, { recursive: true });

// ── production's own posting preparation (api/interview-prep.js → lib/server/prepPosting.js) ────
// Since 2026-11-10 both Prep paths (the card's job_text and the server's job_id read) use ONE cleaning: lines kept,
// 20,000 characters; the job_id path reads the stored description alone. Prep also reads the same taxonomy.
import { cleanPostingText } from '../lib/server/prepPosting.js';

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const STOP = /^(?:and|the|for|with|experience|experienced|skills?|strong|proven|knowledge|ability|abilities|working|work|years?|of|in|or|a|an|to|preferred|required|plus|any|e\.g|similar|etc|basic|general|good|excellent)$/;
const stems = (t) => [...new Set(String(t || '').toLowerCase().replace(/^term:/, '').split(/[^a-z0-9+#&]+/).filter((w) => w.length > 1 && !STOP.test(w)).map((w) => w.replace(/(?:ing|ions?|ed|es|s)$/, '').slice(0, 5)).filter((w) => w.length > 1))];
const sameReq = (a, b) => { const x = stems(a), y = stems(b); if (!x.length || !y.length) return false; const shared = x.filter((w) => y.includes(w)); return shared.length > 0 && (shared.length === Math.min(x.length, y.length)); };
const label = (r) => (r.term ? r.surface : r.requirement);
// Markdown table cell: escape the escape character first, then the pipe, so `a\|b` cannot close a cell.
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const short = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const yearsIn = (t) => [...String(t || '').matchAll(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\b/gi)].map((m) => m[0]);
const payIn = (t) => [...String(t || '').matchAll(/\$\s?\d[\d,.]*(?:\s*[kK])?(?:\s*(?:[–—-]|to)\s*\$?\s?\d[\d,.]*(?:\s*[kK])?)?/g)].map((m) => m[0].replace(/\s+/g, ''));
const allStrings = (o, acc = []) => { if (o == null) return acc; if (typeof o === 'string') acc.push(o); else if (Array.isArray(o)) o.forEach((x) => allStrings(x, acc)); else if (typeof o === 'object') Object.values(o).forEach((x) => allStrings(x, acc)); return acc; };

function loadPosting(c) {
  if (c.posting && fs.existsSync(c.posting)) return { description: fs.readFileSync(c.posting, 'utf8'), title: c.title, company: c.company, source: 'file' };
  const row = corpus.find((r) => r.id === c.posting);
  if (!row) throw new Error(`posting not found: ${c.posting}`);
  return { description: row.description, title: c.title || row.title, company: c.company || row.company, source: row.source, location: row.location };
}

// ── one case ────────────────────────────────────────────────────────────────────────────────────
function runCase(c) {
  const resumeRaw = fs.readFileSync(c.resume, 'utf8');
  const resume = canonicalResumeText(resumeRaw);
  const p = loadPosting(c);
  const title = p.title, company = p.company, jd = p.description, stage = c.stage || 'Interview';
  const remoteOk = /\bremote\b/i.test(jd);

  // free fit check (api/optimizer.js)
  const jobFacts = extractJobFacts(jd, { jobTitle: title, company, taxonomy: taxonomy || undefined });
  const fit = runOptimizer({ resumeText: resume, jobTitle: title, company, jobDescription: jd, jobFacts, companyProcessScore: null, companyProcessConfidence: null, remoteOk, jobLocation: null, desiredLocation: null }, { taxonomy });
  // Job Insights
  const ins = buildJobInsights({ title, company, description: jd, needsSummary: true });
  // Interview Prep — the card's job_text path and the server's job_id path
  const jobTextCard = cleanPostingText(jd);
  const jobTextDb = cleanPostingText(jd);
  const prep = localPack({ company, role: title, resumeText: resumeRaw, jobText: jobTextCard, pay: null, stage, taxonomy });
  const prepDb = localPack({ company, role: title, resumeText: resumeRaw, jobText: jobTextDb, pay: null, stage, taxonomy });
  const preview = previewFrom({ company, role: title, resumeText: resumeRaw, stage });
  // paid Optimize
  const paid = buildPaidOptimize({ resume, jobDescription: jd, job: title, company, pro: false, jobId: c.id, taxonomy, fit: { companyProcessScore: null, companyProcessConfidence: null, remoteOk, jobLocation: null, desiredLocation: null } });

  // ── requirement sets ──
  const fitReqs = [
    ...fit.matched_requirements.map((r) => ({ label: label(r), key: r.requirement, importance: r.importance, status: r.inferred ? 'inferred' : 'matched', via: r.via, term: !!r.term, evidence: r.evidence, soft: !!r.soft })),
    ...fit.unsupported_requirements.map((r) => ({ label: label(r), key: r.requirement, importance: r.importance, status: 'missing', term: !!r.term, soft: !!r.soft })),
  ];
  const paidReqs = [
    ...paid.matched_requirements.map((r) => ({ label: label(r), status: r.inferred ? 'inferred' : 'matched' })),
    ...paid.unsupported_requirements.map((r) => ({ label: label(r), status: 'missing' })),
  ];
  const prepRows = (prep.job_match || []).map((m) => ({ label: m.label, status: m.status, duty: !!m.duty, proof: m.proof || '', say: m.say || '' }));
  const prepDbRows = (prepDb.job_match || []).map((m) => ({ label: m.label, status: m.status, duty: !!m.duty }));
  const insItems = ins.what_they_want || [];

  // consistency table: each fit requirement → what every other tool says
  const findPrep = (l) => prepRows.find((r) => !r.duty && sameReq(r.label, l)) || prepRows.find((r) => sameReq(r.label, l));
  const findIns = (l) => insItems.find((x) => sameReq(x.replace(/\s*\((?:preferred|or similar|e\.g\..*)\)\s*$/i, ''), l));
  const prepAnswerFor = (l) => prep.answers.find((a) => !a.frame && sameReq(String(a.q).replace(/^Tell me about your experience with /i, ''), l) && /^Tell me about your experience with/i.test(a.q));
  const table = fitReqs.map((r) => {
    const pr = findPrep(r.label);
    const pd = paidReqs.find((x) => x.label === r.label);
    const iv = findIns(r.label);
    const pa = prepAnswerFor(r.label);
    return { req: r.label, importance: r.importance, term: r.term, soft: !!r.soft || SOFT_SKILL_RE.test(r.label) || SCREENING_RE.test(r.label), fit: r.status, paid: pd ? pd.status : '—', prep: pr ? `${pr.status}${pr.label !== r.label ? ` (as "${pr.label}")` : ''}` : '—', prepStatus: pr ? pr.status : null, insights: iv ? `shown: "${iv}"` : '—', prepAnswer: pa ? 'story' : '' };
  });

  // ── disagreements ──
  const dis = [];
  for (const t of table) {
    const fitHas = t.fit === 'matched';
    if (fitHas && t.prepStatus === 'gap') dis.push({ kind: 'matched_vs_missing', detail: `"${t.req}": fit check = matched; Interview Prep = "Not on your résumé"` });
    if (t.fit === 'missing' && (t.prepStatus === 'shown' || t.prepStatus === 'stated')) dis.push({ kind: 'missing_vs_shown', detail: `"${t.req}": fit check = missing; Interview Prep = ${t.prepStatus}` });
    if (t.fit !== t.paid && t.paid !== '—') dis.push({ kind: 'fit_vs_paid', detail: `"${t.req}": fit ${t.fit} vs paid ${t.paid}` });
    // a soft skill (a trait) is shown by how you answer, never a job-match row — by design, not a disagreement
    if (t.importance === 'required' && t.prep === '—' && !t.soft) dis.push({ kind: 'prep_drops_requirement', detail: `"${t.req}" (required${t.term ? ', posting term' : ''}) is in the fit check but has no Interview Prep job-match row` });
  }
  for (const pr of prepRows.filter((r) => !r.duty)) {
    if (/^term:/.test(pr.label)) continue; // counted under leaks
    if (!fitReqs.some((r) => sameReq(r.label, pr.label)) && !/\byears?\b/i.test(pr.label)) dis.push({ kind: 'prep_only_requirement', detail: `Interview Prep row "${pr.label}" (${pr.status}) is not a requirement the fit check reads` });
  }
  for (const it of insItems) {
    const base = it.replace(/\s*\((?:preferred|or similar|e\.g\..*)\)\s*$/i, '').replace(/^Any of:\s*/, '');
    if (/\byears?\b|degree|diploma|license|licen[cs]e|certif|availability|bilingual|GED/i.test(base)) continue;
    if (!fitReqs.some((r) => sameReq(r.label, base) || base.split(/,\s*/).some((b) => sameReq(r.label, b)))) dis.push({ kind: 'insights_only_requirement', detail: `Insights shows "${it}" — not a requirement the fit check reads` });
  }
  // missing on fit + paid keywords
  const kwMissing = (paid.keywords_missing || []).map(String);
  const kwAdded = (paid.keywords_added || []).map(String);
  for (const k of kwMissing) { const f = fitReqs.find((r) => sameReq(r.label, k)); if (f && f.status === 'matched') dis.push({ kind: 'paid_keywords_vs_fit', detail: `paid "keywords_missing" lists "${k}" while the fit check matched it` }); }

  // years each tool states
  const years = {
    posting: yearsIn(jd).slice(0, 4),
    fit: fit.constraints.filter((c) => c.kind === 'years').map((c) => `${c.label} → ${c.status}: ${c.message || ''}`),
    fitVerdict: yearsIn(fit.verdict?.sentence),
    insights: insItems.filter((x) => /\byears?\b/i.test(x)),
    prep: [...prepRows.filter((r) => /\byears?\b/i.test(r.label)).map((r) => `${r.label}: ${r.status} — ${short(r.say, 90)}`), ...yearsIn(prep.intro).map((y) => `intro: ${y}`), ...prep.answers.filter((a) => a.script).flatMap((a) => yearsIn(a.answer).map((y) => `script: ${y}`))],
    paidSummary: yearsIn(paid.summary?.text),
    paidMessage: yearsIn(paid.application_message?.text || paid.application_message),
  };
  const yrsNums = (arr) => arr.flatMap((s) => [...String(s).matchAll(/(?:show|have|with|of)\s+(\d+(?:\.\d+)?)\+?\s*years?/gi)].map((m) => Number(m[1])));
  const stated = [...yrsNums(years.fit), ...yrsNums(years.prep), ...yrsNums([paid.summary?.text || '']), ...yrsNums([typeof paid.application_message === 'string' ? paid.application_message : paid.application_message?.text || '']), ...yrsNums([prep.intro || ''])];
  if (new Set(stated.map(Math.floor)).size > 1) dis.push({ kind: 'years_disagree', detail: `years of experience stated: ${[...new Set(stated)].join(' / ')}` });

  // pay each tool states
  const pay = { posting: payIn(jd).slice(0, 3), prep_posting_pay: prep.posting_pay, prep_scripts: prep.answers.filter((a) => a.script && /pay/i.test(a.q)).map((a) => short(a.answer, 120)), insights: payIn(allStrings(ins).join(' ')), paid: payIn(allStrings({ m: paid.application_message, s: paid.summary }).join(' ')) };
  if (pay.posting.length && pay.prep_posting_pay && !pay.posting.some((x) => x.replace(/[^\d]/g, '').startsWith(String(pay.prep_posting_pay).replace(/[^\d]/g, '').slice(0, 4)))) dis.push({ kind: 'pay_disagree', detail: `posting pay ${pay.posting[0]} vs prep "${pay.prep_posting_pay}"` });

  // ── automatic truth / quality checks ──
  const flags = [];
  const outText = allStrings({ prep, ins, paid: { s: paid.summary, m: paid.application_message, q: paid.questions }, fit: { v: fit.verdict, e: fit.explanation } });
  for (const s of outText) if (/\bterm:[a-z]/.test(s)) flags.push({ kind: 'term_key_leak', detail: short(s, 160) });
  for (const s of outText) { const m = s.match(/\b(\w{3,}(?:\s+\w+){0,2})\s+\1\b/i); if (m && !/\b(\d+)\b/.test(m[1])) flags.push({ kind: 'doubled_words', detail: `"${m[0]}" in: ${short(s, 140)}` }); }
  const factUse = new Map();
  for (const a of prep.answers) {
    if (a.frame) continue;
    if (a.resume_fact) factUse.set(a.resume_fact, [...(factUse.get(a.resume_fact) || []), a.q]);
    if (a.answer && !numbersBacked(a.answer, resumeRaw) && !a.script) flags.push({ kind: 'number_not_in_resume', detail: `${short(a.q, 80)} → ${short(a.answer, 160)}` });
    if (a.resume_fact && !resumeRaw.replace(/\s+/g, ' ').includes(a.resume_fact.replace(/\s+/g, ' ').slice(0, 40))) flags.push({ kind: 'fact_not_verbatim', detail: `${short(a.q, 80)} ← ${short(a.resume_fact, 120)}` });
    if (a.resume_fact && /^\s*(?:trained|certified|taught|coached|onboarded|mentored)\b/i.test(a.resume_fact) && !/\b(?:train|teach|coach|onboard|mentor|certif|develop|lead|leader)/i.test(a.q)) flags.push({ kind: 'teaching_line_for_doing_q', detail: `${short(a.q, 90)} ← ${short(a.resume_fact, 100)}` });
    const blanks = (String(a.answer || '').match(/\[[^\]]+\]/g) || []).length;
    if (blanks >= 3 && !a.frame) flags.push({ kind: 'mostly_blanks', detail: `${short(a.q, 80)} (${blanks} blanks)` });
  }
  for (const [f, qs] of factUse) if (qs.length >= 2) flags.push({ kind: 'line_reused', detail: `${qs.length}× "${short(f, 80)}" → ${qs.map((q) => `«${short(q, 60)}»`).join(', ')}` });
  for (const r of prepRows) if (r.status === 'gap' && /haven't (?:worked with|used|done|worked (?:in|on))/i.test(r.say) && /\bterm:|\b(?:policies|laws|leaders|insights?|environment)\b/i.test(r.label)) flags.push({ kind: 'gap_script_on_non_skill', detail: `"I haven't ${r.say.match(/haven't ([^.]+?) yet/)?.[1] || '…'} yet"` });
  if (prepRows.length !== prepDbRows.length || prepRows.filter((r) => r.status === 'shown').length !== prepDbRows.filter((r) => r.status === 'shown').length) dis.push({ kind: 'prep_jobid_path_differs', detail: `job_text path: ${prepRows.length} rows / ${prepRows.filter((r) => r.status === 'shown').length} shown · job_id (flattened) path: ${prepDbRows.length} rows / ${prepDbRows.filter((r) => r.status === 'shown').length} shown` });
  const termFacts = fitReqs.filter((r) => r.term);

  // ── markdown ──
  const L = [];
  L.push(`# ${c.id}: ${path.basename(c.resume)} × ${title} — ${company}`, '', `Source: ${p.source}${p.location ? ` · ${p.location}` : ''} · stage: ${stage} · posting ${jd.length} chars${/\n/.test(jd) ? '' : ' (flat, no line breaks)'} · posting id/file: \`${c.posting}\``, '');
  L.push('## Scores and verdicts', '', `- **Fit check:** ${fit.fit_score ?? '—'} (${fit.fit_band}) — ${esc(fit.verdict?.sentence)} · requirements read: ${fit.requirement_count} (${termFacts.length} posting terms)`, `- **Paid Optimize:** ${paid.fit_score ?? '—'} — ${esc(paid.verdict?.sentence || paid.verdict)}`, `- **Insights:** read=${ins.read} · ${ins.requirements_read} requirements read · ${insItems.length} shown`, `- **Prep:** ${prep.questions.length} questions · ${prep.answers.filter((a) => !a.frame && !a.script).length} résumé stories · ${prep.answers.filter((a) => a.script).length} scripts · ${prep.answers.filter((a) => a.frame).length} frames · job-match ${prepRows.length} rows (${prepRows.filter((r) => r.status === 'shown').length} shown) · guide: ${prep.guide ? prep.guide.company : 'none'} · job_id path: ${prepDbRows.length} rows (${prepDbRows.filter((r) => r.status === 'shown').length} shown)`, '');
  L.push('## Consistency table (each requirement the fit check reads)', '', '| requirement | imp | fit | paid | prep job-match | prep story | insights |', '|---|---|---|---|---|---|---|');
  for (const t of table) L.push(`| ${esc(t.req)}${t.term ? ' ᵗ' : ''} | ${t.importance} | ${t.fit} | ${t.paid} | ${esc(t.prep)} | ${t.prepAnswer} | ${esc(t.insights)} |`);
  L.push('', 'ᵗ = posting term (lib/optimizer/postingTerms.js)', '');
  L.push('## Disagreements (automatic)', '', ...(dis.length ? dis.map((d) => `- **${d.kind}** — ${esc(d.detail)}`) : ['- none detected']), '');
  L.push('## Quality / truth flags (automatic)', '', ...(flags.length ? flags.map((f) => `- **${f.kind}** — ${esc(f.detail)}`) : ['- none']), '');
  L.push('## Years stated', '', '```json', JSON.stringify(years, null, 1), '```', '', '## Pay stated', '', '```json', JSON.stringify(pay, null, 1), '```', '');
  L.push('## Fit check constraints', '', ...fit.constraints.map((x) => `- ${x.kind}: ${esc(x.label)} → **${x.status}** ${esc(x.message || '')}`), '');
  L.push('## Job Insights', '', '**What they want:**', ...insItems.map((x) => `- ${esc(x)}`), '', '**Hidden requirements:**', ...(ins.hidden_requirements || []).map((x) => `- ${esc(x)}`), '', `**Insider tip:** ${esc(ins.insider_tip)}`, '', `**Summary:** ${esc(ins.description_summary)}`, '');
  L.push('## Interview Prep — intro', '', `> ${esc(prep.intro)}`, '', `**Format:** ${esc(prep.format)}`, '', `**Posting pay:** ${esc(prep.posting_pay)}`, '');
  L.push('## Interview Prep — job match', '', '| requirement | status | proof / what to say |', '|---|---|---|', ...prepRows.map((r) => `| ${esc(r.label)}${r.duty ? ' (duty)' : ''} | ${r.status} | ${esc(short(r.proof || r.say, 200))} |`), '');
  L.push('## Interview Prep — questions and answers', '');
  const ansBy = new Map(prep.answers.map((a) => [a.q, a]));
  prep.questions.forEach((q, i) => {
    const a = ansBy.get(q.q);
    const kind = !a ? (/^Tell me about yourself/.test(q.q) ? 'intro' : 'none') : a.exercise ? 'exercise' : a.frame ? 'frame' : a.script ? 'script' : 'story';
    L.push(`${i + 1}. **${esc(q.q)}**${q.company ? ' _(company)_' : ''} — _${kind}_`);
    if (a && a.answer) L.push(`   - ${esc(a.answer)}`);
    if (a && a.resume_fact) L.push(`   - ← résumé: ${esc(a.resume_fact)}`);
    if (a && a.hint) L.push(`   - hint: ${esc(a.hint)}`);
    if (a && a.reference) L.push(`   - reference: ${esc(a.reference)}`);
  });
  L.push('', '**Ask them:**', ...(prep.ask_them || []).map((q) => `- ${esc(q.q)}`), '');
  L.push('## Free preview', '', ...preview.questions.map((q) => `- ${esc(q.q)}`), '', preview.answer ? `> **${esc(preview.answer.q)}** ${esc(preview.answer.answer)}  \n> ← ${esc(preview.answer.resume_fact)}` : '_no story_', '');
  L.push('## Paid Optimize — summary and message', '', `**Summary:** ${esc(paid.summary?.text || '—')}`, '', `**Application message:** ${esc(typeof paid.application_message === 'string' ? paid.application_message : paid.application_message?.text || JSON.stringify(paid.application_message || ''))}`, '', `**keywords_missing:** ${esc(kwMissing.join(', '))} · **keywords_added:** ${esc(kwAdded.join(', '))}`, '', `**Number questions:** ${esc((paid.questions || []).map((q) => q.question).join(' | '))}`, '');
  L.push('## Fit check — matched evidence', '', ...fit.matched_requirements.map((r) => `- ${esc(label(r))}${r.inferred ? ' (inferred)' : ''} [${r.via}] ← ${esc(short(r.evidence, 140))}`), '');
  fs.writeFileSync(path.join(outDir, `${c.id}.md`), L.join('\n'));

  return { id: c.id, resume: path.basename(c.resume), title, company, source: p.source, fit: fit.fit_score, paid: paid.fit_score, reqs: fitReqs.length, terms: termFacts.length, insights: insItems.length, prepRows: prepRows.length, prepShown: prepRows.filter((r) => r.status === 'shown').length, prepDbRows: prepDbRows.length, prepDbShown: prepDbRows.filter((r) => r.status === 'shown').length, stories: prep.answers.filter((a) => !a.frame && !a.script).length, frames: prep.answers.filter((a) => a.frame).length, questions: prep.questions.length, guide: prep.guide?.company || null, disagreements: dis, flags };
}

const results = [];
for (const c of cases) {
  try { results.push(runCase(c)); process.stderr.write(`✓ ${c.id}\n`); }
  catch (e) { process.stderr.write(`✗ ${c.id}: ${e.stack}\n`); results.push({ id: c.id, error: e.message }); }
}
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(results, null, 1));
const S = ['# Tools consistency eval — summary', '', '| case | résumé | posting | fit | paid | reqs (terms) | insights | prep rows (shown) | job_id path rows (shown) | stories/frames | disagreements | flags |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const r of results) {
  if (r.error) { S.push(`| ${r.id} | error: ${esc(r.error)} |`); continue; }
  S.push(`| [${r.id}](${r.id}.md) | ${r.resume} | ${esc(short(`${r.title} — ${r.company}`, 60))} | ${r.fit ?? '—'} | ${r.paid ?? '—'} | ${r.reqs} (${r.terms}) | ${r.insights} | ${r.prepRows} (${r.prepShown}) | ${r.prepDbRows} (${r.prepDbShown}) | ${r.stories}/${r.frames} | ${r.disagreements.length} | ${r.flags.length} |`);
}
const kinds = {};
for (const r of results) for (const x of [...(r.disagreements || []), ...(r.flags || [])]) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
S.push('', '## Finding kinds over all cases', '', ...Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`));
fs.writeFileSync(path.join(outDir, 'summary.md'), S.join('\n'));
console.log(S.join('\n'));
