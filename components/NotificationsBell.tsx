'use client'

// Bell in the top bar for job seekers → a modal of application updates (owner request 2026-10-18):
// employer status changes, employer messages, listing edits. Derived from the tracker data
// (lib/applicationNotifications.js) — no new storage beyond a per-user "last opened" time.
// The count shows instantly from the cached tracker, then refreshes from the server.

import { useCallback, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import ModalPortal from '@/components/ModalPortal'
import { AppStore } from '@/lib/stores/AppStore'
import { applicationNotifications, unreadCount, lastSeenKey } from '@/lib/applicationNotifications.js'
import type { Application } from '@/lib/types'

type Item = { id: string; at: number; appId: string; company: string; role: string; kind: string; tone: string; text: string; message?: string }

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

const readSeen = (uid: string) => { try { return Number(localStorage.getItem(lastSeenKey(uid))) || 0 } catch { return 0 } }
const writeSeen = (uid: string, ms: number) => { try { localStorage.setItem(lastSeenKey(uid), String(ms)) } catch { /* private mode */ } }

function when(ms: number) {
  const d = Math.floor((Date.now() - ms) / 86400000)
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function NotificationsBell({ uid, className }: { uid: string; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [items, setItems] = useState<Item[]>([])
  const [seenAt, setSeenAt] = useState(0)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setItems(applicationNotifications(await AppStore.load(true) as Application[]) as Item[]) }
    catch { /* keep what we have */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    setSeenAt(readSeen(uid))
    setItems(applicationNotifications(AppStore.loadSync()) as Item[]) // instant, from the cached tracker
    // A server refresh on page load at most every 10 minutes (opening the modal always refreshes).
    let last = 0
    try { last = Number(sessionStorage.getItem('seen_notif_refreshed')) || 0 } catch { /* ignore */ }
    if (Date.now() - last > 10 * 60 * 1000) {
      try { sessionStorage.setItem('seen_notif_refreshed', String(Date.now())) } catch { /* ignore */ }
      refresh()
    }
  }, [uid, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const unread = unreadCount(items, seenAt)

  function openModal() {
    setOpen(true)
    refresh()
  }
  function closeModal() {
    // Everything shown is now read; the dots stay visible while the modal is open.
    const now = Date.now()
    writeSeen(uid, now); setSeenAt(now)
    setOpen(false)
  }
  function go(it: Item) {
    closeModal()
    // On the tracker already, a hash change is enough (it listens for hashchange); elsewhere, go there.
    if (pathname === '/tracker') window.location.hash = `app_${it.appId}`
    else router.push(`/tracker#app_${it.appId}`)
  }

  const toneColor = (t: string) => (t === 'good' ? 'var(--green)' : t === 'bad' ? 'var(--red)' : 'var(--blue)')

  return (
    <>
      <button type="button" onClick={openModal} className={className} title="Application updates" aria-label={unread ? `Application updates — ${unread} new` : 'Application updates'} style={{ position: 'relative', cursor: 'pointer' }}>
        <BellIcon />
        {unread > 0 && (
          <span aria-hidden style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: 'var(--red)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '.55rem', fontWeight: 700, lineHeight: '16px', textAlign: 'center', boxSizing: 'border-box' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <ModalPortal>
          <div onClick={closeModal} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(2,4,10,.82)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 1rem', overflowY: 'auto' }}>
            <div role="dialog" aria-modal="true" aria-label="Application updates" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 16, padding: '1.1rem 1.1rem 1.2rem', boxShadow: '0 30px 90px rgba(0,0,0,.6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.8rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--blue)' }}>Notifications</div>
                  <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--white)', marginTop: '.15rem' }}>Application updates</div>
                </div>
                <button type="button" onClick={closeModal} aria-label="Close" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, width: 32, height: 32, color: 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>✕</button>
              </div>

              {items.length === 0 ? (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.64rem', color: 'var(--muted)', lineHeight: 1.6, padding: '.6rem 0 .2rem' }}>
                  {loading ? 'Checking for updates…' : 'No updates yet. When an employer reviews, messages or decides on an application you sent on Seen, it shows up here.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem', maxHeight: '62vh', overflowY: 'auto' }}>
                  {items.map(it => {
                    const isNew = it.at > seenAt
                    return (
                      <button key={it.id} type="button" onClick={() => go(it)}
                        style={{ textAlign: 'left', width: '100%', cursor: 'pointer', background: isNew ? 'rgba(59,130,246,.07)' : 'var(--raised)', border: `1px solid ${isNew ? 'rgba(59,130,246,.3)' : 'var(--line)'}`, borderRadius: 10, padding: '.6rem .7rem', display: 'flex', gap: '.6rem', alignItems: 'flex-start' }}>
                        <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', marginTop: '.4rem', flexShrink: 0, background: isNew ? toneColor(it.tone) : 'transparent', border: `1px solid ${toneColor(it.tone)}` }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: '.82rem', color: 'var(--white)', fontWeight: isNew ? 700 : 500, lineHeight: 1.4 }}>{it.text}</span>
                          {it.role && <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--sub)', marginTop: '.15rem' }}>{it.role}</span>}
                          {it.message && <span style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.45, marginTop: '.3rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>“{it.message}”</span>}
                        </span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', flexShrink: 0, marginTop: '.15rem' }}>{when(it.at)}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginTop: '.75rem', lineHeight: 1.5 }}>
                Tap an update to open it in your tracker.
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  )
}
