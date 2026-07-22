'use client'

// Attributed public-record signals for the company page (SEC 8-K to start; WARN/H-1B to follow).
//
// DEFAMATION-SAFE, by construction:
//  • Every item is an ATTRIBUTED LINK to an official public filing (source_label + source_url).
//  • The framing says these are public records, NOT Seen's assessment — and each SEC entry states
//    only that a filing *references* a term, never that the company "did" anything (the wording
//    comes from lib/server/secEdgar.js and is enforced there).
//  • Only high-confidence entity matches reach here (api/company-signals + companyEntityMatch), so
//    a filing is never attached to the wrong company.
//  • Renders NOTHING when there are no records — absence is shown as absence, never a fake blank.
//  • A documented right-of-reply: employers can dispute from their dashboard; admins can retract.

import { useState, useEffect, useCallback } from 'react'

interface Signal {
  source: string
  event_type: string
  title: string
  detail: string
  event_date: string | null
  location: string | null
  source_url: string
  source_label: string
}

function relativeDate(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export default function CompanyPublicRecord({ companyName }: { companyName: string }) {
  const [items, setItems] = useState<Signal[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/company-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: companyName }),
      })
      const j = (await r.json().catch(() => ({}))) as { signals?: Signal[] }
      setItems(Array.isArray(j.signals) ? j.signals : [])
    } catch {
      setItems([])
    } finally {
      setLoaded(true)
    }
  }, [companyName])

  useEffect(() => { load() }, [load])

  // Absence is shown as absence: no records → the section simply doesn't appear.
  if (!loaded || items.length === 0) return null

  return (
    <div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '.35rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', flexShrink: 0 }} />
        Public records
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
        Official filings, linked to their source. Not Seen&apos;s assessment — open each record to read it yourself.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        {items.map((s, i) => (
          <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.85rem 1rem' }}>
            <a href={s.source_url} target="_blank" rel="noopener noreferrer nofollow"
               style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--white, #fff)', lineHeight: 1.5, textDecoration: 'none', display: 'block' }}>
              {s.title} <span style={{ color: 'var(--blue)' }}>↗</span>
            </a>
            {s.detail && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', lineHeight: 1.55, marginTop: '.4rem' }}>{s.detail}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginTop: '.55rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)', border: '1px solid var(--line2)', borderRadius: 4, padding: '.1rem .4rem' }}>
                {s.source_label}
              </span>
              {s.location && <span style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)' }}>📍 {s.location}</span>}
              {s.event_date && <span style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)' }}>{relativeDate(s.event_date)}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Honest footer: no promises of flows that don't exist. Every entry links to its
          official source; corrections go through the real employer-claims channel. */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', marginTop: '.85rem', lineHeight: 1.5 }}>
        Public records surfaced for transparency — every entry links to its official source.
        Employers: <a href="/employers" style={{ color: 'var(--blue)', textDecoration: 'none' }}>claim your company</a> to flag a mis-attributed record for review.
      </div>
    </div>
  )
}
