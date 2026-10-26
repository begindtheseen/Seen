'use client'

// The company page's one paid line (owner decisions 2026-10-25): under "Applied to {Company}? Track it",
// for the reader who already has the interview. It leads to the tracker with the application filled in
// at the Interview stage, where the card shows the free interview record and prep preview first and the
// $9.99 Interview Prep after (components/tracker/InterviewPrep.tsx). One quiet line — never a second
// card, never stacked with another ask.

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { cleanCompany } from '@/lib/signupIntent.js'
import { funnelEvent } from '@/lib/funnel'
import s from '@/components/track/track.module.css'

export function prepTrackHref(company: string): string {
  const q = new URLSearchParams({ add: '1', company: cleanCompany(company), stage: 'Interview' })
  return `/tracker?${q.toString()}`
}

export default function InterviewPrepLine({ company }: { company: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { funnelEvent('offer_shown', { surface: 'company_page', sku: 'interview', company, once: `company_${company.toLowerCase()}` }); io.disconnect() }
    }, { threshold: 0.6 })
    io.observe(el)
    return () => io.disconnect()
  }, [company])
  return (
    <p ref={ref} className={s.small} data-testid="company-prep-line" style={{ margin: '.75rem 0 0' }}>
      Got an interview at {company}?{' '}
      <Link href={prepTrackHref(company)} onClick={() => funnelEvent('offer_clicked', { surface: 'company_page', sku: 'interview', company })} style={{ color: 'var(--accent)', fontWeight: 600, display: 'inline-block', padding: '.7rem 0', margin: '-.7rem 0' }}>
        Get your prep
      </Link>
      {' '}— questions for the role, answers from your résumé, and what applicants report about {company}&apos;s interviews.
    </p>
  )
}
