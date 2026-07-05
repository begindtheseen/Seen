'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { NOTIFY_EVENT, type NotifyPayload, type NotifySeverity } from '@/lib/notify'

// Global, stacked, animated toast host. Mounted once in app/layout.tsx. Listens for the
// 'seen:notify' window event (see lib/notify.ts) and renders premium slide-in toasts — the
// "something happened" surface that pops on real events, never on a refresh. Enter/leave use
// the .seen-toast / .seen-toast.leaving keyframes in globals.css (reduced-motion aware).

type Toast = NotifyPayload & { tid: number; leaving?: boolean }

const SEV: Record<NotifySeverity, { accent: string; glow: string; icon: string }> = {
  info:    { accent: 'var(--blue)',  glow: 'rgba(59,130,246,.32)', icon: '›' },
  success: { accent: 'var(--green)', glow: 'rgba(16,185,129,.32)', icon: '✓' },
  money:   { accent: '#f7c948',      glow: 'rgba(247,201,72,.38)', icon: '$' },
  warn:    { accent: 'var(--amber)', glow: 'rgba(245,158,11,.32)', icon: '!' },
  error:   { accent: 'var(--red)',   glow: 'rgba(239,68,68,.32)',  icon: '✕' },
}

let _seq = 0

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const recentKeys = useRef<Map<string, number>>(new Map())

  const dismiss = useCallback((tid: number) => {
    setToasts(prev => prev.map(t => (t.tid === tid ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts(prev => prev.filter(t => t.tid !== tid)), 260)
    if (timers.current[tid]) { clearTimeout(timers.current[tid]); delete timers.current[tid] }
  }, [])

  useEffect(() => {
    function onNotify(e: Event) {
      const p = (e as CustomEvent<NotifyPayload>).detail
      if (!p || !p.title) return
      if (p.key) {
        const now = Date.now()
        const last = recentKeys.current.get(p.key)
        if (last && now - last < 4000) return
        recentKeys.current.set(p.key, now)
      }
      const tid = ++_seq
      const dur = p.duration ?? 5000
      setToasts(prev => [...prev.slice(-4), { ...p, tid }]) // keep at most 5 on screen
      if (dur > 0) timers.current[tid] = setTimeout(() => dismiss(tid), dur)
    }
    window.addEventListener(NOTIFY_EVENT, onNotify as EventListener)
    const t = timers.current
    return () => {
      window.removeEventListener(NOTIFY_EVENT, onNotify as EventListener)
      Object.values(t).forEach(clearTimeout)
    }
  }, [dismiss])

  if (!toasts.length) return null

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed', top: 'max(76px, calc(env(safe-area-inset-top, 0px) + 64px))', right: 12, zIndex: 10000,
        display: 'flex', flexDirection: 'column', gap: 10, width: 'min(360px, calc(100vw - 24px))', pointerEvents: 'none',
      }}
    >
      {toasts.map(t => {
        const sev = SEV[t.severity || 'info']
        return (
          <div
            key={t.tid}
            role="status"
            className={`seen-toast${t.leaving ? ' leaving' : ''}`}
            onClick={() => dismiss(t.tid)}
            style={{
              pointerEvents: 'auto', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
              background: 'linear-gradient(180deg, rgba(20,24,36,.98), rgba(12,15,26,.98))',
              border: '1px solid var(--line2)', borderLeft: `3px solid ${sev.accent}`,
              borderRadius: 12, padding: '.8rem .95rem',
              boxShadow: `0 10px 40px rgba(0,0,0,.5), 0 0 24px ${sev.glow}`, backdropFilter: 'blur(12px)',
            }}
          >
            <div style={{
              flexShrink: 0, width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `${sev.accent}22`, color: sev.accent, fontFamily: 'var(--mono)', fontSize: '.85rem', fontWeight: 800,
            }}>{sev.icon}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', lineHeight: 1.3 }}>{t.title}</div>
              {t.sub && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.sub}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
