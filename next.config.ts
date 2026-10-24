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
}

export default nextConfig
