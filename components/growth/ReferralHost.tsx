'use client'

// Mounted once in app/layout.tsx. Keeps an invite code that arrived in the URL (?ref=) and claims it
// as soon as an account is signed in on this device (lib/referralClient.ts), and does the same for the
// device's first touch (where it came from — lib/attributionClient.ts). Renders nothing.

import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { captureRefFromUrl, claimPendingRef } from '@/lib/referralClient'
import { captureFirstTouch, recordPendingTouch } from '@/lib/attributionClient'

export default function ReferralHost() {
  const { user, ready } = useAuth()
  // Order matters: the first touch reads ?ref= before captureRefFromUrl() removes it from the address bar.
  useEffect(() => { captureFirstTouch(); captureRefFromUrl() }, [])
  useEffect(() => {
    if (!ready || !user?.id) return
    void claimPendingRef()
    void recordPendingTouch(user.id)
  }, [ready, user?.id])
  return null
}
