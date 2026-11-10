// URL state for the admin (audit §3.2). Everything the owner thinks of as "where I was" lives in the
// URL, so a refresh or Back returns him to the same place:
//   ?s=<section>            the section (replaced, never a history entry per switch)
//   ?item=<kind>:<id>       the open sheet (PUSHED: Back closes it; refresh reopens it)
//   ?<section>.<name>=v     a section's filters (replaced), namespaced so sections never collide
//
// The parsing below is pure (unit-tested in core.test.mjs); the browser helpers wrap lib/nav.
import { ADMIN_SECTIONS, type AdminItemKind, type AdminSection } from '../contract.ts'

export const ITEM_KINDS: readonly AdminItemKind[] = [
  'report', 'job', 'company', 'user', 'ticket', 'dispute', 'claim', 'reply', 'purchase', 'issue', 'cluster',
  // The core's lab has its own item kind, accepted ONLY in a build with NEXT_PUBLIC_ADMIN_LAB=1 (never production).
  ...(process.env.NEXT_PUBLIC_ADMIN_LAB === '1' ? ['labitem' as AdminItemKind] : []),
]

/** Extra sections that exist only in a private build (the core's lab). Never in production. */
export const DEV_SECTIONS = ['lab'] as const
export type ShellSection = AdminSection | (typeof DEV_SECTIONS)[number]

/** `?s=` → a section; anything unknown or missing is Today. `allowed` lets a build add the lab. */
export function parseSection(raw: string | null | undefined, allowed: readonly string[] = ADMIN_SECTIONS): ShellSection {
  const v = String(raw || '').trim().toLowerCase()
  return (allowed.includes(v) ? v : 'today') as ShellSection
}

export type ItemRef = { kind: AdminItemKind; id: string }
export type ParsedItem = { ok: true; ref: ItemRef } | { ok: false; raw: string; reason: 'unknown_kind' | 'no_id' | 'empty' }

/**
 * `?item=report:5f2…` → { kind, id }. The id is everything after the FIRST colon (a company key or a
 * URL may itself hold colons). Unknown kinds and empty ids are reported, never guessed — the sheet
 * shows a plain "not found" state for them.
 */
export function parseItem(raw: string | null | undefined): ParsedItem {
  const s = String(raw || '').trim()
  if (!s) return { ok: false, raw: s, reason: 'empty' }
  const i = s.indexOf(':')
  const kind = (i < 0 ? s : s.slice(0, i)).toLowerCase()
  const id = i < 0 ? '' : s.slice(i + 1).trim()
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) return { ok: false, raw: s, reason: 'unknown_kind' }
  if (!id) return { ok: false, raw: s, reason: 'no_id' }
  return { ok: true, ref: { kind: kind as AdminItemKind, id } }
}

export function formatItem(ref: ItemRef): string {
  return `${ref.kind}:${ref.id}`
}

/** The URL param that holds one section's filter. */
export function filterParam(section: string, name: string): string {
  return `${section}.${name}`
}

/** All filters of one section from a query string (`review.kind=reports` → { kind: 'reports' }). */
export function sectionFilters(search: string, section: string): Record<string, string> {
  const out: Record<string, string> = {}
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const prefix = `${section}.`
  p.forEach((v, k) => { if (k.startsWith(prefix) && v) out[k.slice(prefix.length)] = v })
  return out
}

/**
 * The query string that opens `section` with exactly `filter` (a Today queue row's target). The
 * section's previous filters are cleared; other sections' filters and the open item are kept.
 */
export function searchForSection(search: string, section: string, filter?: Record<string, string>): string {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const prefix = `${section}.`
  for (const k of [...p.keys()]) if (k.startsWith(prefix)) p.delete(k)
  if (section === 'today') p.delete('s')
  else p.set('s', section)
  for (const [k, v] of Object.entries(filter || {})) if (v) p.set(prefix + k, v)
  return p.toString()
}
