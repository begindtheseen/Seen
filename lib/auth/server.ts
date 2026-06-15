// Centralized server-side auth. This replaces the `verifyJWT` / `verifyJWTLocal`
// / `resolveUid` helpers that are duplicated across api/stripe.js, api/reports.js,
// api/demand.js, api/apply.js, and api/user-sync.js.
//
// Strategy (parity with existing routes):
//   1. Fast path — verify the Supabase JWT locally (HS256, no network round-trip)
//      using SUPABASE_JWT_SECRET.
//   2. Fallback — validate the token against Supabase's /auth/v1/user endpoint.
//
// SECURITY: never trust a user_id sent in a request body. The authenticated uid
// returned here is the only source of identity.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ApiRequest } from '../api/types'
import { serverEnv } from '../config/env'
import { UnauthorizedError } from '../api/errors'

export interface AuthIdentity {
  uid: string | null
  email: string | null
}

interface JwtPayload {
  sub?: string
  email?: string
  exp?: number
}

function bearerToken(req: ApiRequest): string {
  const raw = req.headers.authorization
  const header = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  return header.replace(/^Bearer\s+/i, '').trim()
}

// Verify a Supabase JWT locally (HS256). Returns the payload or null.
export function verifySupabaseJwt(token: string, secret: string): JwtPayload | null {
  try {
    const [header, payload, signature] = token.split('.')
    if (!header || !payload || !signature) return null
    const mac = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
    const sigBuf = Buffer.from(signature, 'base64url')
    const macBuf = Buffer.from(mac, 'base64url')
    if (sigBuf.length !== macBuf.length || !timingSafeEqual(sigBuf, macBuf)) return null
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as JwtPayload
    if (!decoded.sub || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null
    return decoded
  } catch {
    return null
  }
}

// Resolve the caller's identity from the Authorization bearer token.
// Returns { uid: null } when unauthenticated.
export async function resolveIdentity(req: ApiRequest): Promise<AuthIdentity> {
  const token = bearerToken(req)
  if (!token) return { uid: null, email: null }

  const secret = serverEnv.supabaseJwtSecret()
  if (secret) {
    const payload = verifySupabaseJwt(token, secret)
    if (payload?.sub) return { uid: payload.sub, email: payload.email ?? null }
  }

  const url = serverEnv.supabaseUrl()
  const serviceKey = serverEnv.supabaseServiceKey()
  if (url && serviceKey) {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const user = (await res.json()) as { id?: string; email?: string }
      if (user?.id) return { uid: user.id, email: user.email ?? null }
    }
  }

  return { uid: null, email: null }
}

// Resolve identity or throw UnauthorizedError. Use when a route requires sign-in.
export async function requireUser(req: ApiRequest): Promise<{ uid: string; email: string | null }> {
  const { uid, email } = await resolveIdentity(req)
  if (!uid) throw new UnauthorizedError('Sign in required')
  return { uid, email }
}
