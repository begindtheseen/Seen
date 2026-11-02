'use client'

import { useState } from 'react'
import Icon from '@/components/ui/Icon'
import { relTime } from './primitives'
import type { LiveEvent } from '@/lib/hooks/useAdminLive'

// Fixed notification bell + live activity feed for the admin dashboard (Seen Live). Shows an
// unread badge, a pulsing "live" dot when polling is healthy, and a dropdown feed of real events
// that arrive without a refresh. Fed by useAdminLive.

const DOT: Record<LiveEvent['sev'], string> = {
  blue: 'var(--blue)', green: 'var(--green)', money: 'var(--caution-text)', amber: 'var(--amber)', violet: 'var(--accent)',
}

export function LiveBell({ events, unread, markRead, live }: {
  events: LiveEvent[]; unread: number; markRead: () => void; live: boolean
}) {
  const [open, setOpen] = useState(false)

  function toggle() {
    setOpen(o => {
      if (!o) markRead()
      return !o
    })
  }

  return (
    <div style={{ position: 'fixed', top: 'max(70px, calc(env(safe-area-inset-top,0px) + 58px))', right: 16, zIndex: 9998 }}>
      <button
        onClick={toggle}
        aria-label="Live activity"
        style={{
          position: 'relative', width: 40, height: 40, borderRadius: 12,
          background: open ? 'var(--raised)' : 'rgba(12,15,26,.85)', border: '1px solid var(--line2)',
          backdropFilter: 'blur(10px)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 24px rgba(0,0,0,.4)',
        }}
      >
        <span style={{ fontSize: 'var(--fs-lead)', lineHeight: 1 }}><Icon name="bell" size={18} /></span>
        {/* live dot */}
        <span style={{
          position: 'absolute', top: 8, left: 8, width: 6, height: 6, borderRadius: 999,
          background: live ? 'var(--green)' : 'var(--muted)',
          boxShadow: live ? '0 0 6px var(--green)' : 'none',
          animation: live ? 'pulse 1.8s infinite' : 'none',
        }} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 999,
            background: 'var(--red)', color: 'var(--text-1)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--void)',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 48, right: 0, width: 'min(340px, calc(100vw - 28px))', maxHeight: '60vh', overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(18,22,34,.99), rgba(10,13,22,.99))', border: '1px solid var(--line2)',
          borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,.6)', backdropFilter: 'blur(16px)', padding: '.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.25rem .5rem .5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: live ? 'var(--green)' : 'var(--muted)', boxShadow: live ? '0 0 6px var(--green)' : 'none', animation: live ? 'pulse 1.8s infinite' : 'none' }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.14em', color: live ? 'var(--green)' : 'var(--muted)' }}>{live ? 'Live' : 'Reconnecting…'}</span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)' }}>Activity</span>
          </div>

          {events.length === 0 ? (
            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', lineHeight: 1.6 }}>
              You&apos;re all caught up.<br />New activity shows up here the moment it happens.
            </div>
          ) : events.map(e => (
            <div key={e.id} className="feed-row-in" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '.5rem .5rem', borderTop: '1px solid var(--line)' }}>
              <span style={{ flexShrink: 0, marginTop: 4, width: 7, height: 7, borderRadius: 999, background: DOT[e.sev], boxShadow: `0 0 6px ${DOT[e.sev]}` }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-meta)', fontWeight: 700, color: 'var(--white)', lineHeight: 1.3 }}>{e.title}</div>
                {e.sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.sub}</div>}
              </div>
              <span style={{ flexShrink: 0, fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)' }}>{relTime(e.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
