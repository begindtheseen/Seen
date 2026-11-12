// The browser side of /api/places: one in-memory cache per tab, keyed by the typed text's placeKey (any spacing or
// case is one entry and one edge-cached URL), shared by every place field on the page. No place data ships to the
// browser — the server owns it (lib/geo/placeSuggest.js).
import { looksFixed, placeKey } from './placeFormat.js'

export type PlaceKind = 'place' | 'state' | 'zip' | 'remote'
export type PlaceSuggestion = { label: string; kind: PlaceKind; detail?: string }
export type PlaceAnswer = { suggestions: PlaceSuggestion[]; resolved: PlaceSuggestion | null }

const MAX = 400
const answers = new Map<string, PlaceAnswer>()
const resolved = new Map<string, PlaceSuggestion | null>()
const pending = new Map<string, Promise<PlaceSuggestion | null>>()

function remember<V>(m: Map<string, V>, k: string, v: V) {
  if (m.size >= MAX) m.delete(m.keys().next().value as string)
  m.set(k, v)
}

const isAnswer = (d: unknown): d is PlaceAnswer =>
  !!d && typeof d === 'object' && Array.isArray((d as PlaceAnswer).suggestions)
const isSuggestion = (d: unknown): d is PlaceSuggestion =>
  !!d && typeof d === 'object' && typeof (d as PlaceSuggestion).label === 'string' && typeof (d as PlaceSuggestion).kind === 'string'

/** The answer already in the tab for this text, if any (no request). */
export function cachedPlaces(text: string): PlaceAnswer | undefined {
  return answers.get(placeKey(text))
}

/** Suggestions + the resolved form for what has been typed. null on a network / server failure (or abort). */
export async function fetchPlaces(text: string, signal?: AbortSignal): Promise<PlaceAnswer | null> {
  const k = placeKey(text)
  if (!k) return { suggestions: [], resolved: null }
  const hit = answers.get(k)
  if (hit) return hit
  try {
    const r = await fetch(`/api/places?q=${encodeURIComponent(k)}`, { signal })
    if (!r.ok) return null
    const d: unknown = await r.json()
    if (!isAnswer(d)) return null
    const a: PlaceAnswer = {
      suggestions: d.suggestions.filter(isSuggestion).slice(0, 8),
      resolved: isSuggestion(d.resolved) ? d.resolved : null,
    }
    remember(answers, k, a)
    remember(resolved, k, a.resolved)
    return a
  } catch {
    return null
  }
}

/**
 * The fixed form of a typed place ("boise id" → "Boise, ID"), or the text exactly as typed when it cannot be placed,
 * the server is slow (`timeoutMs`), or the network fails — a place field is never blocked and never guesses.
 */
export async function resolvePlaceText(text: string, timeoutMs = 700): Promise<string> {
  const k = placeKey(text)
  if (!k || looksFixed(text)) return text
  if (resolved.has(k)) return resolved.get(k)?.label ?? text
  let p = pending.get(k)
  if (!p) {
    p = fetch(`/api/places?resolve=${encodeURIComponent(k)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { resolved?: unknown }) => {
        const v = isSuggestion(d?.resolved) ? d.resolved : null
        remember(resolved, k, v)
        return v
      })
      .catch(() => null)
      .finally(() => { pending.delete(k) })
    pending.set(k, p)
  }
  const v = await Promise.race([p, new Promise<undefined>(res => setTimeout(() => res(undefined), timeoutMs))])
  return v ? v.label : text
}
