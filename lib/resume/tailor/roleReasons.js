// Why each job is on the tailored résumé (owner, 2026-11-12: "it should explain why it keep each job on the resume in
// the breakdown"). One plain sentence per role, built only from what the version does and what the ONE reading says:
//   - what the page does with the role: kept in full / kept N of its lines / one line under Additional Experience / left off
//   - which of the posting's listed things the role's OWN lines show (displayed statements, status `shown`, whose evidence
//     line is one of that role's lines — never a statement the résumé does not show, never a claim, never a guess)
//   - the rule that keeps a role that shows none of it: it is the current job, or it fills a stretch of the timeline that
//     would otherwise be a gap, or there is room on the page.
// Pure; no I/O.
import { cleanLine } from './verdict.js';
import { formatRange, fromToken } from '../parse/dates.js';
import { statementLabel } from './paid.js';

const flat = (s) => cleanLine(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** A statement line belongs to a role when it IS one of the role's lines (or a whole line inside a longer one). */
function lineOfRole(line, lines) {
  const l = flat(line);
  if (!l) return false;
  return lines.some((x) => x && (x === l || (l.length >= 16 && (x.includes(l) || l.includes(x)))));
}

/** How many listed statements (shown or partly) one line shows. */
export function lineStatementCount(text, out) {
  const lines = [flat(text)];
  return (Array.isArray(out && out.statements) ? out.statements : []).filter((st) => st && st.display !== false && st.kind !== 'promise' && (st.status === 'shown' || st.status === 'partly') && !st.claimed
    && (st.evidence || []).some((ev) => ev && ev.line && lineOfRole(ev.line, lines))).length;
}

/** How many listed statements (shown or partly) one role's own lines show — 0 means the role shows nothing they list. */
export function roleStatementCount(e, out) {
  if (!e) return 0;
  const lines = (e.bullets || []).map((b) => flat(b.text));
  const header = flat([e.displayTitle || e.title, e.displayCompany || e.company].filter(Boolean).join(' '));
  return (Array.isArray(out && out.statements) ? out.statements : []).filter((st) => st && st.display !== false && st.kind !== 'promise' && (st.status === 'shown' || st.status === 'partly') && !st.claimed
    && (st.evidence || []).some((ev) => ev && ev.line && (lineOfRole(ev.line, lines) || (header && flat(ev.line).includes(header))))).length;
}

function months(e, nowM) {
  const at = (tok, end) => { const d = fromToken(tok); if (d === 'present') return nowM; if (!d || !d.y) return null; return d.y * 12 + (d.m ? d.m - 1 : end ? 11 : 0); };
  const s = at(e.start, false);
  const en = e.end === 'present' ? nowM : at(e.end, true) ?? s;
  return s == null || en == null ? null : [s, en];
}
/** Months in the last five years that only this role covers (removing it would leave them empty). */
function onlyCovered(e, all, nowM) {
  const span = months(e, nowM);
  if (!span) return 0;
  const others = all.filter((x) => x !== e).map((x) => months(x, nowM)).filter(Boolean);
  let n = 0;
  for (let m = Math.max(span[0], nowM - 59); m <= Math.min(span[1], nowM); m++) if (!others.some(([a, b]) => m >= a && m <= b)) n++;
  return n;
}

/**
 * @param {{ base: object, variant: object, out: object, employer?: string, now?: Date }} a
 * @returns {{ itemId, title, company, decision: 'full'|'trimmed'|'condensed'|'dropped', shown: number, of: number, labels: string[], sentence: string }[]}
 */
export function roleReasons({ base, variant, out, employer = '', now = new Date() }) {
  if (!base || !variant || !Array.isArray(base.experience)) return [];
  const sts = (Array.isArray(out && out.statements) ? out.statements : []).filter((s) => s && s.display !== false && s.kind !== 'promise');
  const of = typeof (out && out.requirement_count) === 'number' ? out.requirement_count : sts.length;
  const nowM = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const who = employer || 'this posting';
  const condensed = new Set(((variant.meta && variant.meta.provenance) || []).filter((p) => p && p.kind === 'condense_role').map((p) => p.itemId));
  const rows = [];
  for (const e of base.experience) {
    const title = String(e.displayTitle || e.title || '').trim();
    const company = String(e.displayCompany || e.company || '').trim();
    if (!title && !company) continue;
    const ve = (variant.experience || []).find((x) => x.id === e.id);
    const total = (e.bullets || []).length;
    const keptTexts = ve ? (ve.bullets || []).map((b) => b.text) : [];
    const decision = ve ? (keptTexts.length >= total ? 'full' : 'trimmed') : condensed.has(e.id) ? 'condensed' : 'dropped';
    // what this role's lines show — on the page (kept lines) for a role that is on it, else its own lines
    const header = flat([title, company].filter(Boolean).join(' '));
    const lines = (decision === 'full' || decision === 'trimmed' ? keptTexts : (e.bullets || []).map((b) => b.text)).map(flat);
    const showsIt = (st) => (st.evidence || []).some((ev) => ev && ev.line && (lineOfRole(ev.line, lines) || (header && flat(ev.line).includes(header))));
    const shownSt = sts.filter((st) => st.status === 'shown' && !st.claimed && showsIt(st));
    const partSt = sts.filter((st) => st.status === 'partly' && !st.claimed && showsIt(st));
    const labels = [...new Set(shownSt.map((st) => statementLabel(st, out, base)).filter(Boolean))].slice(0, 3);
    const n = shownSt.length, p = partSt.length;
    const named = labels.length ? ` (${listJoin(labels)})` : '';
    const showsSentence = n
      ? `${n} of the ${of} things ${who} lists${named}${p ? `, and part of ${p} more` : ''}`
      : p ? `part of ${p} of the ${of} things ${who} lists` : '';
    const work = title ? `your ${title} work${company ? ` at ${company}` : ''}` : `your work at ${company}`;
    const range = formatRange(e.start, e.end) || e.dateText || '';
    const current = e.end === 'present';
    const gap = onlyCovered(e, base.experience, nowM) >= 3;
    let sentence;
    if (decision === 'full' || decision === 'trimmed') {
      const head = decision === 'full' ? 'Kept in full' : `Kept ${keptTexts.length} of its ${total} lines`;
      const cut = decision === 'trimmed' ? `; the other ${total - keptTexts.length} say the least about this job and are left off to keep the page to its length` : '';
      if (showsSentence) sentence = `${head}: ${work} shows ${showsSentence}${cut}.`;
      else if (current) sentence = `${head}: it is your current job, so it stays on the page — though none of its lines shows what ${who} lists${cut}.`;
      else if (gap) sentence = `${head}: none of its lines shows what ${who} lists, but it covers ${range || 'part of your history'}, so your work history has no gap${cut}.`;
      else sentence = `${head}: none of its lines shows what ${who} lists; there is room on the page, so it stays as part of your work history${cut}.`;
    } else if (decision === 'condensed') {
      sentence = showsSentence
        ? `Condensed to one line under Additional Experience, so the jobs that show the most of what ${who} lists lead the page; its full lines stay in your base résumé.`
        : `Condensed to one line under Additional Experience: it shares little with this job — none of its lines shows what ${who} lists — but it ${range ? `covers ${range}` : 'stays on the page'}, so there is no gap in your history.`;
    } else {
      sentence = `Left off this version: none of its lines shows what ${who} lists${gap ? '' : ', and leaving it off opens no gap in your history'}.`;
    }
    rows.push({ itemId: e.id, title, company, decision, shown: n, partly: p, of, labels, sentence });
  }
  return rows;
}
