// Re-optimize: another honest version of the same résumé for the same posting (owner, 2026-11-12: "an option to
// reoptimize giving a different result").
//
// A variant is the finished plan with ONE OR TWO visible decisions turned the other way — never new content. Tried in
// this order (the most visible difference first):
//   condense  a past role that shows nothing the posting lists becomes one line under Additional Experience
//   lead      your latest job opens with its runner-up line (the next one that shows something they list)
//   order     your lines in the order you wrote them ↔ the order the build first chose
//   summary   your own summary (or none, when you wrote none) ↔ the summary composed from your own lines
//   layout    "Relevant Experience" first, the other roles as one line each (only when your latest job still leads and
//             every role it shortens shows nothing they list)
// then the same moves in pairs. Every candidate goes through applyPlan (the ONE apply path — nothing is written here),
// and it is offered only when it holds the build's own invariants: its fit score is not below your résumé as written,
// and it shows no less of the posting where a recruiter reads first. Distinct = its text differs from the build and from
// every earlier variant. Candidates are tried in a fixed order, so variant k is the same for the same résumé + posting.
// When fewer than k distinct versions pass, there is no variant k (`null`) — never the same thing twice.

import { roleStatementCount, lineStatementCount } from './roleReasons.js';

export const MAX_VARIANTS = 3;

const clone = (x) => JSON.parse(JSON.stringify(x));
const isCurrent = (e) => !!e && (e.end === 'present' || (!e.end && !!e.start && !e.dateText));

/** The single moves that apply to this plan, in the order they are tried. Each turns a planData into another or null. */
export function variantMoves({ base, planData, verdict, out = null, sd0 = null, builtOrder = null }) {
  const showsNothing = (id) => !((verdict && verdict.roleWeight && verdict.roleWeight.get(id)) > 0) && roleStatementCount(base.experience.find((x) => x.id === id), out) === 0;
  const moves = [];
  const own = String((base && base.basics && base.basics.summary) || '').trim();
  // 1. summary: the other of (your own, the composed one)
  moves.push({ id: 'summary', apply: (pd) => {
    const mode = pd.ctx && pd.ctx.summaryMode;
    if (['replace', 'add'].includes(mode) && pd.ctx.summaryText) {
      // your own summary, or — when you wrote none — no summary (a shorter page; offered only if it shows no less)
      const p = clone(pd); p.ctx = { ...p.ctx, summaryMode: 'keep', summaryText: '' };
      return { pd: p, summary: { mode: 'keep', text: own, why: own ? 'This version keeps your own summary, word for word.' : 'This version leaves the summary off, as your résumé had it.' } };
    }
    if (sd0 && ['replace', 'add'].includes(sd0.mode) && sd0.text && sd0.text.trim() !== own) {
      const p = clone(pd); p.ctx = { ...p.ctx, summaryMode: sd0.mode, summaryText: sd0.text };
      return { pd: p, summary: { mode: sd0.mode, text: sd0.text, named: sd0.named || [], sources: sd0.sources || null, why: sd0.why || 'This version composes your summary from your own lines.' } };
    }
    return null;
  } });
  // 2. line order: as you wrote it ↔ the order the build first chose
  const asWritten = (pd) => (pd.decisions || []).map((d) => { const e = base.experience.find((x) => x.id === d.itemId); if (!e) return d; const keep = new Set(d.keptBullets || []); return { ...d, keptBullets: e.bullets.map((b) => b.id).filter((id) => keep.has(id)) }; });
  const same = (a, b) => a.length === b.length && a.every((d, i) => (d.keptBullets || []).join() === (b[i].keptBullets || []).join());
  moves.push({ id: 'order:own', apply: (pd) => {
    const cur = pd.decisions || [];
    const aw = asWritten(pd);
    if (same(aw, cur)) return null;
    const p = clone(pd); p.decisions = aw; return { pd: p };
  } });
  if (builtOrder) moves.push({ id: 'order:built', apply: (pd) => {
    const cur = pd.decisions || [];
    const bo = cur.map((d) => { const want = builtOrder.get(d.itemId); if (!want) return d; const keep = new Set(d.keptBullets || []); const ordered = want.filter((id) => keep.has(id)); return { ...d, keptBullets: [...ordered, ...(d.keptBullets || []).filter((id) => !ordered.includes(id))] }; });
    if (same(bo, cur)) return null;
    const p = clone(pd); p.decisions = bo; return { pd: p };
  } });
  // 2b. lead line: your latest job opens with its next line that shows something they list (the runner-up lead)
  moves.push({ id: 'lead', apply: (pd) => {
    const latest = (base.experience || []).find((e) => (e.bullets || []).length >= 2 && (pd.decisions || []).some((d) => d.itemId === e.id && (d.decision === 'keep' || d.decision === 'trim')));
    if (!latest) return null;
    const p = clone(pd); const d = p.decisions.find((x) => x.itemId === latest.id);
    const kept = d.keptBullets && d.keptBullets.length ? d.keptBullets : latest.bullets.map((b) => b.id);
    if (kept.length < 2) return null;
    const textOf = (id) => (latest.bullets.find((b) => b.id === id) || {}).text || '';
    const next = kept.slice(1).map((id, i) => ({ id, i, n: lineStatementCount(textOf(id), out) })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n || x.i - y.i)[0];
    if (!next) return null;
    d.keptBullets = [next.id, ...kept.filter((id) => id !== next.id)];
    return { pd: p };
  } });
  // 3. condense: a past role that proves nothing in the posting, least relevant first (at most two candidates); at least
  //    two roles stay in full and the role stays on the page as a line, so the timeline keeps no hole
  const roleCount = (base.experience || []).length;
  if (roleCount >= 3) {
    const cands = (planData.decisions || [])
      .filter((d) => { const e = base.experience.find((x) => x.id === d.itemId); return e && !isCurrent(e) && (e.bullets || []).length > 0 && showsNothing(d.itemId); })
      .sort((a, b) => (a.relevance || 0) - (b.relevance || 0))
      .slice(0, 2);
    for (const c of cands) moves.push({ id: `condense:${c.itemId}`, apply: (pd) => {
      const ds = pd.decisions || [];
      const d = ds.find((x) => x.itemId === c.itemId);
      if (!d || d.decision === 'condense' || d.decision === 'drop') return null;
      if (ds.filter((x) => x.itemId !== c.itemId && (x.decision === 'keep' || x.decision === 'trim')).length < 2) return null;
      const p = clone(pd); const pdD = p.decisions.find((x) => x.itemId === c.itemId);
      pdD.decision = 'condense'; pdD.keptBullets = [];
      pdD.reasons = ['Shown as one line under Additional Experience in this version.', ...(pdD.reasons || [])];
      return { pd: p };
    } });
  }
  // 4. layout: the relevant roles first, every other role as one line — only when it keeps your latest job on top
  moves.push({ id: 'layout', apply: (pd) => {
    if (pd.strategy && pd.strategy.layout === 'relevance') return null;
    const ds = pd.decisions || [];
    if (!ds.some((d) => ['core', 'supporting'].includes(d.tier)) || !ds.some((d) => !['core', 'supporting'].includes(d.tier))) return null;
    const p = clone(pd); p.strategy = { ...(p.strategy || {}), layout: 'relevance' };
    return { pd: p, needsLatestFirst: true };
  } });
  // the order they are tried: the most visible difference first (a role on one line, then which line leads), the summary later
  const rank = (id) => (id.startsWith('condense') ? 0 : id === 'lead' ? 1 : id.startsWith('order') ? 2 : id === 'summary' ? 3 : 4);
  moves.sort((x, y) => rank(x.id) - rank(y.id));
  return { moves, showsNothing };
}

/**
 * Variant k (1-based) of a finished plan, or null when there are fewer than k distinct honest versions.
 * @param {{ base, planData, variant, verdict, out, sd0, builtOrder, k, applyPlan, serialize, fitOf, fitFloor, visOf, visFloor, maxTries? }} a
 *   variant    the build's own document (variant 0)
 *   fitOf(doc) → the reading of doc (runOptimizer output), fitFloor = the résumé-as-written's fit score; visOf(doc) → number, visFloor = its first read
 */
export function pickVariant(a) {
  const k = Math.max(1, Math.min(MAX_VARIANTS, Math.floor(Number(a.k) || 1)));
  const { moves: single, showsNothing } = variantMoves(a);
  // singles first, then pairs in a fixed order (a pair of the same kind — two condenses — is allowed)
  const combos = [...single.map((m) => [m])];
  for (let i = 0; i < single.length; i++) for (let j = i + 1; j < single.length; j++) combos.push([single[i], single[j]]);
  const seen = new Set([a.serialize(a.variant)]);
  const latestId = (doc) => ((doc.experience || [])[0] || {}).id;
  const baseLatest = latestId(a.variant);
  let accepted = 0;
  let tries = 0;
  for (const combo of combos) {
    if (tries >= (a.maxTries || 12)) break;
    let pd = a.planData, summary = null, needsLatestFirst = false, ok = true;
    for (const m of combo) {
      const r = m.apply(pd);
      if (!r) { ok = false; break; }
      pd = r.pd; if (r.summary) summary = r.summary; if (r.needsLatestFirst) needsLatestFirst = true;
    }
    if (!ok) continue;
    const doc = a.applyPlan(a.base, pd, { transferable: true });
    const sig = a.serialize(doc);
    if (seen.has(sig)) continue;
    if (needsLatestFirst && latestId(doc) !== baseLatest) continue;
    // a role turned into one line must show nothing the posting lists (the relevance layout condenses by tier alone)
    const condensedIds = ((doc.meta && doc.meta.provenance) || []).filter((p) => p && p.kind === 'condense_role').map((p) => p.itemId);
    if (condensedIds.some((id) => !showsNothing(id))) continue;
    tries++;
    if (a.debug) a.debug({ moves: combo.map((m) => m.id), vis: a.visOf(doc), visFloor: a.visFloor, fit: (a.fitOf(doc) || {}).fit_score, fitFloor: a.fitFloor });
    // the build's invariants: never below your résumé as written, never less of the posting in the first read
    if (a.visOf(doc) < a.visFloor) continue;
    const fitOut = a.fitOf(doc);
    const fit = fitOut ? fitOut.fit_score : null;
    if (a.fitFloor != null && fit != null && fit < a.fitFloor) continue;
    seen.add(sig);
    accepted++;
    if (accepted === k) return { planData: pd, variant: doc, fitOut, summary, moves: combo.map((m) => m.id) };
  }
  return null;
}
