'use client'

import { CHECK_SCHEDULE } from '../constants'
import type { Application, Badge } from '../types'

interface StoredCheckEvent {
  appId?: string
  type: string
  createdAt?: number
}

export const BadgeStore = {
  compute(apps: Application[], allChecks: StoredCheckEvent[]): Badge[] {
    const b: Badge[] = []
    const hired    = apps.filter(a => a.status === 'hired')
    const ghosted  = apps.filter(a => a.status === 'ghosted')
    const rejected = apps.filter(a => a.status === 'rejected')
    const terminal = hired.length + ghosted.length + rejected.length

    const hasInterview = (a: Application) =>
      (a.events || []).some(e => ['interview_received', 'interview_completed'].includes(e.type))

    const offerDays = (a: Application): number | null => {
      const oe = (a.events || []).find(e => e.type === 'offer_received')
      return oe ? Math.max(1, Math.round((oe.date - a.appliedAt) / 86400000)) : null
    }

    if (hired.length >= 1) {
      b.push({ id: 'first_offer', icon: '🎉', label: 'First Offer', desc: 'Received a job offer tracked through Seen' })
    }

    if (hired.length >= 2) {
      b.push({ id: 'offer_streak', icon: '🔥', label: `Offer Streak ×${hired.length}`, desc: `Received ${hired.length} job offers` })
    }

    const fastApp = hired.find(a => { const d = offerDays(a); return d !== null && d <= 14 })
    if (fastApp) {
      const d = offerDays(fastApp)
      b.push({ id: 'fast_hire', icon: '⚡', label: 'Fast Hire', desc: `Offer received in just ${d} days` })
    }

    if (apps.length >= 5) {
      b.push({ id: 'consistent_tracker', icon: '📊', label: 'Consistent Tracker', desc: `Actively tracked ${apps.length}+ applications` })
    }

    if (terminal >= 3) {
      b.push({ id: 'transparency_contributor', icon: '🔬', label: 'Transparency Contributor', desc: `Contributed ${terminal} hiring outcomes to the community` })
    }

    if (apps.length >= 5) {
      const ir = apps.filter(hasInterview).length / apps.length
      if (ir >= 0.4) b.push({ id: 'high_interview_rate', icon: '🗓', label: 'High Interview Rate', desc: `${Math.round(ir * 100)}% interview rate — top tier` })
    }

    if (apps.length >= 5 && hired.length >= 1) {
      const or = hired.length / apps.length
      if (or >= 0.1) b.push({ id: 'strong_conversion', icon: '🏆', label: 'Strong Converter', desc: `${Math.round(or * 100)}% offer rate — outstanding` })
    }

    const earlyCount = apps.filter(a =>
      CHECK_SCHEDULE.some(chk => {
        const evt = allChecks.find(e => e.appId === a.id && e.type === chk.type)
        if (!evt || !evt.createdAt) return false
        const dueAt = a.appliedAt + chk.day * 86400000
        return evt.createdAt <= dueAt + 86400000
      })
    ).length
    if (earlyCount >= 3) {
      b.push({ id: 'early_responder', icon: '⏱', label: 'Early Responder', desc: 'Completed 3+ outcome check-ins within 24 hours of being due' })
    }

    return b
  },
}
