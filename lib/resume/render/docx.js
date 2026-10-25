// DOCX renderer on the `docx` package — the same three one-column templates as the PDF, built the
// way Word-based ATS parsers want them:
//   • real heading styles (Heading 1) for section titles, so parsers that key on style names find
//     the sections, with the font/colour overridden so Word's blue Calibri Light never shows;
//   • real bullet lists through a numbering definition (w:numPr), not typed "•" characters;
//   • dates flush right through a RIGHT tab stop at the content edge — one paragraph per role line;
//   • keepNext on role headers so a title never strands at a page foot;
//   • mailto:/https: hyperlinks on the contact line; document properties (title, creator, keywords);
//   • no tables, no text boxes, no headers/footers for content (the free-tier brand line is a plain
//     final paragraph, so it is visible AND harmless to parsers).
// Fonts are named, not embedded (DOCX convention): Georgia / Arial / Calibri per template.

import { Document, Packer, Paragraph, TextRun, Tab, TabStopType, LevelFormat, HeadingLevel, AlignmentType, BorderStyle, ExternalHyperlink } from 'docx';
import { normalizeDoc, gpaLabel } from '../model.js';
import { sectionTitle } from '../model.js';
import { formatRange, formatDate } from '../parse/dates.js';
import { resolveTemplate, safeAccent } from './templates.js';

export const DOCX_RENDERER_VERSION = 'docx_render_v1';

const PAGE = { letter: { width: 12240, height: 15840 }, a4: { width: 11906, height: 16838 } };
const hex = (c) => String(c).replace('#', '').toUpperCase();
const linkHref = (url) => (/^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`);
const linkLabel = (l) => l.label || l.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
// a run keeps its edge spaces ("Languages: " before the items) — docx marks them xml:space=preserve
const soft = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ');

/**
 * @param {object} docIn ResumeDoc
 * @param {{ template?: string, pro?: boolean, paper?: 'letter'|'a4', accent?: string, fontScale?: number, targetLine?: string, brand?: string }} opts
 * @returns {Promise<{ buffer: Buffer, template: string, font: string, warnings: string[] }>}
 */
export async function renderDocx(docIn, opts = {}) {
  const d = normalizeDoc(docIn);
  const T = resolveTemplate(opts.template);
  const scale = Math.min(1.15, Math.max(0.85, Number(opts.fontScale) || 1));
  const pt = (v) => Math.round(v * scale * 2); // half-points
  const S = T.sizes;
  const accent = hex(safeAccent(opts.accent, T.accent));
  const META = T.id === 'modern' ? '4A4F5C' : '444444';
  const font = T.docxFont;
  const paper = PAGE[String(opts.paper || 'letter').toLowerCase()] || PAGE.letter;
  const marginTwips = Math.round((T.margin / 72) * 1440);
  const contentWidth = paper.width - marginTwips * 2;
  const warnings = [];

  const run = (text, o = {}) => new TextRun({ text: soft(text), font, size: pt(S.body), ...o });
  const P = (children, o = {}) => new Paragraph({ children, spacing: { after: 40, line: Math.round(240 * (1 + T.lineGap / 12)) }, ...o });
  const children = [];
  const b = d.basics;
  const center = T.header === 'center';
  const align = center ? AlignmentType.CENTER : AlignmentType.LEFT;

  // ── header ──
  if (b.name) children.push(new Paragraph({ alignment: align, spacing: { after: 40 }, children: [new TextRun({ text: clean(b.name), font, bold: true, size: pt(S.name), color: T.id === 'modern' ? accent : '000000' })] }));
  if (b.headline) children.push(new Paragraph({ alignment: align, spacing: { after: 40 }, children: [new TextRun({ text: clean(b.headline), font, italics: true, size: pt(S.headline), color: META })] }));
  if (opts.targetLine) children.push(new Paragraph({ alignment: align, spacing: { after: 40 }, children: [new TextRun({ text: clean(opts.targetLine), font, italics: true, size: pt(S.meta), color: META })] }));
  const contact = [];
  if (b.location) contact.push(new TextRun({ text: clean(b.location), font, size: pt(S.meta) }));
  if (b.phone) contact.push(new TextRun({ text: clean(b.phone), font, size: pt(S.meta) }));
  if (b.email) contact.push(new ExternalHyperlink({ link: `mailto:${b.email}`, children: [new TextRun({ text: clean(b.email), font, size: pt(S.meta), style: 'Hyperlink' })] }));
  for (const l of b.links) contact.push(new ExternalHyperlink({ link: linkHref(l.url), children: [new TextRun({ text: clean(linkLabel(l)), font, size: pt(S.meta), style: 'Hyperlink' })] }));
  if (contact.length) {
    const parts = [];
    contact.forEach((c, i) => { if (i) parts.push(new TextRun({ text: '  ·  ', font, size: pt(S.meta), color: META })); parts.push(c); });
    children.push(new Paragraph({ alignment: align, spacing: { after: 80 }, children: parts, border: T.id === 'modern' ? undefined : { bottom: { style: BorderStyle.SINGLE, size: T.id === 'engineering' ? 6 : 8, color: '000000', space: 4 } } }));
  }

  const heading = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, children: [new TextRun({ text: clean(text).toUpperCase(), font, bold: true, size: pt(S.heading), color: accent })] });
  const bullet = (text) => P([run(text)], { numbering: { reference: 'seen-bullets', level: 0 }, spacing: { after: 30 } });
  // a real <w:tab/> (not a literal tab character inside <w:t>) carries the slug to the right tab stop
  const rightTab = (leftRuns, rightText, rightOpts = {}) => P([...leftRuns, ...(rightText ? [new TextRun({ children: [new Tab(), clean(rightText)], font, size: pt(S.meta), color: META, ...rightOpts })] : [])], { tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }], keepNext: true, spacing: { after: 20 } });
  const metaLine = (first, rest, firstOpts = {}) => P([run(first, firstOpts), ...(rest.length ? [new TextRun({ text: `${first ? '  ·  ' : ''}${rest.join('  ·  ')}`, font, italics: true, size: pt(S.meta), color: META })] : [])], { keepNext: true, spacing: { after: 30 } });
  const dateOf = (e) => (e.end || !e.dateText ? (formatRange(e.start, e.end) || e.dateText) : e.dateText) || '';

  for (const key of d.sectionOrder) {
    if (key === 'summary' && b.summary) {
      children.push(heading(sectionTitle(d, 'summary')));
      for (const line of b.summary.split('\n')) if (line.trim()) children.push(P([run(line)]));
    } else if (key === 'experience' && d.experience.length) {
      children.push(heading(sectionTitle(d, 'experience')));
      d.experience.forEach((e, i) => {
        if (i > 0) children.push(P([], { spacing: { after: 60 } }));
        if (T.roleLayout === 'company-first') {
          children.push(rightTab([run(e.company, { bold: true, size: pt(S.body + 0.5) })], [clean(e.location), clean(e.employmentType)].filter(Boolean).join('  ·  '), { italics: true }));
          children.push(rightTab([run(e.title, { italics: true })], dateOf(e), { italics: true }));
        } else {
          children.push(rightTab([run(e.title, { bold: true, size: pt(S.body + 0.5) })], dateOf(e)));
          const rest = [clean(e.location), clean(e.employmentType)].filter(Boolean);
          if (e.company || rest.length) children.push(metaLine(e.company, rest, { size: pt(S.meta) }));
        }
        if (e.summary) for (const line of e.summary.split('\n')) if (line.trim()) children.push(P([run(line)]));
        for (const bl of e.bullets) children.push(bullet(bl.text));
      });
    } else if (key === 'education' && d.education.length) {
      children.push(heading(sectionTitle(d, 'education')));
      d.education.forEach((e, i) => {
        if (i > 0) children.push(P([], { spacing: { after: 40 } }));
        const degree = [clean(e.degree), clean(e.field)].filter(Boolean).join(', ');
        children.push(rightTab([run(e.school || degree, { bold: true })], dateOf(e), T.roleLayout === 'company-first' ? { italics: true } : {}));
        const rest = [clean(e.location), clean(gpaLabel(e))].filter(Boolean);
        if ((e.school && degree) || rest.length) children.push(metaLine(e.school ? degree : '', rest, { size: pt(S.meta), italics: T.roleLayout === 'company-first' }));
        for (const bl of e.details) children.push(bullet(bl.text));
      });
    } else if (key === 'skills' && d.skills.length) {
      children.push(heading(sectionTitle(d, 'skills')));
      for (const g of d.skills) {
        const items = g.items.map(clean).filter(Boolean).join(T.id === 'classic' && !g.label ? '   ·   ' : ', ');
        children.push(g.label ? P([run(`${g.label}: `, { bold: true }), run(items)]) : P([run(items)]));
      }
    } else if (key === 'certifications' && d.certifications.length) {
      children.push(heading(sectionTitle(d, 'certifications')));
      for (const c of d.certifications) {
        const rest = [clean(c.issuer), clean(formatDate(c.date))].filter(Boolean).join(', ');
        children.push(P([run(c.name || c.text, { bold: true }), ...(rest ? [new TextRun({ text: ` — ${rest}`, font, size: pt(S.body), color: META })] : [])], { spacing: { after: 30 } }));
      }
    } else if (key === 'projects' && d.projects.length) {
      children.push(heading(sectionTitle(d, 'projects')));
      d.projects.forEach((p, i) => {
        if (i > 0) children.push(P([], { spacing: { after: 50 } }));
        children.push(rightTab([run(p.name, { bold: true, size: pt(S.body + 0.5) })], dateOf(p)));
        const sub = [];
        if (p.role) sub.push(new TextRun({ text: clean(p.role), font, italics: true, size: pt(S.meta), color: META }));
        if (p.url) { if (p.role) sub.push(new TextRun({ text: '  ·  ', font, size: pt(S.meta), color: META })); sub.push(new ExternalHyperlink({ link: linkHref(p.url), children: [new TextRun({ text: clean(p.url.replace(/^https?:\/\/(www\.)?/i, '')), font, size: pt(S.meta), style: 'Hyperlink' })] })); }
        if (sub.length) children.push(P(sub, { keepNext: true, spacing: { after: 30 } }));
        if (p.summary) for (const line of p.summary.split('\n')) if (line.trim()) children.push(P([run(line)]));
        for (const bl of p.bullets) children.push(bullet(bl.text));
      });
    } else if (key === 'languages' && d.languages.length) {
      children.push(heading(sectionTitle(d, 'languages')));
      children.push(P([run(d.languages.map((l) => (l.level ? `${clean(l.name)} (${clean(l.level)})` : clean(l.name))).join(T.id === 'classic' ? '   ·   ' : ', '))]));
    } else if (key.startsWith('extra:')) {
      const x = d.extra.find((e) => `extra:${e.id}` === key);
      if (!x) continue;
      children.push(heading(x.title));
      for (const it of x.items) children.push(x.style === 'lines' ? P([run(it.text)], { spacing: { after: 30 } }) : bullet(it.text));
    }
  }

  const brand = opts.pro ? '' : (opts.brand == null ? 'Optimized with Seen  ·  seenjobs.io' : String(opts.brand));
  if (brand) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 360 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: '999999', space: 6 } }, children: [new TextRun({ text: brand, font, size: 17, color: '666666' })] }));

  const document = new Document({
    creator: 'Seen Résumé Studio (seenjobs.io)',
    title: b.name ? `${clean(b.name)} — Résumé` : 'Résumé',
    description: clean(opts.targetLine || b.headline || ''),
    keywords: d.skills.flatMap((g) => g.items).slice(0, 40).join(', '),
    styles: {
      default: { document: { run: { font, size: pt(S.body) } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font, bold: true, size: pt(S.heading), color: accent },
          paragraph: { spacing: { before: T.id === 'engineering' ? 200 : 240, after: 60 }, keepNext: true, outlineLevel: 0,
            border: T.headingStyle === 'bar' ? undefined : { bottom: { style: BorderStyle.SINGLE, size: T.id === 'engineering' ? 4 : 6, color: '999999', space: 1 } } } },
        { id: 'Hyperlink', name: 'Hyperlink', basedOn: 'Normal', run: { font, color: '000000', underline: {} } },
      ],
    },
    numbering: { config: [{ reference: 'seen-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 200 } } } }] }] },
    sections: [{ properties: { page: { size: { width: paper.width, height: paper.height }, margin: { top: marginTwips, right: marginTwips, bottom: marginTwips, left: marginTwips } } }, children }],
  });
  const buffer = await Packer.toBuffer(document);
  return { buffer, template: T.id, font, warnings };
}
