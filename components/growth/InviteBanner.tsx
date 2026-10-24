'use client'

// The invited friend's welcome. A visitor who arrived with ?ref= (the code waits in
// localStorage seen_ref_pending_v1, lib/referralClient.ts) used to see nothing at all: the best reason
// to sign up today was invisible (conversion audit 2026-10-24, journey 4). Signed-out visitors now get
// one slim bar until they sign up or close it. The numbers are the reward rules themselves
// (lib/server/creditRules.js, paid out by lib/server/growthRewards.js when the invitee tracks a first
// application). Hidden on the auth pages (the sign-up screen says it in its own headline) and on the
// employer and admin sides.

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { REFERRAL_REWARD_PRO_DAYS, proDaysLabel } from '@/lib/creditRules'
import { signupHref } from '@/lib/signupIntent.js'
import { safeSessionGet, safeSessionSet } from '@/lib/safeStorage'
import s from '@/components/track/track.module.css'

/** sessionStorage: closed for this tab session (it comes back on the next visit while the invite waits). */
export const INVITE_BANNER_CLOSED_KEY = 'seen_invite_banner_closed'
const HIDE_ON = ['/login', '/reset', '/signup', '/employers', '/admin', '/trial']

export default function InviteBanner({ pending }: { pending: boolean }) {
  const pathname = usePathname() || '/'
  const [closed, setClosed] = useState(true)
  useEffect(() => { setClosed(safeSessionGet(INVITE_BANNER_CLOSED_KEY) === '1') }, [])
  if (!pending || closed || HIDE_ON.some(p => pathname === p || pathname.startsWith(`${p}/`))) return null
  const next = pathname.startsWith('/company/') ? pathname : '/tracker'
  return (
    <>
    <div className={s.inviteSpacer} aria-hidden />
    <aside className={s.invite} role="region" aria-label="Your invite" data-testid="invite-banner">
      <span className={s.inviteText}>
        A friend invited you. Sign up and track your first application, and you both get {proDaysLabel(REFERRAL_REWARD_PRO_DAYS)}.
      </span>
      <a className={s.inviteCta} href={signupHref({ intent: 'invite', next })}>Sign up free</a>
      <button
        type="button"
        className={s.inviteClose}
        aria-label="Close"
        onClick={() => { safeSessionSet(INVITE_BANNER_CLOSED_KEY, '1'); setClosed(true) }}
      >
        ×
      </button>
    </aside>
    </>
  )
}
