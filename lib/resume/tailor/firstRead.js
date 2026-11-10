// The first read, and the planner that fills it (T3 round 5, 2026-11-10).
//
// FIRST READ — what a recruiter reads before deciding to read on, defined ONCE (paid.js `visibility` counts it, the
// charge rule decides on it, the planner maximises it):
//   the summary · the first skills line · the first K = 3 lines of the latest role · the first line of the role before it
// (the roles as printed; a career note is never a role).
//
// THE PLANNER works on the VERDICT, not on keywords: the posting's displayed statements and, for every shown / partly
// one, the person's own résumé line the verdict cites as its evidence. It orders bullets INSIDE each role so the evidence
// lines lead — required before duties before preferred, a line proving two statements before one proving one, a line
// with a number before one without — never moving a bullet to another role, never rewriting or dropping one. It then
// SEARCHES the candidates (the plan as built, the planner's order, with and without the summary change) with the same
// `visibility` the charge rule uses, and keeps the one that puts the most displayed statements in the first read (ties:
// fewer changes). "Charged" and "really better" are the same fact by construction.
import { isGapNote, cleanLine, bulletRank, contentStems } from './verdict.js';

export const FIRST_READ = { latestLines: 3, previousLines: 1 };

/**
 * The two roles a recruiter reads first: the first two roles AS PRINTED (career notes excluded). In a chronological
 * document that is the latest role and the one before it; in a document the person ordered themselves it is the role
 * they put on top — which is what the recruiter actually reads (Tasha lists her marketing internship above her current
 * barista job; the internship is her first read).
 */
export function firstReadRoles(doc) {
  return ((doc && doc.experience) || []).filter((e) => !isGapNote(e) && (e.bullets || []).length).slice(0, 2);
}
/** The first-read lines of a document (cleaned). */
export function firstRead(doc) {
  const lines = [];
  if (doc && doc.basics && doc.basics.summary) lines.push(...String(doc.basics.summary).split(/(?<=[.!?])\s+/));
  const g = ((doc && doc.skills) || [])[0];
  if (g && g.items && g.items.length) lines.push(g.items.join(', '));
  const [latest, previous] = firstReadRoles(doc);
  if (latest) for (const b of latest.bullets.slice(0, FIRST_READ.latestLines)) lines.push(b.text);
  if (previous) for (const b of previous.bullets.slice(0, FIRST_READ.previousLines)) lines.push(b.text);
  return lines.map(cleanLine).filter(Boolean);
}

const flat = (s) => cleanLine(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const IMPORTANCE = (st) => (st.kind === 'duty' ? 2 : st.importance === 'preferred' || st.kind === 'preferred' ? 1 : st.importance === 'required' || st.kind === 'requirement' ? 3 : 1);
const hasNumber = (t) => /\d/.test(String(t || '').replace(/\b(?:19|20)\d{2}\b/g, ''));

const STOPS = new Set(['with', 'from', 'that', 'this', 'your', 'their', 'have', 'will', 'work', 'working', 'able', 'ability', 'skills', 'experience', 'other', 'such', 'including', 'team', 'teams', 'shift', 'shifts', 'assigned', 'duties', 'related', 'within', 'across', 'ensure', 'support', 'perform', 'provide', 'maintain', 'responsible']);
const stems = (t) => [...new Set(contentStems(t).filter((w) => w.length >= 3 && !STOPS.has(w) && !/^(?:the|and|for|our|you|any|all|its|can|may|are|has|was|who|not|but|per|etc|get|use)$/.test(w)))];
/** The line says the statement's own words: two shared content words, or one when the statement has three or fewer. */
export function saysIt(statement, line) {
  const a = stems(statement), b = new Set(stems(line));
  const shared = a.filter((w) => b.has(w)).length;
  return shared >= 2 || (shared >= 1 && a.length <= 3);
}

/**
 * The displayed statements each bullet is evidence for: the verdict's cited line (exact), or a fact of that statement
 * the verdict located on the bullet (verdict.bulletReqs rows carry the statementId).
 * → Map<bulletId, statement[]>
 */
export function statementsByBullet(doc, out, verdict) {
  const sts = (Array.isArray(out && out.statements) ? out.statements : []).filter((s) => s && s.display !== false && s.kind !== 'promise' && (s.status === 'shown' || s.status === 'partly'));
  const byId = new Map(sts.map((s) => [s.id, s]));
  const map = new Map();
  for (const e of (doc && doc.experience) || []) for (const b of e.bullets || []) {
    const f = flat(b.text);
    // the verdict's cited line, trusted for ORDER only when it says the statement's own words (two shared content words, or
    // one when the statement is short): "Worked during COVID surge…" never leads as proof of "Coordinate VA-to-DoD
    // patient transfers" (round 5 read)
    const got = sts.filter((s) => (s.evidence || []).some((ev) => ev && ev.line && flat(ev.line) === f) && saysIt(s.text, b.text));
    for (const r of (verdict && verdict.bulletReqs.get(b.id)) || []) { const s = r.statementId && byId.get(r.statementId); if (s && !got.includes(s) && saysIt(s.text, b.text)) got.push(s); }
    if (got.length) map.set(b.id, got);
  }
  return map;
}

/** A bullet's rank for the first read: what it proves (importance, how many statements), then a number. */
export function bulletScore(stsOfBullet, text, rank = 0) {
  if (!stsOfBullet || !stsOfBullet.length) return 0;
  const best = Math.max(...stsOfBullet.map(IMPORTANCE));
  // within the same importance, a core duty or skill before a tool ("Advanced Excel" never lifts above month-end close)
  return best * 1000 + rank * 100 + Math.min(stsOfBullet.length, 5) * 10 + (hasNumber(text) ? 1 : 0);
}

/**
 * The planner's bullet order for one role: evidence lines first by score (stable), every other line after in the
 * person's order. Only the lines that are kept are ordered (the page budget already decided what is kept).
 */
export function plannedOrder(role, keptIds, sb, verdict = null) {
  const kept = keptIds.filter((id) => role.bullets.some((b) => b.id === id));
  const pos = new Map(role.bullets.map((b, i) => [b.id, i]));
  const scored = kept.map((id) => { const b = role.bullets.find((x) => x.id === id); return { id, s: bulletScore(sb.get(id), b.text, verdict ? bulletRank(verdict, id) : 0), i: pos.get(id) }; });
  const proof = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i);
  const rest = scored.filter((x) => x.s === 0).sort((a, b) => a.i - b.i);
  return [...proof, ...rest].map((x) => x.id);
}

/**
 * A first-read role's order: the K slots are filled greedily by the line that adds the most NOT-yet-covered statements
 * (weighted by importance), ties by the line's own score; then every other proof line by score; then the rest in the
 * person's order. Updates `covered` with what the slots show.
 */
export function coverageOrder(role, keptIds, sb, verdict, covered, slots) {
  const kept = keptIds.filter((id) => role.bullets.some((b) => b.id === id));
  const pos = new Map(role.bullets.map((b, i) => [b.id, i]));
  const textOf = (id) => (role.bullets.find((b) => b.id === id) || {}).text || '';
  const score = (id) => bulletScore(sb.get(id), textOf(id), verdict ? bulletRank(verdict, id) : 0);
  const gain = (id) => (sb.get(id) || []).filter((s) => !covered.has(s.id)).reduce((n, s) => n + IMPORTANCE(s), 0);
  const left = [...kept];
  const head = [];
  for (let k = 0; k < slots && left.length; k++) {
    left.sort((a, b) => gain(b) - gain(a) || score(b) - score(a) || pos.get(a) - pos.get(b));
    const pick = left[0];
    if (gain(pick) === 0 && score(pick) === 0) break;
    head.push(pick); left.shift();
    for (const s of sb.get(pick) || []) covered.add(s.id);
  }
  // the person's own order for the slots that prove nothing new: their first line stays first when nothing beats it
  const rest = left.sort((a, b) => score(b) - score(a) || pos.get(a) - pos.get(b));
  const proofRest = rest.filter((id) => score(id) > 0);
  const plain = rest.filter((id) => score(id) === 0).sort((a, b) => pos.get(a) - pos.get(b));
  return [...head, ...proofRest, ...plain];
}

/**
 * Search the candidate plans and return the best: { planData, variant, visibility, chosen }.
 *   candidates = (built order | planner order on the first-read roles | planner order on every role) × (summary as decided |
 *   the person's own summary). Score = visibility.shown; ties → fewer changes (the person's own summary, the built order).
 * Never returns a plan whose first read is worse than the base document's.
 */
export function planFirstRead({ base, planData, out, verdict, applyPlan, visibility, summaryKeepCtx, targetedSummary = null }) {
  const sb = statementsByBullet(base, out, verdict);
  const roles = firstReadRoles(base).map((e) => e.id);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // what the summary and the first skills line already show (no experience lines): the first-read slots go to what is
  // NOT yet covered — three lines that prove three different statements beat three lines proving the same one
  const headOnly = { ...base, experience: [] };
  const covered0 = new Set((visibility(headOnly, out).ids) || []);
  const withOrder = (pd, which) => {
    const p = clone(pd);
    const covered = new Set(covered0);
    for (const rid of roles) {
      const d = (p.decisions || []).find((x) => x.itemId === rid);
      const e = base.experience.find((x) => x.id === rid);
      if (!d || !e) continue;
      const slots = rid === roles[0] ? FIRST_READ.latestLines : FIRST_READ.previousLines;
      d.keptBullets = coverageOrder(e, d.keptBullets || [], sb, verdict, covered, slots);
    }
    if (which === 'all') for (const d of p.decisions || []) {
      if (roles.includes(d.itemId)) continue;
      const e = base.experience.find((x) => x.id === d.itemId);
      if (!e || isGapNote(e)) continue;
      d.keptBullets = plannedOrder(e, d.keptBullets || [], sb, verdict);
    }
    return p;
  };
  const withOwnSummary = (pd) => { const p = clone(pd); p.ctx = { ...p.ctx, ...summaryKeepCtx }; return p; };
  const baseVis = visibility(base, out).shown;
  const cands = [];
  for (const [order, oCost] of [['built', 0], ['firstRead', 1], ['all', 2]]) {
    // a summary aimed at what the first read still lacks (composed from the person's own facts; firewalled)
    let target = null;
    if (targetedSummary) {
      const pOrder = order === 'built' ? clone(planData) : withOrder(planData, order);
      const covered = new Set(visibility(applyPlan(base, withOwnSummary(pOrder), { transferable: true }), out).ids || []);
      target = targetedSummary(covered);
    }
    for (const [sum, sCost] of [['decided', 0], ['own', -0.5], ...(target ? [['targeted', 0.5]] : [])]) {
      let p = order === 'built' ? clone(planData) : withOrder(planData, order);
      if (sum === 'own') p = withOwnSummary(p);
      if (sum === 'targeted') { p.ctx = { ...p.ctx, summaryMode: target.mode, summaryText: target.text }; }
      const v = applyPlan(base, p, { transferable: true });
      const vis = visibility(v, out);
      cands.push({ order, sum, p, v, vis, cost: oCost + sCost, target: sum === 'targeted' ? target : null });
    }
  }
  // most displayed statements up front; then the cheapest (keeping the person's own summary counts as cheaper)
  cands.sort((a, b) => b.vis.shown - a.vis.shown || a.cost - b.cost);
  const best = cands.find((c) => c.vis.shown >= baseVis) || null;
  if (!best) return null;
  return { planData: best.p, variant: best.v, visibility: best.vis, chosen: { order: best.order, summary: best.sum, target: best.target } };
}

/** The statement a moved line proves, in the posting's words (for the change's why). */
export function statementForLine(text, out) {
  const f = flat(text);
  const sts = (Array.isArray(out && out.statements) ? out.statements : []).filter((s) => s && s.display !== false && (s.status === 'shown' || s.status === 'partly'));
  const st = sts.find((s) => (s.evidence || []).some((ev) => ev && ev.line && flat(ev.line) === f));
  return st ? String(st.text || '').trim() : '';
}
