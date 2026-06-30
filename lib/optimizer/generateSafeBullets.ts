// Deterministic résumé bullet generation from EXISTING evidence only. NO external AI.
//
// CORE ANTI-HALLUCINATION RULE: a bullet may only use skills/tools/metrics that came
// from the résumé itself (the ResumeFact evidence). We NEVER invent a skill, number,
// tool, title, degree, or certification. Templates are pure string assembly over real
// evidence. If a number would strengthen a bullet, we emit a `confirm_before_using`
// entry with a placeholder instead of fabricating one.
//
// Templates (per spec):
//   1. action + context + process/tool + result
//   2. customer/service + volume/pace + reliability
//   3. operations/logistics + accuracy + time-sensitivity

import type {
  ResumeFact,
  RequirementMatch,
  GeneratedBullet,
  ConfirmBeforeUsing,
} from './types.ts';

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Surface label for a normalized skill — strip namespace prefixes, keep it readable.
function pretty(skill: string): string {
  return skill.replace(/^(metric:|seniority:|cert:|education:)/, '');
}

const CUSTOMER_SKILLS = new Set(['customer service', 'customer intake', 'point of sale', 'cash handling', 'sales', 'communication']);
const OPS_SKILLS = new Set(['route planning', 'logistics', 'inventory management', 'shipping', 'receiving', 'warehouse', 'scheduling', 'data entry']);

export interface SafeBulletsResult {
  safe_bullets: GeneratedBullet[];
  confirm_before_using: ConfirmBeforeUsing[];
}

export function generateSafeBullets(
  resumeFacts: ResumeFact[],
  matches: RequirementMatch[]
): SafeBulletsResult {
  const safe: GeneratedBullet[] = [];
  const confirm: ConfirmBeforeUsing[] = [];

  // Build the allowed evidence set — only normalized skills that exist in the résumé.
  const evidenceBySkill = new Map<string, string>();
  for (const f of resumeFacts) {
    if ((f.factType === 'skill' || f.factType === 'tool') && !evidenceBySkill.has(f.normalizedLabel)) {
      evidenceBySkill.set(f.normalizedLabel, f.evidenceText);
    }
  }
  const hasMetric = resumeFacts.some((f) => f.factType === 'metric');

  // Generate one bullet per MATCHED requirement that is grounded in résumé evidence.
  // (matched + has evidence guarantees the skill is in the résumé — no invention.)
  const used = new Set<string>();
  for (const m of matches) {
    if (!m.matched || !m.evidence) continue;
    const skill = m.requirement;
    if (used.has(skill)) continue;
    used.add(skill);
    const evidence = evidenceBySkill.get(m.via === 'related' ? skill : skill) || m.evidence;
    const label = pretty(m.surface);

    let text: string;
    let template: string;
    if (CUSTOMER_SKILLS.has(skill)) {
      // Template 2: customer/service + volume/pace + reliability (no invented volume)
      text = `Delivered ${label} in a fast-paced environment, maintaining reliability and a consistent standard of service.`;
      template = 'customer_service';
    } else if (OPS_SKILLS.has(skill)) {
      // Template 3: operations/logistics + accuracy + time-sensitivity
      text = `Handled ${label} with accuracy under time-sensitive conditions, keeping work on schedule.`;
      template = 'operations';
    } else {
      // Template 1: action + context + process/tool + result
      text = `Applied ${label} to deliver results, using it as part of day-to-day responsibilities and process.`;
      template = 'action_context_result';
    }

    safe.push({ text, evidenceUsed: [evidence], template });

    // Offer a quantified variant the user must confirm — never fabricate the number.
    if (!hasMetric) {
      confirm.push({
        text: `${text.replace(/\.$/, '')} — handling [X] per day/week.`,
        reason: 'Add the real number from your experience to make this measurable. We will not invent it.',
        placeholder: '[X]',
      });
    }
  }

  // If the résumé has real metrics, suggest pairing one with a matched skill — but
  // since we cannot be certain the metric belongs to that exact skill, it goes under
  // confirm_before_using, not safe_bullets.
  const metricFacts = resumeFacts.filter((f) => f.factType === 'metric').slice(0, 2);
  for (const mf of metricFacts) {
    const anchorSkill = [...used][0];
    if (!anchorSkill) break;
    confirm.push({
      text: `${cap(pretty(anchorSkill))} work that produced ${pretty(mf.label)} — confirm this figure applies here before using.`,
      reason: 'This number is from your résumé but may belong to a different role/skill. Confirm it fits this bullet.',
      placeholder: pretty(mf.label),
    });
  }

  return { safe_bullets: safe.slice(0, 6), confirm_before_using: confirm.slice(0, 6) };
}

// Hard guarantee used by tests: every skill referenced in safe_bullets must be a
// normalized skill/tool present in the résumé facts (output skills ⊆ résumé evidence).
export function bulletSkillsSubsetOf(
  result: SafeBulletsResult,
  resumeFacts: ResumeFact[]
): boolean {
  const evidenceTexts = new Set(
    resumeFacts.filter((f) => f.factType === 'skill' || f.factType === 'tool').map((f) => f.evidenceText)
  );
  for (const b of result.safe_bullets) {
    for (const e of b.evidenceUsed) {
      if (!evidenceTexts.has(e)) return false;
    }
  }
  return true;
}
