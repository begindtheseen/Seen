'use client'

// "Send this to someone applying here." The warn-a-friend share on every company page (under the
// grade) and right after someone reports a ghosting or rejection (the outcome card). The native share
// sheet when the device has one, else the text and link are copied. A signed-in person's link carries
// their invite code (lib/referralClient.ts), so a friend who joins from it counts as their invite;
// a guest shares the plain company link. The words come from lib/growthCopy.js.

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { referralUrl } from '@/lib/referral.js'
import { myInviteUrl } from '@/lib/referralClient'
import { WARN_FRIEND_LABEL } from '@/lib/growthCopy.js'
import { track } from '@/lib/analytics'
import s from './WarnFriendShare.module.css'

interface Props {
  /** The text the friend reads (lib/growthCopy.js warnFriendText / warnAfterOutcomeText). */
  text: string
  /** The page the link opens, e.g. '/company/acme'. */
  path: string
  /** The line above the button. Omit for just the button. */
  lead?: string
  /** 'page' = a strip on the company page; 'modal' = inside the outcome card's dark sheet. */
  variant?: 'page' | 'modal'
  /** For analytics only. */
  context: 'company_page' | 'after_report'
}

export default function WarnFriendShare({ text, path, lead, variant = 'page', context }: Props) {
  const { user } = useAuth()
  const [url, setUrl] = useState(() => referralUrl(null, path))
  const [note, setNote] = useState('')

  // Read the invite link before the tap: the share sheet must open in the same tap, with no wait.
  useEffect(() => {
    let on = true
    setUrl(referralUrl(null, path))
    if (user?.id) myInviteUrl(user.id, path).then(u => { if (on) setUrl(u) }).catch(() => {})
    return () => { on = false }
  }, [user?.id, path])

  async function share() {
    setNote('')
    const nav = typeof navigator !== 'undefined' ? navigator : null
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ text, url })
        track('warn_friend_shared', { context, method: 'native', invite: url.includes('ref=') })
        return
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return // closed the sheet: nothing to say
      }
    }
    try {
      await nav!.clipboard.writeText(`${text} ${url}`)
      setNote('Copied. Paste it in a text or chat.')
      track('warn_friend_shared', { context, method: 'copy', invite: url.includes('ref=') })
    } catch {
      setNote(`Copy this link: ${url}`)
    }
  }

  return (
    <div className={`${s.wrap} ${variant === 'modal' ? s.modal : s.page}`}>
      {lead && <p className={s.lead}>{lead}</p>}
      <button type="button" className={s.btn} onClick={share}>
        <span aria-hidden="true" className={s.ico}>↗</span>
        <span>{WARN_FRIEND_LABEL}</span>
      </button>
      {note && <p className={s.note} role="status">{note}</p>}
    </div>
  )
}
