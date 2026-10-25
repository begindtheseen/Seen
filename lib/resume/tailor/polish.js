// Optional LLM polish for tailored bullets — behind the llm.js gateway, behind the credit gate, and
// behind the fabrication firewall. The deterministic tailor plan is the product; this is the
// finishing pass a Pro user can ask for.
//
// Contract (what makes this safe to ship):
//   • The model receives ONLY the candidate's own bullets plus the posting's keyword list, never a
//     licence to add facts. It returns a strict JSON patch: { changes: [{ id, text, reason }] }.
//   • Every returned bullet is checked by passesFirewall against the original: no new numbers, no
//     new capitalized terms, no content words that are not already in the bullet, the résumé, or
//     the allowed keyword list (a keyword is allowed ONLY when the résumé already evidences it).
//   • Bullet accounting: one change per id, ids must exist, nothing deleted or added.
//   • Any violation drops that one change (reported as `rejected`), never the whole result.
//   • No provider configured → { available: false } and the caller shows the deterministic plan.

import { chat, llmAvailable } from '../../server/llm.js';
import { passesFirewall } from '../rewrite/rules.js';
import { analyzeBullet } from '../health/bullet.js';
import { fenceUntrusted } from '../../server/promptGuard.js';
import { numbersIntact } from '../../humanizer/protect.js';
import { KNOWN_SKILLS } from '../../optimizer/extractJobFacts.js';
import { completedResult } from './optimizer.js';
import { VERB_CATEGORIES } from '../health/verbs.js';

const NEUTRAL_VERBS = new Set(['building', 'analysis', 'communication', 'operations', 'support'].flatMap((k) => VERB_CATEGORIES[k] || []));
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasTerm = (hay, term) => new RegExp(`(?<![A-Za-z0-9])${escRe(term).replace(/\s+/g, '\\s+')}(?![A-Za-z0-9])`, 'i').test(hay);
const RATE_RE = /\bper\s+[a-z]+|\b(?:a|each|every)\s+(?:day|week|shift|month|quarter|year|semester)\b|\b(?:daily|weekly|monthly|quarterly|annually|yearly|nightly|hourly)\b/gi;

/**
 * What a polish edit may never do (2026-10-25: the polish removed "Python" from Dev's bullet,
 * dropped "Manhattan" from "Manhattan WMS", turned Maria's "200+ transactions per shift" into
 * "200+ daily transactions", and put dated results into the present tense):
 *   • change, drop or add any number;
 *   • drop a skill, a tool, a capitalised name or an allowed posting keyword the bullet had;
 *   • change a rate ("per shift", "weekly");
 *   • move a completed, measured result out of the past tense.
 * Returns null when the edit is safe, else the reason.
 */
export function polishViolation(from, to, allowed = []) {
  if (!numbersIntact(from, to)) return 'changed_number';
  const terms = new Set();
  for (const k of [...KNOWN_SKILLS, ...allowed]) if (k && k.length >= 2 && hasTerm(from, k)) terms.add(k);
  for (const m of String(from).matchAll(/(?<![A-Za-z0-9])([A-Z][A-Za-z0-9+#.]*[A-Z0-9+#][A-Za-z0-9+#.]*|[A-Z][a-z]+(?:\s+[A-Z][A-Za-z]+)+)(?![A-Za-z0-9])/g)) terms.add(m[1].replace(/[.]+$/, ''));
  // a capitalised word mid-sentence is a name ("in Python", "across Stripe, Adyen")
  for (const m of String(from).matchAll(/(?<=[a-z,;(/]\s|\s\()([A-Z][a-z]{2,})(?![A-Za-z])/g)) terms.add(m[1]);
  for (const t of terms) if (!hasTerm(to, t)) return `removed_term:${t}`;
  const rates = (String(from).match(RATE_RE) || []).map((r) => r.toLowerCase());
  for (const r of rates) if (!String(to).toLowerCase().includes(r)) return `changed_rate:${r}`;
  const pastLead = /^[A-Z][a-z]+ed\b/.test(String(from).trim()) || /^(?:Led|Built|Ran|Grew|Cut|Won|Sold|Made|Drove|Wrote|Taught|Kept|Held|Set|Met|Got|Spent|Brought|Thought|Caught)\b/.test(String(from).trim());
  const presentLead = /^[A-Z][a-z]+(?<!ed)\b/.test(String(to).trim()) && !/^[A-Z][a-z]+ed\b/.test(String(to).trim()) && !/^(?:Led|Built|Ran|Grew|Cut|Won|Sold|Made|Drove|Wrote|Taught|Kept|Held|Set|Met|Got|Spent|Brought)\b/.test(String(to).trim());
  if (pastLead && presentLead && completedResult(from)) return 'tense_on_completed_result';
  return null;
}

export const POLISH_VERSION = 'polish_v2';

const SYSTEM = `You are an editor who tightens résumé bullets. You restate; you never add.
Rules you must follow:
1. Keep every fact exactly: every number, percentage, dollar figure, tool, company, product and date stays as written. Do not add any number, tool, technology, certification, title or employer that is not in the bullet.
2. Start each bullet with a strong past-tense action verb (present tense if the bullet is marked current). No pronouns (I, my, we), no "responsible for", no buzzwords.
3. You may reorder clauses, cut filler, and use a posting keyword from the allowed list ONLY where the bullet already describes that exact work.
4. One line each, 12–25 words. Keep the meaning identical.
5. Return ONLY JSON: {"changes":[{"id":"<bullet id>","text":"<rewritten bullet>","reason":"<one short clause>"}]}. Leave out bullets that are already strong.`;

/**
 * @param {Array<{ id: string, text: string, current?: boolean }>} bullets
 * @param {{ allowedKeywords?: string[], resumeText?: string, jobTitle?: string }} ctx
 */
export async function polishBullets(bullets, ctx = {}) {
  if (!llmAvailable()) return { available: false, changes: [], rejected: [], version: POLISH_VERSION };
  const list = bullets.filter((b) => b && b.id && b.text).slice(0, 24);
  if (!list.length) return { available: true, changes: [], rejected: [], version: POLISH_VERSION };
  const allowed = (ctx.allowedKeywords || []).map(String).filter(Boolean).slice(0, 40);
  const user = [
    `Target role: ${String(ctx.jobTitle || 'the posting').slice(0, 120)}`,
    `Allowed posting keywords (use only where the bullet already describes that work): ${allowed.length ? allowed.join('; ') : '(none)'}`,
    'Bullets (JSON):',
    fenceUntrusted(JSON.stringify(list.map((b) => ({ id: b.id, text: b.text, tense: b.current ? 'present' : 'past' })))),
  ].join('\n');

  let out;
  try {
    out = await chat({ system: SYSTEM, user, maxTokens: 1800, timeoutMs: 25000, json: true });
  } catch (e) {
    return { available: true, error: String(e && e.message || e).slice(0, 160), changes: [], rejected: [], version: POLISH_VERSION };
  }
  const byId = new Map(list.map((b) => [b.id, b]));
  const changes = [], rejected = [];
  const seen = new Set();
  for (const ch of Array.isArray(out && out.changes) ? out.changes : []) {
    const id = ch && String(ch.id || '');
    const src = byId.get(id);
    const text = ch && typeof ch.text === 'string' ? ch.text.replace(/\s+/g, ' ').trim() : '';
    if (!src || !text || seen.has(id)) { rejected.push({ id, reason: 'unknown_or_duplicate_id' }); continue; }
    seen.add(id);
    if (text === src.text) continue;
    // Firewall: against the bullet itself, with the résumé-evidenced keywords as the only extra vocabulary.
    let fw = passesFirewall(src.text + '\n' + (ctx.resumeText || ''), text, allowed.flatMap((k) => k.toLowerCase().split(/\s+/)));
    // A plainer LEAD VERB for the same work is an edit, not a new claim: the firewall used to
    // reject every verb swap ("Ran" → "Coordinated"), so the teacher fixture got no polish at all
    // (harness 2026-10-25). Only the first word, only from the neutral verb families — never a
    // leadership, improvement or selling verb, which would claim more than the bullet says.
    if (!fw.ok && /^new_word:/.test(fw.reason || '')) {
      const lead = (text.match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
      const srcLead = (src.text.match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
      const bases = [lead, lead.replace(/ied$/, 'y'), lead.replace(/ed$/, ''), lead.replace(/d$/, ''), lead.replace(/([b-df-hj-np-tv-z])\1ed$/, '$1'), lead.replace(/s$/, '')];
      if (fw.reason === `new_word:${lead}` && srcLead && srcLead !== lead && bases.some((b) => NEUTRAL_VERBS.has(b))) {
        fw = passesFirewall(src.text + '\n' + (ctx.resumeText || ''), text, [...allowed.flatMap((k) => k.toLowerCase().split(/\s+/)), lead]);
      }
    }
    if (!fw.ok) { rejected.push({ id, reason: fw.reason, text }); continue; }
    const violation = polishViolation(src.text, text, allowed);
    if (violation) { rejected.push({ id, reason: violation, text }); continue; }
    const a = analyzeBullet(text, { roleTense: src.current ? 'present' : 'past' });
    if (a.pronouns.length || a.lead.kind === 'weak' || a.words > 32) { rejected.push({ id, reason: 'style', text }); continue; }
    changes.push({ id, from: src.text, text, reason: String(ch.reason || '').slice(0, 140) });
  }
  return { available: true, changes, rejected, version: POLISH_VERSION };
}
