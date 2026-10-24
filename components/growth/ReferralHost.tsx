'use client'

// Mounted once in app/layout.tsx. Keeps an invite code that arrived in the URL (?ref=) and claims it
// as soon as an account is signed in on this device (lib/referralClient.ts). Renders nothing.

import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { captureRefFromUrl, claimPendingRef } from '@/lib/referralClient'

export default function ReferralHost() {
  const { user, ready } = useAuth()
  useEffect(() => { captureRefFromUrl() }, [])
  useEffect(() => {
    if (!ready || !user?.id) return
    void claimPendingRef()
  }, [ready, user?.id])
  return null
}
