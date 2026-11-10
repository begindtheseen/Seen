// The paid result, made honest (T3, 2026-11-10): what the credit buys, decided AFTER the package is built.
//
//   fieldMatch(out, plan, base, jobTitle) → { level: 'same'|'adjacent'|'different', … }
//     the verdict's own `field_match` when the reader provides it; until then derived here, in ONE place, from the
//     posting's role family vs the families of the person's roles, the title words they share, the band and the
//     share of the posting's requirements the résumé shows.
//   blockedFor(out, fm, base, ctx) → null | { reason, sentence, what_would_change_it: [...], carries_over: [...] }
//   visibility(doc, out) → { of, shown, labels } — how many of the requirements the résumé PROVES appear in the part a
//     recruiter reads first: the summary, the first skills line, and the first three lines of the first two roles.
//   formatChanges(original, baseRendered) → one honest "Formatting made consistent" item (or null)
//   reorderChanges(base, variant, verdict) → one item per role whose line order changed, every moved line listed
//   unlistedDifferences(originalText, tailoredText, changes) → the lines that differ and no change lists (test oracle)
//   chargeDecision({ blocked, changes, visibility, summaryDecision, jobTitle, company }) → { charge, reason, sentence }
//
// ONE charge rule for the paid Optimize AND the Studio's tailor (api/resume.js calls nothing else): charged only when
// (a) nothing blocks the application (no failed hard gate, not a different field), (b) at least one applied change of
// substance beyond formatting, and (c) the document is measurably better for THIS posting — more of what the résumé
// proves sits where a recruiter reads first, or a thin / cliché summary was replaced. Otherwise free, with one
// specific sentence. The fit score never has to rise: truthful tailoring cannot add facts.
import { escapeRegExp } from '../../text/escapeRegExp.js';
import { contentStems, stemsCovered, isGapNote, cleanLine, qualifiedProof } from './verdict.js';
import { askableGap } from './questions.js';
import { detectRoleFamily } from '../../application-intelligence/roleOntology.js';
import { fitBand } from '../../optimizer/explainScore.js';
import { isTool } from '../../optimizer/extractResumeFacts.js';

const TITLE_FILLER = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'chief', 'head', 'associate', 'entry', 'level', 'part', 'time', 'full', 'remote', 'hybrid', 'onsite', 'contract', 'temporary', 'seasonal', 'intern', 'internship', 'trainee', 'night', 'day', 'shift', 'team', 'member', 'manager', 'supervisor', 'director', 'assistant', 'specialist', 'coordinator', 'representative', 'analyst', 'officer', 'agent', 'clerk', 'worker', 'general', 'new', 'grad', 'ii', 'iii', 'iv', 'i', 'mid', 'expert', 'vice', 'president', 'executive', 'professional']).values();
const FILLER = new Set([...TITLE_FILLER].map((w) => contentStems(w)[0]).filter(Boolean));

// families that hire from each other (a cashier for a host stand, a medical assistant for a front desk)
const ADJACENT = [
  ['retail', 'customer_service', 'food_service', 'hospitality', 'sales', 'valet_parking'],
  ['warehouse', 'delivery_logistics', 'operations', 'manufacturing', 'skilled_trades'],
  ['clinical', 'healthcare_support'],
  ['administrative', 'healthcare_support', 'customer_service', 'finance_accounting', 'operations'],
  ['marketing', 'sales', 'customer_service'],
  ['software_engineering', 'data', 'it_support'],
];
const adjacentFamilies = (a, b) => ADJACENT.some((g) => g.includes(a) && g.includes(b));
const FAMILY_WORD = { retail: 'retail', customer_service: 'customer service', food_service: 'food service', hospitality: 'hospitality', sales: 'sales', warehouse: 'warehouse', delivery_logistics: 'delivery and logistics', operations: 'operations', clinical: 'clinical', healthcare_support: 'healthcare support', administrative: 'office', finance_accounting: 'accounting', marketing: 'marketing', software_engineering: 'software engineering', skilled_trades: 'skilled trades', education: 'teaching', security: 'security' };

const titleStems = (t) => contentStems(String(t || '').replace(/\([^)]*\)/g, ' ')).filter((s) => s.length > 2 && !FILLER.has(s));
const proven = (out) => ((out && out.matched_requirements) || []).filter((m) => m.matched && !m.soft && !m.inferred && m.via !== 'related' && m.via !== 'title' && m.via !== 'field' && !qualifiedProof(String(m.surface || m.requirement || '').replace(/^term:/, ''), m.evidence));
const labelOf = (m) => String(m.surface || m.requirement || '').replace(/^term:/, '').trim();

/** The share of the posting's (non-soft) requirements the résumé shows, required ones counted double. */
export function shareShown(out) {
  const rows = [...((out && out.matched_requirements) || []), ...((out && out.unsupported_requirements) || [])].filter((m) => !m.soft);
  if (!rows.length) return null;
  const w = (m) => (m.importance === 'required' ? 2 : 1);
  const tot = rows.reduce((s, m) => s + w(m), 0);
  const got = rows.filter((m) => m.matched && !m.inferred && m.via !== 'related').reduce((s, m) => s + w(m), 0);
  return got / tot;
}

/**
 * Same field, an adjacent one, or a different one. The reader's verdict decides when it carries `field_match`; this
 * is the one fallback until it does.
 */
export function fieldMatch(out, plan, base, jobTitle = '') {
  const given = out && out.verdict && out.verdict.field_match;
  const jobFam = (plan && plan.job && plan.job.family) || 'general';
  const roles = (base.experience || []).filter((e) => !isGapNote(e));
  const famOf = new Map(((plan && plan.decisions) || []).map((d) => [d.itemId, d.family]));
  const fams = [...new Set(roles.map((e) => famOf.get(e.id)).filter((f) => f && f !== 'general'))];
  const jt = titleStems(jobTitle);
  const titleOverlap = jt.length > 0 && roles.some((e) => titleStems(e.title).some((s) => jt.includes(s)));
  const score = out ? out.fit_score : null;
  const share = shareShown(out);
  // the title alone is a second opinion: a posting read into the wrong family ("Executive Assistant to the
  // Communications … Executives" read as marketing) is never called a different field when its title is the person's
  const titleFam = detectRoleFamily(String(jobTitle || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+(?:to|for)\s+the\s+.*$|\s+[-–—|,]\s.*$/i, '')).family;
  const near = (f) => f && f !== 'general' && (fams.includes(f) || fams.some((g) => adjacentFamilies(g, f)));
  let level;
  if (jobFam === 'general' || !fams.length || fams.includes(jobFam) || fams.includes(titleFam)) level = 'same';
  else if (near(titleFam)) level = 'adjacent';
  else if (titleOverlap || fams.some((f) => adjacentFamilies(f, jobFam))) level = 'adjacent';
  else if (!/strong|good/i.test(fitBand(score) || '') && (share == null || share < 0.4)) level = 'different';
  else level = 'adjacent';
  // a family read wrong never makes a near-match "different": a shared title word or a real score keeps it adjacent
  if (level === 'same' && fams.length && !fams.includes(jobFam) && jobFam !== 'general') level = 'adjacent';
  // the reader's verdict decides when it KNOWS (known === false is no verdict at all)
  if (given && given.level && given.known !== false) {
    // the reader's verdict decides — except that a posting whose TITLE names the person's own work is never a different
    // field (the reader read "Executive Assistant to the Communications … Executives" as marketing for an office manager)
    if (given.level === 'different' && (fams.includes(titleFam) || near(titleFam))) return { ...given, level: 'adjacent', sentence: null, derived: false, overridden: 'title names your field' };
    return { ...given, derived: false };
  }
  return { level, job_family: jobFam, title_family: titleFam, person_families: fams, title_overlap: titleOverlap, share: share == null ? null : Number(share.toFixed(2)), derived: true };
}

// A requirement label as a person writes it mid-sentence: the résumé's own spelling when it has one with capitals
// ("HubSpot", "GAAP", "PostgreSQL"), an acronym in capitals, a plain word in lower case ("month-end close").
const ACRONYM = /^(?:erp|crm|gaap|sql|aws|gcp|api|apis|emr|ehr|hipaa|osha|cdl|pos|kpi|seo|sem|ui|ux|qa|bls|acls|rn|lpn|cna|wms|sap|cpa|ats|b2b|saas|etl|bi)$/i;
export function showLabel(label, text = '') {
  const l = String(label || '').trim();
  if (!l) return l;
  const esc = escapeRegExp(l).replace(/\s+/g, '\\s+');
  const m = String(text || '').match(new RegExp(`(?<![A-Za-z0-9])(${esc})(?![A-Za-z0-9])`, 'i'));
  if (m && (/[A-Z]/.test(m[1].slice(1)) || (/^[A-Z]/.test(m[1]) && isTool(l.toLowerCase())))) return m[1].replace(/\s+/g, ' ');
  return l.split(/\s+/).map((w) => (ACRONYM.test(w) ? w.toUpperCase() : w)).join(' ');
}
const quoteLine = (t, max = 70) => { const s = cleanLine(t).replace(/[.;,]+$/, ''); return s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s; };
const cap1 = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
// The role as a person says it: "Registered Nurse Registered Nurse Med/Surg Telemetry Full Time Nights" → "Registered
// Nurse Med/Surg Telemetry"; "Shift Lead - Laurel" → "Shift Lead"; "Director, Finance" stays (a short qualifier)
export function shortRole(t) {
  let s = String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*[|–—]\s.*$|\s+-\s.*$/, '').trim();
  s = s.replace(/,\s*.*$/, ''); // "Store Associate, Dallas" → "Store Associate" (a location or a team after a comma)
  s = s.replace(/\b(?:full[- ]time|part[- ]time|nights?|days?|evenings?|weekends?|remote|hybrid|on-?site|per diem|prn|contract|temporary|seasonal)\b.*$/i, '').trim();
  const w = s.split(/\s+/);
  for (let n = Math.floor(w.length / 2); n >= 1; n--) for (let i = 0; i + 2 * n <= w.length; i++) if (w.slice(i, i + n).join(' ').toLowerCase() === w.slice(i + n, i + 2 * n).join(' ').toLowerCase()) { w.splice(i + n, n); return shortRole(w.join(' ')); }
  return s.replace(/[\s,/-]+$/, '');
}
const roleName = shortRole;

/** A statement short and clean enough to quote in a sentence (the reader's compression can run long or keep a lead-in). */
export function readableStatement(m, out) {
  const st = m && m.statementId && out && Array.isArray(out.statements) ? out.statements.find((s) => s.id === m.statementId) : null;
  const t = st && st.text ? String(st.text).trim() : '';
  if (!t) return null;
  const n = t.split(/\s+/).length;
  if (n < 2 || n > 9) return null;
  if (/^(?:responsibilities|qualifications|requirements|education|experience|successful|candidates?|all\s|the\s+(?:ideal|successful)|you\s|we\s|our\s|this\s+(?:role|position))\b/i.test(t)) return null;
  if (/\b(?:must|will|should)\b/i.test(t) || /[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z][a-z]+\s+[A-Z]/.test(t)) return null;
  return t;
}

/** A statement fit to quote as a requirement: 2–16 words, no lead-in ("Essential duties … include"), no dangling end. */
export function cleanStatement(t) {
  const x = String(t || '').trim();
  const n = x.split(/\s+/).length;
  if (n < 2 || n > 16) return false;
  if (/^(?:essential|key|primary|main|other|general)\s+(?:duties|responsibilities)|^(?:responsibilities|qualifications|requirements|duties)\b|^(?:success|a successful|the successful|the ideal|our|we|you|this role|this position|at\s+[A-Z])/i.test(x)) return false;
  if (/\b(?:include|includes|including|but|not limited|desirable|preferred|plus|and|or|of|to|with|such as)\s*$/i.test(x)) return false;
  return true;
}

/** The requirement as a person reads it: the reader's statement for its posting line when there is one. */
export function requirementText(m, out) {
  return readableStatement(m, out) || labelOf(m || {});
}

/**
 * Why the paid work stops here, from the verdict: a failed hard gate, or a posting in a different field. null otherwise.
 * Lists what on the résumé DOES carry over, as written.
 */
export function blockedFor(out, fm, base, { jobTitle = '', employer = '' } = {}) {
  // a failed hard gate, or any gate the verdict GRADES not met for a reason tailoring cannot change (years, a licence, a
  // certification, a degree — director's decision b)
  const graded = ((out && out.constraints) || []).filter((c) => c.gate && /^(?:not[_ ]?met|unmet|fail(?:ed)?)$/i.test(String(c.grade || '')) && /^(?:years|license|licence|certification|credential|degree|education)$/i.test(String(c.kind || '')));
  const gates = [...((out && out.hard_gates) || []), ...graded.filter((g) => !((out && out.hard_gates) || []).some((h) => h.label === g.label))];
  const carries = proven(out).slice(0, 4).map((m) => ({ requirement: labelOf(m), line: quoteLine(m.evidence || '', 90) })).filter((c) => c.line);
  const unmet = ((out && out.unsupported_requirements) || []).filter((m) => !m.soft && m.importance === 'required' && askableGap({ label: labelOf(m), soft: m.soft, importance: m.importance, term: m.term })).sort((a, b) => (b.hard - a.hard) || ((b.weight || 0) - (a.weight || 0)));
  const job = roleName(jobTitle) || 'this job';
  const at = employer ? ` at ${employer}` : '';
  if (fm && fm.level === 'different') {
    const latest = (base.experience || []).find((e) => !isGapNote(e) && e.title);
    const field = (FAMILY_WORD[(fm.person_families || [])[0]] || (fm.resumeField ? String(fm.resumeField) : '')).replace(/\s+work$/i, '');
    // the posting's top REQUIRED statements (a whole requirement line, cleanly restated), never a plucked keyword like
    // "scheduling" (round 2); the keyword only when the reader has no statements
    const topStatements = screenStatements(out).filter((x) => x.importance === 'required' && x.kind === 'requirement' && x.status === 'not_shown' && cleanStatement(x.text)).map((x) => x.text);
    const asks = (topStatements.length ? topStatements : [...new Set(unmet.map((m) => requirementText(m, out)))]).slice(0, 2);
    const carry = (Array.isArray(fm.transferable) && fm.transferable.length ? fm.transferable.slice(0, 3) : carries.map((c) => c.requirement).slice(0, 3)).map((x) => showLabel(x, JSON.stringify(base.experience) + JSON.stringify(base.skills)));
    const who = latest ? `${roleName(latest.displayTitle || latest.title)}${latest.company ? ` at ${latest.displayCompany || latest.company}` : ''}` : '';
    const sentence = `${job}${at} asks for ${asks.length ? listJoin(asks.map((a) => `"${a}"`)) : 'work your résumé does not show'}, and your résumé is ${field ? `${field} work` : 'other work'}${who ? ` (${who})` : ''}${carry.length ? `; what carries over is ${listJoin(carry)}` : ''}. Rewording cannot add ${asks[0] ? `"${asks[0]}"` : 'that experience'}, so nothing is changed and no credit is used.`;
    const CRED = /\b(?:degree|bachelor|master|associate'?s|diploma|ged|licen[cs]e|licensure|certif\w*|registered|cpa|rn|lpn|cdl|journeyman)\b/i;
    const what = (topStatements.length ? topStatements : [...new Set(unmet.map((m) => requirementText(m, out)))]).slice(0, 3).map((t) => (CRED.test(t) ? `"${t}" — listed on your résumé, if you hold it` : `Work you have done that shows "${t}", written on your résumé`));
    return { reason: 'different_field', sentence: balanceBrackets(sentence), what_would_change_it: what, carries_over: carries };
  }
  if (gates.length) {
    const g = gates[0];
    const sentence = `${balanceBrackets(String(g.message || '')).replace(/[\s.]+$/, '')} — ${job}${at} states it as a requirement and no rewording can meet it, so no credit is used.`;
    const what = gates.slice(0, 3).map((x) => (x.kind === 'years' ? `More years in this work than your résumé shows (${x.label})` : `${x.label}, held and listed on your résumé`));
    return { reason: 'hard_gate', sentence, what_would_change_it: what, carries_over: carries };
  }
  return null;
}

// ── visibility: what a recruiter reads first ──
function firstRead(doc) {
  const lines = [];
  if (doc.basics && doc.basics.summary) lines.push(...String(doc.basics.summary).split(/(?<=[.!?])\s+/));
  const g = (doc.skills || [])[0];
  if (g && g.items && g.items.length) lines.push(g.items.join(', '));
  const roles = (doc.experience || []).filter((e) => !isGapNote(e)).slice(0, 2);
  for (const e of roles) for (const b of e.bullets.slice(0, 3)) lines.push(b.text);
  return lines.map(cleanLine).filter(Boolean);
}
/** Requirements the résumé proves that sit in the first-read part of `doc` (the requirements are the base's verdict). */
export function visibility(doc, out) {
  const reqs = [];
  for (const m of proven(out)) { const l = labelOf(m); if (l && !reqs.some((r) => r.label.toLowerCase() === l.toLowerCase())) reqs.push({ label: l, evidence: cleanLine(m.evidence || '') }); }
  const lines = firstRead(doc);
  const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const shown = reqs.filter((r) => lines.some((l) => stemsCovered(r.label, l) || (r.evidence && flat(l) === flat(r.evidence))));
  const txt = JSON.stringify([doc.basics && doc.basics.summary, doc.skills, doc.experience]);
  return { of: reqs.length, shown: shown.length, labels: shown.map((r) => showLabel(r.label, txt)) };
}

// ── line diff (every difference listed) ──
// a line's identity ignores punctuation, bullets, separators, case and the order of its words (a contact line or a
// role header re-punctuated is the same line); a rewrite changes the words and is a different line
export const lineKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9$%+#]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');
// a hard-wrapped line ("Experienced in month-end" / "close, reconciliations…") is one line of the person's document
const textLines = (t) => {
  const out = [];
  for (const raw of String(t || '').split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const prev = out[out.length - 1];
    if (prev && /^[a-z(]/.test(l) && !/[.!?:;]$/.test(prev) && !/^[-•·*]/.test(l)) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out;
};
function lcsKeep(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keepA = new Set(), keepB = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { keepA.add(i); keepB.add(j); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return { keepA, keepB };
}
/** Lines removed, added and moved between two texts, by key. */
export function lineDiff(beforeText, afterText) {
  const A = textLines(beforeText), B = textLines(afterText);
  const ka = A.map(lineKey), kb = B.map(lineKey);
  const { keepA, keepB } = lcsKeep(ka, kb);
  const countB = new Map(); kb.forEach((k, j) => { if (!keepB.has(j)) countB.set(k, (countB.get(k) || 0) + 1); });
  const removed = [], moved = [], added = [];
  ka.forEach((k, i) => { if (keepA.has(i)) return; if (countB.get(k)) { countB.set(k, countB.get(k) - 1); moved.push(A[i]); } else removed.push(A[i]); });
  const countA = new Map(); ka.forEach((k, i) => { if (!keepA.has(i)) countA.set(k, (countA.get(k) || 0) + 1); });
  kb.forEach((k, j) => { if (keepB.has(j)) return; if (countA.get(k)) countA.set(k, countA.get(k) - 1); else added.push(B[j]); });
  return { removed, added, moved };
}
const HEADING_RE = /^[A-Z][A-Z &/]{2,40}$/;
const HEADING_KIND = [['summary', /\b(?:SUMMARY|OBJECTIVE|PROFILE|ABOUT)\b/], ['experience', /\b(?:EXPERIENCE|EMPLOYMENT|WORK|HISTORY)\b/], ['education', /\b(?:EDUCATION|TRAINING|ACADEMIC)\b/], ['skills', /\b(?:SKILLS|COMPETENCIES|TOOLS|EXPERTISE)\b/], ['certifications', /\b(?:CERTIFICATIONS?|CERTS|LICENSES?|LICENSURE|CREDENTIALS)\b/], ['projects', /\bPROJECTS\b/], ['languages', /\bLANGUAGES\b/]];
const headingKind = (h) => (HEADING_KIND.find(([, re]) => re.test(h)) || [null])[0];
/**
 * The person's own section headings, found by content: for each section of the re-typeset document, the line that
 * stood right above that section's first line in the upload. → [{ kind, rendered, person }]
 * ("What I've done" above "Journeyman Electrician — Sunbelt…" is the person's Experience heading.)
 */
const KIND_BY_TITLE = { SUMMARY: 'summary', EXPERIENCE: 'experience', EDUCATION: 'education', SKILLS: 'skills', CERTIFICATIONS: 'certifications', PROJECTS: 'projects', LANGUAGES: 'languages' };
export function personHeadings(original, rendered) {
  const R = String(rendered || '').split('\n').map((l) => l.trim());
  const O = textLines(original);
  const out = [];
  for (let i = 0; i < R.length; i++) {
    const h = R[i];
    if (!h || !(i > 0 && R[i - 1] === '' && HEADING_RE.test(h))) continue;
    const kind = KIND_BY_TITLE[h];
    if (!kind) continue;
    const first = R.slice(i + 1).find((l) => l);
    if (!first) continue;
    const at = O.findIndex((l) => lineKey(l) === lineKey(first) || (lineKey(first).length > 12 && lineKey(l).includes(lineKey(first))));
    if (at <= 0) continue;
    const above = O[at - 1].replace(/[:：]\s*$/, '').trim();
    if (!above || lineKey(above) === lineKey(h) || /@|\d{3}/.test(above) || above.split(/\s+/).length > 6 || /^[-•·*]/.test(above)) continue;
    out.push({ kind, rendered: h, person: above });
  }
  return out;
}
// headings every applicant system reads: the person's own spelling of these stays without a word
const STANDARD_HEADING_RE = /^(?:(?:professional|career|work|employment|relevant)\s+)?(?:summary|profile|objective|experience|history|education|skills|(?:licen[cs]es?\s*(?:&|and|\/)\s*)?certifications?|licen[cs]es?(?:\s*(?:&|and|\/)\s*cert(?:ification)?s?)?|projects|languages|skills\s*(?:&|and)\s*certifications)$/i;
export const isStandardHeading = (h) => STANDARD_HEADING_RE.test(String(h || '').trim());

const sectionOf = (lines, idx, isHead) => { for (let i = idx; i >= 0; i--) if (isHead(lines[i], i)) return lines[i]; return ''; };
/**
 * Everything the re-typeset document says differently from the person's upload, as STRUCTURED items the screen
 * renders one per line — never a flattened before/after of the whole document:
 *   { kind: 'heading_renamed', from, to } · { kind: 'line_moved', line, from_section, to_section }
 *   { kind: 'lines_joined', before: [..], after: [..] } · { kind: 'line_split', before: [..], after: [..] }
 *   { kind: 'line_restyled', before, after } (same words, other punctuation) · { kind: 'unplaced', line }
 * Returns one change { type: 'format', items, why } or null.
 */
export function formatChanges(original, rendered) {
  if (!String(original || '').trim()) return null;
  const d = lineDiff(original, rendered);
  if (!d.removed.length && !d.added.length && !d.moved.length) return null;
  const renderedLines = textLines(rendered);
  const origLines = textLines(original);
  const allTokens = new Set(renderedLines.flatMap((l) => (/@/.test(l) ? [] : lineKey(l).split(' '))));
  const isSection = (l) => String(rendered).includes(`\n\n${l}\n`);
  const items = [];
  const added = [...d.added];
  const used = new Set();
  for (const r of d.removed) {
    if (HEADING_RE.test(r)) {
      const k = added.findIndex((a) => HEADING_RE.test(a) && headingKind(a) && headingKind(a) === headingKind(r));
      if (k >= 0) { items.push({ kind: 'heading_renamed', from: r, to: added[k] }); added.splice(k, 1); continue; }
    }
    const rs = new Set(lineKey(r).split(' '));
    const pairJ = (a) => { const as = lineKey(a).split(' '); const inter = as.filter((w) => rs.has(w)).length; return inter / (rs.size + as.length - inter || 1); };
    const close = added.findIndex((a) => pairJ(a) >= 0.6);
    if (close >= 0) { items.push({ kind: 'line_restyled', before: r, after: added[close] }); added.splice(close, 1); continue; }
    const rk = lineKey(r).split(' ').filter(Boolean);
    // joined onto another line (a date line put on the role's header line); never onto a contact line that merely
    // contains the same letters (an e-mail address)
    const host = renderedLines.find((l) => { if (/@/.test(l)) return false; const ls = new Set(lineKey(l).split(' ')); return rk.length && rk.every((w) => ls.has(w)) && ls.size > rk.length; });
    if (host) {
      const prev = items.find((x) => x.kind === 'lines_joined' && x.after[0] === host);
      if (prev) prev.before.push(r); else items.push({ kind: 'lines_joined', before: [r], after: [host] });
      continue;
    }
    if (rk.length && rk.every((w) => allTokens.has(w))) {
      const parts = renderedLines.filter((l) => !/@/.test(l) && lineKey(l).split(' ').some((w) => rk.includes(w) && w.length > 3) && !origLines.some((o) => lineKey(o) === lineKey(l)));
      items.push({ kind: 'line_split', before: [r], after: parts.slice(0, 4) });
      parts.forEach((x) => used.add(x));
      continue;
    }
    items.push({ kind: 'unplaced', line: r });
  }
  for (const a of added) {
    if (used.has(a)) continue;
    if (HEADING_RE.test(a) && isSection(a)) continue; // a section heading the re-typesetting adds is reported with what moved under it
    if (!items.some((x) => Array.isArray(x.after) && x.after.includes(a))) items.push({ kind: 'line_restyled', before: '', after: a });
  }
  const oHead = (l, i) => HEADING_RE.test(l || '') && i > 0;
  const rHead = (l) => HEADING_RE.test(l || '') && isSection(l);
  for (const m of d.moved) items.push({ kind: 'line_moved', line: m, from_section: sectionOf(origLines, origLines.indexOf(m), oHead), to_section: sectionOf(renderedLines, renderedLines.indexOf(m), rHead) });
  // a line that kept its order but now sits under a new section heading has moved section too
  for (const h of d.added.filter((a) => HEADING_RE.test(a) && isSection(a))) {
    const at = renderedLines.indexOf(h);
    const under = renderedLines.slice(at + 1).find((l) => l && !rHead(l));
    if (under && !items.some((x) => x.kind === 'line_moved' && x.line === under)) items.push({ kind: 'line_moved', line: under, from_section: sectionOf(origLines, Math.max(0, origLines.findIndex((o) => lineKey(o) === lineKey(under))), oHead), to_section: h });
  }
  // one item per moved line (the same line read with and without its bullet is one move; a named section wins)
  const movedSeen = new Map();
  for (const x of items.filter((y) => y.kind === 'line_moved')) { const k = lineKey(x.line); const prev = movedSeen.get(k); if (!prev || (!prev.to_section && x.to_section)) movedSeen.set(k, x); }
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'line_moved' && movedSeen.get(lineKey(items[i].line)) !== items[i]) items.splice(i, 1);
  if (!items.length) return null;
  const n = (k) => items.filter((x) => x.kind === k).length;
  const say = [];
  for (const x of items.filter((y) => y.kind === 'heading_renamed')) say.push(`"${x.from}" is headed "${x.to}"`);
  for (const x of items.filter((y) => y.kind === 'line_moved')) say.push(`"${quoteLine(x.line.replace(/^[-•]\s*/, ''), 45)}" moved to ${x.to_section ? `"${x.to_section}"` : 'another section'}`);
  if (n('lines_joined')) say.push(`${n('lines_joined')} line${n('lines_joined') === 1 ? '' : 's'} joined to the line ${n('lines_joined') === 1 ? 'it belongs' : 'they belong'} to`);
  if (n('line_split')) say.push(`${n('line_split')} line${n('line_split') === 1 ? '' : 's'} split across sections`);
  if (n('line_restyled')) say.push(`${n('line_restyled')} line${n('line_restyled') === 1 ? '' : 's'} re-punctuated`);
  if (n('unplaced')) say.push(`${n('unplaced')} line${n('unplaced') === 1 ? '' : 's'} could not be placed — check before you send`);
  return { id: 'format', type: 'format', where: 'Whole résumé', before: '', after: '', items, requirement: null, why: `Formatting made consistent: ${say.join('; ')}. Your words are unchanged.`, default: 'applied', substantive: false };
}

/**
 * One item per role whose line order changed, with EVERY moved line (from → to) and the requirement that moved it.
 */
export function reorderChanges(base, variant, verdict, out = null) {
  const items = [];
  for (const e of base.experience || []) {
    const ve = (variant.experience || []).find((x) => x.id === e.id);
    if (!ve) continue;
    const oldIds = e.bullets.map((b) => b.id).filter((id) => ve.bullets.some((b) => b.id === id));
    const newIds = ve.bullets.map((b) => b.id).filter((id) => oldIds.includes(id));
    if (oldIds.join() === newIds.join()) continue;
    // every line whose place changed: the ones that moved up (and why), and the ones that shifted down to make room
    const moved = oldIds.filter((id, i) => newIds.indexOf(id) !== i).map((id) => {
      const b = e.bullets.find((x) => x.id === id);
      const reqs = ((verdict && verdict.bulletReqs.get(id)) || []).filter((r) => !r.soft);
      const row = reqs[0] ? ((out && out.matched_requirements) || []).find((m) => labelOf(m) === reqs[0].label) : null;
      return { text: b.text, from: e.bullets.findIndex((x) => x.id === id) + 1, to: ve.bullets.findIndex((x) => x.id === id) + 1, requirement: reqs[0] ? reqs[0].label : null, statement: row ? readableStatement(row, out) : null };
    });
    const up = moved.filter((m) => m.to < m.from && m.requirement).sort((a, b) => (b.from - b.to) - (a.from - a.to) || a.to - b.to);
    const where = [e.displayTitle || e.title, e.displayCompany || e.company].filter(Boolean).join(' · ');
    const lead = up[0] || null;
    const down = moved.filter((m) => m.to > m.from);
    const co = String(e.displayCompany || e.company || e.displayTitle || e.title).replace(/\s*\([^)]*\)/g, '').split(/,|\s\|\s/)[0].trim();
    const ask = lead && showLabel(lead.requirement, JSON.stringify(base.experience) + JSON.stringify(base.skills));
    const why = lead
      ? `They ask for ${ask}; your line "${quoteLine(lead.text)}" shows it, so it moves from line ${lead.from} to line ${lead.to} of your ${co} role${down.length ? `, and "${quoteLine(down[0].text, 40)}"${down.length > 1 ? ` and ${down.length - 1} other line${down.length === 2 ? '' : 's'}` : ''} move${down.length === 1 ? 's' : ''} down` : ''}. No words change.`
      : `Lines in your ${co} role change order; no words change.`;
    items.push({ id: `reorder:${e.id}`, type: 'reorder', where, before: oldIds.map((id) => e.bullets.find((b) => b.id === id).text).join('\n'), after: newIds.map((id) => e.bullets.find((b) => b.id === id).text).join('\n'), moved, requirement: lead ? lead.requirement : null, why, default: 'applied', substantive: up.length > 0, kind: 'reorder_lead' });
  }
  return items;
}

/** Every line that differs between the person's document and the tailored one and that no change lists. */
export function unlistedDifferences(originalText, tailoredText, changes) {
  const d = lineDiff(originalText, tailoredText);
  const keys = new Set();
  const addText = (t) => { for (const l of textLines(t)) keys.add(lineKey(l)); };
  for (const c of changes || []) {
    addText(c.before); addText(c.after);
    for (const m of c.moved || []) addText(m.text);
    if (c.heading) addText(c.heading);
    for (const x of c.items || []) { for (const k of ['before', 'after', 'line', 'from', 'to', 'from_section', 'to_section']) { const v = x[k]; if (Array.isArray(v)) v.forEach(addText); else addText(v); } }
  }
  const covered = (l) => { const k = lineKey(l); if (keys.has(k)) return true; for (const ck of keys) if (ck && k && (ck.includes(k) || k.includes(ck)) && Math.min(ck.length, k.length) >= 12) return true; return false; };
  return [...d.removed.map((l) => ({ kind: 'removed', line: l })), ...d.added.map((l) => ({ kind: 'added', line: l })), ...d.moved.map((l) => ({ kind: 'moved', line: l }))].filter((x) => !covered(x.line));
}

const SUBSTANTIVE_TYPES = new Set(['summary', 'rewrite', 'move', 'reorder', 'skills', 'cut']);
/**
 * THE charge rule (both entry points). Returns { charge, reason, sentence } — `sentence` is one specific line for the
 * screen: what the credit buys, or exactly why it is free.
 */
export function chargeDecision(args = {}) {
  const c = chargeDecisionCore(args);
  return { ...c, ...headlineFor(c, args) };
}
function chargeDecisionCore({ blocked = null, changes = [], visibility: vis = null, summaryDecision = null, jobTitle = '', company = '', topAsk = '', withheld = false, fitScore = null } = {}) {
  const job = roleName(jobTitle) ? `this ${roleName(jobTitle)} posting` : 'this posting';
  const at = company ? ` at ${company}` : '';
  if (blocked) return { charge: false, reason: blocked.reason, sentence: blocked.sentence };
  if (withheld) return { charge: false, reason: 'no_requirements', sentence: `${job.charAt(0).toUpperCase()}${job.slice(1)}${at} states too few requirements to tailor your résumé against, so no credit is used.` };
  const real = changes.filter((c) => c.default === 'applied' && c.substantive && SUBSTANTIVE_TYPES.has(c.type));
  if (!real.length) {
    const pending = changes.filter((c) => c.default === 'needs_ok').length;
    const seen = vis && vis.before && vis.before.labels && vis.before.labels.length ? vis.before.labels.slice(0, 3) : [];
    if (!seen.length && /strong|good/i.test(fitBand(fitScore) || '')) return { charge: false, reason: 'no_change', sentence: `Your résumé already fits ${job}${at} as written, so nothing of substance changed and no credit is used${pending ? ` (${pending} optional wording idea${pending === 1 ? '' : 's'} below)` : ''}.` };
    return { charge: false, reason: 'no_change', sentence: seen.length ? `Your summary, first skills line and top lines already show ${listJoin(seen)}, so for ${job}${at} nothing of substance changed and no credit is used${pending ? ` (${pending} optional wording idea${pending === 1 ? '' : 's'} below)` : ''}.` : `${topAsk ? `${job.charAt(0).toUpperCase()}${job.slice(1)}${at} asks for "${topAsk}", which no line on your résumé shows, and n` : 'N'}othing ${topAsk ? 'else ' : ''}on your résumé can be moved or reworded to show more of what it asks for, so no credit is used${pending ? ` (${pending} optional wording idea${pending === 1 ? '' : 's'} below)` : ''}.` };
  }
  const gained = vis && vis.after && vis.before && vis.after.shown > vis.before.shown;
  const sumMode = summaryDecision && summaryDecision.mode;
  const summaryFix = (sumMode === 'replace' || sumMode === 'add') && changes.some((c) => c.type === 'summary' && c.default === 'applied' && c.substantive);
  if (gained) {
    const fresh = vis.after.labels.filter((l) => !vis.before.labels.includes(l));
    return { charge: true, reason: 'visible_gain', sentence: `${vis.after.shown} of the ${vis.after.of} things ${job} asks for that your résumé proves now sit in your summary, first skills line or top lines, up from ${vis.before.shown}${fresh.length ? ` (${listJoin(fresh.slice(0, 3))} moved up)` : ''}.` };
  }
  if (summaryFix && sumMode === 'add') return { charge: true, reason: 'summary_added', sentence: `You had no summary; this one opens your résumé with ${listJoin((summaryDecision.named || []).slice(0, 3))} from ${job}, in your own words.` };
  if (summaryFix) return { charge: true, reason: 'summary_replaced', sentence: `Your summary now names ${listJoin((summaryDecision.named || []).slice(0, 3))} from ${job}, in your own words, where it said ${summaryDecision.namedBefore && summaryDecision.namedBefore.length ? `only ${listJoin(summaryDecision.namedBefore.slice(0, 2))}` : 'none of it'}.` };
  const seen2 = vis && vis.before && vis.before.labels ? vis.before.labels.slice(0, 3) : [];
  return { charge: false, reason: 'no_visible_gain', sentence: `${seen2.length ? `${cap1(listJoin(seen2))} already sit${seen2.length === 1 ? 's' : ''} where a recruiter reads first; the` : 'The'} edits below tidy your résumé for ${job}${at} but put nothing more of what it asks for up front, so no credit is used.` };
}

/**
 * THE tailored result, built the same way for the paid Optimize and the Studio's tailor (one rule, one shape):
 *   { tailored, blocked, field_match, employer }
 * `tailored` = { doc, text, pages, score_before, score_after, changes, kept_as_is, visibility, charge, field_match }.
 * With a different field nothing is changed (the doc is the person's own); a failed hard gate keeps the changes, free.
 */
/**
 * Un-crashable: any failure inside degrades to "document kept as written", free, with the verdict intact.
 */
export function buildTailored(args) {
  try { return buildTailoredUnsafe(args); } catch (err) {
    const { base, plan, out, original = '', renderText } = args || {};
    let text = String(original || '');
    if (!text.trim()) { try { text = renderText(base); } catch { text = ''; } }
    const sentence = 'Something in this résumé could not be tailored safely, so it is kept exactly as you wrote it and no credit is used.';
    const charge = { charge: false, reason: 'kept_as_written', sentence, will_charge: false, reason_sentence: sentence };
    let fm = null; try { fm = fieldMatch(out, plan, base, args.jobTitle || ''); } catch { fm = null; }
    return { tailored: { doc: base, text, untouched: true, pages: 1, score_before: out ? out.fit_score : null, score_after: out ? out.fit_score : null, changes: [], kept_as_is: sentence, visibility: { of: 0, before: 0, after: 0, labels_before: [], labels_after: [] }, charge, field_match: fm, error: String((err && err.message) || err).slice(0, 120) }, blocked: null, field_match: fm, different: false, failed: true };
  }
}
function buildTailoredUnsafe({ base, plan, variant, out, original = '', jobTitle = '', employer = '', renderText }) {
  const fm = fieldMatch(out, plan, base, jobTitle);
  const blocked = out && out.fit_score != null ? blockedFor(out, fm, base, { jobTitle, employer }) : null;
  const different = !!(blocked && blocked.reason === 'different_field');
  const sd = plan.summaryDecision;
  const visBefore = visibility(base, out);
  const top = ((out && out.unsupported_requirements) || []).filter((m) => !m.soft && m.importance === 'required' && askableGap({ label: labelOf(m), soft: m.soft, importance: m.importance, term: m.term }))[0];
  // blocked (a different field or a failed hard gate): there is NO tailored version — the person's document, untouched
  if (blocked) {
    const charge = chargeDecision({ blocked, changes: [], jobTitle, company: employer });
    return { tailored: { doc: base, text: String(original || '').trim() ? String(original) : renderText(base), untouched: true, pages: (plan.strategy && plan.strategy.pages) || 1, score_before: plan.score ? plan.score.before : null, score_after: plan.score ? plan.score.before : null, changes: [], kept_as_is: charge.sentence, visibility: { of: visBefore.of, before: visBefore.shown, after: visBefore.shown, labels_before: visBefore.labels, labels_after: visBefore.labels }, charge: withAliases(charge), field_match: fm }, blocked, field_match: fm, different };
  }
  // the person's own section headings stay as they wrote them ("What I've done" is their voice); a heading no applicant
  // system may recognise is a needs_ok proposal. A summary that replaces an objective takes the heading "Summary".
  const summaryNew = sd && (sd.mode === 'replace' || sd.mode === 'add');
  const heads = String(original || '').trim() ? personHeadings(original, renderText(base)) : [];
  const keepHeads = (doc, forVariant) => {
    const d = JSON.parse(JSON.stringify(doc));
    d.meta = d.meta || {};
    d.meta.sectionTitles = { ...(d.meta.sectionTitles || {}) };
    for (const h of heads) { if (forVariant && h.kind === 'summary' && summaryNew) continue; d.meta.sectionTitles[h.kind] = h.person; }
    return d;
  };
  const base2 = keepHeads(base, false);
  const variant2 = keepHeads(variant, true);
  // the person's contact line keeps its order and separators when it carries the same details
  const contactOf = (lines) => lines.slice(0, 5).find((l) => /@|\(\d{3}\)|\d{3}[-. ]\d{3}[-. ]\d{4}/.test(l));
  const origContact = contactOf(String(original || '').split('\n').map((l) => l.trim()));
  const textOf = (doc) => {
    const t = renderText(doc);
    const rc = contactOf(t.split('\n'));
    return origContact && rc && lineKey(rc) === lineKey(origContact) ? t.replace(rc, origContact) : t;
  };
  const fmt = String(original || '').trim() ? formatChanges(String(original), textOf(base2)) : null;
  const headingChanges = [];
  for (const h of heads) {
    if (h.kind === 'summary' && summaryNew) {
      if (lineKey(h.person) !== lineKey(h.rendered)) headingChanges.push({ id: `heading:${h.kind}`, type: 'heading', where: h.person, before: h.person.toUpperCase(), after: h.rendered, requirement: null, why: `Your "${h.person}" now holds a summary of what you bring, so its heading says "Summary".`, default: 'applied', substantive: false, apply: { kind: h.kind, to: titleCase(h.rendered) } });
      continue;
    }
    if (isStandardHeading(h.person)) continue;
    headingChanges.push({ id: `heading:${h.kind}`, type: 'heading', where: h.person, before: h.person, after: titleCase(h.rendered), requirement: null, why: `Rename "${h.person}" to "${titleCase(h.rendered)}" — some applicant systems only recognise standard headings. Your call; it stays as you wrote it unless you accept.`, default: 'needs_ok', substantive: false, apply: { kind: h.kind, to: titleCase(h.rendered) } });
  }
  const planChanges = (plan.changes || []).map((c) => ({ ...c, substantive: !!c.substantive }));
  // a summary added, replaced or left off carries its section heading with it (the heading line is part of the change)
  const personSummary = heads.find((h) => h.kind === 'summary');
  for (const c of planChanges) if (c.type === 'summary') {
    if (!String(c.after || '').trim()) c.heading = personSummary ? personSummary.person : 'SUMMARY';
    else if (!String(c.before || '').trim() || summaryNew) c.heading = 'SUMMARY';
  }
  const changes = [...(fmt ? [fmt] : []), ...headingChanges, ...planChanges];
  const visAfter = visibility(variant, out);
  const charge = chargeDecision({ blocked: null, changes, visibility: { before: visBefore, after: visAfter }, summaryDecision: sd, jobTitle, company: employer, topAsk: top ? requirementText(top, out) : '', withheld: !out || out.fit_score == null, fitScore: out ? out.fit_score : null });
  // the ONE apply path for the screen: every accept / undo re-applies `plan` to `base` with applyTailorPlan(base, plan,
  // { rewrites, prompts, answers, decisions }) — never patches text on the finished document. `base` carries the person's
  // own headings so a re-apply keeps them.
  const baseForApply = keepHeads(base, true);
  const tailored = {
    doc: variant2,
    text: textOf(variant2),
    plan: applyPlanData(plan),
    base: baseForApply,
    pages: (plan.strategy && plan.strategy.pages) || 1,
    score_before: plan.score ? plan.score.before : null,
    score_after: plan.score ? plan.score.after : null,
    changes,
    kept_as_is: charge.charge ? null : charge.sentence,
    visibility: { of: visBefore.of, before: visBefore.shown, after: visAfter.shown, labels_before: visBefore.labels, labels_after: visAfter.labels },
    charge: withAliases(charge),
    field_match: fm,
  };
  return { tailored, blocked: null, field_match: fm, different: false };
}
const titleCase = (h) => String(h || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
// the screen's names for the decision, beside the engine's (both stable)
const withAliases = (c) => ({ ...c, will_charge: !!c.charge, reason_sentence: c.sentence });

/**
 * The requirement list the result screen renders — the reader's STATEMENTS, never keyword chips:
 * [{ id, text, status: 'shown'|'partly'|'not_shown'|'cannot_tell', evidence: string|null, why: string|null, missing: [], importance, kind }]
 * A "shown" statement whose only evidence qualifies what it names ("CPA Candidate") is printed as 'partly'.
 */
export function screenStatements(out) {
  const st = Array.isArray(out && out.statements) ? out.statements : [];
  return st.map((s) => {
    const ev = (s.evidence || []).find((x) => x && (x.line || x.why)) || null;
    let status = s.status;
    let missing = Array.isArray(s.missing) ? [...s.missing] : [];
    if (status === 'shown' && ev && ev.line && qualifiedProof(s.text, ev.line) || (status === 'shown' && ev && ev.line && QUALIFIED_LINE_RE.test(ev.line) && (s.evidence || []).every((x) => !x.line || QUALIFIED_LINE_RE.test(x.line)))) { status = 'partly'; missing = [...missing, 'held, not in progress']; }
    return { id: s.id, text: s.text, status, evidence: ev && ev.line ? cleanLine(ev.line) : null, why: ev && ev.why ? ev.why : null, missing, importance: s.importance, kind: s.kind };
  });
}
const QUALIFIED_LINE_RE = /\b(?:candidate|exam\b|pursuing|in progress|working toward|eligible)\b/i;

// The screen's two lines: a short headline and the detail (round 3, "the sentence is too long for a headline").
function headlineFor(c, { visibility: vis = null, summaryDecision = null } = {}) {
  const fresh = vis && vis.after && vis.before ? vis.after.labels.filter((l) => !vis.before.labels.includes(l)) : [];
  const named = ((summaryDecision && summaryDecision.named) || []).slice(0, 3);
  switch (c.reason) {
    case 'visible_gain': return { headline: `Now up front: ${vis.after.shown} of the ${vis.after.of} things they ask for that your résumé proves — it was ${vis.before.shown}.`, detail: fresh.length ? `${cap1(listJoin(fresh.slice(0, 3)))} moved into your first lines.` : 'Your strongest proof moved into your first lines.' };
    case 'summary_added': return { headline: 'Added a summary built from what they ask for.', detail: named.length ? `It names ${listJoin(named)}, in your own words.` : c.sentence };
    case 'summary_replaced': return { headline: 'Your summary now leads with what they ask for.', detail: named.length ? `It names ${listJoin(named)}, in your own words.` : c.sentence };
    case 'different_field': return { headline: 'No credit used — this is a different line of work.', detail: c.sentence };
    case 'hard_gate': return { headline: 'No credit used — a stated requirement no rewording can meet.', detail: c.sentence };
    case 'no_requirements': return { headline: 'No credit used — the posting states too few requirements.', detail: c.sentence };
    case 'no_change': return { headline: 'No credit used — your résumé already shows what they ask for up front.', detail: c.sentence };
    case 'no_visible_gain': return { headline: 'No credit used — nothing more of what they ask for moved up front.', detail: c.sentence };
    default: return { headline: 'No credit used.', detail: c.sentence };
  }
}

// What the screen needs to re-apply the plan (applyTailorPlan) — and nothing a person never reads (the legacy
// analysis' recommendation titles are not screen copy).
function applyPlanData(plan) {
  const keep = ['version', 'optimizer', 'verdictDriven', 'job', 'decisions', 'roles', 'skills', 'strategy', 'ctx', 'rewrites', 'applyRewrites', 'prompts', 'terminology', 'applyTerminology', 'changes', 'summaryDecision', 'moves', 'cuts', 'score'];
  const out = {};
  for (const k of keep) if (plan && plan[k] !== undefined) out[k] = plan[k];
  return out;
}

// the reader's gate line can arrive with an unclosed "(" ("10+ years in tech or SaaS (as an Account Executive; your…"):
// an unmatched bracket is dropped rather than printed
export function balanceBrackets(t) {
  let s = String(t || '');
  for (let guard = 0; guard < 5 && (s.split('(').length - 1) > (s.split(')').length - 1); guard++) {
    const i = s.lastIndexOf('(');
    s = `${s.slice(0, i)}${s.slice(i + 1)}`.replace(/\s{2,}/g, ' ');
  }
  for (let guard = 0; guard < 5 && (s.split(')').length - 1) > (s.split('(').length - 1); guard++) {
    const i = s.indexOf(')');
    s = `${s.slice(0, i)}${s.slice(i + 1)}`;
  }
  return s;
}
