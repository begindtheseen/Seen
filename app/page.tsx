import HomeHero from '@/components/HomeHero'
import LandingMarketingSections from '@/components/LandingMarketingSections'
import LivePulse from '@/components/home/LivePulse'

export default function LandingPage() {
  return (
    <div className="lp2">
      {/* Calm ambient background — subtle gradient + soft drifting orbs */}
      <div className="lp2-bg" aria-hidden>
        <div className="lp2-orb lp2-orb-a" />
        <div className="lp2-orb lp2-orb-b" />
        <div className="lp2-bg-fade" />
      </div>

      {/* Redesigned hero: one consolidated company search + a live real-data proof card */}
      <HomeHero />

      {/* Live pulse: the newest real applicant reports gliding by (components/home/LivePulse) */}
      <LivePulse />

      {/* Value · How it works · Final CTA.
          NOTE: no page-local footer here — the global <Footer /> from app/layout.tsx
          renders on every page. The old lp2-footer duplicated it (two stacked footers
          with two different © years on the landing page). */}
      <LandingMarketingSections />
    </div>
  )
}
