// ATS round-trip check — the honest answer to "will a parser read this file the way I wrote it?"
//
// It renders the document (PDF, DOCX or plain text), runs the SAME extraction + parsing pipeline an
// applicant-tracking system runs (text layer → lines → sections → roles), and compares what came
// back with what went in: contact fields, section headings, every role's title/company/dates,
// bullet and skill survival, word-level text fidelity, and the layout facts that decide
// parse-ability (one column, page count). Every check carries a weight and a plain explanation,
// so the UI can show exactly what a parser would lose. Score 0–100.
//
// It checks OUR render, not a third-party ATS — but the same structural failures (two columns,
// letter-spaced headings, text in tables, dates split from titles) are what every parser trips on,
// and this catches all of them before the candidate uploads.

import { normalizeDoc, serializeToText } from '../model.js';
import { parseResume } from '../parse/index.js';
import { extractResumeFile } from '../extract/index.js';
import { renderPdf } from './pdf.js';
import { renderDocx } from './docx.js';
import { renderText } from './text.js';
import { resolveTemplate } from './templates.js';

export const ATS_CHECK_VERSION = 'ats_check_v1';

const norm = (s) => String(s || '').toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z0-9+#.' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const digits = (s) => String(s || '').replace(/\D/g, '');
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length >= 3 && !/^\d+$/.test(w)));
const ratio = (a, b) => (b ? a / b : 1);
const has = (hay, needle) => !!needle && norm(hay).includes(norm(needle));

/**
 * @param {object} docIn ResumeDoc
 * @param {{ format?: 'pdf'|'docx'|'txt', template?: string, paper?: string, fontScale?: number, accent?: string }} opts
 */
export async function atsCheck(docIn, opts = {}) {
  const d = normalizeDoc(docIn);
  const format = ['pdf', 'docx', 'txt'].includes(String(opts.format || '').toLowerCase()) ? String(opts.format).toLowerCase() : 'pdf';
  const template = resolveTemplate(opts.template).id;
  const checks = [];
  const add = (code, label, ok, weight, detail = '') => { checks.push({ code, label, ok: !!ok, weight, detail }); };
  const t0 = Date.now();

  // 1. Render (unbranded: the check is about the résumé, not the footer) and extract.
  let buffer, pages = null, font = null, renderWarnings = [];
  if (format === 'txt') buffer = Buffer.from(renderText(d), 'utf8');
  else if (format === 'docx') { const r = await renderDocx(d, { template, pro: true, paper: opts.paper, fontScale: opts.fontScale, accent: opts.accent }); buffer = r.buffer; font = r.font; renderWarnings = r.warnings; }
  else { const r = await renderPdf(d, { template, pro: true, paper: opts.paper, fontScale: opts.fontScale, accent: opts.accent }); buffer = r.buffer; pages = r.pages; font = r.font; renderWarnings = r.warnings; }
  const ex = await extractResumeFile({ buffer, fileName: `resume.${format}` });
  if (!ex.ok) {
    add('text_layer', 'The file has a readable text layer', false, 100, ex.error || 'Nothing readable came back from the file.');
    return finish({ d, format, template, checks, pages, font, renderWarnings, extracted: null, parsed: null, ms: Date.now() - t0 });
  }
  add('text_layer', 'The file has a readable text layer', true, 5, `${ex.wordCount} words extracted.`);
  const text = ex.text;
  const parsed = parseResume({ text: ex.text, lines: ex.lines, source: ex.fileType, layout: ex.layout, fileName: `resume.${format}` });

  // 2. Layout facts.
  const columns = ex.layout && ex.layout.columns ? ex.layout.columns : 1;
  add('single_column', 'One column — parsers read top to bottom', columns === 1, 5, columns === 1 ? 'Single column.' : `${columns} columns detected: a parser may interleave the columns.`);
  if (pages != null) add('page_count', 'Two pages or fewer', pages <= 2, 2, `${pages} page${pages === 1 ? '' : 's'}.`);

  // 3. Contact.
  const b = d.basics, pb = parsed.basics;
  if (b.name) add('name', 'Name recognised', norm(pb.name) === norm(b.name) || has(text.split('\n')[0], b.name), 6, pb.name ? `Read as "${pb.name}".` : 'The name was not recognised on the first lines.');
  if (b.email) add('email', 'Email recognised', norm(pb.email) === norm(b.email), 5, pb.email ? `Read as ${pb.email}.` : 'No email found.');
  if (b.phone) add('phone', 'Phone recognised', digits(pb.phone) === digits(b.phone) && digits(b.phone).length >= 7, 4, pb.phone ? `Read as ${pb.phone}.` : 'No phone found.');
  if (b.location) add('location', 'Location recognised', has(pb.location, b.location) || has(text.slice(0, 400), b.location), 1, pb.location ? `Read as "${pb.location}".` : 'Location not found near the top.');

  // 4. Sections.
  const expected = [];
  if (b.summary) expected.push(['summary', 'Summary', () => !!parsed.basics.summary]);
  if (d.experience.length) expected.push(['experience', 'Experience', () => parsed.experience.length > 0]);
  if (d.education.length) expected.push(['education', 'Education', () => parsed.education.length > 0]);
  if (d.skills.length) expected.push(['skills', 'Skills', () => parsed.skills.length > 0]);
  if (d.certifications.length) expected.push(['certifications', 'Certifications', () => parsed.certifications.length > 0]);
  if (d.projects.length) expected.push(['projects', 'Projects', () => parsed.projects.length > 0]);
  if (d.languages.length) expected.push(['languages', 'Languages', () => parsed.languages.length > 0]);
  const missingSections = expected.filter(([, , f]) => !f()).map(([, label]) => label);
  if (expected.length) add('sections', 'Every section found under a standard heading', !missingSections.length, 12, missingSections.length ? `Not recognised: ${missingSections.join(', ')}.` : `${expected.length} section${expected.length === 1 ? '' : 's'} recognised.`);

  // 5. Roles: title, company, dates, bullets.
  // Match each role to ONE parsed role: exact title first (two roles at the same employer must not
  // collapse onto each other), then title containment, then company; each parsed role used once.
  const unused = new Set(parsed.experience);
  const take = (pred) => { for (const p of unused) if (pred(p)) { unused.delete(p); return p; } return null; };
  const roles = d.experience.map((e) => {
    const match = (e.title && take((p) => norm(p.title) === norm(e.title)))
      || (e.title && take((p) => has(p.title, e.title) || has(e.title, p.title)))
      || (e.company && take((p) => norm(p.company) === norm(e.company) && (!e.title || !p.title)))
      || (e.company && take((p) => has(p.company, e.company)))
      || null;
    const titleOk = !e.title || !!(match && (norm(match.title) === norm(e.title) || has(match.title, e.title)));
    const companyOk = !e.company || !!(match && (norm(match.company) === norm(e.company) || has(match.company, e.company)));
    const datesOk = !(e.start || e.end) || !!(match && match.start === e.start && match.end === e.end);
    const bulletsFound = match ? e.bullets.filter((bl) => match.bullets.some((pbl) => norm(pbl.text) === norm(bl.text))).length : 0;
    return { title: e.title, company: e.company, titleOk, companyOk, datesOk, bullets: { found: bulletsFound, total: e.bullets.length }, readAs: match ? { title: match.title, company: match.company, dates: [match.start, match.end].filter(Boolean).join(' – ') } : null };
  });
  if (roles.length) {
    const bad = roles.filter((r) => !(r.titleOk && r.companyOk));
    add('roles', 'Every role’s title and company read back correctly', !bad.length, 15, bad.length ? `Misread: ${bad.map((r) => r.readAs ? `"${r.title || r.company}" → "${r.readAs.title || '?'}" / "${r.readAs.company || '?'}"` : `"${r.title || r.company}" not found`).join('; ')}.` : `${roles.length} role${roles.length === 1 ? '' : 's'} recognised.`);
    const dated = roles.filter((r) => d.experience.find((e) => e.title === r.title && e.company === r.company && (e.start || e.end)));
    if (dated.length) add('dates', 'Dates stay attached to their roles', dated.every((r) => r.datesOk), 8, dated.every((r) => r.datesOk) ? 'All date ranges matched.' : `Wrong or missing dates on: ${dated.filter((r) => !r.datesOk).map((r) => r.title || r.company).join(', ')}.`);
    const bt = roles.reduce((s, r) => s + r.bullets.total, 0), bf = roles.reduce((s, r) => s + r.bullets.found, 0);
    if (bt) add('bullets', 'Bullets survive one per line', bf === bt, 12, `${bf} of ${bt} bullets read back verbatim.`);
  }

  // 6. Skills, education, certifications.
  const skillItems = d.skills.flatMap((g) => g.items);
  if (skillItems.length) {
    const parsedSkillText = norm(parsed.skills.flatMap((g) => g.items).join(' | '));
    const found = skillItems.filter((it) => parsedSkillText.includes(norm(it))).length;
    add('skills', 'Skills list reads back item by item', found === skillItems.length, 8, `${found} of ${skillItems.length} skills found in the Skills section.`);
  }
  if (d.education.length) {
    const found = d.education.filter((e) => parsed.education.some((p) => (e.school && has(p.school, e.school)) || (e.degree && has(p.degree, e.degree)))).length;
    add('education', 'Education entries recognised', found === d.education.length, 5, `${found} of ${d.education.length} entries found.`);
  }
  if (d.certifications.length) {
    const found = d.certifications.filter((c) => parsed.certifications.some((p) => has(p.text || p.name, c.name || c.text))).length;
    add('certifications', 'Certifications recognised', found === d.certifications.length, 3, `${found} of ${d.certifications.length} found.`);
  }

  // 7. Word-level fidelity: every real word of the document appears in the extracted text.
  const want = words(serializeToText(d)), got = words(text);
  let lost = [];
  for (const w of want) if (!got.has(w)) lost.push(w);
  const fidelity = ratio(want.size - lost.length, want.size);
  add('fidelity', 'Every word survives extraction', fidelity >= 0.995, 10, lost.length ? `${lost.length} word${lost.length === 1 ? '' : 's'} did not come back (${lost.slice(0, 6).join(', ')}${lost.length > 6 ? '…' : ''}).` : 'Every word came back.');
  const spaced = (text.match(/\b(?:[A-Z] ){3,}[A-Z]\b/g) || []);
  add('letter_spacing', 'No letter-spaced headings (S U M M A R Y)', !spaced.length, 4, spaced.length ? `Spaced text found: ${spaced.slice(0, 3).join(', ')}.` : 'Headings read as whole words.');

  return finish({ d, format, template, checks, pages, font, renderWarnings, columns, extracted: text, parsed, roles, ms: Date.now() - t0, lost, bytes: buffer.length });
}

function finish({ d, format, template, checks, pages, font, renderWarnings, columns = null, extracted, parsed, roles = [], ms, lost = [], bytes = 0 }) {
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = total ? Math.round((earned / total) * 100) : 0;
  const grade = score >= 95 ? 'A' : score >= 85 ? 'B' : score >= 70 ? 'C' : 'D';
  return {
    version: ATS_CHECK_VERSION,
    format, template: format === 'txt' ? null : template,
    score, grade,
    pages, columns, font, bytes, ms,
    checks,
    failed: checks.filter((c) => !c.ok).map((c) => c.code),
    recovered: parsed ? { name: parsed.basics.name, email: parsed.basics.email, phone: parsed.basics.phone, roles: roles.map((r) => ({ title: r.title, company: r.company, ok: r.titleOk && r.companyOk && r.datesOk, readAs: r.readAs, bullets: r.bullets })), sections: parsed.sectionOrder, lostWords: lost.slice(0, 20) } : null,
    warnings: renderWarnings,
    extractedText: extracted ? extracted.slice(0, 6000) : '',
    summary: score >= 95 ? 'Parsers read this file exactly as written.' : score >= 85 ? 'Parsers read this well; one or two details may be lost.' : score >= 70 ? 'Parsers will lose some structure — see the failed checks.' : 'This file will not parse reliably.',
  };
}
