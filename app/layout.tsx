import type { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/lib/auth'
import Nav from '@/components/Nav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Seen — Job Search Intelligence',
  description: 'Track applications, check company ghost rates, and get hiring intelligence before you apply.',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: 'Seen',
    description: 'The hiring intelligence platform. Know before you apply.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
        <AuthProvider>
          {/* Global aurora background orbs — renders on all pages */}
          <div className="aurora" aria-hidden="true">
            <div className="aurora-3" />
          </div>
          <Nav />
          {children}
          <div id="toast" />
        </AuthProvider>
      </body>
    </html>
  )
}
