// Typed API error classes. Throw these from services/route handlers and let the
// shared handler (lib/api/handler.ts) translate them into safe JSON responses.
//
// SECURITY: `expose` controls whether the message reaches the client. 5xx errors
// default to `expose: false` so internal details / stack traces never leak.

export interface ApiErrorBody {
  error: string
  code?: string
  details?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown
  readonly expose: boolean

  constructor(
    status: number,
    message: string,
    options: { code?: string; details?: unknown; expose?: boolean } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = options.code
    this.details = options.details
    // 4xx are client-facing by default; 5xx are hidden unless explicitly exposed.
    this.expose = options.expose ?? status < 500
  }

  toBody(): ApiErrorBody {
    const body: ApiErrorBody = {
      error: this.expose ? this.message : 'Internal server error',
    }
    if (this.code) body.code = this.code
    if (this.expose && this.details !== undefined) body.details = this.details
    return body
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Bad request', code?: string, details?: unknown) {
    super(400, message, { code, details })
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized', code?: string) {
    super(401, message, { code })
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden', code?: string) {
    super(403, message, { code })
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Not found', code?: string) {
    super(404, message, { code })
  }
}

export class MethodNotAllowedError extends ApiError {
  constructor(message = 'Method not allowed') {
    super(405, message)
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflict', code?: string) {
    super(409, message, { code })
  }
}

export class TooManyRequestsError extends ApiError {
  constructor(message = 'Too many requests — slow down.') {
    super(429, message, { code: 'rate_limited' })
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service unavailable', code?: string) {
    super(503, message, { code })
  }
}

export class InternalError extends ApiError {
  constructor(message = 'Internal server error') {
    super(500, message, { expose: false })
  }
}

// Normalize any thrown value into an ApiError. Unknown errors become a hidden 500.
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  const message = err instanceof Error ? err.message : 'Internal server error'
  return new ApiError(500, message, { expose: false })
}
