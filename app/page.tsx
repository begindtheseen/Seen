import LandingHero from '@/components/LandingHero'
import LandingMarketingSections from '@/components/LandingMarketingSections'
import ScrollIndicator from '@/components/ScrollIndicator'

export default function LandingPage() {
  return (
    <div className="page-full active" style={{ position: 'relative' }}>

      {/* COSMOS BACKGROUND */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: `
        radial-gradient(ellipse at 18% 65%,rgba(29,78,216,0.55) 0%,transparent 52%),
        radial-gradient(ellipse at 82% 28%,rgba(124,58,237,0.48) 0%,transparent 48%),
        radial-gradient(ellipse at 55% 92%,rgba(8,145,178,0.22) 0%,transparent 42%),
        radial-gradient(ellipse at 8% 12%,rgba(99,102,241,0.32) 0%,transparent 38%),
        radial-gradient(ellipse at 72% 78%,rgba(139,92,246,0.2) 0%,transparent 40%),
        #02040a` }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(to bottom,rgba(2,4,10,0.05) 0%,transparent 30%,transparent 55%,rgba(2,4,10,0.82) 88%,#02040a 100%)' }} />
      </div>

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
