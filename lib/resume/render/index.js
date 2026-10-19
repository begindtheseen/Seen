// Export entry point: one call renders a ResumeDoc to any supported format.
//
//   renderResume(doc, { format: 'pdf'|'docx'|'txt'|'md'|'json', template, pro, paper, accent, fontScale, targetLine, appendix, role })
//     → { buffer, contentType, extension, fileName, format, template, pages, font, warnings }
//
// The watermark rule is enforced HERE, once: `pro` false → the free-tier "Optimized with Seen ·
// seenjobs.io" line (PDF footer / DOCX closing line); `pro` true → unbranded. Text, Markdown and
// JSON are never branded (they are the candidate's data, not a Seen-rendered document).

import { normalizeDoc } from '../model.js';
import { renderPdf } from './pdf.js';
import { renderDocx } from './docx.js';
import { renderText, renderMarkdown } from './text.js';
import { toJsonResume } from './jsonResume.js';
import { listTemplates, resolveTemplate } from './templates.js';

export { listTemplates, resolveTemplate, TEMPLATES, DEFAULT_TEMPLATE } from './templates.js';
export { renderPdf } from './pdf.js';
export { renderDocx } from './docx.js';
export { renderText, renderMarkdown } from './text.js';
export { toJsonResume, fromJsonResume } from './jsonResume.js';

export const FORMATS = Object.freeze({
  pdf: { id: 'pdf', label: 'PDF', extension: 'pdf', contentType: 'application/pdf', templated: true, description: 'What you send. One column, real text, parses everywhere.' },
  docx: { id: 'docx', label: 'Word (.docx)', extension: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', templated: true, description: 'For portals that want Word, and for editing in Word or Google Docs.' },
  txt: { id: 'txt', label: 'Plain text', extension: 'txt', contentType: 'text/plain; charset=utf-8', templated: false, description: 'For paste-into-a-box application forms and old ATS uploads.' },
  md: { id: 'md', label: 'Markdown', extension: 'md', contentType: 'text/markdown; charset=utf-8', templated: false, description: 'For GitHub, Notion, email and anything that renders Markdown.' },
  json: { id: 'json', label: 'JSON Resume', extension: 'json', contentType: 'application/json; charset=utf-8', templated: false, description: 'The open JSON Resume schema — portable to any JSON Resume theme or tool.' },
});

export function listFormats() { return Object.values(FORMATS).map(({ id, label, extension, templated, description }) => ({ id, label, extension, templated, description })); }

/** "Jordan Reyes — Commercial Electrician Resume.pdf" (ASCII-safe characters only besides the dash). */
export function fileNameFor(doc, { format = 'pdf', role = '' } = {}) {
  const ext = (FORMATS[format] || FORMATS.pdf).extension;
  const d = normalizeDoc(doc);
  const name = String(d.basics.name || '').replace(/[^\w .'-]/g, '').replace(/\s+/g, ' ').trim();
  const r = String(role || (d.meta.tailoredFor && d.meta.tailoredFor.role) || '').replace(/[^\w .,'/&-]/g, '').replace(/\s+/g, ' ').trim();
  if (name && r) return `${name} — ${r} Resume.${ext}`;
  if (name) return `${name} — Resume.${ext}`;
  if (r) return `${r} Resume.${ext}`;
  return `Seen Resume.${ext}`;
}

export async function renderResume(docIn, opts = {}) {
  const d = normalizeDoc(docIn);
  const format = FORMATS[String(opts.format || 'pdf').toLowerCase()] ? String(opts.format || 'pdf').toLowerCase() : 'pdf';
  const F = FORMATS[format];
  const base = { format, contentType: F.contentType, extension: F.extension, fileName: fileNameFor(d, { format, role: opts.role }), template: null, pages: null, font: null, warnings: [] };
  if (format === 'txt') return { ...base, buffer: Buffer.from(renderText(d), 'utf8') };
  if (format === 'md') return { ...base, buffer: Buffer.from(renderMarkdown(d), 'utf8') };
  if (format === 'json') return { ...base, buffer: Buffer.from(JSON.stringify(toJsonResume(d), null, 2), 'utf8') };
  const common = { template: opts.template, pro: !!opts.pro, paper: opts.paper, accent: opts.accent, fontScale: opts.fontScale, targetLine: opts.targetLine, brand: opts.brand };
  if (format === 'docx') {
    const r = await renderDocx(d, common);
    return { ...base, buffer: r.buffer, template: r.template, font: r.font, warnings: r.warnings };
  }
  const r = await renderPdf(d, { ...common, appendix: opts.appendix || null });
  return { ...base, buffer: r.buffer, template: r.template, pages: r.pages, font: r.font, warnings: r.warnings };
}
