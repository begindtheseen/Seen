'use client'

// The two states every data-backed page must be able to show besides "data" and "empty":
//   • LoadError — the request failed. Says what could not be loaded and offers Retry. A failed load
//     is NEVER rendered as an empty state ("No applications yet", "0 TOTAL", "No company data yet"):
//     the audit of 2026-10-24 (R-1) found a dead API shown as an empty account.
//   • PageSkeleton — the first load is in flight (R-2). Uses the `.sk` shimmer from globals.css.
// Shared by the dashboard, tracker, companies, company page, jobs and the employer hub so the words
// and the Retry affordance are the same everywhere.

import type { CSSProperties } from 'react'

export function LoadError({ what, detail, onRetry, retrying = false, compact = false, children }: {
  /** What failed to load, e.g. "your applications", "the company scoreboard". */
  what: string
  /** One optional line of extra truth, e.g. "Showing what this device last synced." */
  detail?: string
  onRetry?: () => void
  retrying?: boolean
  compact?: boolean
  children?: React.ReactNode
}) {
  return (
    <div role="alert" data-testid="load-error" style={{ background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.28)', borderRadius: 12, padding: compact ? '.75rem .9rem' : '1.1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '.9rem', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: compact ? '.86rem' : '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: detail ? '.2rem' : 0 }}>
          Couldn&apos;t load {what}.
        </div>
        {detail && <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', lineHeight: 1.55 }}>{detail}</div>}
        {children}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={retrying} data-testid="load-retry"
          style={{ minHeight: 44, padding: '.6rem 1.1rem', background: 'rgba(255,255,255,.06)', border: '1px solid var(--line2)', borderRadius: 10, color: 'var(--white)', fontFamily: 'var(--display)', fontWeight: 700, fontSize: 'var(--fs-sm)', cursor: retrying ? 'default' : 'pointer', opacity: retrying ? .6 : 1 }}>
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  )
}

const skRow = (w: string, h: number, extra?: CSSProperties): CSSProperties => ({ width: w, height: h, ...extra })

/** A page-shaped shimmer for the first load: a header line, a row of tiles, then list rows. */
export function PageSkeleton({ label = 'Loading', tiles = 4, rows = 3 }: { label?: string; tiles?: number; rows?: number }) {
  return (
    <div role="status" aria-label={label} aria-live="polite" data-testid="page-skeleton" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem 0' }}>
      <div className="sk" style={skRow('38%', 28, { borderRadius: 8 })} />
      <div className="sk" style={skRow('56%', 12)} />
      {tiles > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))`, gap: '.6rem', marginTop: '.4rem' }}>
          {Array.from({ length: tiles }, (_, i) => <div key={i} className="sk" style={{ height: 64, borderRadius: 14 }} />)}
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk" style={{ height: 76, borderRadius: 16 }} />
      ))}
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{label}…</span>
    </div>
  )
}
