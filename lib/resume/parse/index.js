// Résumé parser — rich lines (or plain text) → canonical ResumeDoc.
//
// Pipeline: preprocess (noise, wrapped lines, typography stats) → section segmentation (vocabulary +
// structure) → contact block → per-section parsers (experience roles, education entries, skill
// groups, certifications, projects, languages, extras) → fallbacks for unlabeled résumés →
// confidence + warnings. Pure + deterministic (ids aside), no I/O, no AI.

import { normalizeDoc, newId, titleForKind, defaultSectionOrder, EXTRA_KINDS } from '../model.js';
import { textToLines } from '../extract/lines.js';
import { preprocessLines, mergeWrappedLines, mergeWrappedListLines } from './preprocess.js';
import { segmentSections } from './sections.js';
import { extractContact } from './contact.js';
import { parseExperience, looksLikeTitle } from './experience.js';
import { parseEducation } from './education.js';
import { parseSkills } from './skills.js';
import { parseCertifications, parseProjects, parseLanguages, parseSummary, parseExtraItems } from './misc.js';
import { findDateRange } from './dates.js';
import { DEGREE_RE, SCHOOL_RE, TITLE_WORD_RE } from './lexicon.js';

export const PARSER_VERSION = 'resume_parser_v2';

/**
 * @param {{ text?: string, lines?: object[], source?: string, fileName?: string, layout?: object }} input
 * @returns {object} ResumeDoc (normalized)
 */
export function parseResume(input = {}) {
  const source = input.source || (input.lines ? 'lines' : 'text');
  const rawLines = Array.isArray(input.lines) && input.lines.length ? input.lines : textToLines(input.text || '');
  const fullText = input.text || rawLines.map((l) => l.text).join('\n');
  const { lines, stats } = preprocessLines(rawLines);
  const seg = segmentSections(lines, stats);
  // Wrapped-line merging per section kind: prose sections merge, list sections never do.
  const NO_MERGE = new Set(['skills', 'languages', 'contact', 'interests', 'certifications']);
  const header = mergeWrappedLines(seg.header, stats);
  // List sections still rejoin an item that wrapped mid-phrase ("loss" / "prevention").
  const LIST_MERGE = new Set(['skills', 'interests', 'languages']);
  const sections = seg.sections.map((sec) => (NO_MERGE.has(sec.kind)
    ? (LIST_MERGE.has(sec.kind) ? { ...sec, lines: mergeWrappedListLines(sec.lines, stats) } : sec)
    : { ...sec, lines: mergeWrappedLines(sec.lines, stats) }));
  const warnings = [];

  const contactSections = sections.filter((s) => s.kind === 'contact');
  const { basics, remaining } = extractContact(header, contactSections.flatMap((s) => s.lines), fullText, stats);

  const doc = {
    basics, experience: [], education: [], skills: [], certifications: [], projects: [], languages: [], extra: [],
    sectionOrder: [],
    meta: { source, fileName: input.fileName || '', parsedAt: new Date().toISOString(), parserVersion: PARSER_VERSION, warnings, confidence: {}, layout: input.layout || null },
  };
  const order = [];
  const pushOrder = (k) => { if (!order.includes(k)) order.push(k); };
  const expOpts = { hasGeometry: stats.hasGeometry };
  const roleConfidences = [];

  // Leftover header-block lines may be an unlabeled experience block (résumé with no EXPERIENCE
  // header but with later headers) — anything with dates or title words goes to the role parser.
  if (remaining.length) {
    const hasRoles = remaining.some((l) => findDateRange(l.text)) || remaining.filter((l) => TITLE_WORD_RE.test(l.text) && l.text.split(/\s+/).length <= 8).length >= 2;
    if (hasRoles) {
      // Degree lines inside an unlabeled block are education, not roles.
      const eduLines = remaining.filter((l) => DEGREE_RE.test(l.text) && !l.bullet && l.text.split(/\s+/).length <= 12 && !TITLE_WORD_RE.test(l.text.replace(DEGREE_RE, '')));
      const { roles } = parseExperience(remaining.filter((l) => !eduLines.includes(l)), { ...expOpts, requireDates: true });
      for (const r of roles) { doc.experience.push(r); roleConfidences.push(r.confidence); }
      if (roles.length) { pushOrder('experience'); warnings.push({ code: 'implicit_experience', message: 'Work history found above the first section header; add an "Experience" heading so every parser sees it.' }); }
      if (eduLines.length) { doc.education.push(...parseEducation(eduLines)); pushOrder('education'); }
    } else {
      const leftoverText = remaining.map((l) => l.text).filter((t) => t.split(/\s+/).length >= 4);
      if (leftoverText.length && !basics.summary) basics.summary = leftoverText.join('\n');
    }
  }

  for (const sec of sections) {
    const kind = sec.kind;
    if (kind === 'contact' || kind === 'references') continue;
    if (!sec.lines.length) continue;
    if (kind === 'summary') {
      const s = parseSummary(sec.lines);
      basics.summary = basics.summary ? `${basics.summary}\n${s}` : s;
      pushOrder('summary');
    } else if (kind === 'experience' || kind === 'volunteer') {
      const { roles, orphans } = parseExperience(sec.lines, expOpts);
      if (kind === 'volunteer' && roles.length) {
        for (const r of roles) {
          r.employmentType = r.employmentType ? `${r.employmentType}, Volunteer` : 'Volunteer';
          // "Volunteer" / "Hope Street Food Pantry | 2022 - 2023": the one header piece is the
          // organisation, and the role is the volunteer work itself (harness 2026-10-25).
          if (r.title && !r.company && !looksLikeTitle(r.title)) { r.company = r.title; r.title = 'Volunteer'; }
        }
      }
      for (const r of roles) { doc.experience.push(r); roleConfidences.push(r.confidence); }
      if (orphans.length) warnings.push({ code: 'unparsed_lines', message: `${orphans.length} line(s) in "${sec.title}" could not be attached to a role.` });
      pushOrder('experience');
    } else if (kind === 'education') {
      const entries = parseEducation(sec.lines);
      // Composite "Education & Certifications": pull cert-looking entries out.
      doc.education.push(...entries);
      pushOrder('education');
    } else if (kind === 'skills') {
      doc.skills.push(...parseSkills(sec.lines));
      pushOrder('skills');
    } else if (kind === 'certifications') {
      doc.certifications.push(...parseCertifications(sec.lines));
      pushOrder('certifications');
    } else if (kind === 'projects') {
      doc.projects.push(...parseProjects(sec.lines, expOpts));
      pushOrder('projects');
    } else if (kind === 'languages') {
      doc.languages.push(...parseLanguages(sec.lines));
      pushOrder('languages');
    } else {
      const xk = EXTRA_KINDS.includes(kind) ? kind : 'custom';
      const items = parseExtraItems(sec.lines);
      if (items.length) {
        // Vocabulary headers get their canonical title ("AWARDS" → "Awards"); custom headers keep
        // the author's wording (already title-cased by the section detector).
        const x = { id: newId('z'), kind: xk, title: sec.custom ? sec.title : titleForKind(xk), items };
        doc.extra.push(x);
        pushOrder(`extra:${x.id}`);
      }
    }
  }

  // Unlabeled résumé (no sections at all): segment the whole body heuristically.
  if (!sections.length && !doc.experience.length && remaining.length) {
    const eduLines = remaining.filter((l) => DEGREE_RE.test(l.text) && (SCHOOL_RE.test(l.text) || l.text.split(/\s+/).length <= 10));
    const rest = remaining.filter((l) => !eduLines.includes(l));
    const { roles } = parseExperience(rest, { ...expOpts, requireDates: true });
    for (const r of roles) { doc.experience.push(r); roleConfidences.push(r.confidence); }
    if (eduLines.length) doc.education.push(...parseEducation(eduLines));
    if (doc.experience.length) pushOrder('experience');
    if (doc.education.length) pushOrder('education');
    warnings.push({ code: 'no_sections', message: 'No section headings were found; add headings like "Experience", "Education" and "Skills" so applicant systems can read your résumé.' });
  }

  // Education entries that are really certifications (composite sections) and vice versa.
  for (const e of [...doc.education]) {
    if (!e.degree && !e.school && e.details.length === 1 && /certif|licen/i.test(e.details[0].text)) {
      doc.education.splice(doc.education.indexOf(e), 1);
      doc.certifications.push(...parseCertifications([{ text: e.details[0].text }]));
      pushOrder('certifications');
    }
  }

  if (!order.includes('summary') && basics.summary) order.unshift('summary');
  // A multi-column / table layout's reading order is a layout accident (sidebar first); render in
  // the conventional order instead. Single-column documents keep the author's order.
  const multi = input.layout && (input.layout.columns > 1 || input.layout.tables);
  doc.sectionOrder = order;
  doc._useDefaultOrder = !!multi;

  // Confidence + warnings.
  const contactFields = ['name', 'email', 'phone', 'location'].filter((k) => basics[k]).length;
  doc.meta.confidence = {
    contact: Number((contactFields / 4).toFixed(2)),
    experience: roleConfidences.length ? Number((roleConfidences.reduce((a, b) => a + b, 0) / roleConfidences.length).toFixed(2)) : 0,
    education: doc.education.length ? Number((doc.education.filter((e) => e.school && e.degree).length / doc.education.length).toFixed(2)) : 0,
    skills: doc.skills.length ? 0.9 : 0,
  };
  if (!basics.name) warnings.push({ code: 'no_name', message: 'We could not find your name at the top of the résumé.' });
  if (!basics.email) warnings.push({ code: 'no_email', message: 'No email address found.' });
  if (!basics.phone) warnings.push({ code: 'no_phone', message: 'No phone number found.' });
  if (!doc.experience.length) warnings.push({ code: 'no_experience', message: 'No work experience entries were recognised.' });
  for (const r of doc.experience) {
    if (!r.start && !r.dateText) warnings.push({ code: 'role_no_dates', message: `"${r.title || r.company}" has no dates.`, anchor: { section: 'experience', itemId: r.id } });
    if (!r.company) warnings.push({ code: 'role_no_company', message: `"${r.title}" has no employer.`, anchor: { section: 'experience', itemId: r.id } });
    if (!r.title) warnings.push({ code: 'role_no_title', message: `"${r.company}" has no job title.`, anchor: { section: 'experience', itemId: r.id } });
  }
  if (input.layout && input.layout.columns > 1) warnings.push({ code: 'multi_column', message: 'This résumé uses a multi-column layout; some applicant tracking systems read columns out of order. A single column is safest.' });
  if (input.layout && input.layout.tables) warnings.push({ code: 'tables', message: 'This résumé uses tables; many applicant tracking systems skip table cells.' });

  const useDefault = doc._useDefaultOrder; delete doc._useDefaultOrder;
  const normalized = normalizeDoc(doc);
  // normalizeDoc rebuilds sectionOrder only when empty — keep ours, but drop keys for empty sections.
  const kept = order.filter((k) => k === 'summary' ? !!normalized.basics.summary : k.startsWith('extra:') ? normalized.extra.some((x) => `extra:${x.id}` === k) : normalized[k] && normalized[k].length);
  normalized.sectionOrder = useDefault ? defaultSectionOrder(normalized) : kept;
  return normalized;
}

export { preprocessLines, mergeWrappedLines, segmentSections, parseExperience, parseEducation, parseSkills };
