// PDF renderer — three one-column templates on pdfkit, built for ATS parsers first and recruiters
// second. Every design choice here is a parse-ability choice:
//   • real text everywhere (no vector bullets: "•" is a character, so extractors read it as one);
//   • hanging-indent bullets measured before drawing, so a bullet never splits across pages;
//   • role header + first bullet, and section heading + first entry, are kept together;
//   • dates flush right on the SAME baseline as the title/company (one text line per role header,
//     exactly how parsers expect it) — long titles wrap under themselves, never into the date;
//   • built-in Times/Helvetica for classic/engineering, embedded Liberation Sans (OFL, shipped with
//     pdfjs-dist) for modern — and automatically for ANY template when the text has characters the
//     built-in WinAnsi fonts cannot encode (Cyrillic, Greek, extended Latin), so names never garble;
//   • clickable mailto:/https: links on the contact line, PDF metadata (Title/Author/Keywords) set
//     from the document, page numbers only when there is more than one page;
//   • the free tier keeps the "Optimized with Seen · seenjobs.io" footer line, Pro exports are
//     unbranded. The footer band is reserved either way so pagination is identical.
// Pure function of (doc, options): same input → same bytes (pdfkit's CreationDate aside).

import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizeDoc } from '../model.js';
import { sectionTitle } from '../model.js';
import { formatRange, formatDate } from '../parse/dates.js';
import { resolveTemplate, safeAccent } from './templates.js';

export const PDF_RENDERER_VERSION = 'pdf_render_v2';

// Everything pdfkit's built-in (AFM, WinAnsi-encoded) fonts can draw.
const WIN_ANSI_RE = /^[\x09\x0A\x0D\x20-\x7E\xA0-\xFFŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™]*$/;
const SYMBOL_MAP = { '→': '->', '←': '<-', '↑': '^', '↓': 'v', '★': '*', '☆': '*', '✓': '*', '✔': '*', '✗': 'x', '✘': 'x', '●': '•', '○': 'o', '■': '•', '□': '-', '◆': '•', '◇': '-', '▪': '•', '▫': '-', '►': '>', '▶': '>', '➢': '>', '➤': '>', '‣': '•', '·': '·', '∙': '•', '−': '-', '‒': '-', '―': '—', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', '​': '', '﻿': '' };

let _liberation = null;
function liberationFonts() {
  if (_liberation !== null) return _liberation;
  try {
    const req = createRequire(import.meta.url);
    const dir = path.join(path.dirname(req.resolve('pdfjs-dist/package.json')), 'standard_fonts');
    const f = (n) => path.join(dir, `LiberationSans-${n}.ttf`);
    _liberation = ['Regular', 'Bold', 'Italic', 'BoldItalic'].every((n) => fs.existsSync(f(n)))
      ? { regular: f('Regular'), bold: f('Bold'), italic: f('Italic'), boldItalic: f('BoldItalic'), embedded: true, name: 'Liberation Sans' }
      : false;
  } catch { _liberation = false; }
  return _liberation;
}
const STD = {
  serif: { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic', embedded: false, name: 'Times' },
  sans: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique', embedded: false, name: 'Helvetica' },
};

/** Characters the built-in fonts cannot draw → nearest ASCII (used only when no embeddable font exists). */
export function sanitizeForStandardFont(text) {
  let s = String(text || '').replace(/[←-⇿─-➿‐-―  ​﻿]/g, (c) => (c in SYMBOL_MAP ? SYMBOL_MAP[c] : c));
  if (WIN_ANSI_RE.test(s)) return s;
  // decompose accents the WinAnsi set lacks (Ş → S), drop combining marks, then anything else → '?'
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, (m, i, str) => (WIN_ANSI_RE.test(str.slice(0, i).normalize('NFC')) ? '' : '')).normalize('NFC');
  return [...s].map((c) => (WIN_ANSI_RE.test(c) ? c : '?')).join('');
}

function allText(d) {
  const parts = [d.basics.name, d.basics.headline, d.basics.location, d.basics.summary, ...d.basics.links.map((l) => `${l.label} ${l.url}`)];
  for (const e of d.experience) parts.push(e.title, e.company, e.location, e.employmentType, e.dateText, e.summary, ...e.bullets.map((b) => b.text));
  for (const e of d.education) parts.push(e.school, e.degree, e.field, e.location, e.dateText, e.gpa, ...e.details.map((b) => b.text));
  for (const g of d.skills) parts.push(g.label, ...g.items);
  for (const c of d.certifications) parts.push(c.name, c.issuer, c.text);
  for (const p of d.projects) parts.push(p.name, p.role, p.url, p.summary, p.dateText, ...p.bullets.map((b) => b.text));
  for (const l of d.languages) parts.push(l.name, l.level);
  for (const x of d.extra) parts.push(x.title, ...x.items.map((b) => b.text));
  return parts.filter(Boolean).join('\n');
}

const PAPER = { letter: 'LETTER', a4: 'A4' };
const linkHref = (url) => (/^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`);
const linkLabel = (l) => l.label || l.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

/**
 * @param {object} docIn ResumeDoc
 * @param {{ template?: string, pro?: boolean, paper?: 'letter'|'a4', accent?: string, fontScale?: number,
 *           targetLine?: string, appendix?: object|null, brand?: string }} opts
 * @returns {Promise<{ buffer: Buffer, pages: number, template: string, font: string, warnings: string[] }>}
 */
export function renderPdf(docIn, opts = {}) {
  const d = normalizeDoc(docIn);
  const T = resolveTemplate(opts.template);
  const warnings = [];
  const scale = Math.min(1.15, Math.max(0.85, Number(opts.fontScale) || 1));
  const S = Object.fromEntries(Object.entries(T.sizes).map(([k, v]) => [k, v * scale]));
  const accent = safeAccent(opts.accent, T.accent);
  const lib = liberationFonts();

  // Font set: template family, or the embedded font whenever the text needs more than WinAnsi.
  let fonts = T.family === 'serif' ? STD.serif : T.family === 'sans' ? STD.sans : (lib || STD.sans);
  const needsUnicode = !WIN_ANSI_RE.test(allText(d));
  let sanitize = (s) => String(s || '');
  if (needsUnicode && !fonts.embedded) {
    if (lib) { fonts = lib; warnings.push('font_fallback_unicode'); }
    else { sanitize = sanitizeForStandardFont; warnings.push('unicode_sanitized'); }
  }
  if (T.family === 'embedded-sans' && !lib) warnings.push('embedded_font_unavailable');
  const san = (v) => sanitize(String(v == null ? '' : v)).replace(/\s+/g, ' ').trim();

  return new Promise((resolve, reject) => {
    const MARGIN = T.margin;
    const FOOTER_BAND = 40;
    const paper = PAPER[String(opts.paper || 'letter').toLowerCase()] || 'LETTER';
    const skillsForMeta = d.skills.flatMap((g) => g.items).slice(0, 40).join(', ');
    const doc = new PDFDocument({
      size: paper, bufferPages: true, margins: { top: MARGIN, bottom: 2, left: MARGIN, right: MARGIN },
      pdfVersion: '1.5', lang: 'en', displayTitle: true,
      info: {
        Title: d.basics.name ? `${d.basics.name} — Résumé` : 'Résumé',
        Author: d.basics.name || '',
        Subject: san(opts.targetLine || d.basics.headline || ''),
        Keywords: san(skillsForMeta),
        Creator: 'Seen Résumé Studio (seenjobs.io)',
        Producer: 'Seen Résumé Studio',
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pages, template: T.id, font: fonts.name, warnings }));
    doc.on('error', reject);
    if (fonts.embedded) {
      doc.registerFont('R', fonts.regular); doc.registerFont('B', fonts.bold); doc.registerFont('I', fonts.italic); doc.registerFont('BI', fonts.boldItalic);
    }
    const F = fonts.embedded ? { regular: 'R', bold: 'B', italic: 'I', boldItalic: 'BI' } : fonts;

    const LEFT = MARGIN, RIGHT = doc.page.width - MARGIN, W = RIGHT - LEFT, TOP = MARGIN;
    const CONTENT_BOTTOM = doc.page.height - FOOTER_BAND - 12;
    const INK = '#000000', META = T.id === 'modern' ? '#4a4f5c' : '#444444', RULE = '#999999', FOOT = '#666666';
    const LG = T.lineGap;
    let pages = 1;

    // ── pagination primitives ──
    const newPage = () => { doc.addPage(); pages++; doc.x = LEFT; doc.y = TOP; };
    const ensure = (need) => { if (doc.y + need > CONTENT_BOTTOM) newPage(); };
    const gap = (pts) => { doc.y = Math.min(doc.y + pts, CONTENT_BOTTOM); };
    const setFont = (name, size, color = INK) => doc.font(name).fontSize(size).fillColor(color);
    const H = (text, font, size, width) => { doc.font(font).fontSize(size); return doc.heightOfString(text, { width, lineGap: LG }); };
    const lineH = (font, size) => { doc.font(font).fontSize(size); return doc.currentLineHeight(true) + LG; };

    // One line of text with an optional right-aligned slug (dates/location) on the same baseline.
    // The left text wraps under itself inside (W - slugWidth) so it never collides with the slug.
    function lineWithRight(left, leftFont, leftSize, leftColor, right, rightFont, rightSize, rightColor) {
      const rightW = right ? (doc.font(rightFont).fontSize(rightSize), doc.widthOfString(right) + 2) : 0;
      const leftW = right ? Math.max(W * 0.45, W - rightW - 10) : W;
      const h = Math.max(left ? H(left, leftFont, leftSize, leftW) : 0, right ? lineH(rightFont, rightSize) : 0);
      ensure(h);
      const y = doc.y;
      if (left) setFont(leftFont, leftSize, leftColor).text(left, LEFT, y, { width: leftW, lineGap: LG });
      if (right) setFont(rightFont, rightSize, rightColor).text(right, LEFT, y, { width: W, align: 'right', lineBreak: false });
      doc.y = y + h;
      return h;
    }
    // Runs on one wrapped paragraph: [{ text, font, color, link }]. Measured as the concatenation.
    function runs(parts, size, width = W, x = LEFT) {
      const list = parts.filter((p) => p && p.text);
      if (!list.length) return 0;
      const full = list.map((p) => p.text).join('');
      const h = H(full, list[0].font, size, width);
      ensure(h);
      const y = doc.y;
      list.forEach((p, i) => {
        const last = i === list.length - 1;
        const o = { width, lineGap: LG, continued: !last, link: p.link || null, underline: false };
        if (i === 0) setFont(p.font, size, p.color || INK).text(p.text, x, y, o);
        else setFont(p.font, size, p.color || INK).text(p.text, o);
      });
      doc.y = y + h;
      return h;
    }
    function bulletHeight(text) { return H(text, F.regular, S.body, W - T.bulletIndent) + 3; }
    function bullet(text, color = INK) {
      const t = san(text);
      if (!t || !/[a-z0-9]/i.test(t)) return;
      const h = bulletHeight(t);
      if (doc.y + h > CONTENT_BOTTOM) newPage();
      const y = doc.y;
      setFont(F.regular, S.body, color).text('•', LEFT + 2, y, { width: T.bulletIndent, lineBreak: false });
      setFont(F.regular, S.body, color).text(t, LEFT + T.bulletIndent, y, { width: W - T.bulletIndent, lineGap: LG });
      doc.y = y + h;
    }
    function paragraph(text, color = INK, font = F.regular) {
      const t = san(text);
      if (!t) return;
      const h = H(t, font, S.body, W);
      if (doc.y + h <= CONTENT_BOTTOM) { setFont(font, S.body, color).text(t, LEFT, doc.y, { width: W, lineGap: LG }); return; }
      // flows across a page break line by line (never leaves a half-page gap)
      const words = t.split(/\s+/);
      const lh = lineH(font, S.body);
      let line = '';
      const flush = () => { if (!line) return; if (doc.y + lh > CONTENT_BOTTOM) newPage(); setFont(font, S.body, color).text(line, LEFT, doc.y, { width: W, lineBreak: false }); doc.y += lh; line = ''; };
      for (const w of words) { const trial = line ? `${line} ${w}` : w; if (doc.widthOfString(trial) > W && line) { flush(); line = w; } else line = trial; }
      flush();
    }
    // NO characterSpacing anywhere: text extractors (pdf.js, pdfminer) read letter-spaced glyphs as
    // separate letters ("S U M M A R Y"), which breaks every ATS section detector.
    function heading(text, followNeed = 24) {
      const t = san(text).toUpperCase();
      if (T.headingStyle === 'bar') {
        gap(13 * scale);
        ensure(16 + followNeed);
        setFont(F.bold, S.heading, accent).text(t, LEFT, doc.y, { width: W, lineBreak: false });
        doc.moveDown(0.15);
        const y = doc.y + 1;
        doc.save().lineWidth(1.6).strokeColor(accent).moveTo(LEFT, y).lineTo(LEFT + 28, y).stroke().restore();
        doc.y = y + 8;
      } else {
        gap((T.id === 'engineering' ? 11 : 14) * scale);
        ensure(18 + followNeed);
        setFont(F.bold, S.heading, accent).text(t, LEFT, doc.y, { width: W, lineBreak: false });
        doc.moveDown(0.18);
        const y = doc.y;
        doc.save().lineWidth(T.id === 'engineering' ? 0.6 : 0.9).strokeColor(RULE).moveTo(LEFT, y).lineTo(RIGHT, y).stroke().restore();
        doc.y = y + (T.id === 'engineering' ? 6 : 7);
      }
    }

    // ── header ──
    const b = d.basics;
    const center = T.header === 'center';
    if (b.name) {
      setFont(F.bold, S.name, T.id === 'modern' ? accent : INK).text(san(b.name), LEFT, doc.y, { width: W, align: center ? 'center' : 'left' });
      doc.moveDown(0.15);
    }
    if (b.headline) { setFont(F.italic, S.headline, META).text(san(b.headline), LEFT, doc.y, { width: W, align: center ? 'center' : 'left' }); doc.moveDown(0.15); }
    if (opts.targetLine) { setFont(F.italic, S.meta, META).text(san(opts.targetLine), LEFT, doc.y, { width: W, align: center ? 'center' : 'left' }); doc.moveDown(0.15); }
    const contact = [];
    if (b.location) contact.push({ text: san(b.location) });
    if (b.phone) contact.push({ text: san(b.phone), link: `tel:${b.phone.replace(/[^\d+]/g, '')}` });
    if (b.email) contact.push({ text: san(b.email), link: `mailto:${b.email}` });
    for (const l of b.links) contact.push({ text: san(linkLabel(l)), link: linkHref(l.url) });
    if (contact.length) {
      const SEP = center ? '   ·   ' : '  ·  ';
      setFont(F.regular, S.meta, INK);
      const sepW = doc.widthOfString(SEP);
      // pack segments into lines, then draw each line (centered or left) with per-segment links
      const lines = [[]];
      let used = 0;
      for (const seg of contact) {
        const w = doc.widthOfString(seg.text);
        const add = (lines[lines.length - 1].length ? sepW : 0) + w;
        if (used + add > W && lines[lines.length - 1].length) { lines.push([]); used = 0; }
        lines[lines.length - 1].push({ ...seg, w });
        used += (lines[lines.length - 1].length > 1 ? sepW : 0) + w;
      }
      const lh = lineH(F.regular, S.meta);
      for (const line of lines) {
        const total = line.reduce((s, seg, i) => s + seg.w + (i ? sepW : 0), 0);
        let x = center ? LEFT + (W - total) / 2 : LEFT;
        const y = doc.y;
        line.forEach((seg, i) => {
          if (i) { setFont(F.regular, S.meta, META).text(SEP, x, y, { lineBreak: false, width: W - (x - LEFT) }); x += sepW; }
          // pdfkit needs an explicit width to size a link annotation (NaN rect otherwise)
          setFont(F.regular, S.meta, INK).text(seg.text, x, y, { lineBreak: false, width: Math.max(seg.w + 2, 1), link: seg.link || null });
          x += seg.w;
        });
        doc.y = y + lh;
      }
      doc.moveDown(0.25);
    }
    if (b.name || contact.length) {
      const y = doc.y;
      if (T.id === 'modern') doc.save().lineWidth(2).strokeColor(accent).moveTo(LEFT, y).lineTo(LEFT + 40, y).stroke().restore();
      else doc.save().lineWidth(T.id === 'engineering' ? 0.8 : 1.1).strokeColor(INK).moveTo(LEFT, y).lineTo(RIGHT, y).stroke().restore();
      doc.y = y + 2;
    }

    // ── sections in the document's own order ──
    const dateOf = (e) => san(e.end || !e.dateText ? (formatRange(e.start, e.end) || e.dateText) : e.dateText);
    for (const key of d.sectionOrder) {
      if (key === 'summary' && b.summary) {
        heading(sectionTitle(d, 'summary'));
        paragraph(b.summary);
      } else if (key === 'experience' && d.experience.length) {
        heading(sectionTitle(d, 'experience'));
        d.experience.forEach((e, i) => {
          if (i > 0) gap(T.id === 'engineering' ? 7 : 9);
          const firstBullet = e.bullets.length ? bulletHeight(san(e.bullets[0].text)) : 0;
          ensure(30 + firstBullet);
          if (T.roleLayout === 'company-first') {
            lineWithRight(san(e.company), F.bold, S.body + 0.5, INK, [san(e.location), san(e.employmentType)].filter(Boolean).join('  ·  '), F.italic, S.meta, META);
            lineWithRight(san(e.title), F.italic, S.body, INK, dateOf(e), F.italic, S.meta, META);
          } else {
            lineWithRight(san(e.title), F.bold, S.body + 0.5, INK, dateOf(e), F.regular, S.meta, META);
            const sub = [san(e.company), san(e.location), san(e.employmentType)].filter(Boolean);
            if (sub.length) runs([{ text: sub[0], font: F.regular, color: INK }, { text: sub.length > 1 ? `  ·  ${sub.slice(1).join('  ·  ')}` : '', font: F.italic, color: META }], S.meta);
          }
          gap(1.5);
          if (e.summary) { paragraph(e.summary); gap(1.5); }
          for (const bl of e.bullets) bullet(bl.text);
        });
      } else if (key === 'education' && d.education.length) {
        heading(sectionTitle(d, 'education'));
        d.education.forEach((e, i) => {
          if (i > 0) gap(6);
          ensure(28);
          const degree = [san(e.degree), san(e.field)].filter(Boolean).join(', ');
          if (T.roleLayout === 'company-first') {
            lineWithRight(san(e.school) || degree, F.bold, S.body, INK, dateOf(e), F.italic, S.meta, META);
            const sub = [san(e.school) ? degree : '', san(e.location), e.gpa ? `GPA ${san(e.gpa)}` : ''].filter(Boolean);
            if (sub.length) runs([{ text: sub[0] || '', font: F.italic, color: INK }, { text: sub.length > 1 ? `${sub[0] ? '  ·  ' : ''}${sub.slice(1).join('  ·  ')}` : '', font: F.italic, color: META }], S.meta);
          } else {
            lineWithRight(san(e.school) || degree, F.bold, S.body, INK, dateOf(e), F.regular, S.meta, META);
            const sub = [san(e.school) ? degree : '', san(e.location), e.gpa ? `GPA ${san(e.gpa)}` : ''].filter(Boolean);
            if (sub.length) runs([{ text: sub[0] || '', font: F.regular, color: INK }, { text: sub.length > 1 ? `${sub[0] ? '  ·  ' : ''}${sub.slice(1).join('  ·  ')}` : '', font: F.italic, color: META }], S.meta);
          }
          for (const bl of e.details) bullet(bl.text);
        });
      } else if (key === 'skills' && d.skills.length) {
        heading(sectionTitle(d, 'skills'));
        d.skills.forEach((g, i) => {
          if (i > 0) gap(2.5);
          const items = g.items.map(san).filter(Boolean).join(T.id === 'classic' && !g.label ? '   ·   ' : ', ');
          if (g.label) runs([{ text: `${san(g.label)}: `, font: F.bold, color: INK }, { text: items, font: F.regular, color: INK }], S.body);
          else paragraph(items);
        });
      } else if (key === 'certifications' && d.certifications.length) {
        heading(sectionTitle(d, 'certifications'));
        d.certifications.forEach((c, i) => {
          if (i > 0) gap(2);
          const name = san(c.name) || san(c.text);
          const rest = [san(c.issuer), san(formatDate(c.date))].filter(Boolean).join(', ');
          runs([{ text: name, font: F.bold, color: INK }, { text: rest ? ` — ${rest}` : '', font: F.regular, color: META }], S.body);
        });
      } else if (key === 'projects' && d.projects.length) {
        heading(sectionTitle(d, 'projects'));
        d.projects.forEach((p, i) => {
          if (i > 0) gap(7);
          const firstBullet = p.bullets.length ? bulletHeight(san(p.bullets[0].text)) : 0;
          ensure(28 + firstBullet);
          lineWithRight(san(p.name), F.bold, S.body + 0.5, INK, dateOf(p), F.regular, S.meta, META);
          const sub = [];
          if (p.role) sub.push({ text: san(p.role), font: F.italic, color: META });
          if (p.url) sub.push({ text: `${p.role ? '  ·  ' : ''}${san(p.url.replace(/^https?:\/\/(www\.)?/i, ''))}`, font: F.regular, color: META, link: linkHref(p.url) });
          if (sub.length) runs(sub, S.meta);
          if (p.summary) { gap(1.5); paragraph(p.summary); }
          gap(1.5);
          for (const bl of p.bullets) bullet(bl.text);
        });
      } else if (key === 'languages' && d.languages.length) {
        heading(sectionTitle(d, 'languages'));
        paragraph(d.languages.map((l) => (l.level ? `${san(l.name)} (${san(l.level)})` : san(l.name))).join(T.id === 'classic' ? '   ·   ' : ', '));
      } else if (key.startsWith('extra:')) {
        const x = d.extra.find((e) => `extra:${e.id}` === key);
        if (!x) continue;
        heading(x.title);
        if (x.style === 'lines') { for (const it of x.items) { paragraph(it.text); gap(1.5); } }
        else for (const it of x.items) bullet(it.text);
      }
    }

    // ── optional appendix (the legacy "Optimized for …" package: additive, clearly separated) ──
    const opt = opts.appendix || null;
    if (opt && ((opt.bullets && opt.bullets.length) || (opt.confirmItems && opt.confirmItems.length) || opt.message)) {
      const roleLine = [opt.role, opt.company ? `at ${opt.company}` : ''].filter(Boolean).join(' ');
      heading(roleLine ? `Optimized for ${roleLine}` : 'Optimized for this role');
      if (opt.fitScore != null && !Number.isNaN(Number(opt.fitScore))) paragraph(`SeenFit match: ${Math.round(Number(opt.fitScore))}/100. The bullets below are tailored to this role and grounded in your résumé — review, then copy the ones that fit.`, META);
      for (const t of opt.bullets || []) bullet(t);
      if (opt.confirmItems && opt.confirmItems.length) {
        gap(6);
        ensure(30);
        setFont(F.bold, S.meta, META).text('CONFIRM BEFORE USING', LEFT, doc.y, { width: W, lineBreak: false });
        doc.y += 13;
        paragraph('These add specifics we could not verify from your résumé. Only use them if they are true — fill in the real detail first.', META, F.italic);
        doc.moveDown(0.2);
        for (const c of opt.confirmItems) bullet(`⚠ ${c}`, META);
      }
      if (opt.message && String(opt.message).trim()) {
        gap(6);
        ensure(30);
        setFont(F.bold, S.meta, INK).text('APPLICATION MESSAGE', LEFT, doc.y, { width: W, lineBreak: false });
        doc.y += 13;
        paragraph(String(opt.message).trim());
      }
    }

    // ── footer band on every page: brand line (free tier only) + page numbers (2+ pages) ──
    const range = doc.bufferedPageRange();
    const brand = opts.pro ? '' : (opts.brand == null ? 'Optimized with Seen  ·  seenjobs.io' : String(opts.brand));
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footY = doc.page.height - FOOTER_BAND;
      if (brand) {
        doc.save().lineWidth(0.8).strokeColor(RULE).moveTo(LEFT, footY).lineTo(RIGHT, footY).stroke().restore();
        setFont(F.regular, 8.5, FOOT).text(brand, LEFT, footY + 9, { width: W, align: 'center', lineBreak: false });
      }
      if (range.count > 1) {
        setFont(F.regular, 8.5, FOOT).text(`${san(b.name) ? `${san(b.name)}  ·  ` : ''}Page ${i - range.start + 1} of ${range.count}`, LEFT, footY + 9, { width: W, align: brand ? 'right' : 'center', lineBreak: false });
      }
    }
    doc.flushPages();
    doc.end();
  });
}
