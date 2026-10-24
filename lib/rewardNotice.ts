'use client'

// The line a person sees when a growth reward answer comes back (lib/growthCopy.js words it):
// "+3 days of Seen Pro" after a rewarded report, an honest note when this month's report reward days
// are used up or the application is under a week on the tracker, and the invite reward after a
// friend's first tracked application. A granted reward also refreshes the nav's Pro state.

import { notify } from './notify'
import { reportRewardMessage, referralRewardMessage } from './growthCopy.js'

type RewardAnswer = Parameters<typeof reportRewardMessage>[0]

function refreshCredits() {
  try { window.dispatchEvent(new Event('seen:credits-updated')) } catch { /* no window */ }
}

export function showReportReward(reward: RewardAnswer): void {
  const m = reportRewardMessage(reward)
  if (!m) return
  notify({ title: m.title, sub: m.sub, severity: m.kind === 'granted' ? 'money' : 'info', key: `report-reward-${m.kind}`, duration: m.kind === 'granted' ? 6000 : 8000 })
  if (m.kind === 'granted') refreshCredits()
}

export function showReferralReward(reward: Parameters<typeof referralRewardMessage>[0]): void {
  const m = referralRewardMessage(reward)
  if (!m) return
  notify({ title: m.title, sub: m.sub, severity: 'money', key: 'referral-reward', duration: 7000 })
  refreshCredits()
}
