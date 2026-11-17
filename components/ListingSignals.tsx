'use client'
// "Listing signals" — the company's rating from its OWN open job posts (lib/server/listingSignals.js). Shown for
// every company that has posts, after the Seen Grade and never inside it: the grade stays report-only (owner
// decision 2026-10-20). Every number is a stated factor; the label says plainly these are job posts, not
// applicant reports.
//
// The company page's server render already read the posts (app/company/[slug]/companyData.ts) and passes them
// as `initial`, so the four facts are in the server HTML and the page holds ONE set of listing numbers. Without
// `initial` (the server read was slow or failed) the card asks the API itself, as before.
import { useEffect, useState } from 'react'
import Badge from '@/components/ui/Badge'
import type { Tone } from '@/lib/ui/tone.js'
import type { ListingSignalsData } from '@/components/company/CompanyAnswersSeed'
import styles from './ListingSignals.module.css'

// The band is the one decided reading here (lib/server/listingSignals.js): it colours the label — with its
// word and icon — never the factor bars, which are ink whatever their value (design review 2026-11-02).
const BAND_TONE: Record<'clear' | 'mixed' | 'thin', Tone> = { clear: 'good', mixed: 'caution', thin: 'bad' }

export default function ListingSignals({ companyName, initial = null }: { companyName: string; initial?: ListingSignalsData | null }) {
  const [s, setS] = useState<ListingSignalsData | null>(initial)
  useEffect(() => {
    if (!companyName || initial) return
    let live = true
    // GET so the CDN can serve it (lib/server/publicRead.js); the rating is identical for every visitor.
    fetch(`/api/jobs?action=listing_signals&company=${encodeURIComponent(companyName)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live && b?.signals) setS(b.signals as ListingSignalsData) })
      .catch(() => {})
    return () => { live = false }
  }, [companyName, initial])
  // Nothing to say without posts; a read failure shows nothing rather than a made-up zero.
  if (!s || s.listings === 0) return null
  const head = (
    <div className={styles.head}>
      <h2 className={styles.title}>Listing signals</h2>
      <span className={styles.scope}>from its job posts · not applicant accounts</span>
    </div>
  )
  if (!s.rated) {
    return (
      <section className={styles.card} aria-label="Listing signals">
        {head}
        <p className={styles.thinLine}>{s.listings.toLocaleString('en-US')} open posting{s.listings === 1 ? '' : 's'} on Seen; {s.reason}.</p>
      </section>
    )
  }
  const f = s.facts
  const byKey = Object.fromEntries(s.factors.map((x) => [x.key, x.value]))
  // The facts a reader asks first. Older API answers carry no `facts`: they are read off the factors.
  const open = f?.open ?? s.listings
  const pay = f?.payPct ?? byKey.pay
  const direct = f?.directPct ?? byKey.direct
  const longOpen = f ? f.longOpenPct : byKey.fresh != null ? 100 - byKey.fresh : null
  const facts: Array<{ k: string; v: string; l: string }> = [
    { k: 'open', v: open.toLocaleString('en-US'), l: `open posting${open === 1 ? '' : 's'}` },
    ...(pay != null ? [{ k: 'pay', v: `${pay}%`, l: 'show pay' }] : []),
    ...(direct != null ? [{ k: 'direct', v: `${direct}%`, l: 'apply direct' }] : []),
    ...(longOpen != null ? [{ k: 'long', v: `${longOpen}%`, l: 'open 30+ days' }] : []),
  ]
  return (
    <section className={styles.card} aria-label="Listing signals" data-testid="listing-signals">
      {head}
      <dl className={styles.facts}>
        {facts.map((x) => (
          <div key={x.k} className={styles.fact}>
            <dt className={styles.factLabel}>{x.l}</dt>
            <dd className={styles.factValue}>{x.v}</dd>
          </div>
        ))}
      </dl>
      <details className={styles.more}>
        <summary className={styles.moreSum}>
          <span className={styles.score}>{s.score}<small>/100</small></span>
          <Badge tone={BAND_TONE[s.band]}>{s.label}</Badge>
          <span className={styles.moreHint}>How this is scored</span>
        </summary>
        <ul className={styles.factors}>
          {s.factors.map((x) => (
            <li key={x.key} className={styles.factor}>
              <span className={styles.fLabel}>{x.label} <em>weighs {Math.round(x.weight * 100)}%</em></span>
              <span className={styles.bar} aria-hidden><span style={{ width: `${Math.max(2, x.value)}%` }} /></span>
              <span className={styles.fVal}>{x.value}%</span>
              <span className={styles.fDetail}>{x.detail}</span>
            </li>
          ))}
        </ul>
        <p className={styles.basis}>{s.basis}</p>
      </details>
    </section>
  )
}
