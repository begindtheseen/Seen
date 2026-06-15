// Centralized CORS policy. This is the single source of truth that replaces the
// per-file CORS blocks copy-pasted into api/stripe.js, api/admin-stats.js,
// api/user-sync.js, and the `setCORS` in lib/server/ratelimit.js.
//
// Policy: production traffic is restricted to the seenjobs.io origins; local
// development (localhost / 127.0.0.1 / no Origin) is allowed through.

import type { ApiRequest, ApiResponse } from '../api/types'

export const ALLOWED_ORIGINS = ['https://seenjobs.io', 'https://www.seenjobs.io'] as const

export interface CorsOptions {
  methods?: string
  headers?: string
}

function readOrigin(req: ApiRequest): string {
  const raw = req.headers.origin
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
}

export function applyCors(req: ApiRequest, res: ApiResponse, options: CorsOptions = {}): void {
  const origin = readOrigin(req)
  const isDev = !origin || origin.includes('localhost') || origin.includes('127.0.0.1')
  const isAllowed = isDev || (ALLOWED_ORIGINS as readonly string[]).includes(origin)

  res.setHeader('Access-Control-Allow-Origin', isAllowed ? origin || '*' : ALLOWED_ORIGINS[0])
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', options.methods ?? 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', options.headers ?? 'Content-Type, Authorization')
}

// Apply CORS and answer preflight requests. Returns true when the request was an
// OPTIONS preflight (already answered) and the caller should stop processing.
export function handlePreflight(
  req: ApiRequest,
  res: ApiResponse,
  options: CorsOptions = {},
): boolean {
  applyCors(req, res, options)
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return true
  }
  return false
}
