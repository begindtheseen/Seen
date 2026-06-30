// Deterministic application message generation. NO external AI.
//
// Produces a 3–5 sentence, role-specific message using ONLY supported facts (matched
// skills with résumé evidence). Confident but not fake: no exaggerated claims, no
// unsupported tools, no invented numbers. Pure string assembly from templates.

import type { RequirementMatch } from './types.ts';

function pretty(s: string): string {
  return s.replace(/^(metric:|seniority:|cert:|education:)/, '');
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function generateApplicationMessage(opts: {
  jobTitle?: string;
  company?: string;
  matches: RequirementMatch[];
}): string {
  const role = (opts.jobTitle || 'this role').trim();
  const company = (opts.company || '').trim();
  const at = company ? ` at ${company}` : '';

  // Only fully-supported (exact/alias) matched requirements may be named as strengths.
  // Related-only matches are mentioned as transferable, never as direct expertise.
  const direct = opts.matches
    .filter((m) => m.matched && (m.via === 'exact' || m.via === 'alias'))
    .map((m) => pretty(m.surface));
  const transferable = opts.matches
    .filter((m) => m.matched && m.via === 'related')
    .map((m) => pretty(m.surface));

  const topDirect = [...new Set(direct)].slice(0, 3);
  const topTransfer = [...new Set(transferable)].slice(0, 2);

  const sentences: string[] = [];

  // 1. Intent — role-specific.
  sentences.push(`I'm applying for the ${role} position${at} and believe my background is a strong match.`);

  // 2. Direct strengths (only supported facts).
  if (topDirect.length) {
    sentences.push(`My experience with ${joinList(topDirect)} lines up directly with what the role calls for.`);
  } else if (topTransfer.length) {
    sentences.push(`My background in ${joinList(topTransfer)} translates closely to the requirements of this role.`);
  } else {
    sentences.push(`I'm confident my background equips me to take on the responsibilities of this role.`);
  }

  // 3. Transferable experience (clearly framed, never overstated).
  if (topDirect.length && topTransfer.length) {
    sentences.push(`I also bring transferable experience in ${joinList(topTransfer)}.`);
  }

  // 4. Close — confident, not fake.
  sentences.push(`I'd welcome the chance to discuss how I can contribute, and I appreciate your consideration.`);

  // Keep it to 3–5 sentences.
  return sentences.slice(0, 5).join(' ');
}
