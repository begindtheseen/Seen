import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,
  async redirects() {
    return [
      // The employer nav and footer call the promote section "Pricing"; people type the obvious URL.
      // It was a 404 (audit 2026-10-24 E-2).
      { source: '/employers/pricing', destination: '/employers#promote', permanent: true },
    ]
  },
}

export default nextConfig
