// Certifications, projects, languages, summary and free-form extra sections.

import { findDateRange, findTrailingDate, stripDateRange } from './dates.js';
import { parseExperience } from './experience.js';
import { parseLanguage, splitSkillList, newId } from '../model.js';
import { URL_RE } from './lexicon.js';

const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

// Split on " | ", " — ", " – ", " - ", " • " and ", Capital" — but never inside parentheses, so
// "Registered Nurse (RN), Arizona Board of Nursing" keeps its acronym.
export function splitOutsideParens(text) {
  const out = [];
  let depth = 0, cur = '';
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0) {
      const rest = s.slice(i);
      const m = rest.match(/^(\s*(?:\||—|–|•|·)\s*|\s+-\s+|,\s+(?=[A-Z]))/);
      if (m && cur.trim()) { out.push(cur); cur = ''; i += m[0].length - 1; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseCertifications(lines) {
  const out = [];
  for (const line of lines) {
    let text = line.text.trim();
    if (!text) continue;
    // A long prose line in a certifications section is still a cert with a description.
    const entry = { id: newId('c'), name: '', issuer: '', date: '', text };
    const dr = findDateRange(text);
    if (dr) { entry.date = dr.start; text = stripDateRange(text); }
    else { const td = findTrailingDate(text); if (td) { entry.date = td.token; text = text.slice(0, td.index).replace(/[\s,;:|–—(-]+$/, '').trim(); } }
    const pieces = splitOutsideParens(text).map((p) => p.trim()).map((p) => (/^\(.*\)$/.test(p) ? p.slice(1, -1).trim() : p)).filter(Boolean);
    entry.name = pieces[0] || text;
    if (pieces.length >= 2) entry.issuer = pieces.slice(1).join(', ');
    entry.text = line.text.trim();
    out.push(entry);
  }
  return out;
}

export function parseProjects(lines, opts) {
  // Projects look like roles: a header (name — role | url | dates) then bullets.
  const { roles } = parseExperience(lines, { ...opts, requireDates: false });
  return roles.map((r) => {
    // For projects the first piece is the name and the second (if any) the role/tagline.
    const name = r.title || r.company;
    const role = r.title && r.company ? r.company : '';
    return {
      id: newId('p'), name: String(name || '').replace(URL_RE, '').trim(),
      role: String(role || '').replace(URL_RE, '').trim(),
      url: r.url || '',
      start: r.start, end: r.end, dateText: r.dateText, summary: r.summary, bullets: r.bullets,
    };
  });
}

export function parseLanguages(lines) {
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    for (const part of splitSkillList(line.text)) {
      const l = parseLanguage(part);
      if (!l.name || seen.has(l.name.toLowerCase()) || wordCount(l.name) > 3) continue;
      seen.add(l.name.toLowerCase()); out.push(l);
    }
  }
  return out;
}

export function parseSummary(lines) {
  return lines.map((l) => l.text.trim()).filter(Boolean).join('\n');
}

export function parseExtraItems(lines) {
  return lines.map((l) => l.text.trim()).filter(Boolean).map((text) => ({ id: newId('b'), text }));
}
