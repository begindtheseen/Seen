'use client'

/**
 * Top-of-page route progress hairline (the GitHub / YouTube pattern). Starts on any same-origin
 * link click that changes the pathname, or on `seen:nav-start` (the command palette), and
 * completes when the pathname changes. Pure DOM width transitions — no layout, no React churn.
 */
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import styles from './RouteProgress.module.css'

export default function RouteProgress() {
  const pathname = usePathname()
  const ref = useRef<HTMLDivElement>(null)
  const live = useRef(false)
  const timer = useRef<number | null>(null)
  const safety = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const clear = () => {
      if (timer.current) { window.clearInterval(timer.current); timer.current = null }
      if (safety.current) { window.clearTimeout(safety.current); safety.current = null }
    }
    const finish = () => {
      if (!live.current) return
      live.current = false
      clear()
      el.style.width = '100%'
      window.setTimeout(() => {
        el.style.opacity = '0'
        window.setTimeout(() => { el.style.transition = 'none'; el.style.width = '0'; void el.offsetWidth; el.style.transition = '' }, 320)
      }, 120)
    }
    const start = () => {
      if (live.current) return
      live.current = true
      clear()
      el.style.transition = 'none'; el.style.width = '0'; void el.offsetWidth; el.style.transition = ''
      el.style.opacity = '1'
      let w = 12
      el.style.width = w + '%'
      timer.current = window.setInterval(() => {
        w += Math.max(0.6, (88 - w) * 0.12)
        el.style.width = Math.min(88, w) + '%'
      }, 260)
      safety.current = window.setTimeout(finish, 10000)
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      let url: URL
      try { url = new URL(a.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname) return // hash / query-only moves are instant
      start()
    }
    const onProgrammatic = () => start()
    document.addEventListener('click', onClick, true)
    window.addEventListener('seen:nav-start', onProgrammatic)
    // A completed navigation (pathname effect below) or a page show from bfcache ends the bar.
    window.addEventListener('pageshow', finish)
    ;(el as HTMLDivElement & { _finish?: () => void })._finish = finish
    return () => {
      clear()
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('seen:nav-start', onProgrammatic)
      window.removeEventListener('pageshow', finish)
    }
  }, [])

  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { _finish?: () => void }) | null
    el?._finish?.()
  }, [pathname])

  return <div ref={ref} className={styles.bar} aria-hidden="true" />
}
