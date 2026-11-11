// The person's own answers, applied to the verdict (X, 2026-11-10). The result screens send
//   confirmed: [{ statementId, answer: 'yes' | 'no', line? }]
// for lines only the person can answer (hours, lifting, authorisation, a trait — `status: 'cannot_tell'`) and for the
// question "Closest line we found: '…'. Does this show it?" (`statement.candidate = { line, why }`, `line` sent back).
//
// applyConfirmations(statements, constraints, confirmed, { resumeText }) → { statements, constraints, confirmations, applied }
//   Validation first — an entry is used only when its statementId is a statement of THIS reading, its answer is 'yes' or
//   'no', and (for a candidate) its line is a line of THIS résumé and that statement's own candidate line. Anything else is
//   dropped silently and counted in `confirmations.ignored`.
//   Effects (a statement the judge already calls shown is never changed; nothing is ever written into the résumé):
//     yes on cannot_tell  → shown, by:'you', evidence [{ why: 'You said yes.' }]; its constraint counts as met
//     no  on cannot_tell  → not_shown, by:'you'; its constraint reads as not met in its own words ("You said you can't …")
//     yes on a candidate  → shown, by:'you', evidence [{ line: <the résumé line>, why: 'You said this line shows it.' }]
//     no  on a candidate  → the candidate is removed; the status stays
//     yes + claim:true on a not_shown / partly line (a duty, skill, tool, language, credential or degree the résumé does
//                         not show, though the person has done it / holds it) → shown, by:'you', claimed:true, evidence
//                         [{ why: CLAIM_WHY }] — never a résumé line; its constraint reads as met in "You said you hold …"
//                         words. A years ask is never claimable (years come from dates): ignored and counted.
//     no  + claim:true    → the status stays; the line is settled (settled:true, no candidate) — no longer asked about
//   Every changed statement and constraint carries `by: 'you'`, so no tool says "your résumé shows" for it.
import { createHash } from 'node:crypto';
import { GATE_KINDS } from './constraints.js';

export const MAX_CONFIRMATIONS = 200;
const ID_RE = /^[a-z]\d{1,4}$/i;
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// a line compared as the person wrote it: whitespace normalised, a leading bullet glyph ignored
const lineKey = (t) => norm(t).replace(/^[•●▪◦*·\-–—]+\s*/, '').toLowerCase();

/** The entries that are well formed, one per statement (the last answer wins), in a stable order. */
export function cleanConfirmations(confirmed) {
  if (!Array.isArray(confirmed)) return [];
  const by = new Map();
  for (const e of confirmed.slice(0, MAX_CONFIRMATIONS * 5)) {
    if (!e || typeof e !== 'object') continue;
    const id = typeof e.statementId === 'string' ? e.statementId.trim() : '';
    const answer = typeof e.answer === 'string' ? e.answer.trim().toLowerCase() : '';
    if (!ID_RE.test(id) || (answer !== 'yes' && answer !== 'no')) continue;
    const line = typeof e.line === 'string' && e.line.trim() ? norm(e.line).slice(0, 600) : null;
    // a claim ("I've done this" / "I hold this") is its own kind of answer; it never carries a line
    if (e.claim === true) by.set(id, { statementId: id, answer, claim: true });
    else by.set(id, { statementId: id, answer, ...(line ? { line } : {}) });
  }
  return [...by.values()].sort((a, b) => a.statementId.localeCompare(b.statementId)).slice(0, MAX_CONFIRMATIONS);
}

/** A short stable hash of the answers (for cache keys): '' when there are none. */
export function confirmationsKey(confirmed) {
  const c = cleanConfirmations(confirmed);
  return c.length ? createHash('sha256').update(JSON.stringify(c)).digest('base64url').slice(0, 16) : '';
}

// "lift up to 50 pounds" → "You said you can't lift up to 50 pounds."; a trait / schedule line said as it stands
function cantSentence(st) {
  const a = norm((st.ask && st.ask.text) || st.text).replace(/[.;:,]+$/, '');
  const t = a.charAt(0).toLowerCase() + a.slice(1);
  return /^(?:work|lift|stand|travel|be|pass|meet|obtain|hold|read|speak|follow|communicate|walk|bend|climb|drive|sit|push|pull|carry|handle|use|operate)\b/i.test(t)
    ? `You said you can't ${t}.` : `You said no to "${a.charAt(0).toUpperCase()}${a.slice(1)}".`;
}
export const CLAIM_WHY = 'You said you have done this — it is not on your résumé yet.';
// a credential is held, not done ("I hold this"): a ServSafe Manager certification, a license, a degree
export const CLAIM_HOLD_WHY = 'You said you hold this — it is not on your résumé yet.';
const CRED_RE = /\b(?:licen[cs]e[ds]?|certif\w*|certificate|registered|degree|diploma|bachelor|master|associate'?s?\s+degree|ged|cpr|bls|acls|cdl|servsafe)\b/i;
const credentialLine = (st, cons) => cons.some((c) => c.statementId === st.id && /^(?:certification|license|licence|credential|degree|education)$/.test(String(c.kind))) || CRED_RE.test(String(st.text || ''));
const YEARS_RE = /\b\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\(\d+\)\s+)?years?\b/i;
// "You said you hold a ServSafe Manager certification — add it to your résumé."
function claimSentence(c, st) {
  const label = norm(c.label || st.text).replace(/[.;:,]+$/, '');
  const art = /^(?:an?|the|\d)\b/i.test(label) || /s$/i.test(label.split(' ')[0]) ? '' : /^[aeiou]/i.test(label) ? 'an ' : 'a ';
  if (/^(?:certification|license|licence|credential)$/.test(String(c.kind))) return `You said you hold ${art}${label} — add it to your résumé.`;
  if (/^(?:degree|education)$/.test(String(c.kind))) return `You said you have ${art}${label} — add it to your résumé.`;
  return `You said you have done this: "${norm(st.text).replace(/[.;:,]+$/, '')}" — add it to your résumé.`;
}
function canSentence(st) {
  const a = norm((st.ask && st.ask.text) || st.text).replace(/[.;:,]+$/, '');
  return `You said yes to "${a.charAt(0).toUpperCase()}${a.slice(1)}".`;
}

export function applyConfirmations(statements, constraints, confirmed, { resumeText = '' } = {}) {
  const sts = Array.isArray(statements) ? statements : [];
  const cons = Array.isArray(constraints) ? constraints : [];
  const raw = Array.isArray(confirmed) ? confirmed : [];
  if (!raw.length) return { statements: sts, constraints: cons, confirmations: { applied: 0, ignored: 0 }, applied: [] };
  const entries = cleanConfirmations(raw);
  const byId = new Map(sts.map((s) => [s.id, s]));
  const resumeLines = new Map();
  for (const l of String(resumeText || '').split('\n')) { const k = lineKey(l); if (k && !resumeLines.has(k)) resumeLines.set(k, norm(l)); }
  const outSt = new Map();
  const conPatch = new Map(); // statementId → 'yes' | 'no'
  const applied = [];
  const yearsIds = new Set(cons.filter((c) => c.kind === 'years' && c.statementId).map((c) => c.statementId));
  for (const e of entries) {
    const st = byId.get(e.statementId);
    if (!st || st.status === 'shown' || st.kind === 'promise') continue;
    if (e.claim) {
      // only a line the reading calls not shown or partly; never a years ask (the person fixes dates, not a tick)
      if (st.status !== 'not_shown' && st.status !== 'partly') continue;
      if (yearsIds.has(st.id) || YEARS_RE.test(String(st.text || ''))) continue;
      const next = { ...st };
      delete next.candidate;
      if (e.answer === 'yes') { Object.assign(next, { status: 'shown', by: 'you', claimed: true, evidence: [{ why: credentialLine(st, cons) ? CLAIM_HOLD_WHY : CLAIM_WHY }], missing: [] }); conPatch.set(st.id, 'claim'); }
      else next.settled = true;
      outSt.set(st.id, next);
      applied.push(e);
      continue;
    }
    if (e.line) {
      // a candidate answer: the line must be this statement's own candidate AND a line of this résumé
      const cand = st.candidate && st.candidate.line;
      if (!cand || lineKey(cand) !== lineKey(e.line) || !resumeLines.has(lineKey(e.line))) continue;
      const next = { ...st };
      delete next.candidate;
      if (e.answer === 'yes') Object.assign(next, { status: 'shown', by: 'you', evidence: [{ line: resumeLines.get(lineKey(e.line)), why: 'You said this line shows it.' }], missing: [] });
      outSt.set(st.id, next);
      applied.push(e);
      continue;
    }
    if (st.status !== 'cannot_tell') continue;
    const next = e.answer === 'yes'
      ? { ...st, status: 'shown', by: 'you', evidence: [{ why: 'You said yes.' }], missing: [] }
      : { ...st, status: 'not_shown', by: 'you', evidence: [{ why: cantSentence(st) }], missing: [] };
    outSt.set(st.id, next);
    conPatch.set(st.id, e.answer);
    applied.push(e);
  }
  const confirmations = { applied: applied.length, ignored: raw.length - applied.length };
  if (!applied.length) return { statements: sts, constraints: cons, confirmations, applied };
  const newSts = sts.map((s) => outSt.get(s.id) || s);
  const newCons = cons.map((c) => {
    const ans = c.statementId ? conPatch.get(c.statementId) : null;
    if (!ans || c.status === 'met') return c;
    const st = byId.get(c.statementId);
    if (ans === 'claim') { if (c.kind === 'years') return c; const said = claimSentence(c, st); return { ...c, status: 'met', grade: 'met', statementStatus: 'shown', factor: 1, caps: false, by: 'you', claimed: true, message: said, ...(c.sentence ? { sentence: said } : {}) }; }
    if (ans === 'yes') { const said = canSentence(st); return { ...c, status: 'met', grade: 'met', statementStatus: 'shown', factor: 1, caps: false, by: 'you', message: said, ...(c.sentence ? { sentence: said } : {}) }; }
    // a "no": a hard gate (degree, years, a credential…) now caps in its own words; any other required condition (hours,
    // lifting) lowers the score — the person has said it does not fit
    const hard = GATE_KINDS.has(c.kind) && (c.gate || c.importance === 'required');
    // (a physical demand or who may work there weighs more than an hours line, which is often one option of several)
    const weight = c.importance === 'preferred' ? 0.95 : /^(?:physical|work_authorization|eligibility|license|licence|language)$/.test(String(c.kind)) ? 0.7 : c.kind === 'schedule' ? 0.85 : 0.9;
    const factor = hard ? c.factor : Math.min(Number.isFinite(c.factor) ? c.factor : 1, weight);
    const said = cantSentence(st);
    return { ...c, status: 'unmet', grade: 'not_shown', statementStatus: 'not_shown', factor, caps: hard, by: 'you', message: said, ...(c.sentence ? { sentence: said } : {}) };
  });
  return { statements: newSts, constraints: newCons, confirmations, applied };
}
