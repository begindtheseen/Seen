// Resume Intelligence Engine — OPTIMIZATION RECOMMENDATIONS (Phase 12).
//
// Turns the match analysis into evidence-backed advice — NOT "add these 25 keywords." Every
// recommendation points at real résumé evidence and the specific requirement it serves, and NONE
// can invent a qualification: a genuine gap is reported as a gap, never as something to fake.
// Categories: surface a proven-but-buried skill, name a transferable skill explicitly, align to the
// JD's exact terminology (only when already evidenced), add a metric you can back, and honest gaps.
// Pure + deterministic.

import { normSurface } from './taxonomy.js';

export function recommend({ jobProfile, resume, matchResult }) {
  const recs = [];
  const skillNames = new Set((resume.skills || []).map((s) => normSurface(s.surface)));

  // 1. Transferable skills the résumé PROVES through work but never names → surface them.
  for (const m of matchResult.transferableMatches) {
    if (m.matchType !== 'TRANSFERABLE_MATCH') continue;
    const named = skillNames.has(normSurface(m.requirement));
    if (!named) {
      recs.push({
        type: 'name_transferable_skill',
        priority: m.requirementLevel === 'REQUIRED' ? 'high' : 'medium',
        title: `Name "${m.requirement}" explicitly`,
        detail: `Your experience already demonstrates ${m.requirement}${m.matchedIndicators ? ` (${m.matchedIndicators.slice(0, 3).join(', ')})` : ''}, but the words "${m.requirement}" don't appear on your résumé. Add the term where your evidence supports it — this is presentation, not invention.`,
        requirement: m.requirement,
        evidence: m.evidence,
      });
    }
  }

  // 2. Concepts matched via evidence but not listed in the Skills section → surface in Skills.
  for (const m of matchResult.strongMatches) {
    if (!m.canonicalConcept) continue;
    if (!skillNames.has(normSurface(m.requirement)) && m.matchType !== 'ALIAS_MATCH') {
      recs.push({
        type: 'surface_buried_skill',
        priority: 'medium',
        title: `Add "${m.requirement}" to your Skills section`,
        detail: `You prove ${m.requirement} in your experience but it isn't in a scannable Skills list — add it so keyword scanners and skimming recruiters both catch it.`,
        requirement: m.requirement,
        evidence: m.evidence,
      });
    }
  }

  // 3. Terminology alignment: the JD uses a specific term for a concept you have under another
  //    alias → mirror the JD's exact wording (evidenced, so it's honest).
  for (const m of matchResult.strongMatches) {
    if (m.matchType !== 'ALIAS_MATCH' && m.matchType !== 'EXACT_MATCH') continue;
    const jdTerm = normSurface(m.requirement);
    const hay = normSurface(resume.evidenceText);
    const re = new RegExp('\\b' + jdTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (jdTerm.length >= 4 && !re.test(hay)) {
      recs.push({
        type: 'align_terminology',
        priority: 'low',
        title: `Mirror the posting's term: "${m.requirement}"`,
        detail: `You have this, but the posting calls it "${m.requirement}". Use their exact phrasing so a keyword scanner matches it verbatim.`,
        requirement: m.requirement,
        evidence: m.evidence,
      });
    }
  }

  // 4. Metric prompt: strong non-metric résumé → ask for numbers you can PROVE (never invent).
  if ((resume.metricCount || 0) < 2 && matchResult.strongMatches.length) {
    recs.push({
      type: 'add_metric',
      priority: 'medium',
      title: 'Quantify your strongest bullets',
      detail: 'Your matches are real but thin on numbers. Add counts, %, $, or timeframes you can actually stand behind (units per shift, customers per day, on-time rate). Only real figures — never estimated.',
    });
  }

  // 5. Honest gaps — genuinely missing requirements, reported truthfully. Fatal sort first (below).
  for (const m of matchResult.missingRequirements) {
    recs.push({
      type: 'real_gap',
      priority: m.missSeverity === 'fatal' ? 'high' : 'medium',
      title: `Missing: ${m.requirement}${m.mustNotInvent ? ' (do not fabricate)' : ''}`,
      detail: m.mustNotInvent
        ? `This posting requires ${m.requirement}. It's a credential/gate — if you don't hold it, don't imply you do. Consider whether you can obtain it, or focus on roles that don't require it.`
        : `${m.requirement} isn't evidenced on your résumé. If you have relevant experience, add it honestly; if not, this is a real gap for this role.`,
      requirement: m.requirement,
      missSeverity: m.missSeverity,
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3)).slice(0, 12);
}
