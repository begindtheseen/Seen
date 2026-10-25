// Plain-text and Markdown renderers.
//
// TXT follows the conventions ATS plain-text parsers expect: name on the first line, one contact
// line, UPPERCASE section headings, one role header per line ("Title | Company | Location | Dates"),
// ASCII "-" bullets one per line, blank lines between entries, NO hard wrapping (a wrapped bullet
// becomes two bullets to a parser) and ASCII dashes in date ranges.
// Markdown is the human-readable twin (GitHub, Notion, email) — same order, same content.

import { normalizeDoc, sectionTitle, gpaLabel } from '../model.js';
import { formatRange, formatDate } from '../parse/dates.js';

const asciiDash = (s) => String(s || '').replace(/[–—]/g, '-');
const join = (parts, sep) => parts.map((p) => String(p || '').trim()).filter(Boolean).join(sep);

function dateOf(e) { return (e.end || !e.dateText ? (formatRange(e.start, e.end) || e.dateText) : e.dateText) || ''; }
function eduMain(e) { return join([join([e.degree, e.field], ', '), e.school], ' - '); }
function certMain(c) { return join([c.name, c.issuer], ' - ') || c.text; }

export function renderText(docIn) {
  const d = normalizeDoc(docIn);
  const b = d.basics;
  const L = [];
  if (b.name) L.push(b.name.toUpperCase());
  if (b.headline) L.push(b.headline);
  const contact = join([b.location, b.phone, b.email, ...b.links.map((l) => l.url)], ' | ');
  if (contact) L.push(contact);
  const blank = () => { if (L.length && L[L.length - 1] !== '') L.push(''); };
  const section = (title) => { blank(); L.push(title.toUpperCase()); };

  for (const key of d.sectionOrder) {
    if (key === 'summary' && b.summary) { section(sectionTitle(d, 'summary')); L.push(...b.summary.split('\n')); }
    else if (key === 'experience' && d.experience.length) {
      section(sectionTitle(d, 'experience'));
      d.experience.forEach((e, i) => {
        if (i > 0) blank();
        L.push(asciiDash(join([e.title, e.company, e.location, e.employmentType, dateOf(e)], ' | ')));
        if (e.summary) L.push(...e.summary.split('\n'));
        for (const bl of e.bullets) L.push(`- ${bl.text}`);
      });
    } else if (key === 'education' && d.education.length) {
      section(sectionTitle(d, 'education'));
      d.education.forEach((e, i) => {
        if (i > 0) blank();
        L.push(asciiDash(join([eduMain(e), e.location, dateOf(e), gpaLabel(e)], ' | ')));
        for (const bl of e.details) L.push(`- ${bl.text}`);
      });
    } else if (key === 'skills' && d.skills.length) {
      section(sectionTitle(d, 'skills'));
      for (const g of d.skills) L.push(g.label ? `${g.label}: ${g.items.join(', ')}` : g.items.join(', '));
    } else if (key === 'certifications' && d.certifications.length) {
      section(sectionTitle(d, 'certifications'));
      for (const c of d.certifications) L.push(`- ${asciiDash(join([certMain(c), formatDate(c.date)], ' | '))}`);
    } else if (key === 'projects' && d.projects.length) {
      section(sectionTitle(d, 'projects'));
      d.projects.forEach((p, i) => {
        if (i > 0) blank();
        L.push(asciiDash(join([join([p.name, p.role], ' - '), p.url, dateOf(p)], ' | ')));
        if (p.summary) L.push(...p.summary.split('\n'));
        for (const bl of p.bullets) L.push(`- ${bl.text}`);
      });
    } else if (key === 'languages' && d.languages.length) {
      section(sectionTitle(d, 'languages'));
      L.push(d.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', '));
    } else if (key.startsWith('extra:')) {
      const x = d.extra.find((e) => `extra:${e.id}` === key);
      if (!x) continue;
      section(x.title);
      for (const it of x.items) L.push(x.style === 'lines' ? it.text : `- ${it.text}`);
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function renderMarkdown(docIn) {
  const d = normalizeDoc(docIn);
  const b = d.basics;
  const L = [];
  if (b.name) L.push(`# ${b.name}`);
  if (b.headline) L.push(`**${b.headline}**`);
  const contact = join([b.location, b.phone, b.email ? `[${b.email}](mailto:${b.email})` : '', ...b.links.map((l) => `[${l.label || l.url.replace(/^https?:\/\/(www\.)?/, '')}](${/^https?:/i.test(l.url) ? l.url : `https://${l.url}`})`)], ' · ');
  if (contact) L.push(contact);
  const blank = () => { if (L.length && L[L.length - 1] !== '') L.push(''); };
  const section = (title) => { blank(); L.push(`## ${title}`); L.push(''); };
  const esc = (s) => String(s || '').replace(/([\\*_`#])/g, '\\$1');

  for (const key of d.sectionOrder) {
    if (key === 'summary' && b.summary) { section(sectionTitle(d, 'summary')); L.push(...b.summary.split('\n')); }
    else if (key === 'experience' && d.experience.length) {
      section(sectionTitle(d, 'experience'));
      d.experience.forEach((e, i) => {
        if (i > 0) blank();
        const head = join([e.title ? `**${esc(e.title)}**` : '', e.company ? esc(e.company) : ''], ' — ');
        const meta = join([e.location, e.employmentType, dateOf(e)], ' · ');
        L.push(join([head, meta ? `_${esc(meta)}_` : ''], '  \n'));
        if (e.summary) { L.push(''); L.push(...e.summary.split('\n')); }
        if (e.bullets.length) L.push('');
        for (const bl of e.bullets) L.push(`- ${esc(bl.text)}`);
      });
    } else if (key === 'education' && d.education.length) {
      section(sectionTitle(d, 'education'));
      d.education.forEach((e, i) => {
        if (i > 0) blank();
        const head = join([e.school ? `**${esc(e.school)}**` : '', esc(join([e.degree, e.field], ', '))], ' — ');
        const meta = join([e.location, dateOf(e), gpaLabel(e)], ' · ');
        L.push(join([head, meta ? `_${esc(meta)}_` : ''], '  \n'));
        for (const bl of e.details) L.push(`- ${esc(bl.text)}`);
      });
    } else if (key === 'skills' && d.skills.length) {
      section(sectionTitle(d, 'skills'));
      for (const g of d.skills) L.push(g.label ? `- **${esc(g.label)}:** ${esc(g.items.join(', '))}` : `- ${esc(g.items.join(', '))}`);
    } else if (key === 'certifications' && d.certifications.length) {
      section(sectionTitle(d, 'certifications'));
      for (const c of d.certifications) L.push(`- ${esc(join([certMain(c), formatDate(c.date)], ' · '))}`);
    } else if (key === 'projects' && d.projects.length) {
      section(sectionTitle(d, 'projects'));
      d.projects.forEach((p, i) => {
        if (i > 0) blank();
        const head = join([p.name ? `**${esc(p.name)}**` : '', esc(p.role)], ' — ');
        const meta = join([p.url ? `[${p.url.replace(/^https?:\/\/(www\.)?/, '')}](${/^https?:/i.test(p.url) ? p.url : `https://${p.url}`})` : '', dateOf(p)], ' · ');
        L.push(join([head, meta ? `_${meta}_` : ''], '  \n'));
        if (p.summary) { L.push(''); L.push(...p.summary.split('\n')); }
        if (p.bullets.length) L.push('');
        for (const bl of p.bullets) L.push(`- ${esc(bl.text)}`);
      });
    } else if (key === 'languages' && d.languages.length) {
      section(sectionTitle(d, 'languages'));
      L.push(d.languages.map((l) => (l.level ? `${esc(l.name)} (${esc(l.level)})` : esc(l.name))).join(' · '));
    } else if (key.startsWith('extra:')) {
      const x = d.extra.find((e) => `extra:${e.id}` === key);
      if (!x) continue;
      section(x.title);
      for (const it of x.items) L.push(x.style === 'lines' ? `${esc(it.text)}  ` : `- ${esc(it.text)}`);
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
