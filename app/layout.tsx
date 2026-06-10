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
      <body>
        <AuthProvider>
          <Nav />
          {children}
          <div id="toast" />
        </AuthProvider>
      </body>
    </html>
  )
}
