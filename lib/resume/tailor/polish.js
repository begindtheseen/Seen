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

export const POLISH_VERSION = 'polish_v1';

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
    const fw = passesFirewall(src.text + '\n' + (ctx.resumeText || ''), text, allowed.flatMap((k) => k.toLowerCase().split(/\s+/)));
    if (!fw.ok) { rejected.push({ id, reason: fw.reason, text }); continue; }
    const a = analyzeBullet(text, { roleTense: src.current ? 'present' : 'past' });
    if (a.pronouns.length || a.lead.kind === 'weak' || a.words > 32) { rejected.push({ id, reason: 'style', text }); continue; }
    changes.push({ id, from: src.text, text, reason: String(ch.reason || '').slice(0, 140) });
  }
  return { available: true, changes, rejected, version: POLISH_VERSION };
}
