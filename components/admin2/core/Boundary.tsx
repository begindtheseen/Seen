'use client'

// Loads a module on demand and contains its failures: a section (or an item view) that cannot load or
// throws while rendering shows ErrorState with Retry INSIDE its own area — the shell never blanks.
// Retry builds a fresh lazy component, because React.lazy remembers a failed import forever.
import { Component, Suspense, lazy, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { ErrorState, Skeleton } from '../ui/states.tsx'

class Catch extends Component<{ children: ReactNode; fallback: (err: Error) => ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { if (typeof console !== 'undefined') console.error('[admin] render error:', err) } // eslint-disable-line no-console
  render() { return this.state.err ? this.props.fallback(this.state.err) : this.props.children }
}

function describe(err: Error): string {
  const m = err?.message || ''
  if (/Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i.test(m)) {
    return 'This part of the admin could not be downloaded — the connection may have dropped, or a newer version was deployed. Retry loads it again.'
  }
  return `It stopped with an error: ${m || 'unknown error'}.`
}

export function Loadable<P extends object>({ load, props, what, skeletonRows = 4 }: {
  load: () => Promise<{ default: ComponentType<P> }>
  props: P
  /** Completes "Couldn't load …": "the Review section", "this report". */
  what: string
  skeletonRows?: number
}) {
  const [attempt, setAttempt] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const C = useMemo(() => lazy(load), [load, attempt])
  return (
    <Catch key={attempt} fallback={(err) => <ErrorState what={what} error={describe(err)} onRetry={() => setAttempt((a) => a + 1)} />}>
      <Suspense fallback={<Skeleton rows={skeletonRows} label={`Loading ${what}`} />}>
        <C {...props} />
      </Suspense>
    </Catch>
  )
}
