'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const VALUE_CARDS = [
  {
    title: 'Ghost rates',
    desc: 'See how often applicants report getting no response.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 10h.01M15 10h.01" />
        <path d="M12 2a8 8 0 0 0-8 8v11l3-2 2 2 3-2 3 2 2-2 3 2V10a8 8 0 0 0-8-8Z" />
      </svg>
    ),
  },
  {
    title: 'Response times',
    desc: 'Know whether people hear back in days, weeks, or never.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    title: 'Company grades',
    desc: 'Compare companies before you spend time applying.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 2l2.4 5 5.6.8-4 4 1 5.6L12 19l-5 2.4 1-5.6-4-4 5.6-.8L12 2Z" />
      </svg>
    ),
  },
  {
    title: 'Real outcomes',
    desc: 'Built from applicant reports, not company marketing.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    ),
  },
]

const STEPS = [
  { n: 1, t: 'Search a company' },
  { n: 2, t: 'See real applicant outcomes' },
  { n: 3, t: 'Decide if it is worth applying' },
]

export default function LandingMarketingSections() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const els = wrapRef.current?.querySelectorAll<HTMLElement>('[data-reveal]')
    if (!els || !('IntersectionObserver' in window)) {
      els?.forEach(el => { el.style.opacity = '1'; el.style.transform = 'none' })
      return
    }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement
          el.style.transitionDelay = `${el.dataset.delay || '0'}ms`
          el.style.opacity = '1'
          el.style.transform = 'translateY(0)'
          obs.unobserve(el)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' })

    els.forEach(el => {
      el.style.opacity = '0'
      el.style.transform = 'translateY(24px)'
      el.style.transition = 'opacity .6s cubic-bezier(.16,1,.3,1), transform .6s cubic-bezier(.16,1,.3,1)'
      obs.observe(el)
    })
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={wrapRef}>
      {/* VALUE SECTION */}
      <section className="lp2-section">
        <div className="lp2-wrap">
          <div className="lp2-section-head" data-reveal>
            <div className="lp2-kicker">Why Seen</div>
            <h2 className="lp2-h2">Stop applying blind.</h2>
          </div>
          <div className="lp2-grid-4">
            {VALUE_CARDS.map((c, i) => (
              <div key={c.title} className="lp2-card" data-reveal data-delay={`${i * 70}`}>
                <div className="lp2-card-ico">{c.icon}</div>
                <h3 className="lp2-card-t">{c.title}</h3>
                <p className="lp2-card-d">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp2-section" style={{ paddingTop: 0 }}>
        <div className="lp2-wrap">
          <div className="lp2-section-head" data-reveal>
            <div className="lp2-kicker">Simple by design</div>
            <h2 className="lp2-h2">How SeenJobs works</h2>
          </div>
          <div className="lp2-steps">
            {STEPS.map((s, i) => (
              <div key={s.n} className="lp2-step" data-reveal data-delay={`${i * 90}`}>
                <div className="lp2-step-n">{s.n}</div>
                <h3 className="lp2-step-t">{s.t}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="lp2-final">
        <div className="lp2-wrap">
          <div className="lp2-final-card" data-reveal>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <h2 className="lp2-h2" style={{ maxWidth: '18ch', margin: '0 auto' }}>
                Check your next company before you apply.
              </h2>
              <div className="lp2-cta-row" style={{ marginTop: '2rem' }}>
                <button className="lp2-btn lp2-btn-primary" onClick={() => router.push('/companies')}>
                  Check a company
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
