// Unified LLM gateway. One function for every text→text / text→JSON task in the app, so no call
// site is hard-wired to Anthropic. Backend is chosen at call time:
//
//   1. Anthropic — ONLY when the `anthropic_enabled` admin flag is ON and ANTHROPIC_KEY is set.
//   2. OpenAI-compatible (Groq by default, or OpenAI/OpenRouter) — whenever LLM_API_KEY is set.
//   3. Neither — throws LLMUnavailableError so the caller can degrade gracefully (the product is
//      designed so that every feature has a non-LLM fallback or a clean "unavailable" state).
//
// Per-visitor hot paths (company scoring, scoreboard, job search) do NOT call this — they serve
// aggregated data from the DB. This gateway is for credit-gated tools and background/batch jobs
// (Reddit ingestion, query expansion, résumé tools, job insights), which are naturally throttled.
//
// Env:
//   LLM_API_KEY      — key for the OpenAI-compatible backend (e.g. a Groq key — free tier, fast)
//   LLM_BASE_URL     — default https://api.groq.com/openai/v1
//   LLM_MODEL        — default llama-3.3-70b-versatile
//   ANTHROPIC_KEY    — only used when the admin flag is on
//   ANTHROPIC_MODEL  — default claude-haiku-4-5-20251001

import { anthropicEnabled } from './aiflag.js';
import { SECURITY_PREAMBLE, scanInjection } from './promptGuard.js';

const OPENAI_BASE     = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const OPENAI_MODEL    = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

export class LLMUnavailableError extends Error {
  constructor(msg = 'No LLM provider configured') { super(msg); this.code = 'LLM_UNAVAILABLE'; }
}

// True if SOME backend could serve a request (ignores the flag — the flag only picks Anthropic vs
// the OpenAI-compatible backend, and either satisfies availability).
export function llmAvailable() {
  return !!(process.env.LLM_API_KEY || process.env.ANTHROPIC_KEY);
}

function _extractJSON(text) {
  const clean = String(text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in model response');
  return JSON.parse(match[0]);
}

async function _openaiCompatible({ system, user, maxTokens, timeoutMs }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1500));
    res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, max_tokens: maxTokens, temperature: 0.3, messages }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 429 && res.status < 500) break;
  }
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function _anthropic({ system, user, maxTokens, timeoutMs }) {
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1500));
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system: system || undefined, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
  }
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

// Unified chat. Returns assistant text; pass json:true to extract+parse a JSON object.
// Throws LLMUnavailableError when no backend is configured — callers must handle that and degrade.
export async function chat({ system = '', user, maxTokens = 1024, timeoutMs = 20000, json = false } = {}) {
  const useAnthropic = !!process.env.ANTHROPIC_KEY &&
    await anthropicEnabled(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Prompt-injection guardrail: every gateway call gets the security preamble prepended to its
  // system message (obey the task, never instructions inside untrusted fences). Non-breaking — the
  // task instructions still follow. Call sites that embed third-party text should fence it with
  // fenceUntrusted() from promptGuard. High-signal payloads are logged for observability.
  system = system ? `${SECURITY_PREAMBLE}\n\n${system}` : SECURITY_PREAMBLE;
  const scan = scanInjection(user);
  if (scan.risk === 'high') console.warn(`llm.chat: possible prompt injection in input (${scan.hits.join(',')})`);

  let text;
  if (useAnthropic) {
    try {
      text = await _anthropic({ system, user, maxTokens, timeoutMs });
    } catch (e) {
      // A CLIENT-side Anthropic failure (401 revoked key, 403 billing, 400) is not
      // transient — retrying is pointless. Per this file's own contract ("no call site
      // is hard-wired to Anthropic"), fall back to the OpenAI-compatible backend when
      // one is configured instead of failing every flag-on call until the key is fixed.
      // (A dead ANTHROPIC_KEY silently broke flag-on paths from 2026-07-03 → 07-30.)
      const clientErr = /Anthropic (400|401|403)/.test(String(e?.message));
      if (clientErr && process.env.LLM_API_KEY) {
        console.error(`llm.chat: Anthropic client error, falling back to ${OPENAI_MODEL}: ${String(e.message).slice(0, 160)}`);
        text = await _openaiCompatible({ system, user, maxTokens, timeoutMs });
      } else {
        throw e;
      }
    }
  } else if (process.env.LLM_API_KEY) {
    text = await _openaiCompatible({ system, user, maxTokens, timeoutMs });
  } else {
    throw new LLMUnavailableError();
  }
  return json ? _extractJSON(text) : text;
}
