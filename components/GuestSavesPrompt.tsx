'use client'

// "Keep the 2 jobs you saved before signing in? Keep · Discard" — the ONE toast asked when a sign-in finds
// jobs saved on this device while signed out. Device-local data never imports into an account by itself
// (CLAUDE.md "Sign-out data isolation"); Keep sends them through SavedJobsStore.adoptGuestSaves (the
// save_job path), Discard — or no answer — leaves them on the device, where sign-out clears them.
// Mounted once by AuthProvider (lib/auth.tsx), which fires GUEST_SAVES_EVENT from its SIGNED_IN handling.
// Same surface as the site toast (components/ui/ui.css .ui-toast), top right, solid.

import { useEffect, useState } from 'react'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { showToast } from '@/lib/toast'
import Icon from '@/components/ui/Icon'

export const GUEST_SAVES_EVENT = 'seen:guest-saves'
/** No answer within this long counts as "leave them on the device". */
const AUTO_DISMISS_MS = 30_000

export default function GuestSavesPrompt() {
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const on = (e: Event) => {
      const n = Number((e as CustomEvent<{ count?: number }>).detail?.count) || SavedJobsStore.guestSaves().length
      if (n > 0) setCount(n)
    }
    window.addEventListener(GUEST_SAVES_EVENT, on)
    return () => window.removeEventListener(GUEST_SAVES_EVENT, on)
  }, [])

  useEffect(() => {
    if (!count) return
    const t = setTimeout(() => setCount(0), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [count])

  if (!count) return null

  const keep = async () => {
    setBusy(true)
    const { kept, failed } = await SavedJobsStore.adoptGuestSaves()
    setBusy(false)
    setCount(0)
    if (kept) showToast(`Kept ${kept} saved job${kept === 1 ? '' : 's'} — they’re on your account now.`)
    if (failed) showToast(`${failed} saved job${failed === 1 ? '' : 's'} didn’t reach your account — still on this device.`)
  }
  const discard = () => setCount(0)

  const btn: React.CSSProperties = { minHeight: 44, padding: '0 1rem', borderRadius: 'var(--r-control)', fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer' }

  return (
    <div className="ui-toast-stack" style={{ zIndex: 100001 }}>
      <div className="ui-toast" role="dialog" aria-label="Jobs saved before signing in" data-testid="guest-saves-prompt" style={{ cursor: 'default', flexDirection: 'column', gap: 'var(--sp-3)', ['--acc' as string]: 'var(--info-text)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
          <span className="ui-toast__icon"><Icon name="heart" size={18} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="ui-toast__title">Keep the {count} job{count === 1 ? '' : 's'} you saved before signing in?</div>
            <div className="ui-toast__sub">Keep adds {count === 1 ? 'it' : 'them'} to your account. Discard leaves {count === 1 ? 'it' : 'them'} on this device only.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={discard} disabled={busy} style={{ ...btn, background: 'transparent', border: '1px solid var(--border-2)', color: 'var(--text-2)' }}>Discard</button>
          <button type="button" onClick={keep} disabled={busy} style={{ ...btn, background: 'var(--cta)', border: '1px solid transparent', color: 'var(--text-1)', boxShadow: 'var(--sh-control)' }}>{busy ? 'Keeping…' : 'Keep'}</button>
        </div>
      </div>
    </div>
  )
}
