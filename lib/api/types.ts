// Minimal structural types for Vercel Node serverless handlers `(req, res)`.
// Defined locally so foundation code is type-safe WITHOUT a hard dependency on
// `@vercel/node`. These mirror the subset of the Node http req/res surface that
// our existing `api/*.js` routes actually use.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

export interface ApiRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[] | undefined>
  body?: unknown
  socket?: { remoteAddress?: string }
}

export interface ApiResponse {
  status(code: number): ApiResponse
  json(body: unknown): void
  send(body: unknown): void
  end(body?: unknown): void
  setHeader(name: string, value: string | number | readonly string[]): void
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => unknown | Promise<unknown>
