// Résumé Studio — the server-side façade over lib/resume (structure → health → rewrite → tailor →
// export → ATS check). api/resume.js maps HTTP actions onto these functions; they are pure
// (no I/O except rendering) and unit-tested directly, so the HTTP layer stays thin.
//
// Credit/Pro policy lives in api/resume.js, not here. This module never decides who may call it.

import { normalizeDoc, serializeToText, docStats, docIsEmpty } from '../resume/model.js';
import { parseResume, PARSER_VERSION } from '../resume/parse/index.js';
import { scoreResume, HEALTH_VERSION } from '../resume/health/score.js';
import { rewriteDoc, rewriteBullet, REWRITE_VERSION } from '../resume/rewrite/rules.js';
import { tailorResume, TAILOR_VERSION } from '../resume/tailor/tailor.js';
import { renderResume, listTemplates, listFormats, FORMATS } from '../resume/render/index.js';
import { atsCheck } from '../resume/render/atsCheck.js';
import { resolveTemplate } from '../resume/render/templates.js';
import { isReadableResume } from './resumeReadability.js';

export const STUDIO_VERSION = 'resume_studio_v1';
export const MAX_TEXT_CHARS = 60_000;
export const MAX_DOC_JSON = 400_000;
export const MAX_JD_CHARS = 30_000;

export class StudioError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/** Fraction of the raw text's distinct words that survive into the structured document. */
export function coverageOf(rawText, doc) {
  const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9+#'’]+/g, ' ').split(' ').filter((w) => w.length >= 3));
  const want = words(rawText);
  if (!want.size) return 1;
  const got = words(serializeToText(doc));
  let n = 0;
  for (const w of want) if (got.has(w)) n++;
  return Number((n / want.size).toFixed(3));
}

/** Accept a doc from the wire: must be an object of sane size; normalized (never throws on junk). */
export function docFromBody(body, { required = true } = {}) {
  const raw = body && body.doc;
  if (raw == null) { if (required) throw new StudioError(400, 'Missing doc'); return null; }
  if (typeof raw !== 'object') throw new StudioError(400, 'doc must be an object');
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch { throw new StudioError(400, 'doc is not serializable'); }
  if (size > MAX_DOC_JSON) throw new StudioError(413, 'Résumé document too large');
  const doc = normalizeDoc(raw);
  if (required && docIsEmpty(doc)) throw new StudioError(422, 'The résumé document is empty — add a name, a role or some skills first.');
  return doc;
}

function textFromBody(body) {
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) throw new StudioError(400, 'Missing text');
  if (text.length > MAX_TEXT_CHARS) throw new StudioError(413, 'Résumé text too long');
  if (text.trim().length < 50) throw new StudioError(422, 'That text is too short to be a résumé — paste the whole thing.');
  if (!isReadableResume(text)) throw new StudioError(400, 'RESUME_CORRUPTED');
  return text;
}

/** Text (pasted or extracted) → structured doc + health + coverage. */
export function structureText({ text, lines = null, source = 'text', fileName = '', layout = null }) {
  const doc = parseResume({ text, lines: lines || undefined, source, fileName, layout });
  const health = scoreResume(doc, { layout });
  const coverage = coverageOf(text, doc);
  return { doc, health, coverage, stats: docStats(doc), warnings: doc.meta.warnings, versions: { parser: PARSER_VERSION, health: HEALTH_VERSION } };
}

export function structureAction(body) {
  if (body.doc != null && typeof body.text !== 'string') {
    const doc = docFromBody(body);
    return { ok: true, doc, health: scoreResume(doc), coverage: 1, stats: docStats(doc), warnings: doc.meta.warnings, versions: { parser: PARSER_VERSION, health: HEALTH_VERSION } };
  }
  const text = textFromBody(body);
  return { ok: true, ...structureText({ text, source: 'text', fileName: typeof body.fileName === 'string' ? body.fileName.slice(0, 200) : '' }) };
}

export function healthAction(body) {
  const doc = docFromBody(body);
  return { ok: true, health: scoreResume(doc), stats: docStats(doc) };
}

/** Whole-document rewrite (every bullet, or only `bulletIds`) or a single bullet (`text`). */
export function rewriteAction(body) {
  const tense = ['past', 'present', 'keep'].includes(body.tense) ? body.tense : undefined;
  if (typeof body.text === 'string' && body.doc == null) {
    const text = body.text.slice(0, 2000);
    if (!text.trim()) throw new StudioError(400, 'Missing text');
    return { ok: true, result: rewriteBullet(text, { tense: tense || 'keep' }), version: REWRITE_VERSION };
  }
  const doc = docFromBody(body);
  const ids = Array.isArray(body.bulletIds) ? new Set(body.bulletIds.map(String)) : null;
  const { doc: rewritten, log } = rewriteDoc(doc, { apply: true, tense });
  if (ids) {
    // keep only the requested bullets' changes: everything else reverts to the original text
    const originals = new Map();
    for (const e of doc.experience) for (const b of e.bullets) originals.set(b.id, b.text);
    for (const p of doc.projects) for (const b of p.bullets) originals.set(b.id, b.text);
    for (const e of rewritten.experience) for (const b of e.bullets) if (!ids.has(b.id) && originals.has(b.id)) b.text = originals.get(b.id);
    for (const p of rewritten.projects) for (const b of p.bullets) if (!ids.has(b.id) && originals.has(b.id)) b.text = originals.get(b.id);
    rewritten.meta.provenance = (rewritten.meta.provenance || []).filter((x) => x.kind !== 'rewrite' || ids.has(x.bulletId));
  }
  const kept = ids ? log.filter((l) => ids.has(l.bulletId)) : log;
  return { ok: true, doc: rewritten, log: kept, changed: kept.length, health: scoreResume(rewritten), version: REWRITE_VERSION };
}

/** Job-targeted variant plan — deterministic (lib/resume/tailor); no model is called. */
export async function tailorAction(body, { taxonomy = null, fit = null } = {}) {
  const doc = docFromBody(body);
  const jobDescription = typeof body.jobDescription === 'string' ? body.jobDescription.slice(0, MAX_JD_CHARS) : '';
  const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.slice(0, 200) : '';
  if (!jobDescription.trim() && !jobTitle.trim()) throw new StudioError(400, 'Add the job title or the job description to tailor against.');
  const job = {
    jobTitle, company: typeof body.company === 'string' ? body.company.slice(0, 200) : '',
    jobDescription, jobId: typeof body.jobId === 'string' ? body.jobId.slice(0, 120) : '',
    location: typeof body.location === 'string' ? body.location.slice(0, 120) : '',
    applyTerminology: !!body.applyTerminology, replaceSummary: body.replaceSummary !== false,
    taxonomy,
    fit,
  };
  const { plan, variant } = tailorResume(doc, job);
  return { ok: true, plan, variant, health: scoreResume(variant), version: TAILOR_VERSION };
}

export async function atsCheckAction(body) {
  const doc = docFromBody(body);
  const format = ['pdf', 'docx', 'txt'].includes(body.format) ? body.format : 'pdf';
  const check = await atsCheck(doc, { format, template: body.template, paper: body.paper, fontScale: body.fontScale, accent: body.accent });
  return { ok: true, check };
}

export function templatesAction() {
  return { ok: true, templates: listTemplates(), formats: listFormats(), version: STUDIO_VERSION };
}

/** Render for download. `pro` decides the brand line (free tier) vs unbranded (Pro). */
export async function exportAction(body, { pro = false } = {}) {
  const doc = docFromBody(body);
  const format = FORMATS[String(body.format || 'pdf').toLowerCase()] ? String(body.format).toLowerCase() : 'pdf';
  const template = resolveTemplate(body.template).id;
  const out = await renderResume(doc, {
    format, template, pro, paper: body.paper === 'a4' ? 'a4' : 'letter', accent: typeof body.accent === 'string' ? body.accent : undefined,
    fontScale: Number(body.fontScale) || 1, targetLine: typeof body.targetLine === 'string' ? body.targetLine.slice(0, 160) : '',
    role: typeof body.role === 'string' ? body.role : '', appendix: body.appendix && typeof body.appendix === 'object' ? body.appendix : null,
  });
  return out;
}
