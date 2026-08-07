'use client'

// ErrorBoundary — contains a render crash to one section instead of letting it bubble to Next.js's
// global boundary (the bare "Application error: a client-side exception has occurred" screen that
// replaces the whole page). Wrap any surface that renders variable/engine-derived data so a single
// malformed payload degrades gracefully to a retry prompt rather than taking down the route.

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Custom fallback UI. Falls back to a design-system card if omitted. */
  fallback?: ReactNode
  /** Short label for the console diagnostic (e.g. "deep-dive"). */
  label?: string
}

export default class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.error(`[Seen] section render error${this.props.label ? ` (${this.props.label})` : ''}:`, error)
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <div
        role="alert"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: '1.5rem 1.25rem',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '1.4rem', marginBottom: '.5rem' }}>⚠️</div>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.92rem', marginBottom: '.35rem' }}>
          This section couldn&apos;t be displayed
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.6 }}>
          Something in this result didn&apos;t render. The rest of your analysis is unaffected — try re-running it.
        </div>
      </div>
    )
  }
}
