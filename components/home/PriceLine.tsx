'use client'

// The homepage's one line about money (owner decisions 2026-10-25): what is free forever and what is
// paid, in plain words, linking to /pricing. Counted as the homepage offer once it is actually on
// screen (offer_shown, surface homepage), and on the tap (offer_clicked).

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { PREP, PASS, PREP_PRICE, PASS_PRICE } from '@/lib/pricing'
import { funnelEvent } from '@/lib/funnel'

export default function PriceLine() {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { funnelEvent('offer_shown', { surface: 'homepage', once: 'homepage' }); io.disconnect() }
    }, { threshold: 0.6 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <p ref={ref} className="lp2-section-sub" data-testid="home-price-line" style={{ marginTop: '1.4rem', fontSize: 'var(--fs-ui)', maxWidth: '46ch', marginLeft: 'auto', marginRight: 'auto' }}>
      Company grades, the tracker, job search and résumé match are free forever. When they call you in, {PREP.name} is {PREP_PRICE} for that interview, or the {PASS.name} is {PASS_PRICE} for {PASS.pro_days} days. Nothing renews.{' '}
      <Link href="/pricing" onClick={() => funnelEvent('offer_clicked', { surface: 'homepage' })} style={{ color: 'var(--green)', whiteSpace: 'nowrap' }}>See pricing →</Link>
    </p>
  )
}
