import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/lib/auth'
import AnalyticsProvider from '@/components/AnalyticsProvider'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import IntroSplash from '@/components/IntroSplash'
import { ToastHost } from '@/components/ToastHost'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://seenjobs.io'),
  title: {
    default: 'Seen — Company Ghost Rates & Hiring Transparency',
    template: '%s | Seen',
  },
  description: 'Check any company’s ghost rate, response time, and real applicant outcomes before you apply. Hiring transparency aggregated from Reddit, Glassdoor, and verified job-seeker reports.',
  keywords: ['company ghost rate', 'does company ghost applicants', 'hiring reviews reddit', 'interview process reviews', 'job application tracker', 'company response rate', 'glassdoor alternative'],
  applicationName: 'Seen',
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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=Instrument+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300&display=swap" rel="stylesheet" />
      </head>
      <body>
        {/* Static full-screen cover — present in the initial HTML before JS runs.
            Prevents the flash of page content during React hydration.
            IntroSplash removes it as soon as it mounts. */}
        <div id="intro-guard" aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 2147483646, background: '#02040a' }} />
        <AuthProvider>
          <AnalyticsProvider />
          <IntroSplash />
          {/* Global aurora background orbs — renders on all pages */}
          <div className="aurora" aria-hidden="true">
            <div className="aurora-3" />
          </div>
          <Nav />
          <div className="site-main">{children}</div>
          <Footer />
          <div id="toast" />
          <ToastHost />
        </AuthProvider>
      </body>
    </html>
  )
}
