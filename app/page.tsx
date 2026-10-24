import HomeHero from '@/components/HomeHero'
import LandingMarketingSections from '@/components/LandingMarketingSections'
import LivePulse from '@/components/home/LivePulse'
import { jsonLdHtml } from '@/lib/jsonLd'

// schema.org for the homepage only (rendered once, here, not by the root layout on every page): who
// publishes the site and what it is. The logo is the stable /favicon.svg in public/ (no build hash).
// The SearchAction is the job search, whose page reads ?q= on load (lib/hooks/useJobSearch.ts
// readSearchQuery: "Honor inbound search params"); the company search has no query URL (it routes to
// /company/<slug>), so it is not declared.
const HOME_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://seenjobs.io/#organization',
      name: 'Seen',
      url: 'https://seenjobs.io',
      logo: 'https://seenjobs.io/favicon.svg',
    },
    {
      '@type': 'WebSite',
      '@id': 'https://seenjobs.io/#website',
      name: 'Seen',
      url: 'https://seenjobs.io',
      publisher: { '@id': 'https://seenjobs.io/#organization' },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: 'https://seenjobs.io/jobs?q={search_term_string}' },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}

export default function LandingPage() {
  return (
    <div className="lp2">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(HOME_JSON_LD) }} />
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
