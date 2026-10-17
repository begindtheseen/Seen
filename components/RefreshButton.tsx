'use client'

// One refresh button for the whole site. Refreshes run in the background (the page stays usable),
// so the button itself must show that something is happening: the ↻ spins while the work runs,
// then the label confirms it finished ("✓ Updated") or failed. A second press while running is
// ignored instead of stacking requests.

import { useEffect, useRef, useState, type CSSProperties } from 'react'

type Phase = 'idle' | 'busy' | 'done' | 'error'

export default function RefreshButton({
  onRefresh, label = 'Refresh', busyLabel = 'Refreshing…', doneLabel = 'Updated', className, style,
}: {
  onRefresh: () => unknown
  label?: string
  busyLabel?: string
  doneLabel?: string
  className?: string
  style?: CSSProperties
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true // re-set on (strict-mode) remount
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current) }
  }, [])

  async function run() {
    if (phase === 'busy') return
    if (timer.current) clearTimeout(timer.current)
    setPhase('busy')
    let ok: boolean
    // A refresh that resolves to `false` failed (it handled its own error); anything else is success.
    try { ok = (await onRefresh()) !== false } catch { ok = false }
    if (!alive.current) return
    setPhase(ok ? 'done' : 'error')
    timer.current = setTimeout(() => { if (alive.current) setPhase('idle') }, 1800)
  }

  const text = phase === 'busy' ? busyLabel : phase === 'done' ? `✓ ${doneLabel}` : phase === 'error' ? 'Failed — retry' : label
  return (
    <button
      type="button"
      onClick={run}
      aria-busy={phase === 'busy'}
      className={`refresh-btn${className ? ' ' + className : ''}`}
      style={style}
    >
      {phase !== 'done' && phase !== 'error' && (
        <span aria-hidden className={`refresh-btn-ico${phase === 'busy' ? ' spinning' : ''}`}>↻</span>
      )}
      <span>{text}</span>
    </button>
  )
}
