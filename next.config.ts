import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,

  // Lint runs as its own quality gate (`npm run lint`), not coupled to the build.
  // This keeps `next build` focused on compilation while ESLint findings are
  // tracked and burned down separately (see docs/REFACTOR_PLAN.md Phase 2).
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
