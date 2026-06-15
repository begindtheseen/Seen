// Lightweight, dependency-free request validation. Throws BadRequestError on
// invalid input so the shared handler converts it into a 400 automatically.
//
// This is the seam where a schema library (e.g. zod) can be adopted later — see
// docs/CODING_STANDARDS.md. Keeping it zero-dependency for now avoids adding a
// runtime dependency before the validation surface is mapped out.

import { BadRequestError } from '../api/errors'

// Coerce a possibly-string request body into a plain object.
export function parseJsonBody(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body)
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  if (body && typeof body === 'object') return body as Record<string, unknown>
  return {}
}

export function requireString(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): string {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${field} must be a string`, 'invalid_field')
  }
  const trimmed = value.trim()
  if (opts.min !== undefined && trimmed.length < opts.min) {
    throw new BadRequestError(`${field} is too short`, 'invalid_field')
  }
  if (opts.max !== undefined && trimmed.length > opts.max) {
    throw new BadRequestError(`${field} is too long`, 'invalid_field')
  }
  return trimmed
}

export function optionalString(
  value: unknown,
  field: string,
  opts: { max?: number } = {},
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, field, opts)
}

export function requireOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestError(`${field} must be one of: ${allowed.join(', ')}`, 'invalid_field')
  }
  return value as T
}

export function requireNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) {
    throw new BadRequestError(`${field} must be a number`, 'invalid_field')
  }
  if (opts.min !== undefined && num < opts.min) {
    throw new BadRequestError(`${field} is below the minimum`, 'invalid_field')
  }
  if (opts.max !== undefined && num > opts.max) {
    throw new BadRequestError(`${field} is above the maximum`, 'invalid_field')
  }
  return num
}

// Assert a condition or throw a 400. Narrows the type when it passes.
export function assert(condition: unknown, message: string, code?: string): asserts condition {
  if (!condition) throw new BadRequestError(message, code)
}
