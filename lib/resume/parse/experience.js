// Experience parsing: lines of an EXPERIENCE-kind section → roles with title / company /
// location / dates / employment type / bullets / summary.
//
// Design (the lessons of the 2026-08-13 production mangle are baked in):
//   • One section-aware pass OWNS entries and their bullets together — bullets are never
//     re-located by fuzzy company-name matching afterwards.
//   • Inside an explicit experience section a date range is NOT required to start a role
//     (self-directed work, a tail list of older jobs). Outside one it is (the name + headline at
//     the top of a résumé is shaped exactly like a job header).
//   • A bullet is recognised by glyph, by indent (PDF), by action-verb opener, or by length — so a
//     bullet that lost its glyph in extraction is never promoted to the next job's header.
//   • Roles packed onto one pipe-separated line ("A – B | C – D") split BEFORE the prose check.
//   • Where neither side of "X – Y" names a recognisable role, the DOCUMENT's own dominant
//     orientation decides (résumé layouts are internally consistent), defaulting to title-first,
//     which is also what serializeToText emits — so the canonical text round-trips.
//   • A header line that would overwrite an already-set title or company starts a NEW role;
//     bare dates / locations / employment types attach to the role being built.

import { findDateRange, stripDateRange, parseDateToken, toToken } from './dates.js';
const DATE_API = { parseDateToken, toToken };
import { TITLE_WORD_RE, COMPANY_SUFFIX_RE, LOCATION_RE, LOCATION_INLINE_RE, EMPLOYMENT_TYPE_RE, BULLET_OPENER_RE, HEADER_VOCAB, PAGE_NOISE_RE, URL_RE } from './lexicon.js';
import { newId } from '../model.js';
import { tailKind, endsOpen, joinWrapped } from './wrap.js';

const MAX_HEADER_LINES = 4;
const SEP_RE = /\s+(?:—|–|\||•|·|@)\s+|\s+-\s+|\s+at\s+(?=[A-Z])/; // " — ", " – ", " | ", " at Company"
const TERMINAL_RE = /[.!?]["')\]]?$/;
const PAREN_TYPE_RE = /\s*[(\[](?:[^()\[\]]*?\b(?:full[-\s]?time|part[-\s]?time|contract(?:or)?|temporary|temp|seasonal|intern(?:ship)?|freelance|per[-\s]?diem|prn|remote|hybrid|on-?site|self[-\s]?employed|volunteer|co-?op)\b[^()\[\]]*?)[)\]]/i;

const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

const TRAILING_ROLE_RE = /\b(senior|associate|junior|trainee|apprentice|intern|partner|principal|fellow|executive|officer|specialist|lead|assistant|coordinator|analyst)$/i;
export function looksLikeTitle(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const w = wordCount(t);
  if (w > 12) return false;
  // UK/professional-services style "Audit Senior", "Tax Associate", "Deals Partner": the role noun
  // comes last and the first word is a function, not a title word.
  if (!TITLE_WORD_RE.test(t)) return w >= 2 && w <= 4 && /^[A-Z]/.test(t) && TRAILING_ROLE_RE.test(t) && !COMPANY_SUFFIX_RE.test(t);
  if (w <= 8) return true;
  return /\b(and|&)\b|\//.test(t); // "Senior Architect and Technical Lead", "Host / Server"
}

export function looksLikeCompany(text) {
  const t = String(text || '').trim();
  if (!t || wordCount(t) > 8) return false;
  if (/[@]|https?:/.test(t)) return false;
  if (COMPANY_SUFFIX_RE.test(t)) return true;
  if (/^[A-Z][A-Z&.\-]{1,8}$/.test(t)) return true; // IBM, AT&T, KPMG
  return false;
}

function isLocationPiece(t) { return LOCATION_RE.test(String(t || '').trim()); }
function isTypePiece(t) {
  const s = String(t || '').trim().replace(/[()]/g, '');
  if (!s) return false;
  // "Contract via Kelly Services", "Temp through Robert Half": an employment type naming the agency
  // (Maria's "Cox Communications" came back as "?" with "Contract via Kelly Services" as the title).
  if (/^(?:contract(?:or)?|temp(?:orary)?|seasonal|freelance|agency|consultant)\b[^,]{0,8}\b(?:via|through|thru|with|from)\s+[A-Z]/i.test(s) && wordCount(s) <= 7) return true;
  if (looksLikeTitle(s.replace(EMPLOYMENT_TYPE_RE, '').trim()) && wordCount(s) <= 4) return false; // "UX Intern" is a title
  return s.split(/\s*[,/&]\s*|\s+and\s+/i).every((p) => EMPLOYMENT_TYPE_RE.test(p) && p.replace(EMPLOYMENT_TYPE_RE, '').replace(/[\s-]/g, '').length === 0);
}

// "Shift Supervisor, Starbucks, Miami, FL" → ["Shift Supervisor", "Starbucks"] when (and only when)
// the comma pieces contain a recognisable title and something that can be an employer. A comma
// inside a title ("Registered Nurse, Telemetry") stays put because "Telemetry" is not a company.
//
// fullHeader: the line ALSO carries its own location ("Software Engineer II, Fieldline — Austin, TX
// Mar 2021 – Present"), so the piece after the title's comma is the employer, not a specialty —
// a "Title, Specialty — City" line with no employer does not happen. The harness found every role
// of three such résumés with the employer left inside the title (2026-10-25).
function splitCommaHeader(piece, { fullHeader = false } = {}) {
  const parts = piece.split(/\s*,\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [piece];
  const kinds = parts.map(classifyPiece);
  const ti = kinds.indexOf('title');
  if (ti === -1) return [piece];
  const maxWords = fullHeader ? 10 : 4;
  const other = parts.findIndex((p, i) => i !== ti && (kinds[i] === 'company' || (kinds[i] === 'unknown' && /^[A-Z0-9]/.test(p) && wordCount(p) <= maxWords && !isLocationPiece(p))));
  if (other === -1) return [piece];
  // Keep a specialty that FOLLOWS the title ("Registered Nurse, Telemetry") attached unless the
  // other piece is a hard company (suffix / known shape) or the line names its own location.
  if (!fullHeader && kinds[other] !== 'company' && other === ti + 1 && !looksLikeCompany(parts[other]) && parts.length === 2) return [piece];
  return [parts[ti], parts[other]];
}

/** Break a header line into {dates, location, employmentType, pieces[]}. */
export function parseHeaderLine(text, segments) {
  const out = { dates: null, location: '', employmentType: '', url: '', pieces: [] };
  const parts = segments && segments.length > 1 ? segments : [String(text || '')];
  const rest = [];
  for (let part of parts) {
    part = String(part || '').trim();
    if (!part) continue;
    const dr = findDateRange(part);
    if (dr) { out.dates = out.dates || dr; part = stripDateRange(part); }
    // "(Full Time)" / "(Contract)" / "(Remote)"
    let pm;
    while ((pm = part.match(PAREN_TYPE_RE))) {
      const inner = pm[0].replace(/^[\s(\[]+|[)\]]+$/g, '');
      if (/remote|hybrid|on-?site/i.test(inner) && !out.location) out.location = cap(inner);
      else out.employmentType = out.employmentType ? `${out.employmentType}, ${cap(inner)}` : cap(inner);
      part = (part.slice(0, pm.index) + ' ' + part.slice(pm.index + pm[0].length)).replace(/\s+/g, ' ').trim();
    }
    if (part) rest.push(part);
  }
  // A parenthetical date ("(Summer 2017)", "(2019 – 2021)") is a date, not part of the title.
  for (let i = 0; i < rest.length; i++) {
    const pm = rest[i].match(/\s*\(([^()]{4,40})\)\s*$/);
    if (pm && !out.dates) {
      const dr = findDateRange(pm[1]);
      if (dr) { out.dates = dr; rest[i] = rest[i].slice(0, pm.index).trim(); }
      else {
        const { parseDateToken, toToken } = DATE_API;
        const single = parseDateToken(pm[1]);
        if (single && single !== 'present') { out.dates = { start: toToken(single), end: '', raw: pm[1] }; rest[i] = rest[i].slice(0, pm.index).trim(); }
      }
    }
  }
  // Split the remaining text on strong separators; classify location / type pieces out.
  for (const r of rest) {
    const pieces = r.replace(/[\s,;:|•·—–-]+$/, '').replace(/^[\s,;:|•·—–-]+/, '').split(SEP_RE)
      .map((p) => p.trim().replace(/^[,;:—–-]+|[,;:—–-]+$/g, '').trim()).filter(Boolean);
    // one title-ish piece next to a location: "Title, Employer — City, ST" (see splitCommaHeader)
    const core = pieces.filter((p) => !isLocationPiece(p) && !isTypePiece(p));
    const expanded = pieces.length === 1 ? splitCommaHeader(pieces[0])
      : core.length === 1 && /,\s/.test(core[0]) && pieces.some((p) => isLocationPiece(p))
        ? pieces.flatMap((p) => (p === core[0] ? splitCommaHeader(p, { fullHeader: true }) : [p]))
        : pieces;
    for (let p of expanded) {
      if (!p) continue;
      // A URL piece (project links, portfolio) is kept aside, never a title or employer.
      if (/^(?:https?:\/\/|www\.)/i.test(p) || (URL_RE.test(p) && p.replace(URL_RE, '').trim() === '' && /[./]/.test(p))) { if (!out.url) out.url = p.replace(/[),.]+$/, ''); continue; }
      if (isLocationPiece(p)) { if (!out.location) out.location = p.replace(/\.$/, ''); continue; }
      if (!out.dates) {
        const single = parseDateToken(p.replace(/^[(\[]|[)\]]$/g, ''));
        if (single && single !== 'present') { out.dates = { start: toToken(single), end: '', raw: p }; continue; }
      }
      if (isTypePiece(p)) { out.employmentType = out.employmentType ? `${out.employmentType}, ${cap(p)}` : cap(p); continue; }
      // "KPMG LLP, Manchester" / "Grant Thornton, Leeds" — one or two capitalized words after a
      // comma on a non-title piece are its city.
      const cityTail = p.match(/^(.+?),\s+([A-Z][a-z.'’-]+(?:\s+[A-Z][a-z.'’-]+)?)$/);
      if (cityTail && !looksLikeTitle(p) && !looksLikeTitle(cityTail[2]) && !looksLikeCompany(cityTail[2]) && !/\d/.test(cityTail[2])) { if (!out.location) out.location = cityTail[2]; p = cityTail[1]; }
      // A trailing inline location inside a piece: "Banner Health, Phoenix, AZ" / "Acme — Phoenix, AZ".
      const lm = p.match(LOCATION_INLINE_RE);
      if (lm && lm.index > 0 && p.slice(0, lm.index).trim().length >= 2 && lm.index + lm[0].length >= p.length - 1) {
        if (!out.location) out.location = lm[0].trim();
        p = p.slice(0, lm.index).replace(/[\s,;:|–—-]+$/, '').trim();
        if (!p) continue;
      }
      out.pieces.push(p);
    }
  }
  // A line that is ONLY a role word that doubles as an employment type ("Volunteer", "Intern") is
  // the title — "Volunteer" / "Hope Street Food Pantry | 2022 - 2023" lost its title (harness).
  if (!out.pieces.length && !out.dates && /^(?:volunteer|intern|freelancer?|consultant|contractor|apprentice|fellow)$/i.test(String(text || '').trim())) {
    out.pieces.push(String(text).trim()); out.employmentType = '';
  }
  return out;
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function classifyPiece(p) {
  const title = looksLikeTitle(p);
  const company = looksLikeCompany(p);
  if (title && !company) return 'title';
  if (company && !title) return 'company';
  if (title && company) {
    // "Sales Associate" (title) vs "Fabrication Shop" (company): title words win unless a hard
    // corporate suffix (Inc/LLC/Corp/Ltd/Group/Company) is present.
    return /\b(inc\.?|llc|ltd\.?|corp\.?|corporation|incorporated|company|co\.|group|plc|gmbh)\b/i.test(p) ? 'company' : 'title';
  }
  return 'unknown';
}

// Does a single header line resolve to a title/company pair on its own? Used by the orientation vote
// and the "does this line start a new role" check.
function pairFromPieces(pieces) {
  if (pieces.length < 2) return null;
  const kinds = pieces.map(classifyPiece);
  const ti = kinds.indexOf('title'), ci = kinds.indexOf('company');
  if (ti !== -1 && ci !== -1) return { title: pieces[ti], company: pieces[ci], titleFirst: ti < ci, resolved: true };
  if (ti !== -1) { const other = pieces.find((_, i) => i !== ti); return { title: pieces[ti], company: other, titleFirst: ti === 0, resolved: true }; }
  if (ci !== -1) { const other = pieces.find((_, i) => i !== ci); return { title: other, company: pieces[ci], titleFirst: ci !== 0, resolved: true }; }
  return { title: pieces[0], company: pieces[1], titleFirst: true, resolved: false };
}

// ── Line classification inside the section ──────────────────────────────────────────────────
function isBulletLike(line, ctx) {
  const t = line.text;
  const w = wordCount(t);
  if (line.bullet) return true;
  // Header lines carry separators and dates; count only the words with letters in them.
  const alphaWords = t.split(/\s+/).filter((x) => /[A-Za-z]{2,}/.test(x) && !/^(?:present|current|now)$/i.test(x)).length;
  if (findDateRange(t) && alphaWords <= 14) return false;
  if (looksLikeTitle(t) && w <= 8 && !TERMINAL_RE.test(t) && !BULLET_OPENER_RE.test(t)) return false;
  if (ctx.hasGeometry && line.indent >= ctx.baseIndent + 7 && w >= 3 && !findDateRange(t)) return true;
  if (BULLET_OPENER_RE.test(t) && w >= 4) return true;
  if (w >= 14) return true;
  if (TERMINAL_RE.test(t) && w >= 8) return true;
  return false;
}

// Is this glyph-less line the wrapped end of the role's last bullet / description line?
function isWrappedTail(line, role) {
  const prev = role.bullets.length ? role.bullets[role.bullets.length - 1] : role.summary[role.summary.length - 1];
  if (!prev) return false;
  const kind = tailKind(line.text);
  if (!kind) return false;
  if (line.bold && !role._bodyBold) return false; // a bold line under plain bullets is a header
  if (kind === 'strong') return endsOpen(prev) || /^[a-z]/.test(line.text.trim());
  return endsOpen(prev) && wordCount(prev) >= 8; // a short capitalized fragment: only after a full, open line
}

// "Campaign Manager – Victoriam Management | Membership Specialist – UFC Gym | …"
function packedRoles(text) {
  const parts = String(text || '').split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  // "Title — Company | 2020 – Present" is ONE role whose date range happens to split on its dash.
  if (parts.some((p) => findDateRange(p))) return null;
  const pairs = parts.map((p) => p.split(/\s+[—–-]\s+/).map((s) => s.trim()).filter(Boolean));
  if (!pairs.every((pr) => pr.length === 2) || !pairs.some((pr) => pr.some((p) => looksLikeTitle(p)))) return null;
  return pairs;
}

function newRole() {
  return { id: newId('x'), headerLines: [], title: '', company: '', location: '', employmentType: '', url: '', start: '', end: '', dateText: '', bullets: [], summary: [], confidence: 0.5, _pairs: [] };
}

// Incrementally fold one header line into a role. Returns false when the line conflicts (would
// overwrite a set title/company), meaning the caller should start a new role with it instead.
function foldHeader(role, line, ctx) {
  const ph = parseHeaderLine(line.text, line.segments);
  // Compute every assignment first; apply only when nothing conflicts (a conflicting line starts
  // a new role, and the current role must stay exactly as it was).
  const set = {};
  if (ph.dates) {
    if (role.start) return false;
    set.start = ph.dates.start; set.end = ph.dates.end; set.dateText = ph.dates.raw;
  }
  if (ph.pieces.length >= 2) {
    if (role.title || role.company) return false;
    const pair = pairFromPieces(ph.pieces);
    set._pair = { ...pair, line };
    set.title = pair.title; set.company = pair.company; set._resolved = pair.resolved;
    set.confidence = pair.resolved ? 0.9 : 0.6;
    for (const extra of ph.pieces.slice(2)) if (!role.location && !ph.location && isLocationPiece(extra)) set.location = extra;
  } else if (ph.pieces.length === 1) {
    const p = ph.pieces[0];
    let kind = classifyPiece(p);
    // A parked unknown header line already occupies whichever of title/company the role still has
    // open ("Victoriam Management" parked, then "Campaign Manager" set as title → the next bare
    // employer line belongs to a NEW role, not this one).
    const parked = (role._unknown || []).length;
    const slotsUsed = (role.title ? 1 : 0) + (role.company ? 1 : 0) + parked;
    // Context: a piece that reads as BOTH ("Amazon Fulfillment", "Fabrication Shop") takes the
    // slot the role still has open.
    if (kind === 'title' && role.title && !role.company && looksLikeCompany(p)) kind = 'company';
    if (kind === 'company' && role.company && !role.title && looksLikeTitle(p)) kind = 'title';
    // An employer line read as a title ("Gulf Coast Marine Services" — "Services" reads like a
    // title word) followed by the real title line with the dates: the first line is the employer.
    // It became a fourth, empty role with the title line's employer missing (harness 2026-10-25).
    if (kind === 'title' && role.title && !role.company && !role.start && !role.sawBody && ph.dates && looksLikeCompany(role.title) && !looksLikeCompany(p)) {
      set.company = role.title; set._companyLine = role._titleLine;
    }
    if (kind === 'title') {
      if ((role.title && !set.company) || (role.company && parked)) return false;
      set.title = p; set._titleLine = line; set.confidence = Math.max(role.confidence, 0.85);
    } else if (kind === 'company') {
      if (role.company || (role.title && parked)) return false;
      set.company = p; set._companyLine = line; set.confidence = Math.max(role.confidence, 0.85);
    } else {
      if (slotsUsed >= 2) return false;
      set._unknownPush = { text: p, line };
    }
  }
  // Apply.
  if (set._pair) { role._pairs.push(set._pair); role._resolved = set._resolved; }
  if (set._unknownPush) { role._unknown = role._unknown || []; role._unknown.push(set._unknownPush); }
  for (const k of ['start', 'end', 'dateText', 'title', 'company', 'location', 'confidence', '_titleLine', '_companyLine']) if (set[k] !== undefined) role[k] = set[k];
  if (ph.location && !role.location) role.location = ph.location;
  if (ph.url && !role.url) role.url = ph.url;
  if (ph.employmentType) role.employmentType = role.employmentType ? `${role.employmentType}, ${ph.employmentType}` : ph.employmentType;
  return true;
}

/** Resolve parked unknown pieces using the document's orientation + typography votes. */
function finalizeRole(role, votes) {
  for (const u of role._unknown || []) {
    const bold = !!u.line.bold, italic = !!u.line.italic;
    if (!role.title && !role.company) {
      // First unknown line of a stacked header: typography vote, else orientation vote.
      let asTitle;
      if (bold && votes.boldIsTitle != null) asTitle = votes.boldIsTitle;
      else if (italic && votes.italicIsTitle != null) asTitle = votes.italicIsTitle;
      else asTitle = votes.stackedTitleFirst;
      if (asTitle) role.title = u.text; else role.company = u.text;
      role.confidence = Math.min(role.confidence, 0.6);
    } else if (!role.title) { role.title = u.text; role.confidence = Math.min(role.confidence, 0.65); }
    else if (!role.company) { role.company = u.text; role.confidence = Math.min(role.confidence, 0.65); }
  }
  // Unresolved "X – Y" pairs follow the document's dash orientation.
  for (const pair of role._pairs) {
    if (pair.resolved) continue;
    const titleFirst = votes.dashTitleFirst;
    role.title = titleFirst ? pair.title : pair.company;
    role.company = titleFirst ? pair.company : pair.title;
  }
  // A single unknown piece with nothing else: company if it looks like a proper noun, else title.
  if (!role.title && role.company && looksLikeTitle(role.company)) { role.title = role.company; role.company = ''; }
  if (role.title && TERMINAL_RE.test(role.title) && wordCount(role.title) >= 8) { role.summary.unshift(role.title); role.title = ''; }
  if (role.company && (TERMINAL_RE.test(role.company) && wordCount(role.company) >= 8 || HEADER_VOCAB.has(role.company.toLowerCase()))) { role.summary.unshift(role.company); role.company = ''; }
  role.title = role.title.slice(0, 120); role.company = role.company.slice(0, 120);
  const out = {
    id: role.id, title: role.title, company: role.company, location: role.location, employmentType: role.employmentType, url: role.url || '',
    start: role.start, end: role.end, dateText: role.start ? '' : role.dateText,
    summary: role.summary.join('\n'),
    bullets: role.bullets.map((t) => ({ id: newId('b'), text: t })),
    confidence: Number(role.confidence.toFixed(2)),
  };
  return out;
}

// Document-level votes from the roles that resolved unambiguously.
function computeVotes(roles) {
  let dashTitleFirst = 0, dashTotal = 0;
  let boldTitle = 0, boldTotal = 0, italicTitle = 0, italicTotal = 0, stackedTitleFirst = 0, stackedTotal = 0;
  for (const r of roles) {
    for (const p of r._pairs) if (p.resolved) { dashTotal++; if (p.titleFirst) dashTitleFirst++; }
    // A role with one classified line and one parked unknown line votes too: the unknown line is
    // the other slot ("Barista" is a title, so the bold "Starbucks" line above it is the employer).
    // Without these votes a stacked header whose two lines were both unknown ("Student Activities
    // Office, NEIU" / "Campus Ambassador") fell back to title-first and swapped them (Tasha's own
    // Classic PDF failed Seen's parser check, 2026-10-25).
    const unk = (r._unknown || []).length === 1 ? r._unknown[0].line : null;
    const tLine = r._titleLine || (r._companyLine && unk) || null;
    const cLine = r._companyLine || (r._titleLine && unk) || null;
    if (tLine && cLine && tLine !== cLine) {
      stackedTotal++;
      if (r.headerLines.indexOf(tLine) < r.headerLines.indexOf(cLine)) stackedTitleFirst++;
      if (!!tLine.bold !== !!cLine.bold) { boldTotal++; if (tLine.bold) boldTitle++; }
      if (!!tLine.italic !== !!cLine.italic) { italicTotal++; if (tLine.italic) italicTitle++; }
    }
  }
  return {
    dashTitleFirst: dashTotal ? dashTitleFirst * 2 >= dashTotal : true,
    stackedTitleFirst: stackedTotal ? stackedTitleFirst * 2 >= stackedTotal : true,
    boldIsTitle: boldTotal ? boldTitle * 2 >= boldTotal : null,
    italicIsTitle: italicTotal ? italicTitle * 2 >= italicTotal : null,
  };
}

/**
 * Parse an experience-kind section.
 * @param {object[]} lines rich lines of the section
 * @param {{ hasGeometry: boolean, requireDates?: boolean }} opts
 * @returns {{ roles: object[], orphans: string[] }}
 */
export function parseExperience(lines, opts = {}) {
  const hasGeometry = !!opts.hasGeometry;
  const requireDates = !!opts.requireDates;
  const headerish = lines.filter((l) => !l.bullet && wordCount(l.text) <= 12);
  const baseIndent = hasGeometry && headerish.length ? Math.min(...headerish.map((l) => l.indent || 0)) : 0;
  const ctx = { hasGeometry, baseIndent };

  const roles = [];
  const orphans = [];
  let cur = null;
  const flush = () => { if (cur && (cur.title || cur.company || cur.start || cur.bullets.length)) roles.push(cur); cur = null; };

  for (const line of lines) {
    const text = line.text.trim();
    if (!text || PAGE_NOISE_RE.test(text)) continue;

    const packed = !line.bullet && packedRoles(text);
    if (packed) {
      flush();
      for (const [a, b] of packed) {
        const r = newRole();
        r.headerLines.push(line);
        const pair = pairFromPieces([a, b]);
        r._pairs.push({ ...pair, line }); r.title = pair.title; r.company = pair.company; r.confidence = pair.resolved ? 0.85 : 0.6;
        roles.push(r);
      }
      continue;
    }

    // A wrapped tail the line merger did not join ("calendar.", "(1,800 subscribers).",
    // "reconciliation breaks 92%."): it finishes the bullet (or description) above it. A line
    // with no header evidence must never open a role — that is how a bullet's last words became
    // a job with no employer and no dates.
    if (cur && cur.sawBody && !line.bullet && isWrappedTail(line, cur)) {
      if (cur.bullets.length) cur.bullets[cur.bullets.length - 1] = joinWrapped(cur.bullets[cur.bullets.length - 1], text);
      else cur.summary[cur.summary.length - 1] = joinWrapped(cur.summary[cur.summary.length - 1], text);
      continue;
    }

    if (isBulletLike(line, ctx)) {
      if (!cur) {
        if (requireDates) { orphans.push(text); continue; }
        cur = newRole();
      }
      if (line.bullet || BULLET_OPENER_RE.test(text) || cur.bullets.length) cur.bullets.push(text);
      else cur.summary.push(text); // a dateless prose description under the header
      cur._bodyBold = cur._bodyBold === undefined ? !!line.bold : cur._bodyBold && !!line.bold;
      cur.sawBody = true;
      continue;
    }

    // Header-ish line.
    if (requireDates && !cur && !findDateRange(text)) { orphans.push(text); continue; }
    if (!cur) { cur = newRole(); cur.headerLines.push(line); if (!foldHeader(cur, line, ctx)) { /* first line always fits */ } continue; }
    const mustSplit = cur.sawBody || cur.headerLines.length >= MAX_HEADER_LINES;
    if (!mustSplit && foldHeader(cur, line, ctx)) { cur.headerLines.push(line); continue; }
    // Conflict or body already seen → new role.
    flush();
    cur = newRole();
    cur.headerLines.push(line);
    foldHeader(cur, line, ctx);
  }
  flush();

  const votes = computeVotes(roles);
  const finished = roles.map((r) => finalizeRole(r, votes)).filter((r) => r.title || r.company || r.bullets.length || r.summary);
  // Merge a role that has only bullets (no header at all) into the previous role — a glyph-less
  // header never happens, but an orphan bullet group after a page break does.
  const merged = [];
  for (const r of finished) {
    const prev = merged[merged.length - 1];
    if (prev && !r.title && !r.company && !r.start && r.bullets.length) { prev.bullets.push(...r.bullets); continue; }
    merged.push(r);
  }
  return { roles: merged, orphans };
}
