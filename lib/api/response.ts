// Shared, typed JSON response helpers. Routes should return through these instead
// of calling `res.status(...).json(...)` ad hoc, so success and error shapes stay
// consistent across the API.

import type { ApiResponse } from './types'
import { toApiError } from './errors'

export function sendJson<T>(res: ApiResponse, status: number, body: T): void {
  res.status(status).json(body)
}

export function ok<T>(res: ApiResponse, data: T): void {
  sendJson(res, 200, data)
}

export function created<T>(res: ApiResponse, data: T): void {
  sendJson(res, 201, data)
}

export function noContent(res: ApiResponse): void {
  res.status(204).end()
}

// Translate any thrown value into a safe JSON error response.
// 5xx errors are logged server-side and never leak internal details.
export function fail(res: ApiResponse, err: unknown): void {
  const apiError = toApiError(err)
  if (apiError.status >= 500) {
    console.error('[api] Unhandled error:', apiError.message)
  }
  sendJson(res, apiError.status, apiError.toBody())
}
