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
import { TITLE_WORD_RE, COMPANY_SUFFIX_RE, LOCATION_INLINE_RE, isLocationText, NOCOMMA_LOCATION_TAIL_RE, EMPLOYMENT_TYPE_RE, BULLET_OPENER_RE, HEADER_VOCAB, PAGE_NOISE_RE, URL_RE } from './lexicon.js';
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

function isLocationPiece(t) { return isLocationText(t); }
// A short capitalised name with no title or employer words ("Southern California", "Rialto"): the
// leftover piece of a header line that already has its title and employer is a place.
function looksLikePlace(t) {
  const s = String(t || '').trim();
  return /^[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,3}$/.test(s) && !looksLikeTitle(s) && !looksLikeCompany(s);
}
function isTypePiece(t) {
  const s = String(t || '').trim().replace(/[()]/g, '');
  if (!s) return false;
  // "Contract via Kelly Services", "Temp through Robert Half": an employment type naming the agency
  // (Maria's "Cox Communications" came back as "?" with "Contract via Kelly Services" as the title).
  if (/^(?:contract(?:or)?|temp(?:orary)?|seasonal|freelance|agency|consultant)\b[^,]{0,8}\b(?:via|through|thru|with|from)\s+[A-Z]/i.test(s) && wordCount(s) <= 7) return true;
  if (looksLikeTitle(s.replace(EMPLOYMENT_TYPE_RE, '').trim()) && wordCount(s) <= 4) return false; // "UX Intern" is a title
  // "Part time, during school" / "Seasonal, summers": a type with a short qualifier after a comma
  // (written "(part time, during school)", serialized as its own field — it read back as the employer
  // on every save and pushed the real one onto a line of its own; round trip, 2026-11-10)
  const q = s.match(/^((?:full|part)[-\s]?time|seasonal|temporary|temp|contract|freelance|per[-\s]?diem|prn|internship|volunteer|casual)\s*[,;]\s*(.+)$/i);
  if (q && wordCount(q[2]) <= 4 && !looksLikeTitle(q[2]) && /^[a-z]/.test(q[2])) return true;
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
// Split outside parentheses only: "Lantern Digital (agency, 12 people)" is one piece — a split inside
// the bracket printed "Lantern Digital (agency" and leaked "12 people)" into the title (coordinator, round 2).
function splitOutside(text, re) {
  const masked = String(text || '').replace(/\([^()]*\)|\[[^\[\]]*\]/g, (m) => m.replace(/[^()\[\]]/g, (c) => String.fromCharCode(0xE000 + c.charCodeAt(0) % 0x1000)));
  const out = [];
  let last = 0;
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = g.exec(masked))) { if (!m[0]) { g.lastIndex++; continue; } out.push(String(text).slice(last, m.index)); last = m.index + m[0].length; }
  out.push(String(text).slice(last));
  return out;
}

// a site of an employer ("Midtown location", "Store #114", "Downtown", "Unit 4B", "Plant 2", "North Campus")
const SITE_RE = /\b(?:location|site|store|branch|plant|unit|campus|office|center|centre|warehouse|hub|depot|downtown|uptown|midtown|north|south|east|west|#\s?\d+)\b/i;

// a specialty after a title's comma ("Registered Nurse, Telemetry", "Account Executive, Mid-Market")
const SPECIALTY_RE = /^(?:telemetry|med-?surg|medical-?surgical|icu|micu|sicu|cvicu|nicu|picu|pacu|er|ed|emergency|or|operating room|l&d|labor (?:and|&) delivery|oncology|pediatrics|cardiology|cardiac|orthopedics|neuro(?:logy)?|psych(?:iatric)?|rehab(?:ilitation)?|home health|hospice|step-?down|float pool|nights?|days?|weekends?|evenings?|overnight|mid-?market|enterprise|smb|commercial|residential|industrial|inside sales|outside sales|front office|back office|front end|back of house|front of house|retail|wholesale|east|west|north|south|central|americas|emea|apac)$/i;

// …or a phrase ending in a unit word ("Cardiovascular ICU", "Medical ICU", "Surgical Step-Down Unit")
const SPECIALTY_TAIL_RE = /\b(?:icu|unit|floor|department|dept\.?|ward|telemetry|med-?surg|step-?down|nicu|picu|pacu|ed|er|or|clinic(?:al)? services)$/i;

function splitCommaHeader(piece, { fullHeader = false } = {}) {
  let parts = splitOutside(piece, /\s*,\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [piece];
  // "…, Tacoma, WA": the last two parts are ONE place; a state code or a known city is never the employer
  // ("Senior Analyst, Harbor Line Logistics (freight, ~$90M revenue), Tacoma, WA" read the employer as
  // "WA" — coordinator, round 3)
  if (parts.length >= 3 && isLocationPiece(`${parts[parts.length - 2]}, ${parts[parts.length - 1]}`)) {
    parts = [...parts.slice(0, -2), `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`];
    fullHeader = true;
  }
  const kinds = parts.map(classifyPiece);
  const ti = kinds.indexOf('title');
  if (ti === -1) return [piece];
  const maxWords = fullHeader ? 10 : 4;
  const bare = (p) => p.replace(/\([^()]*\)/g, ' ').trim();
  const other = parts.findIndex((p, i) => i !== ti && !isLocationPiece(p) && !/^[A-Z]{2}$/.test(p) && (kinds[i] === 'company' || (kinds[i] === 'unknown' && /^[A-Z0-9]/.test(p) && wordCount(bare(p)) <= maxWords)));
  if (other === -1) return [piece];
  // Keep a specialty that FOLLOWS the title ("Registered Nurse, Telemetry") attached unless the
  // other piece is a hard company (suffix / known shape) or the line names its own location.
  // "Server, Giordano's": a possessive name is an employer, not a specialty
  if (!fullHeader && kinds[other] !== 'company' && other === ti + 1 && !looksLikeCompany(parts[other]) && !/[’']s\b/.test(parts[other]) && parts.length === 2) return [piece];
  // the pieces after title and employer are kept: "Shift Supervisor, Starbucks, Miami, FL" lost
  // "Miami, FL" (no header piece is ever dropped)
  const rest = parts.filter((_, i) => i !== ti && i !== other);
  return rest.length ? [parts[ti], parts[other], rest.join(', ')] : [parts[ti], parts[other]];
}

/** Break a header line into {dates, location, employmentType, pieces[]}. */
export function parseHeaderLine(text, segments) {
  const out = { dates: null, location: '', employmentType: '', url: '', pieces: [] };
  let parts = segments && segments.length > 1 ? segments : [String(text || '')];
  // date first, no wide gap ("Summer 2017 Audit Intern, Clark Nuber PS" — the PDF lost the gap the text had)
  if (parts.length === 1 && !findDateRange(parts[0])) {
    const lead = String(parts[0]).match(/^((?:(?:spring|summer|fall|autumn|winter)\s+|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d{2})\s+(?=[A-Z])/i);
    if (lead) parts = [lead[1], String(parts[0]).slice(lead[0].length)];
  }
  // "Apr 2021<TAB>Present" / "2020<TAB>2021": a start and an end in two cells are one range
  if (parts.length > 1) {
    const one = (x) => { const d = parseDateToken(String(x).trim()); return !!d && !findDateRange(x); };
    const merged = [];
    for (let i = 0; i < parts.length; i++) {
      if (i + 1 < parts.length && one(parts[i]) && parseDateToken(String(parts[i]).trim()) !== 'present' && one(parts[i + 1])) { merged.push(`${parts[i].trim()} – ${parts[i + 1].trim()}`); i++; }
      else merged.push(parts[i]);
    }
    parts = merged;
  }
  const rest = [];
  for (let part of parts) {
    part = String(part || '').trim();
    if (!part) continue;
    const dr = findDateRange(part);
    if (dr) {
      out.dates = out.dates || dr; part = stripDateRange(part);
      // "Summers 2014 - 2016": the season word belongs to the dates, never the location
      const sw = part.match(/(?:^|\s)((?:summers?|winters?|springs?|falls?|autumns?)(?:\s+(?:of|from))?)\s*$/i);
      if (sw && out.dates === dr) { out.dates = { ...dr, raw: `${sw[1]} ${dr.raw}` }; part = part.slice(0, part.length - sw[0].length).trim(); }
    }
    // "(Full Time)" / "(Contract)" / "(Remote)"
    let pm;
    while ((pm = part.match(PAREN_TYPE_RE))) {
      const inner = pm[0].replace(/^[\s(\[]+|[)\]]+$/g, '');
      if (/remote|hybrid|on-?site/i.test(inner) && !out.location) out.location = cap(inner);
      else { const ty = cap(inner.replace(/^[\s,;:–—-]+/, '')); out.employmentType = out.employmentType ? `${out.employmentType}, ${ty}` : ty; }
      part = (part.slice(0, pm.index) + ' ' + part.slice(pm.index + pm[0].length)).replace(/\s+/g, ' ').trim();
    }
    if (part) rest.push(part);
  }
  // "Bashas' (Tempe)": a place in parentheses after the employer
  for (let i = 0; i < rest.length; i++) {
    const pm = rest[i].match(/^(.+?\S)\s*\(([^()]{3,40})\)\s*$/);
    if (pm && !out.location && isLocationText(pm[2].trim())) { out.location = pm[2].trim(); rest[i] = pm[1].trim(); }
  }
  // A parenthetical date ("(Summer 2017)", "(2019 – 2021)") is a date, not part of the title.
  // …anywhere in the line, not only at its end: "Dental Assistant Intern (summer 2019) — Smile Bright Dental"
  for (let i = 0; i < rest.length; i++) {
    if (out.dates) break;
    for (const pm of rest[i].matchAll(/\s*\(([^()]{4,40})\)/g)) {
      const dr = findDateRange(pm[1]);
      if (dr) { out.dates = dr; rest[i] = (rest[i].slice(0, pm.index) + ' ' + rest[i].slice(pm.index + pm[0].length)).replace(/\s+/g, ' ').trim(); break; }
      const { parseDateToken, toToken } = DATE_API;
      const single = parseDateToken(pm[1].trim());
      if (single && single !== 'present') { out.dates = { start: toToken(single), end: '', raw: pm[1].trim() }; rest[i] = (rest[i].slice(0, pm.index) + ' ' + rest[i].slice(pm.index + pm[0].length)).replace(/\s+/g, ' ').trim(); break; }
    }
  }
  seasonSpan(out);
  // Split the remaining text on strong separators; classify location / type pieces out.
  for (const r of rest) {
    const pieces = splitOutside(r.replace(/[\s,;:|•·—–-]+$/, '').replace(/^[\s,;:|•·—–-]+/, ''), SEP_RE)
      .map((p) => p.trim().replace(/^[,;:—–-]+|[,;:—–-]+$/g, '').trim()).filter(Boolean);
    // one title-ish piece next to a location: "Title, Employer — City, ST" (see splitCommaHeader)
    const core = pieces.filter((p) => !isLocationPiece(p) && !isTypePiece(p));
    // a dated one-piece line ("SDR, Contoso, 2017–2019") names its employer after the comma
    const expanded = pieces.length === 1 ? splitCommaHeader(pieces[0], { fullHeader: !!out.dates && !SPECIALTY_RE.test(pieces[0].split(/,\s+/)[1] || '') && !SPECIALTY_TAIL_RE.test(pieces[0].split(/,\s+/)[1] || '') })
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
      // "Sunbelt Electric Contractors, Phoenix AZ": a place with no comma before its state code
      const nc = p.length <= 160 ? p.match(NOCOMMA_LOCATION_TAIL_RE) : null;
      if (nc && !looksLikeTitle(nc[2].replace(/\s+[A-Z]{2}$/, '')) && isLocationText(nc[2])) { if (!out.location) out.location = nc[2]; p = nc[1].trim(); }
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
  // "FedEx Ground | Rialto" / "Personal and friends' vehicles | Southern California" (a company-first
  // template puts the place flush right): an employer next to a bare place name is employer + location.
  if (out.pieces.length === 2 && !out.location && !looksLikeTitle(out.pieces[0]) && looksLikePlace(out.pieces[1])) {
    out.location = out.pieces.pop();
  }
  // "Volunteer — Hope Street Food Pantry | 2022 – 2023": a role word that doubles as an employment type,
  // beside one employer piece and no title, is the title (it read back as "Volunteer, Volunteer" with
  // no title on the second save — round trip, 2026-11-10)
  if (out.pieces.length === 1 && out.dates && /^(?:volunteer|intern|freelancer?|consultant|contractor|apprentice|fellow)$/i.test(out.employmentType) && !looksLikeTitle(out.pieces[0])) {
    out.pieces.unshift(out.employmentType); out.employmentType = '';
  }
  seasonSpan(out);
  // A line that is ONLY a role word that doubles as an employment type ("Volunteer", "Intern") is
  // the title — "Volunteer" / "Hope Street Food Pantry | 2022 - 2023" lost its title (harness).
  if (!out.pieces.length && !out.dates && /^(?:volunteer|intern|freelancer?|consultant|contractor|apprentice|fellow)$/i.test(String(text || '').trim())) {
    out.pieces.push(String(text).trim()); out.employmentType = '';
  }
  return out;
}

// "Summer 2018" alone is a span: June – August of that year (an internship read as "2018 –" with no end)
function seasonSpan(out) {
  // a single year is that year, start and end ("Accounting Intern (summer) | Baird LLP | 2013")
  if (out.dates && !out.dates.end && /^(?:19|20)\d{2}$/.test(out.dates.start || '') && /^\(?\s*(?:19|20)\d{2}\s*\)?$/.test(String(out.dates.raw || '').trim())) { out.dates = { ...out.dates, end: out.dates.start }; return; }
  if (!out.dates || out.dates.end || !/\b(?:spring|summer|fall|autumn|winter)\b/i.test(out.dates.raw || '')) return;
  const y = Number((String(out.dates.raw).match(/(?:19|20)\d{2}/) || [])[0]);
  const season = String(out.dates.raw).toLowerCase().match(/spring|summer|fall|autumn|winter/)[0];
  const span = { spring: ['03', '05'], summer: ['06', '08'], fall: ['09', '11'], autumn: ['09', '11'], winter: ['12', '02'] }[season];
  if (y) out.dates = { ...out.dates, start: `${y}-${span[0]}`, end: season === 'winter' ? `${y + 1}-${span[1]}` : `${y}-${span[1]}` };
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
  let ti = kinds.indexOf('title'), ci = kinds.indexOf('company');
  // "Cool Breeze HVAC — Installer": both read as titles; the one that is also an employer is the employer
  if (ci === -1 && kinds.filter((k) => k === 'title').length >= 2) {
    const both = pieces.findIndex((p, i) => kinds[i] === 'title' && looksLikeCompany(p));
    if (both !== -1) { ci = both; ti = pieces.findIndex((p, i) => i !== both && kinds[i] === 'title'); }
  }
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
  // "Audit Intern — Clark Nuber PS | Bellevue, WA | Summer 2017": separated pieces ending in a date are a
  // role header even when the title opens with a verb-like word ("Audit", "Lead", "Support")
  if ((SEP_RE.test(t) || (line.segments && line.segments.length > 1)) && alphaWords <= 16 && /(?:\b(?:spring|summer|fall|autumn|winter)\s+(?:19|20)\d{2}|\b(?:19|20)\d{2}|present|current)\)?\s*$/i.test(t)) return false;
  // a line that ENDS (or starts) with its date range is a role header however long its employer is
  // ("Front Office Coordinator (part-time, evenings) – University of Colorado Health Anschutz Outpatient
  // Pavilion Orthopedics Clinic, Aurora, CO     07/2019 - 03/2020" — its bullets were given to the job above)
  const dr = findDateRange(t);
  if (dr && (/^[\s)(.,;:–—-]*$/.test(t.slice(t.indexOf(dr.raw) + dr.raw.length)) || t.indexOf(dr.raw) <= 1) && !TERMINAL_RE.test(t.replace(/[)\s]+$/, ''))) return false;
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

// ── Career notes ────────────────────────────────────────────────────────────────────────────
// "(2024 – present: caring for a family member; volunteer bookkeeper…)", "Laid off 2020 (plant
// cutbacks); did DoorDash deliveries 2020 - 2021", "2020–2021: Career break — caregiving": a note
// about the timeline, never a job heading (the warehouse note was printed as a role, out of date
// order) and never dropped (the admin's note vanished — Studio judge, 2026-11-10). The caller keeps
// every note, word for word.
const GAP_CUE_RE = /\b(?:career (?:break|gap|pause)|employment gap|gap in (?:employment|work)|laid off|let go|furlough(?:ed)?|caregiving|caring for|care for (?:a |my |an )?(?:family|parent|child|children|mother|father|spouse|relative|newborn|baby)|family (?:leave|care|reasons|caregiver|responsibilities|matters)|parental leave|maternity|paternity|sabbatical|stay[- ]at[- ]home (?:parent|mom|dad|mother|father)|full[- ]time (?:parent|caregiver|mom|dad|mother|father)|rais(?:e|ed|ing) (?:my |our |two |three |\d |a )?(?:young |small )?(?:child|children|kids|family|son|daughter)|stay(?:ed)? (?:at )?home|home with (?:my |our )?(?:kids|children|baby|family)|medical leave|health (?:reasons|leave|recovery)|personal leave|unemployed|between (?:jobs|roles|positions)|job search(?:ing)?|military spouse|time off to)\b/i;
export function isCareerNote(text) {
  const t = String(text || '').trim();
  if (!t || wordCount(t) < 3) return false;
  if (!findDateRange(t) && !/\b(?:19|20)\d{2}\b/.test(t)) return false;
  if (/^\(.*\)$/.test(t) && findDateRange(t) && wordCount(t) >= 5) return true; // a parenthesised aside spanning dates
  if (!GAP_CUE_RE.test(t)) return false;
  // a real role header that happens to carry a cue word ("Caregiver — Home Instead | 2019 – 2021")
  const ph = parseHeaderLine(t);
  const pair = pairFromPieces(ph.pieces);
  return !(pair && pair.resolved && looksLikeTitle(pair.title) && looksLikeCompany(pair.company));
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
    // a parked line above a full "Title, X  dates" line is an employer header of its own (it was dropped)
    if (role.title || role.company || (role._unknown || []).length) return false;
    const pair = pairFromPieces(ph.pieces);
    set._pair = { ...pair, line };
    set.title = pair.title; set.company = pair.company; set._resolved = pair.resolved;
    set.confidence = pair.resolved ? 0.9 : 0.6;
    // every other piece is kept: a place ("Southern California", "Rialto") is the location, anything
    // else stays as a description line — a header piece is never silently dropped
    const used = [pair.title, pair.company];
    for (const extra of ph.pieces.filter((p) => !used.includes(p))) {
      // "Midtown location" beside "Raleigh NC": the site goes with the place ("Midtown location, Raleigh NC")
      if (ph.location && !role.location && !set.siteDone && SITE_RE.test(extra) && wordCount(extra) <= 4) { set.location = `${extra}, ${ph.location}`; set.siteDone = true; continue; }
      // the one extra piece beside title and employer is where the job was (the canonical text prints
      // "Title — Company | Location | Dates"; "Southpark location" became a description line on re-read)
      if (!role.location && !ph.location && !set.location && (isLocationPiece(extra) || looksLikePlace(extra) || (ph.pieces.length === 3 && /\b(?:location|site|branch|store|campus|office|plant|center|centre|warehouse|hub)\b/i.test(extra)))) set.location = extra;
      else (set._extraLines = set._extraLines || []).push(extra);
    }
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
  if (set._extraLines) role.summary.push(...set._extraLines);
  for (const k of ['start', 'end', 'dateText', 'title', 'company', 'location', 'confidence', '_titleLine', '_companyLine']) if (set[k] !== undefined) role[k] = set[k];
  if (ph.location && !role.location && !set.siteDone) role.location = ph.location;
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
  // "Acme Freight (logistics software, Series C)" / "BrightPay Software, payroll SaaS (Series A)": the
  // descriptor is the person's note about the employer, not its name (a tool said "at BrightPay Software,
  // payroll SaaS (" — coordinator, round 2)
  let companyNote = '';
  const pn = role.company.match(/^(.*?[^\s(])\s*(\([^()]+\)(?:\s*\([^()]+\))?)$/);
  if (pn && pn[1].length >= 2) { role.company = pn[1].trim(); companyNote = pn[2].trim(); }
  const cn = role.company.match(/^([^,()]*[^\s,]),\s+([a-z][^]*)$/);
  if (cn) { role.company = cn[1].trim(); companyNote = companyNote ? `${cn[2].trim()} ${companyNote}` : cn[2].trim(); }
  const out = {
    id: role.id, title: role.title, company: role.company, companyNote, location: role.location, employmentType: role.employmentType, url: role.url || '',
    // the person's own wording is kept when it is not a plain date ("Summer 2018", "Fall 2024", "Q3 2021")
    start: role.start, end: role.end, dateText: !role.start || /\b(?:springs?|summers?|falls?|autumns?|winters?|q[1-4])\b/i.test(role.dateText || '') ? role.dateText : '',
    summary: role.summary.join('\n'),
    bullets: role.bullets.map((t) => ({ id: newId('b'), text: t })),
    sourceText: role.headerLines.map((l) => l.text).join(' ').trim(),
    // the employer came from a line of its own, above the role ("Banner Health, Phoenix AZ" / "Charge Nurse — 2022…")
    _blockCompany: !!(role._companyLine && role._companyLine !== role._titleLine && !findDateRange(role._companyLine.text) && role.company),
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
export function parseExperience(linesIn, opts = {}) {
  let lines = linesIn;
  const hasGeometry = !!opts.hasGeometry;
  const requireDates = !!opts.requireDates;
  const headerish = lines.filter((l) => !l.bullet && wordCount(l.text) <= 12);
  const baseIndent = hasGeometry && headerish.length ? Math.min(...headerish.map((l) => l.indent || 0)) : 0;
  const ctx = { hasGeometry, baseIndent };

  const roles = [];
  const orphans = [];
  const notes = []; // [{ lines: string[], afterRole: number }]
  let cur = null;
  let note = null;
  const flush = () => { if (cur && (cur.title || cur.company || cur.start || cur.bullets.length || (cur._unknown || []).length)) roles.push(cur); cur = null; };

  // "LPN at Bayou Rehab Center, Houston TX, 2021 to present. Pass meds for 24 residents…" / "Line Cook, Avec,
  // Chicago IL, 2021-present: sauté and wood oven…": a role header and its duties written as one line are
  // two lines (the duties were glued to the employer as ", . Roomed patients…" — stress set, 2026-11-10)
  const split = [];
  for (const line of lines) {
    const t = line.text.trim();
    const dr = !line.bullet && findDateRange(t);
    if (dr && !isCareerNote(t)) {
      const at = t.indexOf(dr.raw) + dr.raw.length;
      const tail = t.slice(at).match(/^\s*\)?\s*[.:;]\s+(?=[A-Za-z0-9$£€~])/);
      if (tail && wordCount(t.slice(at + tail[0].length)) >= 3 && wordCount(t.slice(0, at)) <= 14) {
        split.push({ ...line, text: t.slice(0, at).replace(/[\s,;:—–-]+$/, '').trim(), segments: null });
        split.push({ ...line, text: t.slice(at + tail[0].length).trim(), segments: null, bullet: false, _prose: true });
        continue;
      }
    }
    split.push(line);
  }
  lines = split;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const text = line.text.trim();
    if (!text || PAGE_NOISE_RE.test(text)) continue;

    if (!line.bullet && isCareerNote(text)) {
      flush();
      note = { lines: [text], afterRole: roles.length };
      notes.push(note);
      continue;
    }
    // bullets right under a note belong to the note ("Career break | 2020 – 2021" / "• Completed …")
    if (note && !cur && line.bullet) { note.lines.push(text); continue; }
    note = null;

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

    // Under a role that already has a body, a short glyph-less line with no date of its own and no date in
    // the two lines after it is more of that body ("Front desk check-in when short-staffed", "Sitter for
    // fall-risk patients" became jobs with no dates — round 3), never a new role.
    if (cur && cur.sawBody && !line.bullet && !findDateRange(text) && !lines.slice(li + 1, li + 3).some((l) => findDateRange(l.text))
      && wordCount(text) >= 3 && text.split(/\s+/).filter((w) => /^[a-z]/.test(w)).length >= 2 && !isCareerNote(text)) {
      if (cur.bullets.length || BULLET_OPENER_RE.test(text)) cur.bullets.push(text); else { cur.summary.push(text); cur._bodyLines = (cur._bodyLines || 0) + 1; }
      continue;
    }


    // "2022 - Present    HEAD BAKER" / "Blue Door Bakery Group — Midtown location, Raleigh NC": a line with no
    // dates directly under a dated title line is that role's EMPLOYER line, whatever follows the name
    // (—, –, -, a comma, "|", brackets; "Store #114", "Downtown", "Plant 2") — it never starts a second role
    // (six roles came back for three — coordinator, round 4)
    if (cur && (cur.start || cur.dateText) && (cur.title || ((cur._unknown || []).length === 1 && !cur.company)) && !cur.company && !cur.sawBody && !line.bullet && !findDateRange(text)
      && cur.headerLines.length <= 2 && !looksLikeTitle(text.split(/\s+[—–|-]\s+|,\s+|\s*\(/)[0])) {
      const ph = parseHeaderLine(text, line.segments);
      let company = ph.pieces[0] || '';
      const sites = ph.pieces.slice(1);
      const paren = company.match(/^(.*?\S)\s*\(([^()]+)\)$/);
      if (paren && (SITE_RE.test(paren[2]) || isLocationText(paren[2]))) { company = paren[1]; sites.unshift(paren[2]); }
      if (company) {
        // the dated line's one unclassified piece ("COUNTER STAFF") is the title
        if (!cur.title && cur._unknown && cur._unknown.length === 1) { cur.title = cur._unknown[0].text; cur._titleLine = cur._unknown[0].line; cur._unknown = []; }
        cur.company = company; cur._companyLine = line; cur.headerLines.push(line);
        const loc = [...sites, ph.location].filter(Boolean).join(', ');
        if (loc && !cur.location) cur.location = loc;
        if (ph.employmentType) cur.employmentType = cur.employmentType ? `${cur.employmentType}, ${ph.employmentType}` : ph.employmentType;
        continue;
      }
    }

    // a glyph-less duty line under a role that already has a body ("Pre-trip and post-trip inspections,
    // ELD logs (Omnitracs)") is a bullet, never the next role's header (stress set, 2026-11-10)
    const looseDuty = (cur && line._prose) || cur && (cur.sawBody || ((cur.start || cur.dateText) && (cur.title || cur.company) && (wordCount(text) >= 4 || (TERMINAL_RE.test(text) && wordCount(text) >= 3)))) && !line.bullet && !findDateRange(text) && wordCount(text) >= (cur && cur.sawBody ? 5 : 4) && !SEP_RE.test(text) && !looksLikeTitle(text) && !looksLikeCompany(text) && !isLocationPiece(text)
      // prose, not a stacked header line: several lower-case words, and no trailing "City, ST"
      && text.split(/\s+/).filter((w) => /^[a-z]/.test(w)).length >= 3 && !LOCATION_INLINE_RE.test(text.slice(-24));
    if (looseDuty || isBulletLike(line, ctx)) {
      if (!cur) {
        if (requireDates) { orphans.push(text); continue; }
        cur = newRole();
      }
      if (line.bullet || BULLET_OPENER_RE.test(text) || cur.bullets.length) cur.bullets.push(text);
      else { cur.summary.push(text); cur._bodyLines = (cur._bodyLines || 0) + 1; } // a dateless prose description under the header
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

  // One form per section: when no line carries a bullet glyph, a body line is a bullet in every role or in
  // none — one role's lines became bullets (they opened with a verb) and the next role's stayed a paragraph
  // (coordinator round 2, 2026-11-10). Each source line stays its own item, in its own words.
  if (!lines.some((l) => l.bullet) && roles.some((r) => r.bullets.length)) {
    for (const r of roles) {
      const n = r._bodyLines || 0;
      if (!n) continue;
      const body = r.summary.splice(r.summary.length - n, n);
      r.bullets = [...body, ...r.bullets];
      r._bodyLines = 0;
    }
  }
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
  const moved = [];
  // ── Employer blocks ──────────────────────────────────────────────────────────────────────────
  // "Acme Freight (logistics software, Series C) | Denver, CO" above "Account Executive, Mid-Market  2023 –
  // Present" and "Sales Development Rep  2021 – 2023": one employer, two roles. It came back as title
  // "Account Executive" at "Mid-Market" and a second role with no employer (coordinator, round 2).
  const dated = (r) => !!(r && (r.start || r.dateText));
  // "Account Executive, Mid-Market": the comma piece of a line under an employer header is a specialty
  const specialty = (r) => r && r.company && r.sourceText.includes(`${r.title}, ${r.company}`) && !/\s[—–|@]\s|\s-\s|\sat\s/.test(stripDateRange(r.sourceText));
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i], next = merged[i + 1];
    const header = !dated(r) && !r.bullets.length && !r.summary && (r.company || r.title) && next && dated(next) && (!next.company || specialty(next));
    if (header) {
      // the employer is the piece that is not a title; the other piece is the site ("Southpark location")
      let employer = r.company || r.title, site = '';
      if (r.company && r.title) { employer = looksLikeTitle(r.company) && !looksLikeTitle(r.title) ? r.title : r.company; site = employer === r.company ? r.title : r.company; }
      for (let j = i + 1; j < merged.length && dated(merged[j]) && (!merged[j].company || specialty(merged[j])); j++) {
        const x = merged[j];
        if (x.company) x.title = `${x.title}, ${x.company}`;
        x.company = employer;
        if (employer === r.company && r.companyNote) x.companyNote = r.companyNote;
        if (!x.location) x.location = r.location || site;
      }
      merged.splice(i, 1); i--;
      continue;
    }
    // "Banner Health, Phoenix AZ" / "Charge Nurse — 2022 to present" / "Staff RN — 2019 to 2022": the
    // employer line above the first role covers the roles under it that name no employer of their own
    if (r._blockCompany) {
      for (let j = i + 1; j < merged.length && dated(merged[j]) && !merged[j].company && !merged[j]._blockCompany; j++) {
        merged[j].company = r.company;
        if (r.companyNote) merged[j].companyNote = r.companyNote;
        if (!merged[j].location) merged[j].location = r.location;
      }
    }
  }
  // "Registered Nurse, Cardiovascular ICU   June 2019 – Present" / "UCHealth University of Colorado Hospital,
  // Aurora, CO" / bullets: the line under a dated title is its employer, and the comma piece was a specialty
  for (let i = 0; i + 1 < merged.length; i++) {
    const r = merged[i], n = merged[i + 1];
    if (dated(r) && !r.bullets.length && !r.summary && r.company && !dated(n) && !n.title && n.company && r.sourceText.includes(`${r.title}, ${r.company}`)) {
      r.title = `${r.title}, ${r.company}`; r.company = n.company; r.companyNote = n.companyNote || '';
      if (!r.location) r.location = n.location;
      r.bullets.push(...n.bullets); if (n.summary) r.summary = n.summary;
      merged.splice(i + 1, 1);
    }
  }
  // ── Not jobs ────────────────────────────────────────────────────────────────────────────────
  // "Unit Practice Council member, 2023 – Present" / "Preceptor for new graduate nurses, 2024 – Present"
  // under a real role: an activity of that job, never a job of its own (7 roles for an RN with 3).
  // A "role" with no employer whose title is a sentence ("Taught the hospital's quarterly "IV Basics"
  // class…"), a committee, council, board or class is never a job: under a real job it is part of that job,
  // otherwise it is kept word for word under Additional Information (round 3).
  const NONJOB_RE = /\b(?:council|committee|task force|board|preceptor|precepted|super ?user|champion|representative to|member of|charge nurse rotation|instructor|mentor for|peer mentor|class|course|workshop|in-?service)\b/i;
  const sentence = (t) => wordCount(t) > 8 || /["“”]/.test(t) || (BULLET_OPENER_RE.test(t) && wordCount(t) >= 4) || /[.!?]$/.test(t);
  const nonjobs = [];
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i];
    if (r.company || r.bullets.length > 1 || r.summary) continue;
    const t = r.title || '';
    if (!(NONJOB_RE.test(t) || sentence(t))) continue;
    const prev = merged[i - 1];
    if (prev && prev.company && NONJOB_RE.test(t) && !sentence(t)) {
      prev.bullets.push({ id: newId('b'), text: r.sourceText });
      moved.push({ line: r.sourceText, to: [prev.title, prev.company].filter(Boolean).join(' at ') });
    } else nonjobs.push([r.sourceText, ...r.bullets.map((b) => b.text)]);
    merged.splice(i, 1); i--;
  }
  // a second role at the same employer whose own line names no place takes the employer's place
  const placeOf = new Map();
  for (const r of merged) if (r.company && r.location && !placeOf.has(r.company.toLowerCase())) placeOf.set(r.company.toLowerCase(), r.location);
  for (const r of merged) if (r.company && !r.location && placeOf.has(r.company.toLowerCase())) r.location = placeOf.get(r.company.toLowerCase());
  for (const r of merged) delete r._blockCompany;
  return { roles: merged, orphans, notes, moved, nonjobs };
}
