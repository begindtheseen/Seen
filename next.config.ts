import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,
  // The company OG image (satori) reads the brand fonts from disk (lib/server/cardFonts.ts).
  // Vercel's file tracer follows the literal process.cwd() join, but be explicit so a refactor
  // of the loader can never ship an unfurl that silently falls back to Noto Sans.
  outputFileTracingIncludes: {
    '/company/[slug]/og': ['./assets/fonts/*.ttf'],
  },
  async redirects() {
    return [
      // The employer nav and footer call the promote section "Pricing"; people type the obvious URL.
      // It was a 404 (audit 2026-10-24 E-2).
      { source: '/employers/pricing', destination: '/employers#promote', permanent: true },
      // The 7-day no-card trial is retired (owner decision 2026-10-25): Seen sells one-time products
      // only. An old trial link or confirmation email lands on the menu instead of a dead page.
      { source: '/trial', destination: '/pricing', permanent: false },
    ]
  },
}

export default nextConfig
