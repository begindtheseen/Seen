'use client'

// "Invite friends": the signed-in person's invite link, a copy / share button, how many invites have
// been rewarded (of REFERRAL_MAX_REWARDED) and the Seen Pro days earned from reports and invites.
// Hidden until the growth tables exist (referral_status answers ready:false before the migration).
// Every number and sentence comes from lib/growthCopy.js, which renders from lib/server/creditRules.js.

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { referralUrl } from '@/lib/referral.js'
import { referralStatus, type ReferralStatus } from '@/lib/referralClient'
import { INVITE_TITLE, inviteShareText, inviteLine, inviteProgress, inviteWaiting, inviteCapLine, earnedLine, reportRewardLine, proUntilLine } from '@/lib/growthCopy.js'
import { track } from '@/lib/analytics'
import s from './InviteCard.module.css'

export default function InviteCard({ id, onReady }: { id?: string; onReady?: (ready: boolean) => void }) {
  const { user, ready } = useAuth()
  const [st, setSt] = useState<ReferralStatus | null>(null)
  const [note, setNote] = useState('')
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    if (!ready || !user?.id) return
    let on = true
    referralStatus(user.id, { fresh: true }).then(r => { if (!on) return; setSt(r); onReady?.(!!(r?.ready && r.code)) })
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
    return () => { on = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id])

  if (!st || !st.ready || !st.code) return null
  const url = referralUrl(st.code)
  const shown = url.replace(/^https:\/\//, '')
  const text = inviteShareText()

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setNote('Link copied.')
      track('invite_link_copied', {})
    } catch {
      setNote('Copy did not work. Press and hold the link to copy it.')
    }
    setTimeout(() => setNote(''), 2500)
  }
  async function share() {
    try {
      await navigator.share({ text, url })
      track('invite_link_shared', { method: 'native' })
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') void copy()
    }
  }

  const waiting = inviteWaiting(st.waiting)
  const cap = inviteCapLine(st.rewarded)
  const earned = earnedLine(st.pro_days_earned)
  const until = proUntilLine(st.pro_until)

  return (
    <section className={s.card} id={id} aria-labelledby="invite-title">
      <div className={s.head}>
        <span className={s.eyebrow}>Earn Seen Pro</span>
        <h2 id="invite-title" className={s.title}>{INVITE_TITLE}</h2>
        <p className={s.lead}>{inviteLine()}</p>
      </div>
      <div className={s.linkRow}>
        <code className={s.link} aria-label="Your invite link">{shown}</code>
        <div className={s.btns}>
          <button type="button" className={s.primary} onClick={copy}>Copy link</button>
          {canShare && <button type="button" className={s.ghost} onClick={share}>Share</button>}
        </div>
      </div>
      {note && <p className={s.note} role="status">{note}</p>}
      <div className={s.stats}>
        <div className={s.stat}>
          <b>{inviteProgress(st.rewarded)}</b>
          {waiting && <small>{waiting}</small>}
          {cap && <small>{cap}</small>}
        </div>
        <div className={s.stat}>
          <b>{earned || 'No Pro days earned yet'}</b>
          {until && <small>{until}</small>}
        </div>
      </div>
      <p className={s.fine}>{reportRewardLine()}</p>
    </section>
  )
}
