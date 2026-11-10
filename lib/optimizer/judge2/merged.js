// The merged statement judge (director's candidate, round 2): duty statements with no gate row are judged by judge2,
// every other statement — requirements, credentials, schedule, physical, and every statement a gate grades — by the
// incumbent judge (lib/optimizer/statements.js), byte for byte. Same interface as statementVerdicts; runOptimizer takes it
// through `options.statementJudge`.
//
// Why this split: on the hidden verdict half judge2 read duties better (exact 67.6% vs 55.9%, false shown 2 vs 7) and the
// incumbent read requirements better (72.6% vs 50.9%, false shown 0 vs 4) — see director/reports/j2-judge.md.
// Cost: judge2 runs only on the duty statements it will keep; the incumbent runs once over all statements.
import { statementVerdicts as incumbent } from '../statements.js';
import { statementVerdicts as judge2, lineUnderRelatedJob } from './index.js';

/**
 * @param {any[]} statements @param {any[]} matches @param {any[]} constraints @param {any[]} [facts]
 * @param {{ resumeText?: string, jobTitle?: string, field?: any }} [opts]
 */
export function statementVerdicts(statements, matches, constraints, facts = [], opts = {}) {
  const base = incumbent(statements, matches, constraints, facts, opts);
  const gated = new Set((constraints || []).map((c) => c.statementId));
  const mine = (statements || []).filter((s) => s.kind === 'duty' && !gated.has(s.id));
  if (!mine.length) return base;
  const byId = new Map(judge2(mine, matches, constraints, facts, opts).map((r) => [r.id, r]));
  const different = !!(opts.field && opts.field.level === 'different' && opts.field.known !== false);
  return base.map((r) => {
    const m = byId.get(r.id);
    if (!m) return r;
    // a duty both judges leave not shown: when judge2 has no closest line to ask about, the incumbent's question is kept
    // (a question changes no status, score or band; never on a known different field)
    // (round 3: and only when that line sits under a job whose occupation lib/occupations relates to the posting's)
    if (m.status === 'not_shown' && !m.candidate && r.status === 'not_shown' && r.candidate && !different && lineUnderRelatedJob(opts.resumeText || '', opts.jobTitle || '', r.candidate.line)) return { ...m, candidate: r.candidate };
    return m;
  });
}
export { statementVerdicts as statementJudge };
