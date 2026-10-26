'use client'

/**
 * Live pulse — the newest REAL applicant accounts (the same rows /feed shows), gliding across the
 * homepage so the product visibly breathes. Nothing here is invented: every chip is a row from the
 * reports table and links to that company's page. Renders nothing until real rows arrive, and never
 * shows visitor/community counts (Seen has none) — the one figure is the real number of compiled
 * accounts, worded as such (brain seen:growth: say "compiled public applicant accounts", never "our users").
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from './LivePulse.module.css'
import Icon, { type IconName } from '@/components/ui/Icon'
import { displayCompanyName } from '@/lib/companyDisplay'

type Row = { id: string; company_name?: string; role?: string; outcome: string; created_at: string }

const OUTCOME: Record<string, { icon: IconName; label: string; cls: string }> = {
  ghosted: { icon: 'ghost', label: 'ghosted', cls: 'red' },
  autoreject: { icon: 'bot', label: 'auto-rejected', cls: 'amber' },
  rejected: { icon: 'circle-x', label: 'rejected', cls: 'amber' },
  human: { icon: 'message-square', label: 'got a response', cls: 'blue' },
  interview: { icon: 'calendar', label: 'interviewing', cls: 'blue' },
  interviewing: { icon: 'calendar', label: 'interviewing', cls: 'blue' },
  offer: { icon: 'trophy', label: 'got an offer', cls: 'green' },
  hired: { icon: 'trophy', label: 'hired', cls: 'green' },
  waiting: { icon: 'hourglass', label: 'still waiting', cls: 'dim' },
}

const slug = (name: string) => encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return `${Math.floor(s / (86400 * 30))}mo ago`
}

export default function LivePulse() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'feed', limit: 30 }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { reports?: Row[]; total?: number } | null) => {
        if (cancelled || !d?.reports) return
        // One chip per company: the server already keeps non-applicant rows out, and a company with
        // ten fresh imports must not fill the whole strip ("albertsons got an offer" × 7).
        const seen = new Set<string>()
        setRows(d.reports.filter(r => {
          if (!r.company_name || !OUTCOME[r.outcome]) return false
          const k = r.company_name.toLowerCase().trim()
          if (seen.has(k)) return false
          seen.add(k)
          return true
        }))
        setTotal(d.total || 0)
      })
      .catch(() => { /* the strip simply doesn't render */ })
    return () => { cancelled = true }
  }, [])

  if (rows.length < 3) return null

  const chips = (hidden: boolean) => rows.map(r => {
    const o = OUTCOME[r.outcome]
    return (
      <Link key={(hidden ? 'b' : 'a') + r.id} href={`/company/${slug(r.company_name!)}`} className={`${styles.chip} ${styles[o.cls]}`} tabIndex={hidden ? -1 : 0} aria-hidden={hidden || undefined}>
        <span className={styles.ico} aria-hidden><Icon name={o.icon} size={14} /></span>
        <b>{displayCompanyName(r.company_name)}</b>
        <span className={styles.what}>{o.label}{r.role ? ` · ${r.role}` : ''}</span>
        <time className={styles.when} dateTime={r.created_at}>{ago(r.created_at)}</time>
      </Link>
    )
  })

  return (
    <section className={styles.pulse} aria-label="Latest applicant accounts">
      <div className={styles.head}>
        <span className={styles.live}><span className={styles.dot} />Live</span>
        <span className={styles.title}>Latest applicant accounts</span>
        {total > 0 && <span className={styles.count}>{total.toLocaleString()} compiled applicant accounts</span>}
        <Link href="/feed" className={styles.more}>Open the feed →</Link>
      </div>
      <div className={styles.rail} data-marquee>
        <div className={styles.track} style={{ '--n': rows.length } as React.CSSProperties}>
          {chips(false)}
          {chips(true)}
        </div>
      </div>
    </section>
  )
}
