'use client'

// Is the signed-in person Pro? — for price labels. true / false once known, null while unknown
// (a label then shows the credit price, which is what a free account pays). Shares the one
// get_credits request with the Nav through _sync, and refreshes on 'seen:credits-updated'.
import { useEffect, useState } from 'react'
import { _sync } from '@/lib/sync'
import { useAuth } from '@/lib/auth'

export function useProStatus(): boolean | null {
  const { isLoggedIn } = useAuth()
  const [pro, setPro] = useState<boolean | null>(null)
  useEffect(() => {
    if (!isLoggedIn) { setPro(null); return }
    let cancelled = false
    const load = () => {
      _sync('get_credits')
        .then((d) => { if (!cancelled && d && typeof d === 'object') setPro(!!(d as { pro?: boolean }).pro) })
        .catch(() => { /* unknown stays null */ })
    }
    load()
    window.addEventListener('seen:credits-updated', load)
    return () => { cancelled = true; window.removeEventListener('seen:credits-updated', load) }
  }, [isLoggedIn])
  return pro
}
