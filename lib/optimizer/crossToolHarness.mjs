// The cross-tool harness (X, 2026-11-10): ONE résumé × ONE posting run through every tool the way its handler runs it,
// reduced to what each tool PRINTS about the posting's requirements — the count, the band, the score, the verdict
// sentence, the status per statement id, the evidence line per statement and the gate sentences. Used by
// crossTool.test.mjs (the acceptance test: tools agree with each other) and by the director's spot scripts.
//
// No network, no DB: the fit context is the one the free check uses with no database (remote read from the posting).
import { runOptimizer } from './index.js';
import { extractJobFacts } from './extractJobFacts.js';
import { canonicalResumeText } from '../resume/canonical.js';
import { parseResume } from '../resume/parse/index.js';
import { postingTextForReader, buildJobInsights, insightReading } from '../server/jobInsights.js';
import { postingSaysRemote } from '../server/fitContext.js';
import { freeDiagnostic, buildPaidOptimize } from '../server/optimizePackage.js';
import { tailorAction } from '../server/resumeStudio.js';
import { localPack } from '../server/prepLocal.js';
import { cleanPostingText } from '../server/prepPosting.js';
import * as statementsMod from './statements.js';
import { failedGates } from './constraints.js';
import { sharedGates, matchListing, buildJobKeys } from '../server/jobKeys.js';

/** THE requirement count from the shared reader module (whatever its current name), for tools with no verdict. */
export function sharedCount(statements) {
  const fn = statementsMod.displayedRequirementCount || statementsMod.requirementCount;
  return fn(statements || []);
}

const noDbFit = (jd) => ({ companyProcessScore: null, companyProcessConfidence: null, remoteOk: postingSaysRemote(jd), jobLocation: null, desiredLocation: null });

/** api/optimizer.js action:optimize, without the DB. */
export function runFree({ resume, title, company, description }) {
  const jd = postingTextForReader(description);
  const jobFacts = extractJobFacts(jd, { jobTitle: title, company });
  const out = runOptimizer({ resumeText: canonicalResumeText(String(resume)), jobId: null, jobTitle: title, company, jobDescription: jd, jobFacts, ...noDbFit(jd) }, { taxonomy: null });
  return freeDiagnostic(out);
}
/** api/resume.js tool:optimize (the package, before the charge). */
export function runPaid({ resume, title, company, description }) {
  const jd = postingTextForReader(description);
  return buildPaidOptimize({ resume: canonicalResumeText(String(resume)), resumeIsCanonical: true, original: String(resume), jobDescription: jd, job: title, company, pro: false, jobId: 'x', taxonomy: null, fit: noDbFit(jd), posting: null });
}
/** api/resume.js action:tailor (the Studio sends the parsed document). */
export async function runStudio({ resume, title, company, description }) {
  const jd = postingTextForReader(description);
  const doc = parseResume({ text: String(resume), source: 'text' });
  return tailorAction({ action: 'tailor', doc, jobTitle: title, company, jobDescription: jd, source: String(resume) }, { taxonomy: null, fit: noDbFit(jd) });
}
/** api/job-insights.js (posting only). */
export function runInsights({ title, company, description }) {
  const r = insightReading({ title, company, description, needsSummary: true, taxonomy: null });
  return { result: r.result, facts: r.facts };
}
/** api/interview-prep.js build (localPack on the posting the prep stores). */
export function runPrep({ resume, title, company, description }) {
  return localPack({ company, role: title, resumeText: String(resume), jobText: cleanPostingText(description), stage: 'Interview', taxonomy: null });
}

const displayed = (sts) => (sts || []).filter((s) => s && s.display !== false && s.kind !== 'promise');
const evLine = (s) => { const e = (s.evidence || []).find((x) => x && (typeof x === 'string' ? x : x.line)); return e ? (typeof e === 'string' ? e : e.line) : null; };
const flat = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * What each tool prints, normalised:
 *   { count, band, score, sentence, rows: [{ id, text, status, evidence }], gates: [sentence], shownIds }
 * `rows` are the statements the tool shows (id-keyed when it carries ids; Prep's rows are matched to the verdict's
 * statements by their text).
 */
export async function allTools(pair) {
  const free = runFree(pair);
  const paid = runPaid(pair);
  const studio = await runStudio(pair);
  const ins = runInsights(pair);
  const prep = runPrep(pair);
  let matched = null;
  try { matched = { gates: sharedGates({ title: pair.title, company: pair.company, description: pair.description }, String(pair.resume)), match: matchListing({ title: pair.title, company: pair.company, description: pair.description }, buildJobKeys({ resumeText: String(pair.resume) })) }; } catch (e) { matched = { error: String(e && e.message) }; }
  const verdictSts = free.statements || [];
  const view = {};
  const fromStatements = (o, sts) => ({
    count: o.requirement_count ?? (o.verdict && o.verdict.requirement_count) ?? null,
    band: o.fit_band ?? null,
    score: o.fit_score ?? null,
    sentence: (o.verdict && o.verdict.sentence) || null,
    rows: (sts || []).map((s) => ({ id: s.id, text: s.text, status: s.status, evidence: typeof s.evidence === 'string' ? s.evidence : evLine(s), display: s.display, kind: s.kind })),
    gates: ((o.constraints || []).map((c) => c.message).filter(Boolean)),
  });
  view.free = fromStatements(free, displayed(free.statements));
  view.paid = fromStatements(paid, paid.statements);
  view.studio = fromStatements(studio, studio.statements);
  // Job Insights prints no status (it has no résumé): its count and the statement each item stands for
  const insItems = (ins.result.items || []);
  view.insights = {
    count: ins.result.requirements_read ?? null,
    items: insItems.map((it) => ({ id: it.statementId || null, text: it.text })),
    statementIds: new Set((ins.facts.statements || []).map((s) => s.id)),
    displayIds: new Set(displayed(ins.facts.statements).map((s) => s.id)),
  };
  // Interview Prep: the job-match rows that come from a statement (label = the verdict's text)
  const byText = new Map(verdictSts.map((s) => [flat(s.text), s]));
  const prepRows = (prep.job_match || []).filter((r) => r.source === 'statement').map((r) => { const st = byText.get(flat(r.label)); return { id: st ? st.id : null, text: r.label, status: r.statement_status, printed: r.status }; });
  view.prep = { rows: prepRows, fit: prep.fit || null, raw: prep };
  return { view, free, paid, studio, ins, prep, matched };
}

// The words Interview Prep prints per verdict status (the one mapping a tool that words a status should read).
const PREP_WORD_STATUS = { shown: 'shown', 'you have it': 'shown', partly: 'partly', gap: 'not_shown', 'only you can say': 'cannot_tell' };

/**
 * Every disagreement between tools for one pair: [{ check, tool, detail }]. Asserts AGREEMENT, never values.
 *   count     the requirement count each tool prints equals the fit check's
 *   verdict   band, score and verdict sentence equal wherever printed
 *   status    a statement id shown by a tool carries the fit check's status
 *   hidden    no tool shows a display:false statement
 *   unknown   no tool shows a requirement that is not one of the reader's statements
 *   evidence  the evidence line printed for a statement is the fit check's line for it
 *   gates     years / degree / licence sentences are the gate's sentence verbatim
 */
export function agreementChecks(r) {
  const { view, free, paid } = r;
  const bad = [];
  const add = (check, tool, detail) => bad.push({ check, tool, detail });
  const all = new Map((free.statements || []).map((s) => [s.id, s]));
  const ref = view.free;
  for (const tool of ['paid', 'studio']) {
    const v = view[tool];
    if (v.count !== ref.count) add('count', tool, `${v.count} vs ${ref.count}`);
    if (v.band !== ref.band) add('verdict', tool, `band ${v.band} vs ${ref.band}`);
    if (v.score !== ref.score) add('verdict', tool, `score ${v.score} vs ${ref.score}`);
    if (v.sentence !== ref.sentence) add('verdict', tool, 'sentence differs');
    if (JSON.stringify(v.gates) !== JSON.stringify(ref.gates)) add('gates', tool, 'constraint sentences differ');
  }
  if (paid.requirements_listed != null && paid.requirements_listed !== ref.count) add('count', 'paid', `requirements_listed ${paid.requirements_listed} vs ${ref.count}`);
  if (view.insights.count !== ref.count) add('count', 'insights', `requirements_read ${view.insights.count} vs ${ref.count}`);
  const refRows = new Map(ref.rows.map((x) => [x.id, x]));
  for (const tool of ['paid', 'studio']) {
    for (const row of view[tool].rows) {
      const st = all.get(row.id);
      if (!st) { add('unknown', tool, `${row.id} "${row.text}"`); continue; }
      if (st.display === false || st.kind === 'promise') { add('hidden', tool, `${row.id} "${row.text}"`); continue; }
      if (row.status !== st.status) add('status', tool, `${row.id} ${row.status} vs ${st.status} "${row.text}"`);
      const want = refRows.get(row.id) && refRows.get(row.id).evidence;
      if (row.evidence && flat(row.evidence) !== flat(want)) add('evidence', tool, `${row.id} "${String(row.evidence).slice(0, 60)}" vs "${String(want || '').slice(0, 60)}"`);
    }
  }
  for (const it of view.insights.items) {
    if (!it.id || !view.insights.statementIds.has(it.id)) add('unknown', 'insights', `"${it.text}"`);
    else if (!view.insights.displayIds.has(it.id)) add('hidden', 'insights', `${it.id} "${it.text}"`);
  }
  const raw = r.prep.job_match || [];
  for (const m of raw.filter((x) => x.source === 'statement')) {
    const texts = m.ask ? (m.items || []) : [m.label];
    const printed = PREP_WORD_STATUS[m.status];
    for (const t of texts) {
      const st = (free.statements || []).find((s) => flat(s.text) === flat(t));
      if (!st) { add('unknown', 'prep', `"${String(t).slice(0, 80)}"`); continue; }
      if (st.display === false) { add('hidden', 'prep', `${st.id} "${st.text}"`); continue; }
      if (printed && printed !== st.status) add('status', 'prep', `${st.id} printed "${m.status}" vs ${st.status} "${st.text.slice(0, 60)}"`);
    }
  }
  // a gate sentence quoted in the paid "blocked" line is the gate's own sentence
  if (paid.blocked && paid.blocked.reason === 'hard_gate') {
    const g = (paid.hard_gates || [])[0] || (paid.constraints || []).find((c) => c.gate && /not/.test(String(c.grade || '')));
    if (g && g.message && !flat(paid.blocked.sentence).startsWith(flat(g.message).slice(0, 40))) add('gates', 'paid', 'blocked sentence does not quote the gate');
  }
  return bad;
}

/** Prep and matched jobs (read-only here; their engineers own the fixes): disagreements with the fit check. */
export function readOnlyChecks(r) {
  const bad = agreementChecks(r).filter((b) => b.tool === 'prep');
  const { free, matched } = r;
  if (matched && !matched.error) {
    const fit = failedGates(free.constraints || []).map((c) => `${c.kind}:${c.label}`).sort();
    const mj = (matched.gates.failed || []).map((c) => `${c.kind}:${c.label}`).sort();
    if (!matched.gates.unread && JSON.stringify(fit) !== JSON.stringify(mj)) bad.push({ check: 'gates', tool: 'matched', detail: `failed gates ${JSON.stringify(mj)} vs fit check ${JSON.stringify(fit)}` });
    const m = matched.match;
    if (m && m.ok && m.need != null) {
      const yrs = (free.constraints || []).filter((c) => c.kind === 'years');
      if (!yrs.some((c) => Number(c.value ?? (String(c.label).match(/\d+/) || [])[0]) === Number(m.need))) bad.push({ check: 'gates', tool: 'matched', detail: `reason says they ask for ${m.need}+ years; the fit check's years rows: ${JSON.stringify(yrs.map((c) => c.label))}` });
    }
  }
  return bad;
}
