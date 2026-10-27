'use client'

// Device-local, USER-SCOPED cache for the Résumé Studio:
//   • the structured doc the server parsed from an upload (layout-aware — better than re-parsing
//     the text in the browser), keyed by a hash of the text it came from so a stale doc can never
//     shadow edited text;
//   • tailored variants (job-targeted copies) — the base résumé stays in ResumeStore / the DB.
// Keys carry the user id and are cleared on sign-out (lib/auth.tsx SESSION_LOCAL_KEYS prefix),
// so a shared device never shows one account's résumé to the next.

import type { ResumeDoc } from '../resume/types'

export const DOC_CACHE_PREFIX = 'seen_resume_doc_'
export const VARIANTS_PREFIX = 'seen_resume_variants_'
// the last Tailor result (plan + the doc it was built for + the person's overrides), so a reload of the
// Studio shows the result they paid a credit for (round 5: "result gone on reload")
export const TAILOR_PREFIX = 'seen_resume_tailor_'
const TAILOR_TTL_MS = 7 * 24 * 3600 * 1000
const MAX_VARIANTS = 12

export function textHash(text: string): string {
  // FNV-1a 32-bit — stable, tiny, good enough to tell "same text" from "edited text".
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return `${text.length}:${h.toString(16)}`
}

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null } catch { return null }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota / private mode — the cache is optional */ }
}

export interface StoredTailor { job: unknown; plan: unknown; baseDoc: ResumeDoc; overrides: unknown; answers: Record<string, string>; at: string }

export interface StoredVariant { id: string; label: string; role: string; company: string; jobId: string; createdAt: string; doc: ResumeDoc; baseHash: string; scoreBefore?: number; scoreAfter?: number }

export const ResumeDocStore = {
  putParsed(userId: string | undefined, text: string, doc: ResumeDoc): void {
    write(`${DOC_CACHE_PREFIX}${userId || 'guest'}`, { hash: textHash(text), doc, at: new Date().toISOString() })
  },
  getParsed(userId: string | undefined, text: string): ResumeDoc | null {
    const rec = read<{ hash: string; doc: ResumeDoc }>(`${DOC_CACHE_PREFIX}${userId || 'guest'}`)
    return rec && rec.hash === textHash(text) ? rec.doc : null
  },
  listVariants(userId: string | undefined): StoredVariant[] {
    return read<StoredVariant[]>(`${VARIANTS_PREFIX}${userId || 'guest'}`) || []
  },
  saveVariant(userId: string | undefined, v: StoredVariant): StoredVariant[] {
    const list = [v, ...ResumeDocStore.listVariants(userId).filter((x) => x.id !== v.id)].slice(0, MAX_VARIANTS)
    write(`${VARIANTS_PREFIX}${userId || 'guest'}`, list)
    return list
  },
  removeVariant(userId: string | undefined, id: string): StoredVariant[] {
    const list = ResumeDocStore.listVariants(userId).filter((x) => x.id !== id)
    write(`${VARIANTS_PREFIX}${userId || 'guest'}`, list)
    return list
  },
  putTailor(userId: string | undefined, rec: Omit<StoredTailor, 'at'>): void {
    write(`${TAILOR_PREFIX}${userId || 'guest'}`, { ...rec, at: new Date().toISOString() })
  },
  getTailor(userId: string | undefined): StoredTailor | null {
    const rec = read<StoredTailor>(`${TAILOR_PREFIX}${userId || 'guest'}`)
    if (!rec || !rec.plan || !rec.baseDoc) return null
    const age = Date.now() - new Date(rec.at || 0).getTime()
    return Number.isFinite(age) && age >= 0 && age < TAILOR_TTL_MS ? rec : null
  },
  clearTailor(userId: string | undefined): void {
    try { localStorage.removeItem(`${TAILOR_PREFIX}${userId || 'guest'}`) } catch { /* ignore */ }
  },
  clear(userId: string | undefined): void {
    try { localStorage.removeItem(`${DOC_CACHE_PREFIX}${userId || 'guest'}`); localStorage.removeItem(`${VARIANTS_PREFIX}${userId || 'guest'}`); localStorage.removeItem(`${TAILOR_PREFIX}${userId || 'guest'}`) } catch { /* ignore */ }
  },
}
