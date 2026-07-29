'use client'

import { useRouter } from 'next/navigation'
import Reveal from '@/components/Reveal'

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
  { n: 1, t: 'Search a company', d: 'Type a name — or tap an example above.' },
  { n: 2, t: 'See real applicant outcomes', d: 'Ghost rate, response time, and a grade.' },
  { n: 3, t: 'Decide if it’s worth applying', d: 'Spend your hours where people hear back.' },
]

export default function LandingMarketingSections() {
  const router = useRouter()

  return (
    <div>
      {/* VALUE SECTION */}
      <section className="lp2-section">
        <div className="lp2-wrap">
          <Reveal className="lp2-section-head">
            <div className="lp2-kicker">Why Seen</div>
            <h2 className="lp2-h2">Stop applying blind.</h2>
            <p className="lp2-section-sub">
              Every number on Seen comes from what actually happened to real applicants —
              never from employer marketing.
            </p>
          </Reveal>
          <div className="lp2-grid-4">
            {VALUE_CARDS.map((c, i) => (
              <Reveal key={c.title} delay={i * 70}>
                <div className="lp2-card">
                  <div className="lp2-card-ico">{c.icon}</div>
                  <h3 className="lp2-card-t">{c.title}</h3>
                  <p className="lp2-card-d">{c.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp2-section" style={{ paddingTop: 0 }}>
        <div className="lp2-wrap">
          <Reveal className="lp2-section-head">
            <div className="lp2-kicker">Simple by design</div>
            <h2 className="lp2-h2">How Seen works</h2>
          </Reveal>
          <div className="lp2-steps">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 110}>
                <div className="lp2-step">
                  <div className="lp2-step-n">{s.n}</div>
                  <h3 className="lp2-step-t">{s.t}</h3>
                  <p className="lp2-step-d">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="lp2-final">
        <div className="lp2-wrap">
          <Reveal className="lp2-final-reveal">
            <div className="lp2-final-card">
              <div style={{ position: 'relative', zIndex: 1 }}>
                <h2 className="lp2-h2" style={{ maxWidth: '18ch', margin: '0 auto' }}>
                  Check your next company before you apply.
                </h2>
                <p className="lp2-section-sub" style={{ marginTop: '.9rem' }}>
                  It takes five seconds. Free, no account needed.
                </p>
                <div className="lp2-cta-row" style={{ marginTop: '1.8rem' }}>
                  <button className="lp2-btn lp2-btn-primary" onClick={() => router.push('/companies')}>
                    Check a company
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
