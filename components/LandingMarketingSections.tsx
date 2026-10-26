'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Reveal from '@/components/Reveal'
import PriceLine from '@/components/home/PriceLine'
import styles from './LandingMarketingSections.module.css'

// Below the workspace window: the four things only Seen does, each linking to the real page,
// then one closing call to action. (Replaces the old "Why Seen" four-card grid + three-step
// "How it works" — the workspace window above now shows how it works.)
const FEATURES = [
  {
    href: '/companies',
    tag: 'Company intel',
    title: 'Ghost rates and grades',
    desc: 'Every company gets a ghost rate, response time and grade from applicant outcomes. No grade until there is enough evidence — at least one real applicant report and five pieces in total — and estimates are labeled as estimates.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 10h.01M15 10h.01" />
        <path d="M12 2a8 8 0 0 0-8 8v11l3-2 2 2 3-2 3 2 2-2 3 2V10a8 8 0 0 0-8-8Z" />
      </svg>
    ),
  },
  {
    href: '/tracker',
    tag: 'Tracker',
    title: 'A tracker that asks what happened',
    desc: 'Day 7, 14 and 30 check-ins on each application. Your answers become your real response rate, and the next applicant’s warning.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 11l3 3 8-8" />
        <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
      </svg>
    ),
  },
  {
    href: '/resume',
    tag: 'Résumé AI',
    title: 'Tailored for the exact role',
    desc: 'SeenFit scores your résumé against one job and rewrites it in your voice, so you know your fit before you spend an hour applying.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </svg>
    ),
  },
  {
    href: '/agencies',
    tag: 'Agency index',
    title: 'Which staffing agencies ghost',
    desc: 'Insight Global, Randstad, Addison Group and more, ranked by applicant-reported ghost and response rates. No reports, no number.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 21h18M5 21V7l7-4 7 4v14" />
        <path d="M9 21v-6h6v6M9 10h.01M15 10h.01" />
      </svg>
    ),
  },
]

export default function LandingMarketingSections() {
  const router = useRouter()

  return (
    <div>
      <section className={styles.section}>
        <div className={styles.wrap}>
          <Reveal className={styles.head}>
            <div className={styles.kicker}>Why Seen</div>
            <h2 className={styles.h2}>Stop applying blind.</h2>
            <p className={styles.sub}>
              Seen is built from what happened to applicants, never from employer marketing.
            </p>
          </Reveal>
          <div className={styles.grid}>
            {FEATURES.map((f, i) => (
              <Reveal key={f.href} delay={i * 80}>
                <Link href={f.href} className={`${styles.card}`}>
                  <div className={styles.cardTop}>
                    <span className={styles.ico}>{f.icon}</span>
                    <span className={styles.tag}>{f.tag}</span>
                  </div>
                  <h3 className={styles.cardT}>{f.title}</h3>
                  <p className={styles.cardD}>{f.desc}</p>
                  <span className={styles.more}>Open <span aria-hidden="true">→</span></span>
                </Link>
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
                  <button className="lp2-btn lp2-btn-ghost" onClick={() => router.push('/login?signup=1')}>
                    Start tracking free
                  </button>
                </div>
                <PriceLine />
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
