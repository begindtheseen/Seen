'use client'

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react'
import { NOTIFY_EVENT, type NotifyPayload, type NotifySeverity } from '@/lib/notify'
import Icon from '@/components/ui/Icon'
import type { IconName } from '@/components/ui/icons'

// THE toast (the only one — lib/toast.ts showToast() and lib/notify.ts notify() both land here).
// Mounted once in app/layout.tsx. Listens for the 'seen:notify' window event and stacks toasts top
// right on a solid surface (components/ui/ui.css .ui-toast). Enter/leave use the .seen-toast /
// .seen-toast.leaving keyframes in app/motion.css (reduced-motion aware).

type Toast = NotifyPayload & { tid: number; dur: number; leaving?: boolean }

const SEV: Record<NotifySeverity, { accent: string; icon: IconName }> = {
  info:    { accent: 'var(--info-text)',    icon: 'info' },
  success: { accent: 'var(--good-text)',    icon: 'circle-check' },
  money:   { accent: 'var(--caution-text)', icon: 'circle-dollar-sign' },
  warn:    { accent: 'var(--caution-text)', icon: 'triangle-alert' },
  error:   { accent: 'var(--bad-text)',     icon: 'circle-x' },
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
      setToasts(prev => [...prev.slice(-4), { ...p, tid, dur }]) // keep at most 5 on screen
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
    <div aria-live="polite" className="ui-toast-stack">
      {toasts.map(t => {
        const sev = SEV[t.severity || 'info']
        // --dur drives the timer hairline that drains along the bottom edge (app/motion.css).
        const vars = { '--dur': `${t.dur}ms`, '--acc': sev.accent } as CSSProperties
        return (
          <div
            key={t.tid}
            role="status"
            className={`ui-toast seen-toast${t.dur > 0 ? ' timed' : ''}${t.leaving ? ' leaving' : ''}`}
            onClick={() => dismiss(t.tid)}
            style={vars}
          >
            <span className="ui-toast__icon"><Icon name={sev.icon} size={18} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="ui-toast__title">{t.title}</div>
              {t.sub && <div className="ui-toast__sub">{t.sub}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
