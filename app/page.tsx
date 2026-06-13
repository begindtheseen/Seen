import LandingHero from '@/components/LandingHero'
import LandingMarketingSections from '@/components/LandingMarketingSections'
import ScrollIndicator from '@/components/ScrollIndicator'

export default function LandingPage() {
  return (
    <div className="page-full active" style={{ position: 'relative' }}>

      {/* TICKER */}
      <div className="ticker-wrap" style={{ position: 'relative', zIndex: 2, flexShrink: 0 }}>
        <div className="ticker-track" id="tickerTrack" />
      </div>

      {/* MAIN CONTENT — interactive client component */}
      <LandingHero />

      {/* SCROLL INDICATOR */}
      <ScrollIndicator />

      {/* DISCLAIMER */}
      <div style={{ position: 'relative', zIndex: 2, padding: '.7rem 2.5rem', fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap' }}>
        <span>Free for job seekers</span>
        <span style={{ color: 'rgba(255,255,255,.12)' }}>·</span>
        <span>No account required to search</span>
        <span style={{ color: 'rgba(255,255,255,.12)' }}>·</span>
        <a href="/legal" style={{ color: 'rgba(255,255,255,.22)', textDecoration: 'underline' }}>Legal</a>
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.15)' }}>© 2025 Seen. All rights reserved.</span>
      </div>

      {/* BELOW FOLD SECTIONS */}
      <div id="lpBelowFold">
        <LandingMarketingSections />
      </div>

      {/* LANDING FOOTER */}
      <div style={{ position: 'relative', zIndex: 2, padding: '.9rem 2.5rem', background: 'rgba(2,4,10,.98)', borderTop: '1px solid rgba(255,255,255,.05)', fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap' }}>
        <span>Free for job seekers</span>
        <span style={{ color: 'rgba(255,255,255,.12)' }}>·</span>
        <span>No account required to search</span>
        <span style={{ color: 'rgba(255,255,255,.12)' }}>·</span>
        <a href="/legal" style={{ color: 'rgba(255,255,255,.22)', textDecoration: 'underline' }}>Legal</a>
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,.15)' }}>© 2025 Seen. All rights reserved.</span>
      </div>

    </div>
  )
}
