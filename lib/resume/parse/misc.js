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
      // a dash separates only with spaces around it: "Grades P–5" is one range, not "Grades P, 5"
      const m = rest.match(/^(\s*(?:\||•|·)\s*|\s+[—–-]\s+|—(?=[A-Z])|,\s+(?=[A-Z]))/);
      if (m && cur.trim()) { out.push(cur); cur = ''; i += m[0].length - 1; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// A certification's own name: an acronym ("BLS", "ACLS", "NIHSS", "OSHA 30") or a cert cue word.
const CERT_NAME_RE = /^(?:[A-Z][A-Z0-9+&-]{1,7}(?:\s+\d{1,3})?\b|(?:[A-Za-z-]+\s+){0,4}(?:certif\w*|licen[cs]\w*|credential|cpr|first aid|osha|servsafe|forklift|cdl)\b)/;
const CERT_CUE_ANY_RE = /\b(?:certif\w*|licen[cs]\w*|licensure|credential|cpr|bls|acls|pals|nrp|nihss|osha|servsafe|first aid|forklift|cdl|cpa|pmp|rn|lpn|cna|emt|tncc|hipaa|nfpa)\b/i;

// "Active RN license (AZ, compact) · BLS" is two certifications, not a licence issued by "BLS".
function splitCertList(text) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /^(?:\s+[·•▪]\s+|\s*;\s+)/.test(text.slice(i))) {
      const m = text.slice(i).match(/^(?:\s+[·•▪]\s+|\s*;\s+)/);
      parts.push(cur); cur = ''; i += m[0].length - 1; continue;
    }
    cur += ch;
  }
  parts.push(cur);
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  if (clean.length < 2) {
    const byYear = text.split(/(?<=\((?:19|20)\d{2}\)),\s+/).map((p) => p.trim()).filter(Boolean);
    return byYear.length >= 2 && byYear.every((p) => /\((?:19|20)\d{2}\)$/.test(p)) ? byYear : [text];
  }
  // a semicolon between entries is always a list; a middle dot only between credential names
  if (/;\s/.test(text) && clean.every((p) => p.split(/\s+/).length >= 1)) return clean;
  // "ServSafe Manager (2024), Allergen Awareness (2024)": each entry carries its own year
  return clean.every((p) => CERT_CUE_ANY_RE.test(p) || /^[A-Z][A-Z0-9+&-]{1,7}\b/.test(p)) ? clean : [text];
}

// Is the date at `index` inside a parenthetical that says more than the date? ("(OSHA, renewed 2024)")
function insideWordyParens(text, index) {
  const open = text.lastIndexOf('(', index);
  if (open < 0 || text.lastIndexOf(')', index - 1) > open) return false;
  const close = text.indexOf(')', index);
  const inner = text.slice(open + 1, close < 0 ? text.length : close);
  return /[A-Za-z]{2,}/.test(inner.replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|\b(?:expected|issued|exp\.?|expires?|valid (?:through|until)|since)\b/gi, ''));
}

function parseOneCert(raw) {
  // a dangling separator at the end ("OSHA 30 — 2022 —", "CPR / First Aid |") is layout, not words
  let text = raw.trim().replace(/[\s|—–·•,;:]+$/, '').replace(/\s+-$/, '').trim();
  // A long prose line in a certifications section is still a cert with a description.
  const entry = { id: newId('c'), name: '', issuer: '', date: '', text };
  const dr = findDateRange(text);
  if (dr && !insideWordyParens(text, text.indexOf(dr.raw))) { entry.date = dr.start; text = stripDateRange(text); }
  else if (!dr) {
    const td = findTrailingDate(text);
    if (td) {
      entry.date = td.token;
      // "Forklift certified (OSHA, renewed 2024)": the year stays inside its parenthetical — cutting
      // it out printed "(OSHA, renewed | 2024" (Studio judge, 2026-11-10)
      // "ASME Section IX 6G pipe, renewed 2024" / "BLS – AHA – exp 06/2026": the date belongs to its word
      const qualified = /\b(?:renewed|renewal|expires?|exp\.?|expiring|valid (?:through|until|thru)|issued|since|active through)\s*$/i.test(text.slice(0, td.index + td.raw.indexOf(td.text)).trim());
      if (!qualified && !insideWordyParens(text, td.index + td.raw.indexOf(td.text))) text = text.slice(0, td.index).replace(/[\s,;:|–—(-]+$/, '').trim();
    }
  }
  const pieces = [];
  for (const p0 of splitOutsideParens(text).map((p) => p.trim()).filter(Boolean)) {
    // "BLS, ACLS (American Heart Association)": a comma between two certification names is a list,
    // not name + issuer — the piece rejoins the one before it
    if (pieces.length && /^[A-Z]/.test(p0) && CERT_NAME_RE.test(p0) && CERT_NAME_RE.test(pieces[pieces.length - 1]) && text.includes(`${pieces[pieces.length - 1]}, ${p0}`)) { pieces[pieces.length - 1] = `${pieces[pieces.length - 1]}, ${p0}`; continue; }
    pieces.push(p0);
  }
  const unwrapped = pieces.map((p) => (/^\(.*\)$/.test(p) ? p.slice(1, -1).trim() : p)).filter(Boolean);
  entry.name = unwrapped[0] || text;
  if (unwrapped.length >= 2) entry.issuer = unwrapped.slice(1).join(', ');
  return entry;
}

export function parseCertifications(lines) {
  const out = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    for (const piece of splitCertList(text)) out.push(parseOneCert(piece));
  }
  return out;
}

export function parseProjects(lines, opts) {
  // Projects look like roles: a header (name — role | url | dates) then bullets.
  const { roles } = parseExperience(lines, { ...opts, requireDates: false });
  return roles.map((r) => {
    // a project's tagline keeps its own parenthetical ("trail-finding app (React Native, Firebase)")
    if (r.companyNote) r = { ...r, company: /^[([]/.test(r.companyNote) ? `${r.company} ${r.companyNote}` : `${r.company}, ${r.companyNote}` };
    // a project has no place: a "location" read off its line is part of its tagline ("Python, Flask")
    if (r.location) r = { ...r, company: r.company ? `${r.company}, ${r.location}` : r.location, location: '' };
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
