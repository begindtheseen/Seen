#!/usr/bin/env node
// Résumé Studio evaluator — runs the WHOLE document path a person goes through and writes what came out.
//
//   résumé (.txt / .pdf / .docx) → extract + parse (parse fidelity against the source text) → Health →
//   tailorResume plan (decisions, bullets kept/cut, composed suggestions, summary, skills edits, gaps,
//   prompts, score before → after) → the tailored variant as text → render PDF + DOCX (lib/resume/render)
//   → re-extract the rendered files with the real extractor and diff against what was intended (ATS round
//   trip) → a truth check (every word of the tailored document must come from the base résumé).
//
// Usage:
//   node scripts/studio-eval.mjs --resume lib/fixtures/personas/nurse.txt --posting <corpus id prefix|file.txt> \
//        [--corpus path/all.json] [--title "…"] [--company "…"] [--out dir (default scripts/_studio-eval-out, git-ignored)] [--name case-id]
//   node scripts/studio-eval.mjs --batch cases.json [--corpus …] [--out dir]
//        cases.json = [{ name, resume, posting, title?, company?, truth? }]   (truth = source .txt for a .pdf)
//
// Writes <out>/<name>/{case.md, tailored.pdf, tailored.docx, base.pdf, result.json} and <out>/scorecard.md.
// Read-only: no network, no database, no model. Deterministic apart from ids.

import fs from 'node:fs';
import path from 'node:path';
import { parseResume } from '../lib/resume/parse/index.js';
import { extractResumeFile } from '../lib/resume/extract/index.js';
import { serializeToText } from '../lib/resume/model.js';
import { scoreResume } from '../lib/resume/health/score.js';
import { tailorResume } from '../lib/resume/tailor/tailor.js';
import { extractJobKeywords } from '../lib/resume/tailor/keywords.js';
import { postingTermWeights } from '../lib/resume/tailor/postingTerms.js';
import { renderPdf, renderDocx, renderText } from '../lib/resume/render/index.js';
import { atsCheck } from '../lib/resume/render/atsCheck.js';
import { runOptimizer } from '../lib/optimizer/index.js';
import { unoptimizableListing } from '../lib/server/optimizePackage.js';

const argv = process.argv.slice(2);
const arg = (k, d = '') => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };

const norm = (s) => String(s || '').toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z0-9+#.' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').map((w) => w.replace(/^[.']+|[.']+$/g, '')).filter((w) => w.length >= 3);
const stem = (w) => w.replace(/(ings|ing|ied|ies|ed|es|s|ly)$/, '').slice(0, 7);
const HEADER_LINE = /^(professional\s+)?(summary|experience|work experience|education|skills|certifications?|licenses?.*|objective|profile|projects?)\s*:?$/i;

async function loadResume(file, truthFile) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  let doc, extractedText = '', layout = null;
  if (ext === '.txt' || ext === '.md') {
    extractedText = buf.toString('utf8');
    doc = parseResume({ text: extractedText, source: 'text', fileName: path.basename(file) });
  } else {
    const ex = await extractResumeFile({ buffer: buf, fileName: path.basename(file) });
    if (!ex.ok) throw new Error(`extract failed: ${ex.error}`);
    extractedText = ex.text; layout = ex.layout;
    doc = parseResume({ text: ex.text, lines: ex.lines, source: ex.fileType, layout: ex.layout, fileName: path.basename(file) });
  }
  const sib = truthFile || (ext !== '.txt' ? file.replace(/\.[a-z]+$/i, '.txt') : file);
  const truth = fs.existsSync(sib) ? fs.readFileSync(sib, 'utf8') : extractedText;
  return { doc, extractedText, truth, layout };
}

function loadPosting(spec, corpusPath) {
  if (fs.existsSync(spec)) return { id: path.basename(spec), title: '', company: '', description: fs.readFileSync(spec, 'utf8') };
  const all = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const j = all.find((x) => x.id === spec || x.id.startsWith(spec));
  if (!j) throw new Error(`posting ${spec} not in corpus`);
  return j;
}

// ── parse fidelity: every source line accounted for somewhere in the parsed document ──
function parseFidelity(truth, doc) {
  const docText = serializeToText(doc);
  const have = new Set(toks(docText).map(stem));
  const lines = truth.split(/\n/).map((l) => l.trim()).filter((l) => l && !HEADER_LINE.test(l));
  const lost = [];
  let ok = 0, wordsAll = 0, wordsHave = 0;
  for (const l of lines) {
    const t = toks(l);
    if (!t.length) { ok++; continue; }
    const present = t.filter((w) => have.has(stem(w)));
    wordsAll += t.length; wordsHave += present.length;
    if (present.length / t.length >= 0.8) ok++;
    else lost.push({ line: l, missing: t.filter((w) => !have.has(stem(w))) });
  }
  // mis-filing heuristics
  const misfiled = [];
  for (const e of doc.experience) {
    if (!e.title) misfiled.push(`role with no title (company "${e.company}")`);
    if (!e.company) misfiled.push(`role "${e.title}" has no company`);
    if (!e.start && !e.end && !e.dateText) misfiled.push(`role "${e.title} @ ${e.company}" has no dates`);
    if (/\b(19|20)\d{2}\b/.test(`${e.title} ${e.company}`)) misfiled.push(`date text inside title/company: "${e.title}" / "${e.company}"`);
    if (e.title && e.title.split(/\s+/).length > 9) misfiled.push(`long title (sentence filed as title?): "${e.title}"`);
    for (const b of e.bullets) if (/^\s*(19|20)\d{2}\s*[–-]/.test(b.text) || /—.*\b(19|20)\d{2}\s*[–-]\s*((19|20)\d{2}|present)/i.test(b.text)) misfiled.push(`role-like line filed as a bullet of "${e.title}": "${b.text.slice(0, 90)}"`);
  }
  for (const g of doc.skills) for (const it of g.items) if (it.length > 60) misfiled.push(`long skills item: "${it.slice(0, 90)}"`);
  return { lines: lines.length, ok, linePct: Math.round((ok / Math.max(1, lines.length)) * 100), wordPct: Math.round((wordsHave / Math.max(1, wordsAll)) * 100), lost, misfiled };
}

function docOutline(doc) {
  const o = [];
  const b = doc.basics;
  o.push(`- **Contact:** ${[b.name, b.headline, b.email, b.phone, b.location && (b.location.city || b.location.text || JSON.stringify(b.location)), ...(b.profiles || []).map((p) => p.url)].filter(Boolean).join(' · ')}`);
  if (b.summary) o.push(`- **Summary:** ${b.summary.replace(/\n/g, ' ')}`);
  for (const e of doc.experience) {
    o.push(`- **Role:** ${e.title || '∅'} | ${e.company || '∅'} | ${e.location || ''} | ${e.start || '∅'} → ${e.end || '∅'}${e.dateText ? ` ("${e.dateText}")` : ''} | ${e.bullets.length} bullets${e.summary ? ` | summary: ${e.summary}` : ''}`);
  }
  for (const e of doc.education) o.push(`- **Education:** ${[e.degree, e.field, e.institution, e.end || e.dateText].filter(Boolean).join(' | ')}${e.details?.length ? ` | details: ${e.details.join(' / ')}` : ''}`);
  for (const g of doc.skills) o.push(`- **Skills${g.label ? ` (${g.label})` : ''}:** ${g.items.join(' · ')}`);
  for (const c of doc.certifications) o.push(`- **Cert:** ${c.text || c.name}`);
  for (const l of doc.languages) o.push(`- **Language:** ${l.language || l.text || JSON.stringify(l)}`);
  for (const x of doc.extra) o.push(`- **Extra (${x.title || x.kind}):** ${x.items.map((i) => (typeof i === 'string' ? i : i.text)).join(' / ')}`);
  for (const w of doc.meta.warnings || []) o.push(`- _parser warning:_ ${w.code}: ${w.message}`);
  return o.join('\n');
}

// words of the tailored text that the base résumé never uses (the truth check)
const TEMPLATE_WORDS = new Set(['relevant', 'additional', 'experience', 'summary', 'skills', 'education', 'certifications', 'professional', 'strengths', 'with', 'years', 'most', 'recently', 'previously', 'and', 'the', 'including', 'candidate', 'present', 'licenses', 'projects', 'languages']);
function truthCheck(baseText, variantText) {
  const have = new Set(toks(baseText).map(stem));
  const newWords = new Map();
  for (const line of variantText.split('\n')) {
    for (const w of toks(line)) {
      if (have.has(stem(w)) || TEMPLATE_WORDS.has(w)) continue;
      if (!newWords.has(w)) newWords.set(w, line.trim());
    }
  }
  const baseNums = new Set((baseText.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]$/, '')));
  const newNums = [...new Set((variantText.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]$/, '')))].filter((n) => !baseNums.has(n));
  return { newWords: [...newWords].map(([w, line]) => ({ word: w, line })), newNumbers: newNums };
}

async function roundTrip(variant, intendedText) {
  const out = {};
  const pdf = await renderPdf(variant, { template: 'classic', pro: false });
  const docx = await renderDocx(variant, { template: 'classic', pro: false });
  out.pdfBuf = pdf.buffer; out.docxBuf = docx.buffer; out.pages = pdf.pages; out.font = pdf.font;
  const intended = new Set(toks(intendedText));
  for (const [fmt, buf] of [['pdf', pdf.buffer], ['docx', docx.buffer]]) {
    const ex = await extractResumeFile({ buffer: buf, fileName: `t.${fmt}` });
    if (!ex.ok) { out[fmt] = { ok: false, error: ex.error }; continue; }
    const got = new Set(toks(ex.text));
    const missing = [...intended].filter((w) => !got.has(w));
    const extra = [...got].filter((w) => !intended.has(w) && !/^(seen|seenjobs|optimized|seenjobs.io|page)$/.test(w));
    const reparsed = parseResume({ text: ex.text, lines: ex.lines, source: ex.fileType, layout: ex.layout });
    out[fmt] = { ok: true, wordPct: Math.round(((intended.size - missing.length) / Math.max(1, intended.size)) * 100), missing: missing.slice(0, 30), extra: extra.slice(0, 20), roles: reparsed.experience.map((e) => `${e.title} | ${e.company} | ${e.start}→${e.end} | ${e.bullets.length}b`), intendedRoles: variant.experience.map((e) => `${e.title} | ${e.company} | ${e.start}→${e.end} | ${e.bullets.length}b`), text: ex.text };
  }
  for (const fmt of ['pdf', 'docx']) {
    const c = await atsCheck(variant, { format: fmt, template: 'classic' });
    out[fmt].ats = { score: c.score, grade: c.grade, failed: (c.checks || []).filter((k) => !k.ok).map((k) => `${k.label} — ${k.detail}`) };
  }
  return out;
}

function yearsIn(s) { const m = String(s || '').match(/(\d+(?:\.\d+)?)\+?\s*years?/i); return m ? m[0] : null; }

async function runCase(c, corpusPath, outDir) {
  const t0 = Date.now();
  const { doc, truth, layout } = await loadResume(c.resume, c.truth);
  const j = loadPosting(c.posting, corpusPath);
  const jobTitle = c.title ?? j.title ?? '';
  const company = c.company ?? j.company ?? '';
  const jd = j.description || '';
  const baseText = serializeToText(doc);
  const fid = parseFidelity(truth, doc);
  const health = scoreResume(doc);
  const unopt = unoptimizableListing({ resume: baseText, jobDescription: jd, job: jobTitle, company });
  const { plan, variant } = tailorResume(doc, { jobTitle, company, jobDescription: jd, location: j.location || '' });
  const tailorMs = Date.now() - t0;
  const variantText = renderText(variant);
  const variantCanon = serializeToText(variant);
  const truthRes = truthCheck(baseText, variantCanon);
  const fitBefore = runOptimizer({ resumeText: baseText, jobTitle, company, jobDescription: jd });
  const fitAfter = runOptimizer({ resumeText: variantCanon, jobTitle, company, jobDescription: jd });
  // posting-terms reader vs the tailor's own vocabulary
  const tailorKw = extractJobKeywords(jd, { jobTitle, company, location: j.location || '' });
  const termW = [...postingTermWeights(jd, { jobTitle, company })].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const reqs = [...(fitBefore.matched_requirements || []), ...(fitBefore.unsupported_requirements || [])];
  const kwSurf = tailorKw.flatMap((k) => k.surfaces);
  const reqInTailor = reqs.map((r) => {
    const lab = norm(r.surface || r.requirement).replace(/^term /, '');
    const hit = kwSurf.find((s) => s.length >= 3 && (lab.includes(s) || s.includes(lab)));
    return { label: r.surface || r.requirement, matched: !!r.matched, evidence: r.evidence || null, tailorKeyword: hit || null };
  });
  // evidence lines the fit check relies on — still on the tailored page?
  const evidenceLost = reqs.filter((r) => r.matched && r.evidence && r.evidenceKind === 'experience' && !variantCanon.includes(String(r.evidence).replace(/^[•\-\s]+/, '').slice(0, 40))).map((r) => ({ req: r.surface || r.requirement, evidence: r.evidence }));
  const lostAfter = (fitBefore.matched_requirements || []).filter((m) => !(fitAfter.matched_requirements || []).some((a) => a.requirement === m.requirement)).map((m) => m.surface || m.requirement);

  const rt = await roundTrip(variant, variantText);
  const basePdf = await renderPdf(doc, { template: 'classic', pro: false });

  // per-role diff: bullets kept / cut / order
  const roleDiff = plan.decisions.map((d) => {
    const e = doc.experience.find((x) => x.id === d.itemId) || { bullets: [] };
    const ve = variant.experience.find((x) => x.id === d.itemId);
    const kept = ve ? ve.bullets.map((b) => b.text) : [];
    const cut = e.bullets.filter((b) => !kept.includes(b.text)).map((b) => b.text);
    const shared = (d.shared || []).map((s) => `${s.competency}${s.evidenced ? ' ✓' : ''}`).join(', ');
    return { title: d.title, company: d.company, tier: d.tier, decision: d.decision, relevance: d.relevance, current: d.current, reasons: d.reasons, shared, kept, cut, of: e.bullets.length };
  });
  const suggestions = (variant.meta.provenance || []).filter((p) => p.kind === 'transferable_suggestion').map((p) => `${p.text}  (${p.basis})`);

  const name = c.name;
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tailored.pdf'), rt.pdfBuf);
  fs.writeFileSync(path.join(dir, 'tailored.docx'), rt.docxBuf);
  fs.writeFileSync(path.join(dir, 'base.pdf'), basePdf.buffer);
  fs.writeFileSync(path.join(dir, 'tailored-roundtrip.txt'), rt.pdf.text || '');

  const md = [];
  md.push(`# ${name}`, '', `**Résumé:** \`${c.resume}\` · **Posting:** ${jobTitle} — ${company} (\`${j.id}\`, ${jd.length} chars) · tailor ${tailorMs} ms`, '');
  md.push(`**Score (SeenFit):** ${plan.score.before} → ${plan.score.after} (${plan.score.verdictBefore?.band || ''} → ${plan.score.verdict?.band || ''}); requirements read: ${plan.score.requirementCount}; tailor keyword coverage ${plan.score.keywordCoverage.before} → ${plan.score.keywordCoverage.after}; objective ${JSON.stringify(plan.objective?.before ?? plan.objective)?.slice(0, 200)}`);
  md.push(`**No-gain (free) would fire:** ${plan.score.before != null && plan.score.after != null && plan.score.after <= plan.score.before ? 'YES' : 'no'} · **Unoptimizable (422):** ${unopt ? unopt.message : 'no'} · **summaryKept:** ${!!plan.summaryKept} · **layout:** ${plan.strategy?.layout} · **job family:** ${plan.job.familyLabel} (${plan.job.family})`, '');
  md.push('## 1. Parse fidelity', '', `Lines accounted for: ${fid.ok}/${fid.lines} (${fid.linePct}%) · words ${fid.wordPct}% · layout ${layout ? JSON.stringify({ method: layout.method, columns: layout.columns }) : 'text'}`, '');
  if (fid.lost.length) { md.push('Lost / partly lost source lines:'); for (const l of fid.lost) md.push(`- "${l.line}" — missing: ${l.missing.join(', ')}`); md.push(''); }
  if (fid.misfiled.length) { md.push('Mis-filed:'); for (const m of fid.misfiled) md.push(`- ${m}`); md.push(''); }
  md.push('Parsed structure:', '', docOutline(doc), '');
  md.push('## 2. Health', '', `Score ${health.score} (${health.grade || health.band || ''}) · ${JSON.stringify(health.categories ? Object.fromEntries(Object.entries(health.categories).map(([k, v]) => [k, v.score ?? v])) : {})}`, '');
  for (const f of (health.findings || []).slice(0, 12)) md.push(`- [${f.severity || f.level || ''}] ${f.message || f.title || f.code}${f.fix && f.fix.text ? ` → fix: "${f.fix.text}"` : ''}`);
  md.push('', '## 3. Tailor plan', '');
  md.push('### Decisions');
  for (const r of roleDiff) {
    md.push(`- **${r.title} @ ${r.company}** — ${r.tier} / **${r.decision}** · relevance ${r.relevance}${r.current ? ' · current' : ''} · kept ${r.kept.length}/${r.of}`);
    md.push(`  - reasons: ${(r.reasons || []).join(' | ')}`);
    md.push(`  - shared competencies: ${r.shared || '—'}`);
    for (const k of r.kept) md.push(`  - KEPT: ${k}`);
    for (const k of r.cut) md.push(`  - CUT: ${k}`);
  }
  md.push('', '### Summary', '', `- before: ${doc.basics.summary ? doc.basics.summary.replace(/\n/g, ' ') : '(none)'}`, `- after: ${variant.basics.summary ? variant.basics.summary.replace(/\n/g, ' ') : '(none)'}`, `- years in summary: ${yearsIn(variant.basics.summary)} · years in fit sentence: ${yearsIn(fitAfter.verdict?.sentence) || yearsIn(JSON.stringify(fitAfter.constraints || []))}`);
  md.push('', '### Skills edits', '');
  for (const r of plan.skills.reorders) md.push(`- reorder: ${r.from.join(', ')} → ${r.to.join(', ')}`);
  for (const a of plan.skills.additions) md.push(`- ADD "${a.listed}" ← ${a.evidence}`);
  md.push('', '### Composed suggestions (off by default)', '', ...(suggestions.length ? suggestions.map((s) => `- ${s}`) : ['- none']));
  md.push('', '### Prompts ("Make it stronger")', '', ...((plan.prompts || []).length ? plan.prompts.map((p) => `- ${p.roleTitle} · ${p.company}: **${p.question}** (unit ${p.unit})`) : ['- none']));
  md.push('', '### Gaps', '', ...(plan.gaps.length ? plan.gaps.map((g) => `- [${g.severity}] ${g.requirement} — ${g.explanation}`) : ['- none']));
  md.push('', '### Wording proposals (plan.rewrites, off by default)', '', ...((plan.rewrites || []).length ? plan.rewrites.map((r) => `- "${r.from}" → "${r.to}"`) : ['- none']));
  md.push('', '### Terminology swaps proposed', '', ...(plan.terminology.length ? plan.terminology.map((t) => `- "${t.alias}" → "${t.term}" in: ${t.from}`) : ['- none']));
  md.push('', '## 4. Posting terms vs the tailor vocabulary', '');
  md.push(`Posting-terms reader (SeenFit) requirements: ${reqs.length}; with a tailor keyword: ${reqInTailor.filter((r) => r.tailorKeyword).length}`);
  for (const r of reqInTailor) md.push(`- ${r.matched ? '✓' : '✗'} ${r.label}${r.evidence ? ` ← "${String(r.evidence).slice(0, 80)}"` : ''} · tailor keyword: ${r.tailorKeyword || '—'}`);
  md.push('', `Tailor keywords (top 20): ${tailorKw.slice(0, 20).map((k) => `${k.display} (${k.weight}, ${k.source})`).join(' · ')}`);
  md.push('', `Tailor posting-term stems (top 20): ${termW.map(([s, w]) => `${s}:${w}`).join(' · ')}`);
  md.push('', `Fit evidence lines cut by the tailor: ${evidenceLost.length ? evidenceLost.map((e) => `${e.req} ← "${e.evidence}"`).join(' | ') : 'none'}`);
  md.push(`Requirements matched before but not after: ${lostAfter.length ? lostAfter.join(', ') : 'none'}`);
  md.push('', '## 5. Truth check (words in the tailored document that the base never uses)', '');
  md.push(...(truthRes.newWords.length ? truthRes.newWords.map((w) => `- "${w.word}" in: ${w.line}`) : ['- none']));
  md.push(`- new numbers: ${truthRes.newNumbers.join(', ') || 'none'}`);
  md.push('', '## 6. Round trip', '');
  for (const fmt of ['pdf', 'docx']) {
    const r = rt[fmt];
    if (!r.ok) { md.push(`- ${fmt}: FAILED ${r.error}`); continue; }
    md.push(`- **${fmt}**: words back ${r.wordPct}% · ATS ${r.ats.score} ${r.ats.grade || ''}${fmt === 'pdf' ? ` · pages ${rt.pages} · font ${rt.font}` : ''}`);
    if (r.missing.length) md.push(`  - missing words: ${r.missing.join(', ')}`);
    if (r.ats.failed.length) md.push(`  - failed checks: ${r.ats.failed.join(' | ')}`);
    md.push(`  - roles intended: ${r.intendedRoles.join(' ; ')}`);
    md.push(`  - roles read back: ${r.roles.join(' ; ')}`);
  }
  md.push('', '## 7. Base résumé (source text)', '', '```', truth.trim(), '```', '', '## 8. Tailored résumé (as rendered text)', '', '```', variantText.trim(), '```', '');
  fs.writeFileSync(path.join(dir, 'case.md'), md.join('\n'));

  const result = {
    name, resume: c.resume, posting: `${jobTitle} — ${company}`, parseLinePct: fid.linePct, parseWordPct: fid.wordPct, lost: fid.lost.length, misfiled: fid.misfiled.length,
    health: health.score, before: plan.score.before, after: plan.score.after, reqs: plan.score.requirementCount, noGain: plan.score.before != null && plan.score.after != null && plan.score.after <= plan.score.before,
    unopt: !!unopt, layout: plan.strategy?.layout, family: plan.job.family, pages: rt.pages, pdfWords: rt.pdf.wordPct, docxWords: rt.docx.wordPct, atsPdf: rt.pdf.ats.score, atsDocx: rt.docx.ats.score,
    newWords: truthRes.newWords.map((w) => w.word), newNumbers: truthRes.newNumbers, reqs_total: reqs.length, reqs_in_tailor_vocab: reqInTailor.filter((r) => r.tailorKeyword).length,
    evidenceLost: evidenceLost.length, lostAfter, summaryBefore: doc.basics.summary || '', summaryAfter: variant.basics.summary || '', summaryKept: !!plan.summaryKept,
    decisions: roleDiff.map((r) => `${r.title}@${r.company}:${r.tier}/${r.decision}(${r.kept.length}/${r.of})`), skillsAdded: plan.skills.additions.map((a) => a.listed), gaps: plan.gaps.map((g) => `${g.severity}:${g.requirement}`), prompts: (plan.prompts || []).map((p) => p.question), rewrites: (plan.rewrites || []).length, suggestions,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const corpus = arg('corpus', process.env.STUDIO_EVAL_CORPUS || '');
  const outDir = arg('out', 'scripts/_studio-eval-out'); // scripts/_* is git-ignored
  fs.mkdirSync(outDir, { recursive: true });
  const cases = arg('batch') ? JSON.parse(fs.readFileSync(arg('batch'), 'utf8')) : [{ name: arg('name', 'case'), resume: arg('resume'), posting: arg('posting'), title: arg('title') || undefined, company: arg('company') || undefined }];
  const results = [];
  for (const c of cases) {
    try { results.push(await runCase(c, corpus, outDir)); process.stderr.write(`ok ${c.name}\n`); }
    catch (e) { process.stderr.write(`FAIL ${c.name}: ${e.stack}\n`); results.push({ name: c.name, error: String(e.message) }); }
  }
  const rows = ['| case | parse lines % | health | fit before→after | no-gain free | reqs | reqs in tailor vocab | evidence cut | new words | pages | PDF words back % | ATS pdf/docx |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of results) {
    if (r.error) { rows.push(`| ${r.name} | ERROR ${r.error} |`); continue; }
    rows.push(`| ${r.name} | ${r.parseLinePct} | ${r.health} | ${r.before}→${r.after} | ${r.noGain ? 'yes' : 'no'} | ${r.reqs} | ${r.reqs_in_tailor_vocab}/${r.reqs_total} | ${r.evidenceLost} | ${r.newWords.length} | ${r.pages} | ${r.pdfWords} | ${r.atsPdf}/${r.atsDocx} |`);
  }
  fs.writeFileSync(path.join(outDir, 'scorecard.md'), rows.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(rows.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
