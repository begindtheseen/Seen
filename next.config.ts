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
    ]
  },
}

export default nextConfig
