// Shared API route wrapper. Composes the foundation layer so each route handler
// stays thin: CORS + preflight, method allow-list, optional rate limiting,
// optional identity resolution, and centralized error handling that never leaks
// stack traces.
//
// Not yet wired into existing api/*.js routes — those are migrated gradually in
// docs/REFACTOR_PLAN.md Phase 3. This is the target shape for new/migrated routes.

import type { ApiHandler, ApiRequest, ApiResponse, HttpMethod } from './types'
import { applyCors, type CorsOptions } from '../security/cors'
import { fail } from './response'
import { MethodNotAllowedError, TooManyRequestsError } from './errors'
import { rateLimit } from '../security/rateLimit'
import { resolveIdentity, type AuthIdentity } from '../auth/server'

export interface RouteContext {
  identity: AuthIdentity
}

export type RouteHandler = (
  req: ApiRequest,
  res: ApiResponse,
  ctx: RouteContext,
) => unknown | Promise<unknown>

export interface RouteConfig {
  // Allowed HTTP methods. Defaults to POST.
  methods?: HttpMethod[]
  cors?: CorsOptions
  // Rate-limit endpoint key (see LIMITS in lib/server/ratelimit.js). Omit to skip.
  rateLimitKey?: string
  // Attach the caller's identity to ctx (does NOT require auth). Use requireUser()
  // inside the handler when sign-in is mandatory.
  resolveAuth?: boolean
}

export function createHandler(handler: RouteHandler, config: RouteConfig = {}): ApiHandler {
  const methods = config.methods ?? (['POST'] as HttpMethod[])

  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    try {
      applyCors(req, res, config.cors)
      if (req.method === 'OPTIONS') {
        res.status(200).end()
        return
      }
      if (req.method && !methods.includes(req.method as HttpMethod)) {
        throw new MethodNotAllowedError()
      }

      if (config.rateLimitKey) {
        const { allowed, remaining, limit } = await rateLimit(req, config.rateLimitKey)
        res.setHeader('X-RateLimit-Limit', String(limit))
        res.setHeader('X-RateLimit-Remaining', String(remaining))
        if (!allowed) throw new TooManyRequestsError()
      }

      const identity: AuthIdentity = config.resolveAuth
        ? await resolveIdentity(req)
        : { uid: null, email: null }

      await handler(req, res, { identity })
    } catch (err) {
      fail(res, err)
    }
  }
}
