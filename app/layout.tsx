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
import NavMemory from '@/components/shell/NavMemory'
import localFont from 'next/font/local'
import './globals.css'
import '@/components/ui/ui.css'
import './motion.css'

// Exactly the faces the type scale uses (app/globals.css tokens), shipped WITH the site from app/fonts
// (latin subset, one woff2 per weight; SIL Open Font License — app/fonts/OFL.txt). They used to be
// downloaded from Google at build time (next/font/google), which failed the Vercel build on Next 15.5.28
// when Google answered with a font link the loader could not read (2026-11-01) — a build must not depend
// on a third party. No faux bold: a weight that is not listed here must not be rendered. Fallback metrics
// stay hand-tuned per weight in globals.css (Syne 800 is 176% of Arial's width), hence adjustFontFallback: false.
const syne = localFont({
  src: [{ path: './fonts/syne-700.woff2', weight: '700' }, { path: './fonts/syne-800.woff2', weight: '800' }],
  display: 'swap', variable: '--font-syne', adjustFontFallback: false,
})
const instrument = localFont({
  src: [
    { path: './fonts/instrument-sans-400.woff2', weight: '400' },
    { path: './fonts/instrument-sans-500.woff2', weight: '500' },
    { path: './fonts/instrument-sans-600.woff2', weight: '600' },
  ],
  display: 'swap', variable: '--font-instrument', adjustFontFallback: false,
})
const dmMono = localFont({
  src: [{ path: './fonts/dm-mono-400.woff2', weight: '400' }, { path: './fonts/dm-mono-500.woff2', weight: '500' }],
  display: 'swap', variable: '--font-dm-mono', adjustFontFallback: false,
})

export const metadata: Metadata = {
  metadataBase: new URL('https://seenjobs.io'),
  title: {
    default: 'Seen — Company Ghost Rates & Hiring Transparency',
    template: '%s | Seen',
  },
  // What the grades are actually built from (prod, 2026-11-01, live scored reports): ~79% first-hand
  // accounts in public review posts, ~20% Reddit, ~0.5% reports submitted to Seen. Say "public applicant
  // accounts", never a single source the data is not mostly from.
  description: 'Check any company’s ghost rate, response time, and real applicant outcomes before you apply — compiled from public applicant accounts and reports from Seen users.',
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
    description: 'Know before you apply. Real ghost rates and applicant outcomes, compiled from public applicant accounts and Seen users’ reports.',
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
        {/* A HINT, not auth: `html.has-session` when this browser holds a stored Supabase session, so a
            prerendered page can paint the right first frame (guest form vs. "loading your account")
            before React knows who is signed in (globals.css `.guest-first` / `.session-first`). Every
            decision is still made by useAuth() once the session resolves. */}
        <script dangerouslySetInnerHTML={{ __html: "try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&/^sb-.+-auth-token$/.test(k)){document.documentElement.classList.add('has-session');break}}}catch(e){}" }} />
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
          <NavMemory />
          <Nav />
          {/* The ONE <main> landmark (audit 2026-10-24: `.site-main` was a div, so there was no main
              landmark and the nav's "Skip to content" link had nowhere to land). tabIndex -1 lets the
              skip link move focus here; the class keeps every `.site-main` rule in globals.css. */}
          <main id="main" className="site-main" tabIndex={-1}>{children}</main>
          <Footer />
          <TabBar />
          <CommandPalette />
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
