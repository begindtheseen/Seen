'use client'

// Mounted once in app/layout.tsx. Keeps an invite code that arrived in the URL (?ref=) and claims it
// as soon as an account is signed in on this device (lib/referralClient.ts), and does the same for the
// device's first touch (where it came from — lib/attributionClient.ts). After the claim it creates the
// applications a guest's sign-up carried (lib/pendingApplicationClient.ts) — claim first, so the
// invitee's first tracked application is the one that pays out the invite. While a code waits and
// nobody is signed in, it shows the invite banner (components/growth/InviteBanner.tsx).

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { captureRefFromUrl, claimPendingRef, hasPendingRef } from '@/lib/referralClient'
import { captureFirstTouch, recordPendingTouch } from '@/lib/attributionClient'
import { importPendingApplications } from '@/lib/pendingApplicationClient'
import InviteBanner from './InviteBanner'

export default function ReferralHost() {
  const { user, ready } = useAuth()
  const [pendingRef, setPendingRef] = useState(false)
  // Order matters: the first touch reads ?ref= before captureRefFromUrl() removes it from the address bar.
  useEffect(() => { captureFirstTouch(); captureRefFromUrl(); setPendingRef(hasPendingRef()) }, [])
  useEffect(() => {
    if (!ready || !user?.id) return
    let alive = true
    void (async () => {
      await claimPendingRef().catch(() => undefined)
      if (alive) setPendingRef(hasPendingRef())
      void recordPendingTouch(user.id)
      await importPendingApplications(user)
    })()
    return () => { alive = false }
    // user object identity changes on every token refresh; the id is what matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id])
  return <InviteBanner pending={ready && !user && pendingRef} />
}
