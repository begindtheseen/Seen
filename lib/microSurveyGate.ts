// WHETHER the no-incentive micro-survey may show on this page right now — the pure half of
// components/MicroSurveyHost.tsx, so the rules can be pinned by a test without a browser.
//
// Never on: the landing page, the employer side, admin, auth flows (/login /signup /reset), pricing,
// the contact page, a 404 (the page may be anything; the not-found page marks itself), within the
// quiet window after a tracker delete / withdraw / outcome (lib/quietWindow.ts), or when today's
// one slot is already spent.

export const SKIP_PREFIXES = ['/employers', '/admin', '/login', '/signup', '/reset', '/pricing', '/contact']

export interface GateInput {
  pathname: string | null | undefined
  /** document.documentElement.dataset.notFound === '1' — set by app/not-found.tsx. */
  notFound: boolean
  /** lib/quietWindow inQuietWindow(). */
  quiet: boolean
  /** The device already showed a micro-survey today. */
  shownToday: boolean
}

export type GateVerdict = 'ok' | 'no_path' | 'landing' | 'skipped_route' | 'not_found' | 'quiet' | 'shown_today'

export function microSurveyGate(i: GateInput): GateVerdict {
  if (!i.pathname) return 'no_path'
  if (i.notFound) return 'not_found'
  if (i.pathname === '/') return 'landing'
  if (SKIP_PREFIXES.some(p => i.pathname === p || i.pathname!.startsWith(p + '/') || i.pathname!.startsWith(p + '?'))) return 'skipped_route'
  if (i.quiet) return 'quiet'
  if (i.shownToday) return 'shown_today'
  return 'ok'
}

/** Reads the 404 marker the not-found page sets (components/NotFoundMarker.tsx). */
export function pageIsNotFound(): boolean {
  try { return typeof document !== 'undefined' && document.documentElement.dataset.notFound === '1' } catch { return false }
}
