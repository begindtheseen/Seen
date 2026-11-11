// Résumé parser — rich lines (or plain text) → canonical ResumeDoc.
//
// Pipeline: preprocess (noise, wrapped lines, typography stats) → section segmentation (vocabulary +
// structure) → contact block → per-section parsers (experience roles, education entries, skill
// groups, certifications, projects, languages, extras) → fallbacks for unlabeled résumés →
// confidence + warnings. Pure + deterministic (ids aside), no I/O, no AI.

import { normalizeDoc, newId, titleForKind, defaultSectionOrder, EXTRA_KINDS } from '../model.js';
import { textToLines } from '../extract/lines.js';
import { preprocessLines, mergeWrappedLines, mergeWrappedListLines } from './preprocess.js';
import { segmentSections, displayHeading, normHeader } from './sections.js';
import { extractContact } from './contact.js';
import { parseExperience, looksLikeTitle, looksLikeCompany } from './experience.js';
import { parseEducation } from './education.js';
import { parseSkills } from './skills.js';
import { parseCertifications, parseProjects, parseLanguages, parseSummary, parseExtraItems } from './misc.js';
import { findDateRange } from './dates.js';
import { DEGREE_RE, SCHOOL_RE, TITLE_WORD_RE, CERT_CUE_RE } from './lexicon.js';
import { parseFidelity } from './fidelity.js';
import { recognizeHeading } from './headings.js';
import { contentKind } from './content.js';

// The catch-all: career notes and any line the parser could not classify are printed here, in the
// person's own words and order — never dropped (Studio judge 2026-11-10: an electrician's licences,
// an admin's career-break note).
export const NOTES_TITLE = 'Additional Information';

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
  seg.sections = seg.sections.flatMap((sec) => splitTrailingRoles(sec, stats, { hasGeometry: stats.hasGeometry }));
  // Wrapped-line merging per section kind: prose sections merge, list sections never do.
  const NO_MERGE = new Set(['skills', 'languages', 'contact', 'interests', 'certifications']);
  const header = mergeWrappedLines(seg.header, stats);
  // List sections still rejoin an item that wrapped mid-phrase ("loss" / "prevention").
  const LIST_MERGE = new Set(['skills', 'interests', 'languages']);
  const sections = seg.sections.map((sec) => (NO_MERGE.has(sec.kind)
    ? (LIST_MERGE.has(sec.kind) ? { ...sec, lines: mergeWrappedListLines(sec.lines, stats) } : sec.kind === 'certifications' ? { ...sec, lines: mergeWrappedCredentials(sec.lines, stats) } : sec)
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
  // each experience section's roles, so a résumé with two experience headings keeps both
  const expGroups = [];
  // lines filed by weak evidence, so a screen can ask ("Is this a job?") instead of asserting
  const uncertain = [];
  // Section assignment checked against content (content.js): a credential-shaped line under any heading
  // is a certification, a school-shaped line is education — item by item.
  const KIND_WORD = { certification: 'a certification', education: 'education' };
  const route = (sec, allow) => {
    const keep = [], certs = [], edu = [];
    for (const l of sec.lines) {
      let k = l.bullet && sec.kind === 'education' ? null : contentKind(l.text);
      // a program certificate under Education stays there ("Web Development Certificate — General Assembly")
      if (k === 'certification' && sec.kind === 'education' && /\bcertificate\b/i.test(l.text) && !/\b(?:certified|certification|licen[cs]e|ticket|card|cpr|permit)\b/i.test(l.text)) k = null;
      if (k === 'certification' && allow.includes('certification')) certs.push(l);
      else if (k === 'education' && allow.includes('education')) edu.push(l);
      else keep.push(l);
    }
    for (const l of [...certs, ...edu]) uncertain.push({ line: l.text, placedIn: certs.includes(l) ? 'certifications' : 'education', why: `listed under "${displayHeading(sec.title)}", but it reads as ${KIND_WORD[certs.includes(l) ? 'certification' : 'education']}` });
    if (certs.length) { doc.certifications.push(...parseCertifications(certs)); pushOrder('certifications'); }
    if (edu.length) { doc.education.push(...parseEducation(edu)); pushOrder('education'); }
    return keep;
  };
  // career notes + unclassified lines, one printable section
  let notesSec = null;
  const keepNotes = (lines) => {
    const texts = lines.map((t) => String(t || '').trim()).filter(Boolean);
    if (!texts.length) return;
    if (!notesSec) { notesSec = { id: newId('z'), kind: 'custom', title: NOTES_TITLE, items: [] }; doc.extra.push(notesSec); }
    for (const text of texts) notesSec.items.push({ id: newId('b'), text });
    pushOrder(`extra:${notesSec.id}`);
  };

  // Leftover header-block lines may be an unlabeled experience block (résumé with no EXPERIENCE
  // header but with later headers) — anything with dates or title words goes to the role parser.
  if (remaining.length) {
    const hasRoles = remaining.some((l) => findDateRange(l.text)) || remaining.filter((l) => TITLE_WORD_RE.test(l.text) && l.text.split(/\s+/).length <= 8).length >= 2;
    if (hasRoles) {
      // Degree lines inside an unlabeled block are education, not roles.
      const eduLines = remaining.filter((l) => DEGREE_RE.test(l.text) && !l.bullet && l.text.split(/\s+/).length <= 12 && !TITLE_WORD_RE.test(l.text.replace(DEGREE_RE, '')) && contentKind(l.text) !== 'certification');
      // a credential line with no heading ("CDL Class A, hazmat (H) and tanker (N) endorsements", "TWIC card")
      const certLines = remaining.filter((l) => !eduLines.includes(l) && !l.bullet && !findDateRange(l.text) && l.text.split(/\s+/).length <= 14 && (CERT_CUE_RE.test(l.text) || /\b(?:card|endorsements?)\b/i.test(l.text)) && !TITLE_WORD_RE.test(l.text.replace(CERT_CUE_RE, ' ').replace(/\b(?:driver|operator)\b/gi, ' ')));
      if (certLines.length) { doc.certifications.push(...parseCertifications(certLines)); }
      const { roles, notes } = parseExperience(remaining.filter((l) => !eduLines.includes(l) && !certLines.includes(l)), { ...expOpts, requireDates: true });
      for (const r of roles) { doc.experience.push(r); roleConfidences.push(r.confidence); }
      if (roles.length) expGroups.push({ title: 'Experience', roles });
      if (roles.length) { pushOrder('experience'); warnings.push({ code: 'implicit_experience', message: 'Work history found above the first section header; add an "Experience" heading so every parser sees it.' }); }
      if (notes.length) keepNotes(notes.flatMap((n) => n.lines));
      if (eduLines.length) { doc.education.push(...parseEducation(eduLines)); pushOrder('education'); }
      if (certLines.length) pushOrder('certifications');
    } else {
      const leftoverText = remaining.map((l) => l.text).filter((t) => t.split(/\s+/).length >= 4);
      if (leftoverText.length && !basics.summary) basics.summary = leftoverText.join('\n');
    }
  }

  for (const sec of sections) {
    const kind = sec.kind;
    if (kind === 'contact') continue;
    if (!sec.lines.length) continue;
    if (kind === 'references') {
      // names the person listed are kept as written ("available upon request" is page noise)
      const items = parseExtraItems(sec.lines);
      if (items.length) { const x = { id: newId('z'), kind: 'custom', title: displayHeading(sec.title) || 'References', items }; doc.extra.push(x); pushOrder(`extra:${x.id}`); }
      continue;
    }
    if (kind === 'summary') {
      const s = parseSummary(sec.lines);
      basics.summary = basics.summary ? `${basics.summary}\n${s}` : s;
      pushOrder('summary');
    } else if (kind === 'volunteer') {
      // Volunteer work is its own section, never a job (an RN came back with 7 "roles" for 3 jobs —
      // coordinator, round 2). Kept line for line, in the person's words.
      const items = parseExtraItems(route(sec, ['certification', 'education']));
      if (items.length) { const x = { id: newId('z'), kind: 'volunteer', title: displayHeading(sec.title) || titleForKind('volunteer'), items }; doc.extra.push(x); pushOrder(`extra:${x.id}`); }
    } else if (kind === 'experience') {
      const { roles, orphans, notes, moved, nonjobs } = parseExperience(sec.lines, expOpts);
      for (const m of moved || []) uncertain.push({ line: m.line, placedIn: 'experience', why: `read as part of your job as ${m.to}, not as a job of its own` });
      for (const n of nonjobs || []) { keepNotes(n); uncertain.push({ line: n[0], placedIn: NOTES_TITLE, why: 'it names no employer and reads as an activity (a committee, a class you teach, a sentence), so it was not printed as a job' }); }
      if (kind === 'volunteer' && roles.length) {
        for (const r of roles) {
          // "Volunteer" / "Hope Street Food Pantry | 2022 - 2023": the one header piece is the
          // organisation, and the role is the volunteer work itself (harness 2026-10-25).
          if (r.title && !r.company && !looksLikeTitle(r.title)) { r.company = r.title; r.title = 'Volunteer'; }
          if (!/\bvolunteer\b/i.test(`${r.title} ${r.employmentType}`)) r.employmentType = r.employmentType ? `${r.employmentType}, Volunteer` : 'Volunteer';
        }
      }
      for (const r of roles) { doc.experience.push(r); roleConfidences.push(r.confidence); }
      if (kind === 'experience' && roles.length) expGroups.push({ title: sec.title, roles });
      if (orphans.length) warnings.push({ code: 'unparsed_lines', message: `${orphans.length} line(s) in "${sec.title}" could not be attached to a role.` });
      pushOrder('experience');
      if (notes.length) {
        keepNotes(notes.flatMap((n) => n.lines));
        warnings.push({ code: 'career_note', message: `${notes.length === 1 ? 'A note' : `${notes.length} notes`} about your timeline ("${notes[0].lines[0].slice(0, 60)}${notes[0].lines[0].length > 60 ? '…' : ''}") ${notes.length === 1 ? 'is' : 'are'} kept under "${NOTES_TITLE}", word for word.` });
      }
    } else if (kind === 'education') {
      const entries = parseEducation(route(sec, ['certification']));
      // Composite "Education & Certifications": pull cert-looking entries out.
      doc.education.push(...entries);
      pushOrder('education');
    } else if (kind === 'skills') {
      const groups = parseSkills(sec.lines);
      // "SKILLS & CERTIFICATIONS": a certification listed among the skills is a certification (round 3: Ray's
      // OSHA forklift certification vanished from the Studio document and every export)
      const CERT_ITEM_RE = /\b(?:certif\w*|licen[cs]e[ds]?|licensure|osha(?:\s*\d+)?|cpr|bls|acls|pals|servsafe|first aid|cdl|forklift (?:certif|licen)|notary|epa\s*608|nate|cna|emt|rn licen)\b/i;
      const certs = [];
      for (const g of groups) {
        const keep = [];
        for (const it of g.items) (CERT_ITEM_RE.test(it) && !/^(?:certifications?|licen[cs]es?)$/i.test(it.trim()) ? certs : keep).push(it);
        g.items = keep;
      }
      doc.skills.push(...groups.filter((g) => g.items.length));
      if (certs.length) { doc.certifications.push(...parseCertifications(certs.map((text) => ({ text })))); pushOrder('certifications'); }
      if (groups.some((g) => g.items.length)) pushOrder('skills');
    } else if (kind === 'certifications') {
      const own = route(sec, ['education']);
      if (own.length) { doc.certifications.push(...parseCertifications(own)); pushOrder('certifications'); }
    } else if (kind === 'projects') {
      doc.projects.push(...parseProjects(sec.lines, expOpts));
      pushOrder('projects');
    } else if (kind === 'languages') {
      doc.languages.push(...parseLanguages(sec.lines));
      pushOrder('languages');
    } else {
      const xk = EXTRA_KINDS.includes(kind) ? kind : 'custom';
      if (sec.candidate) uncertain.push({ line: sec.title, placedIn: 'heading', why: `"${sec.title}" is not a standard heading; it was read as a section title` });
      const items = parseExtraItems(route(sec, ['certification', 'education']));
      if (items.length) {
        // Vocabulary headers get their canonical title ("AWARDS" → "Awards"); custom headers keep
        // the author's wording (already title-cased by the section detector).
        // a free-form heading keeps the author's words ("ADDITIONAL INFORMATION" → "Additional Information")
        const x = { id: newId('z'), kind: xk, title: sec.custom ? sec.title : xk === 'custom' ? displayHeading(sec.title) || titleForKind(xk) : titleForKind(xk), items };
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

  // Two or more experience headings with different names ("Relevant Automotive and EV Experience",
  // "Additional Professional Experience"): every role remembers its heading so each renderer prints
  // both. A repeated "Experience (continued)" is one heading, not two.
  const distinct = new Set(expGroups.map((g) => normHeader(displayHeading(g.title))));
  if (distinct.size >= 2) {
    let prevKey = null, prevTitle = '';
    for (const g of expGroups) {
      const key = normHeader(displayHeading(g.title));
      const title = key === prevKey ? prevTitle : displayHeading(g.title);
      for (const r of g.roles) r.group = title;
      prevKey = key; prevTitle = title;
    }
  }

  // An undated, body-less "role" after dated roles is never silently a job: filed by content, else kept
  // under Additional Information and named (coordinator round 2, 2026-11-10).
  if (doc.experience.some((r) => r.start || r.dateText)) {
    for (const r of [...doc.experience]) {
      if (r.start || r.end || r.dateText || r.bullets.length || r.summary) continue;
      const text = r.sourceText || [r.title, r.company].filter(Boolean).join(' — ');
      const k = contentKind(text);
      if (!k && (looksLikeTitle(r.title) || looksLikeCompany(r.company))) {
        // a real job shape with no dates ("Campaign Manager – Victoriam Management"): kept as a job, but asked
        uncertain.push({ line: text, placedIn: 'experience', why: 'it has no dates and nothing under it — is this a job?' });
        continue;
      }
      doc.experience.splice(doc.experience.indexOf(r), 1);
      if (k === 'certification') { doc.certifications.push(...parseCertifications([{ text }])); pushOrder('certifications'); }
      else if (k === 'education') { doc.education.push(...parseEducation([{ text }])); pushOrder('education'); }
      else keepNotes([text]);
      uncertain.push({ line: text, placedIn: k === 'certification' ? 'certifications' : k === 'education' ? 'education' : NOTES_TITLE, why: 'it sat among your jobs with no dates and nothing under it, so it was not printed as a job' });
    }
  }
  for (const r of doc.experience) delete r.sourceText;

  // Field hygiene: no field begins or ends with a separator, and an unbalanced bracket in any field is a
  // parse error the person is told about ("Lantern Digital (agency" — coordinator, round 2).
  const tidy = (v) => String(v || '').replace(/^[\s|—–·•,;:]+|[\s|—–·•,;:]+$/g, '').trim();
  const unbalanced = (v) => { let d = 0; for (const ch of String(v || '')) { if (ch === '(' || ch === '[') d++; else if (ch === ')' || ch === ']') { d--; if (d < 0) return true; } } return d !== 0; };
  const fields = [];
  for (const r of doc.experience) for (const k of ['title', 'company', 'companyNote', 'location', 'employmentType']) fields.push([r, k, 'experience']);
  for (const e of doc.education) for (const k of ['school', 'degree', 'field', 'location']) fields.push([e, k, 'education']);
  for (const c of doc.certifications) for (const k of ['name', 'issuer']) fields.push([c, k, 'certifications']);
  for (const [o, k, where] of fields) {
    if (!o[k]) continue;
    o[k] = tidy(o[k]);
    if (unbalanced(o[k])) uncertain.push({ line: o[k], placedIn: where, why: 'a bracket in it is not closed — part of this line may have landed in the wrong field' });
  }
  for (const c of doc.certifications) if (!c.date && /^(?:19|20)\d{2}$/.test(c.issuer)) { c.date = c.issuer; c.issuer = ''; }
  // an item with no employer and nothing that reads as one is always asked
  for (const r of doc.experience) {
    if (!r.company && !uncertain.some((u) => u.line.includes(r.title))) uncertain.push({ line: r.title || '(untitled role)', placedIn: 'experience', why: 'no employer was found for this job — check it' });
  }
  // a role whose title is one of the person's listed skills, or whose employer reads as a sentence, is asked
  const skillSet = new Set(doc.skills.flatMap((g) => g.items.map((i) => i.toLowerCase().trim())));
  for (const r of doc.experience) {
    if (r.title && skillSet.has(r.title.toLowerCase())) uncertain.push({ line: [r.title, r.company].filter(Boolean).join(' — '), placedIn: 'experience', why: `"${r.title}" is also in your skills list — is this really a job title?` });
    if (r.company && (r.company.split(/\s+/).length > 8 || (/[.!?]$/.test(r.company) && r.company.split(/\s+/).length >= 4 && !/\b(?:co|inc|ltd|corp|llc|l\.l\.c|bros|st|jr|sr|no)\.$/i.test(r.company)))) uncertain.push({ line: [r.title, r.company].filter(Boolean).join(' — '), placedIn: 'experience', why: 'the employer reads like a sentence — part of a bullet may have been read as the employer' });
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
  const finish = () => {
    const n = normalizeDoc(doc);
    // normalizeDoc rebuilds sectionOrder only when empty — keep ours, but drop keys for empty sections.
    const kept = order.filter((k) => k === 'summary' ? !!n.basics.summary : k.startsWith('extra:') ? n.extra.some((x) => `extra:${x.id}` === k) : n[k] && n[k].length);
    n.sectionOrder = useDefault ? defaultSectionOrder(n) : kept;
    return n;
  };
  let normalized = finish();

  // Source-line accounting (fidelity.js): every line the person wrote is placed somewhere. A line the
  // parser could not classify is kept, word for word and in order, under "Additional Information",
  // and named in the warnings — nothing is dropped silently.
  const fid = parseFidelity(fullText, normalized);
  if (fid.unplaced.length) {
    keepNotes(fid.unplaced.map((u) => u.line));
    normalized = finish();
    warnings.push({ code: 'unplaced_lines', message: `${fid.unplaced.length} line${fid.unplaced.length === 1 ? '' : 's'} we could not place ${fid.unplaced.length === 1 ? 'is' : 'are'} kept under "${NOTES_TITLE}" — check ${fid.unplaced.length === 1 ? 'it' : 'them'}: ${fid.unplaced.slice(0, 3).map((u) => `"${u.line.slice(0, 50)}${u.line.length > 50 ? '…' : ''}"`).join(', ')}${fid.unplaced.length > 3 ? '…' : ''}` });
    normalized.meta.warnings = normalizeDoc({ meta: { warnings } }).meta.warnings;
  }
  // Two section headings side by side on one line ("SKILLS          EXPERIENCE") mean two columns were
  // read across: every line may be in the wrong section. Said plainly, never silent.
  const sideBySide = rawLines.some((l) => l.segments && l.segments.length >= 2 && l.segments.filter((c) => recognizeHeading(c, { structural: true })).length >= 2);
  if (sideBySide && !(input.layout && input.layout.columns > 1)) {
    warnings.push({ code: 'columns_read_across', message: 'This résumé looks like two columns side by side, and the text came out mixed between them. Check that every job, date and skill sits where you put it — a single-column file reads reliably.' });
    normalized.meta.warnings = normalizeDoc({ meta: { warnings } }).meta.warnings;
  }
  normalized.meta.fidelity = {
    version: fid.version, placed: fid.placed, total: fid.total,
    unplaced: fid.unplaced.map((u) => ({ line: u.line, index: u.index, nearestSection: u.nearestSection, keptIn: NOTES_TITLE })),
    altered: fid.altered.map((u) => ({ line: u.line, index: u.index, nearestSection: u.nearestSection, missing: u.missing })),
    uncertain,
  };
  if (uncertain.some((u) => u.placedIn !== 'heading' && u.placedIn !== 'experience')) {
    const moved = uncertain.filter((u) => u.placedIn !== 'heading' && u.placedIn !== 'experience');
    warnings.push({ code: 'filed_by_content', message: `${moved.length === 1 ? 'One line was' : `${moved.length} lines were`} filed by what ${moved.length === 1 ? 'it says' : 'they say'}, not by the heading above ${moved.length === 1 ? 'it' : 'them'} — check: ${moved.slice(0, 3).map((u) => `"${u.line.slice(0, 50)}" → ${u.placedIn}`).join('; ')}${moved.length > 3 ? '…' : ''}` });
    normalized.meta.warnings = normalizeDoc({ meta: { warnings } }).meta.warnings;
  }
  return normalized;
}

// A credential that wraps in a narrow column ("Certified Clinical Medical Assistant" / "(CCMA) — NHA, active
// through" / "2027") is one line, not three certifications (sidebar PDF, coordinator round 4). A line
// continues the one above only when the one above is visibly unfinished (an open bracket, a trailing dash,
// comma or joiner word) or the next starts in lower case, with a bracket, or is only a date.
function mergeWrappedCredentials(lines, stats) {
  const out = [];
  // in a laid-out file a wrapped line sits closer to the line above than the next item does
  const gaps = lines.slice(1).map((l) => l.gapAbove || 0).filter((g) => g > 0).sort((a, b) => a - b);
  const itemGap = gaps.length ? gaps[gaps.length - 1] : 0;
  const open = (t) => (t.match(/\(/g) || []).length > (t.match(/\)/g) || []).length;
  for (const l of lines) {
    const prev = out[out.length - 1];
    const t = l.text.trim();
    const geoOk = !stats.hasGeometry || !prev || (l.gapAbove <= 1.5 && Math.abs((l.size || 0) - (prev.size || 0)) <= 0.75);
    // pasted text never wraps on its own: only an open bracket joins lines there
    const unfinished = open(prev ? prev.text : '') || (stats.hasGeometry && prev && (/[,(—–]\s*$|\b(?:through|until|thru|exp\.?|expires?|by|of|and|for)\s*$/i.test(prev.text.trim())));
    const tight = stats.hasGeometry && itemGap - (l.gapAbove || 0) >= 0.15 && (l.gapAbove || 0) > 0;
    const tail = stats.hasGeometry && (tight || /^[a-z(]/.test(t) || /^(?:(?:19|20)\d{2}|\d{1,2}\/(?:19|20)\d{2}|active|expired)\b[).]?$/i.test(t));
    if (prev && !l.bullet && !prev.bullet && geoOk && (unfinished || tail)) {
      prev.text = `${prev.text.trim()} ${t}`.replace(/\s+/g, ' ');
      continue;
    }
    out.push({ ...l });
  }
  return out;
}

// A list section (skills, languages, interests) never swallows a work history. When an
// experience heading was not recognised, the role header lines (a date range) and the bullets
// under them used to be split on commas into "skills". The first role header and everything after
// it becomes an experience section — kept only when it really reads as roles.
const LIST_KINDS = new Set(['skills', 'languages', 'interests']);
const GROUP_LINE_RE = /^[A-Za-z&/+ ,'-]{2,40}?\s*[:：]\s/;
function splitTrailingRoles(sec, stats, expOpts) {
  if (!LIST_KINDS.has(sec.kind) || sec.lines.length < 2) return [sec];
  const lines = sec.lines;
  const i = lines.findIndex((l) => !l.bullet && !GROUP_LINE_RE.test(l.text) && l.text.split(/\s+/).length <= 24 && findDateRange(l.text));
  if (i < 0) return [sec];
  const caps = (t) => { const L = t.replace(/[^A-Za-z]/g, ''); return L.length >= 3 && L === L.toUpperCase(); };
  const short = (l) => l && !l.bullet && !/[,;]/.test(l.text) && !findDateRange(l.text) && l.text.split(/\s+/).length <= 8;
  let start = i, title = '';
  // a job-title line right above a date line belongs to that role ("Line Cook" / "Diner | 2019 – 2021")
  if (short(lines[start - 1]) && !caps(lines[start - 1].text) && TITLE_WORD_RE.test(lines[start - 1].text)) start--;
  // an unrecognised ALL-CAPS heading right above the role is that experience section's name
  if (short(lines[start - 1]) && caps(lines[start - 1].text)) { start--; title = lines[start].text.trim(); }
  const tail = lines.slice(title ? start + 1 : start);
  const { roles } = parseExperience(mergeWrappedLines(tail, stats), { ...expOpts, requireDates: true });
  const real = roles.filter((r) => (r.title || r.company) && (r.start || r.dateText));
  if (!real.length || (real.length === 1 && !real[0].bullets.length && tail.length < 2)) return [sec];
  const head = { ...sec, lines: lines.slice(0, start) };
  const exp = { kind: 'experience', title: title || 'Experience', lines: tail, column: sec.column, custom: false, headerLine: title ? lines[start] : null, split: true };
  return head.lines.length ? [head, exp] : [exp];
}

export { preprocessLines, mergeWrappedLines, segmentSections, parseExperience, parseEducation, parseSkills };
