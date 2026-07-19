import HomeHero from '@/components/HomeHero'
import LandingMarketingSections from '@/components/LandingMarketingSections'

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

      {/* Value · How it works · Final CTA */}
      <LandingMarketingSections />

      {/* Minimal footer */}
      <footer className="lp2-footer">
        <div className="lp2-wrap lp2-footer-row">
          <span>Free for job seekers</span>
          <span className="lp2-footer-sep">·</span>
          <span>No account required to search</span>
          <span className="lp2-footer-sep">·</span>
          <a href="/compare">Compare</a>
          <span className="lp2-footer-sep">·</span>
          <a href="/reddit">Reddit outcomes</a>
          <span className="lp2-footer-sep">·</span>
          <a href="/legal">Legal</a>
          <span className="lp2-footer-copy">© 2025 Seen. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
