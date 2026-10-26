import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/lib/auth'
import AnalyticsProvider from '@/components/AnalyticsProvider'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { ToastHost } from '@/components/ToastHost'
import MicroSurveyHost from '@/components/MicroSurveyHost'
import MotionLayer from '@/components/motion/MotionLayer'
import ReferralHost from '@/components/growth/ReferralHost'
import TabBar from '@/components/shell/TabBar'
import CommandPalette from '@/components/shell/CommandPalette'
import RouteProgress from '@/components/shell/RouteProgress'
import { Syne, Instrument_Sans, DM_Mono } from 'next/font/google'
import './globals.css'
import './motion.css'

// Exactly the faces the type scale uses (app/globals.css tokens) — self-hosted by next/font, so no
// render-blocking Google Fonts stylesheet and no faux bold: a weight that is not listed here must not
// be rendered (the type codemod capped every rule to these). Fallback metrics stay hand-tuned per
// weight in globals.css (Syne 800 is 176% of Arial's width), hence adjustFontFallback: false.
const syne = Syne({ subsets: ['latin'], weight: ['700', '800'], display: 'swap', variable: '--font-syne', adjustFontFallback: false })
const instrument = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-instrument', adjustFontFallback: false })
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-dm-mono', adjustFontFallback: false })

export const metadata: Metadata = {
  metadataBase: new URL('https://seenjobs.io'),
  title: {
    default: 'Seen — Company Ghost Rates & Hiring Transparency',
    template: '%s | Seen',
  },
  // Sources named here must be ones Seen actually reads: Reddit (public discussion) and reports submitted
  // to Seen. Glassdoor is an excluded source (owner decision 2026-10-20, lib/reports/excludedSources.js).
  description: 'Check any company’s ghost rate, response time, and real applicant outcomes before you apply. Hiring transparency aggregated from Reddit and verified job-seeker reports.',
  keywords: ['company ghost rate', 'does company ghost applicants', 'hiring reviews reddit', 'interview process reviews', 'job application tracker', 'company response rate'],
  applicationName: 'Seen',
  // Google Search Console ownership tag. Set GOOGLE_SITE_VERIFICATION in Vercel to the content value
  // Search Console shows for the "HTML tag" method; unset renders nothing.
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
  icons: {
    icon: '/favicon.svg',
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Seen — Company Ghost Rates & Hiring Transparency',
    description: 'Know before you apply. Real ghost rates and applicant outcomes from Reddit and verified reports.',
    type: 'website',
    siteName: 'Seen',
    url: 'https://seenjobs.io',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Seen — Company Ghost Rates & Hiring Transparency',
    description: 'Check any company’s ghost rate before you apply.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
}

// No maximumScale: capping zoom at 1 disables pinch-zoom — an accessibility
// failure (WCAG 1.4.4) and a Lighthouse flag. iOS input auto-zoom is avoided by
// font-size, not by locking the viewport.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${instrument.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        {/* The opening: on the FIRST load of a session the nav wordmark rises letter by letter and the
            nav hairline draws (app/motion.css `html.seen-first`). Marked before first paint so the pure-CSS
            animation starts on the server-rendered frame, with no hydration flash. There is no blocking
            splash any more — the page is the intro. (Class added before React, hence suppressHydrationWarning.) */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(!sessionStorage.getItem('seen_opened')){document.documentElement.classList.add('seen-first');sessionStorage.setItem('seen_opened','1')}}catch(e){}" }} />
      </head>
      <body>
        <AuthProvider>
          <AnalyticsProvider />
          {/* Global aurora background orbs — renders on all pages */}
          <div className="aurora" aria-hidden="true">
            <div className="aurora-3" />
          </div>
          {/* The connected shell: route progress hairline, nav, page, footer, phone tab bar, ⌘K palette. */}
          <RouteProgress />
          <Nav />
          {/* The ONE <main> landmark (audit 2026-10-24: `.site-main` was a div, so there was no main
              landmark and the nav's "Skip to content" link had nowhere to land). tabIndex -1 lets the
              skip link move focus here; the class keeps every `.site-main` rule in globals.css. */}
          <main id="main" className="site-main" tabIndex={-1}>{children}</main>
          <Footer />
          <TabBar />
          <CommandPalette />
          <div id="toast" />
          <ToastHost />
          <MicroSurveyHost />
          {/* Invite links: keeps ?ref= and claims it once an account signs in (lib/referralClient.ts). */}
          <ReferralHost />
          {/* Cursor spotlight / tilt listener + film grain (app/motion.css) */}
          <MotionLayer />
        </AuthProvider>
      </body>
    </html>
  )
}
