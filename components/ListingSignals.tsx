'use client'
// "Listing signals" — the company's rating from its OWN open job posts (POST /api/jobs
// {action:'listing_signals'} → lib/server/listingSignals.js). Shown for every company that has posts,
// next to — never inside — the Seen Grade, which stays report-only (owner decision 2026-10-20).
// Every number is a stated factor; the label says plainly that this is not applicant reports.
import { useEffect, useState } from 'react'
import styles from './ListingSignals.module.css'

type Factor = { key: string; label: string; value: number; weight: number; detail: string }
type Signals = { rated: true; listings: number; score: number; band: 'clear' | 'mixed' | 'thin'; label: string; factors: Factor[]; basis: string }
  | { rated: false; listings: number; reason: string }

export default function ListingSignals({ companyName }: { companyName: string }) {
  const [s, setS] = useState<Signals | null>(null)
  useEffect(() => {
    if (!companyName) return
    let live = true
    fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'listing_signals', company: companyName }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live && b?.signals) setS(b.signals as Signals) })
      .catch(() => {})
    return () => { live = false }
  }, [companyName])
  // Nothing to say without posts; a read failure shows nothing rather than a made-up zero.
  if (!s || s.listings === 0) return null
  if (!s.rated) return <p className={styles.thinLine}>Listing signals: {s.reason}.</p>
  return (
    <section className={`${styles.card} ${styles[s.band]}`} aria-label="Listing signals">
      <div className={styles.head}>
        <span className={styles.kicker}>Listing signals</span>
        <span className={styles.scope}>from its job posts · not applicant reports</span>
      </div>
      <div className={styles.top}>
        <span className={styles.score}>{s.score}<small>/100</small></span>
        <span className={styles.label}>{s.label}</span>
      </div>
      <ul className={styles.factors}>
        {s.factors.map((f) => (
          <li key={f.key} className={styles.factor}>
            <span className={styles.fLabel}>{f.label} <em>weighs {Math.round(f.weight * 100)}%</em></span>
            <span className={styles.bar} aria-hidden><span style={{ width: `${Math.max(2, f.value)}%` }} /></span>
            <span className={styles.fVal}>{f.value}%</span>
            <span className={styles.fDetail}>{f.detail}</span>
          </li>
        ))}
      </ul>
      <p className={styles.basis}>{s.basis}</p>
    </section>
  )
}
