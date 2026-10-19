// Résumé Studio — the CANONICAL résumé document model.
//
// Everything in lib/resume/* speaks ONE shape: ResumeDoc (a JSON-Resume-compatible superset —
// see toJsonResume() in render/json.js). The parser produces it, the editor edits it, the health
// and tailor engines read it, every renderer (PDF / DOCX / text / JSON) consumes it, and
// serializeToText() turns it back into canonical plain text that the parser round-trips
// LOSSLESSLY. That round-trip is what lets the structured doc live in the existing
// profiles.resume_text column with no schema change: the text IS the document.
//
// Dates are normalized tokens from parse/dates.js ('YYYY-MM' | 'YYYY' | 'present' | '') — never
// Date objects. Every item carries a stable short id so the UI, health findings and tailoring
// provenance can anchor to it. Pure + deterministic (ids aside); no I/O; plain JS so the Vercel
// serverless handlers and the TypeScript client import the same code (model.d.ts types it).

import { formatRange, formatDate, isToken, fromToken, toToken, parseDateToken } from './parse/dates.js';

export const DOC_SCHEMA = 'seen.resume/2';
export const MODEL_VERSION = 'resume_model_v2';

// Sections a résumé may carry, in the default rendering order. `extra` sections (awards,
// publications, volunteer, interests, custom) keep their own kinds inside doc.extra.
export const SECTION_KINDS = ['summary', 'experience', 'education', 'skills', 'certifications', 'projects', 'languages', 'extra'];
export const EXTRA_KINDS = ['awards', 'publications', 'volunteer', 'interests', 'affiliations', 'custom'];
export const LINK_KINDS = ['linkedin', 'github', 'portfolio', 'other'];

let _seq = 0;
/** Short, collision-resistant id. Deterministic ordering is never assumed from it. */
export function newId(prefix = 'i') {
  _seq = (_seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${randomSuffix()}${_seq.toString(36)}`;
}

const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const multi = (v) => (v == null ? '' : String(v)).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const dateTok = (v) => {
  const s = str(v);
  if (!s) return '';
  if (isToken(s)) return s;
  const d = parseDateToken(s);
  return d ? toToken(d) : '';
};

function bulletList(items) {
  const out = [];
  for (const b of arr(items)) {
    const text = typeof b === 'string' ? str(b) : str(b && b.text);
    if (!text) continue;
    out.push({ id: (b && b.id) || newId('b'), text });
  }
  return out;
}

/** An empty, valid document. */
export function emptyDoc() {
  return {
    schema: DOC_SCHEMA,
    id: newId('doc'),
    kind: 'base',
    basics: { name: '', headline: '', email: '', phone: '', location: '', links: [], summary: '' },
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    projects: [],
    languages: [],
    extra: [],
    sectionOrder: [],
    meta: {
      source: 'editor', fileName: '', parsedAt: '', parserVersion: '', warnings: [], confidence: {},
      layout: null, tailoredFor: null, provenance: [], baseDocId: null, sectionTitles: {},
    },
  };
}

/**
 * Coerce any partial / untrusted object into a complete, well-typed ResumeDoc. Unknown fields are
 * dropped, strings are trimmed, dates normalized, ids assigned. Never throws on bad input.
 */
export function normalizeDoc(input) {
  const d = emptyDoc();
  const src = input && typeof input === 'object' ? input : {};
  if (src.id) d.id = str(src.id);
  if (src.kind === 'variant') d.kind = 'variant';

  const b = src.basics && typeof src.basics === 'object' ? src.basics : {};
  d.basics = {
    name: str(b.name), headline: str(b.headline), email: str(b.email), phone: str(b.phone), location: str(b.location),
    links: arr(b.links).map((l) => ({
      kind: LINK_KINDS.includes(l && l.kind) ? l.kind : inferLinkKind(l && l.url),
      url: str(l && l.url), label: str(l && l.label),
    })).filter((l) => l.url),
    summary: multi(b.summary),
  };

  d.experience = arr(src.experience).map((e) => ({
    id: (e && e.id) || newId('x'),
    title: str(e && e.title), company: str(e && e.company), location: str(e && e.location),
    employmentType: str(e && e.employmentType),
    start: dateTok(e && e.start), end: dateTok(e && e.end), dateText: str(e && e.dateText),
    summary: multi(e && e.summary),
    bullets: bulletList(e && e.bullets),
  })).filter((e) => e.title || e.company || e.bullets.length);

  d.education = arr(src.education).map((e) => ({
    id: (e && e.id) || newId('e'),
    school: str(e && e.school), degree: str(e && e.degree), field: str(e && e.field), location: str(e && e.location),
    start: dateTok(e && e.start), end: dateTok(e && e.end), dateText: str(e && e.dateText), gpa: str(e && e.gpa),
    details: bulletList(e && e.details),
  })).filter((e) => e.school || e.degree || e.field || e.details.length);

  d.skills = arr(src.skills).map((g) => {
    if (typeof g === 'string') return { id: newId('s'), label: '', items: splitSkillList(g) };
    return { id: (g && g.id) || newId('s'), label: str(g && g.label), items: arr(g && g.items).map(str).filter(Boolean) };
  }).filter((g) => g.items.length);

  d.certifications = arr(src.certifications).map((c) => {
    if (typeof c === 'string') return { id: newId('c'), name: str(c), issuer: '', date: '', text: str(c) };
    return { id: (c && c.id) || newId('c'), name: str(c && c.name), issuer: str(c && c.issuer), date: dateTok(c && c.date), text: str(c && c.text) || str(c && c.name) };
  }).filter((c) => c.name || c.text);

  d.projects = arr(src.projects).map((p) => ({
    id: (p && p.id) || newId('p'),
    name: str(p && p.name), role: str(p && p.role), url: str(p && p.url),
    start: dateTok(p && p.start), end: dateTok(p && p.end), dateText: str(p && p.dateText),
    summary: multi(p && p.summary), bullets: bulletList(p && p.bullets),
  })).filter((p) => p.name || p.bullets.length || p.summary);

  d.languages = arr(src.languages).map((l) => {
    if (typeof l === 'string') return parseLanguage(l);
    return { id: (l && l.id) || newId('l'), name: str(l && l.name), level: str(l && l.level) };
  }).filter((l) => l.name);

  d.extra = arr(src.extra).map((x) => ({
    id: (x && x.id) || newId('z'),
    kind: EXTRA_KINDS.includes(x && x.kind) ? x.kind : 'custom',
    title: str(x && x.title) || (x && x.kind ? titleForKind(x.kind) : 'Additional'),
    items: bulletList(x && x.items),
    style: x && x.style === 'lines' ? 'lines' : 'bullets', // 'lines' = plain lines (condensed roles), no bullet glyph
  })).filter((x) => x.items.length);

  d.sectionOrder = arr(src.sectionOrder).map(str).filter((k) => SECTION_KINDS.includes(k) || k.startsWith('extra:'));
  if (!d.sectionOrder.length) d.sectionOrder = defaultSectionOrder(d);

  const m = src.meta && typeof src.meta === 'object' ? src.meta : {};
  d.meta = {
    source: str(m.source) || 'editor',
    fileName: str(m.fileName),
    parsedAt: str(m.parsedAt),
    parserVersion: str(m.parserVersion),
    warnings: arr(m.warnings).map((w) => (typeof w === 'string' ? { code: 'note', message: w } : { code: str(w && w.code) || 'note', message: str(w && w.message), anchor: w && w.anchor ? w.anchor : undefined })).filter((w) => w.message),
    confidence: m.confidence && typeof m.confidence === 'object' ? { ...m.confidence } : {},
    layout: m.layout && typeof m.layout === 'object' ? { ...m.layout } : null,
    tailoredFor: m.tailoredFor && typeof m.tailoredFor === 'object'
      ? { company: str(m.tailoredFor.company), role: str(m.tailoredFor.role), jobId: str(m.tailoredFor.jobId) } : null,
    provenance: arr(m.provenance).filter((p) => p && typeof p === 'object'),
    baseDocId: m.baseDocId ? str(m.baseDocId) : null,
    // optional display titles for standard sections ("Relevant Experience") — renderers and the
    // serializer use them; the parser reads them back as the same section kinds
    sectionTitles: m.sectionTitles && typeof m.sectionTitles === 'object' ? Object.fromEntries(Object.entries(m.sectionTitles).filter(([k, v]) => SECTION_KINDS.includes(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()])) : {},
  };
  return d;
}

/** Display title for a standard section, honouring a document's own override ("Relevant Experience"). */
export function sectionTitle(d, kind) {
  const o = d && d.meta && d.meta.sectionTitles && d.meta.sectionTitles[kind];
  return o || titleForKind(kind);
}

export function titleForKind(kind) {
  return ({
    summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills',
    certifications: 'Certifications', projects: 'Projects', languages: 'Languages',
    awards: 'Awards', publications: 'Publications', volunteer: 'Volunteer Experience',
    interests: 'Interests', affiliations: 'Affiliations', custom: 'Additional',
  })[kind] || 'Additional';
}

export function defaultSectionOrder(d) {
  const order = [];
  if (d.basics && d.basics.summary) order.push('summary');
  if (d.experience.length) order.push('experience');
  if (d.education.length) order.push('education');
  if (d.skills.length) order.push('skills');
  if (d.certifications.length) order.push('certifications');
  if (d.projects.length) order.push('projects');
  if (d.languages.length) order.push('languages');
  for (const x of d.extra) order.push(`extra:${x.id}`);
  return order;
}

/** Lower-cased hostname of a URL (scheme optional: "linkedin.com/in/x" → "linkedin.com"); '' when unparseable. */
export function urlHost(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase(); } catch { return ''; }
}
/** True when the URL's host IS `domain` or a subdomain of it (never a substring match on the whole URL). */
export function hostIs(url, domain) {
  const h = urlHost(url);
  return !!h && (h === domain || h.endsWith(`.${domain}`));
}
export function inferLinkKind(url) {
  if (hostIs(url, 'linkedin.com')) return 'linkedin';
  if (hostIs(url, 'github.com')) return 'github';
  if (String(url || '').trim()) return 'portfolio';
  return 'other';
}

/** "English (Native)" / "Spanish – Fluent" / "French: B2" → { name, level }. */
export function parseLanguage(s) {
  const t = str(s);
  const m = t.match(/^([A-Za-z][A-Za-z\s'-]{1,30}?)\s*(?:\(([^)]+)\)|[:–—-]\s*(.+))?$/);
  if (!m) return { id: newId('l'), name: t, level: '' };
  return { id: newId('l'), name: str(m[1]), level: str(m[2] || m[3]) };
}

/** Split "A, B, C" / "A | B" / "A • B" / "A; B" into skill items (keeps "C++", "Node.js", and
 *  never splits inside parentheses: "Forklift certified (sit-down, reach)" is one item). */
export function splitSkillList(s) {
  const text = String(s || '');
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (/[,;|•·▪◦\t]/.test(ch) || (ch === ' ' && text.slice(i, i + 3) === '   '))) {
      if (cur.trim()) out.push(cur);
      cur = '';
      if (ch === ' ') { while (text[i + 1] === ' ') i++; }
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out
    .map((x) => str(x).replace(/^[-–—]\s*/, '').replace(/\.$/, ''))
    .filter((x) => x && x.length <= 60);
}

/** True when the document has essentially no content. */
export function docIsEmpty(d) {
  if (!d) return true;
  return !(d.basics.name || d.basics.summary || d.experience.length || d.education.length || d.skills.length || d.certifications.length || d.projects.length || d.extra.length);
}

/** Simple stats the UI shows and the health engine reuses. */
export function docStats(d) {
  const bullets = d.experience.reduce((n, e) => n + e.bullets.length, 0) + d.projects.reduce((n, p) => n + p.bullets.length, 0);
  const text = serializeToText(d);
  const words = text.split(/\s+/).filter(Boolean).length;
  return {
    words, bullets,
    roles: d.experience.length, education: d.education.length,
    skills: d.skills.reduce((n, g) => n + g.items.length, 0),
    sections: d.sectionOrder.length,
  };
}

// ── Canonical text serialization ─────────────────────────────────────────────────────────────
// Deterministic ATS-style plain text. Header grammar per role is "Title — Company | Location |
// Dates" (fields omitted when blank; the em-dash separates title/company, pipes separate fields).
// The parser recognises exactly this shape (plus every common human layout), so
// parse(serializeToText(doc)) reproduces doc. Used for: profiles.resume_text storage, the legacy
// text-only engines (SeenFit, surveys, job match), and the .txt export.

function headerLine(parts) {
  return parts.filter(Boolean).join(' | ');
}

export function serializeToText(d) {
  const L = [];
  const b = d.basics;
  if (b.name) L.push(b.name);
  if (b.headline) L.push(b.headline);
  const contact = [b.email, b.phone, b.location, ...b.links.map((l) => l.url)].filter(Boolean);
  if (contact.length) L.push(contact.join(' | '));

  const blank = () => { if (L.length && L[L.length - 1] !== '') L.push(''); };
  const section = (title) => { blank(); L.push(title.toUpperCase()); };

  for (const key of d.sectionOrder) {
    if (key === 'summary' && b.summary) {
      section(sectionTitle(d, 'summary'));
      for (const line of b.summary.split('\n')) L.push(line);
    } else if (key === 'experience' && d.experience.length) {
      section(sectionTitle(d, 'experience'));
      d.experience.forEach((e, i) => {
        if (i > 0) blank();
        const tc = [e.title, e.company].filter(Boolean).join(' — ');
        L.push(headerLine([tc, e.location, e.employmentType, formatRange(e.start, e.end) || e.dateText]));
        if (e.summary) for (const line of e.summary.split('\n')) L.push(line);
        for (const bl of e.bullets) L.push(`• ${bl.text}`);
      });
    } else if (key === 'education' && d.education.length) {
      section(sectionTitle(d, 'education'));
      d.education.forEach((e, i) => {
        if (i > 0) blank();
        const deg = [e.degree, e.field].filter(Boolean).join(', ');
        const main = [deg, e.school].filter(Boolean).join(' — ');
        L.push(headerLine([main, e.location, formatRange(e.start, e.end) || e.dateText, e.gpa ? `GPA ${e.gpa}` : '']));
        for (const bl of e.details) L.push(`• ${bl.text}`);
      });
    } else if (key === 'skills' && d.skills.length) {
      section(sectionTitle(d, 'skills'));
      for (const g of d.skills) L.push(g.label ? `${g.label}: ${g.items.join(', ')}` : g.items.join(', '));
    } else if (key === 'certifications' && d.certifications.length) {
      section(sectionTitle(d, 'certifications'));
      for (const c of d.certifications) {
        const main = [c.name, c.issuer].filter(Boolean).join(' — ');
        L.push(`• ${headerLine([main || c.text, formatDate(c.date)])}`);
      }
    } else if (key === 'projects' && d.projects.length) {
      section(sectionTitle(d, 'projects'));
      d.projects.forEach((p, i) => {
        if (i > 0) blank();
        const main = [p.name, p.role].filter(Boolean).join(' — ');
        L.push(headerLine([main, p.url, formatRange(p.start, p.end) || p.dateText]));
        if (p.summary) for (const line of p.summary.split('\n')) L.push(line);
        for (const bl of p.bullets) L.push(`• ${bl.text}`);
      });
    } else if (key === 'languages' && d.languages.length) {
      section(sectionTitle(d, 'languages'));
      L.push(d.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', '));
    } else if (key.startsWith('extra:')) {
      const x = d.extra.find((e) => `extra:${e.id}` === key);
      if (!x) continue;
      section(x.title);
      for (const it of x.items) L.push(x.style === 'lines' ? it.text : `• ${it.text}`);
    }
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ── Legacy adapters ───────────────────────────────────────────────────────────────────────────
// The pre-Studio code paths consume two older shapes. Keeping adapters here (one place) lets the
// résumé survey, career-signal, SeenFit and the classic PDF renderer keep working unchanged.

/** → [{ company, title, start_date, end_date }] (resumeAnalysis.extractEmployment shape). */
export function docToLegacyEmployment(d) {
  const out = [];
  for (const e of d.experience) {
    if (!e.company && !e.title) continue;
    out.push({
      company: e.company || '',
      title: e.title || '',
      start_date: e.start ? formatDate(e.start) : (e.dateText || ''),
      end_date: e.end === 'present' ? 'Present' : (e.end ? formatDate(e.end) : ''),
    });
  }
  return out.slice(0, 15);
}

/** → the shape buildResumePDF (api/resume.js) consumes: {name, contact, summary, experience, skills, education}. */
export function docToLegacyDocument(d, { role = '', company = '' } = {}) {
  const b = d.basics;
  const linkedin = (b.links.find((l) => l.kind === 'linkedin') || {}).url || '';
  return {
    name: b.name || '',
    contact: { email: b.email || '', phone: b.phone || '', location: b.location || '', linkedin },
    role, targetCompany: company,
    summary: b.summary || '',
    experience: d.experience.map((e) => ({
      title: e.title, company: e.company, location: e.location,
      dates: formatRange(e.start, e.end) || e.dateText || '',
      bullets: e.bullets.map((x) => x.text),
    })),
    skills: d.skills.flatMap((g) => g.items),
    education: d.education.map((e) => {
      const deg = [e.degree, e.field].filter(Boolean).join(', ');
      return [deg, e.school, e.location, formatRange(e.start, e.end) || e.dateText].filter(Boolean).join(' — ');
    }),
  };
}

/** Years of experience spanned by the roles (first start → latest end), or null. */
export function experienceSpanYears(d, now = new Date()) {
  // Whole years between the earliest start and the latest end, month-precise when the tokens carry
  // months (Jun 2018 → Oct 2026 = 8, not 8.3 and not 9). Year-only tokens count mid-year, so a
  // "2018 – 2020" range is 2 years, never 3.
  let min = null, max = null;
  for (const e of d.experience) {
    const s = fromToken(e.start), en = e.end === 'present' ? { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 } : fromToken(e.end);
    if (s && s !== 'present') { const v = s.y * 12 + (s.m || 6); min = min == null ? v : Math.min(min, v); }
    if (en && en !== 'present') { const v = en.y * 12 + (en.m || 6); max = max == null ? v : Math.max(max, v); }
  }
  if (min == null || max == null) return null;
  return Math.max(0, Math.floor((max - min) / 12));
}

// Random part of an id: the platform CSPRNG (Web Crypto in browsers and Node ≥ 19), otherwise a
// process-unique counter — never Math.random.
function randomSuffix() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') { const a = new Uint32Array(1); c.getRandomValues(a); return a[0].toString(36); }
  return (_seq * 7919).toString(36);
}
