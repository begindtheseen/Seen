// Typed surface over the shared rate limiter.
//
// The runtime implementation lives in lib/server/ratelimit.js (Supabase-backed,
// atomic upsert, fail-open) and is consumed today by the api/*.js routes. This
// module re-exports it with TypeScript types so future TS API routes import from
// `lib/security/*`. There is a single runtime implementation — no duplication.
//
// Migration note (docs/REFACTOR_PLAN.md, Phase 3): once all routes import from
// here, the implementation can be moved into this file and the .js shim removed.

import type { ApiRequest, ApiResponse } from '../api/types'
import * as impl from '../server/ratelimit.js'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  count?: number
}

type RateLimitFn = (req: ApiRequest, endpoint: string) => Promise<RateLimitResult>
type ApplyRateLimitFn = (req: ApiRequest, res: ApiResponse, endpoint: string) => Promise<boolean>
type SetCorsFn = (req: ApiRequest, res: ApiResponse) => void

// Check and enforce a rate limit. Fails open if the store is unreachable.
export const rateLimit = impl.rateLimit as unknown as RateLimitFn

// Apply CORS + preflight + rate limit; returns true if the caller should stop.
export const applyRateLimit = impl.applyRateLimit as unknown as ApplyRateLimitFn

// Legacy CORS helper kept for parity with existing routes. New code should prefer
// lib/security/cors.ts (applyCors / handlePreflight).
export const setCORS = impl.setCORS as unknown as SetCorsFn
