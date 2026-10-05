// The one CORS origin policy for every api/*.js handler.
//
// Production origins are an exact-match allowlist. A local dev origin (http(s)://localhost or a
// loopback IP, any port) is allowed only when this code is NOT running as a production build, and
// it is matched on the parsed hostname, never by substring, so a look-alike host that merely
// contains "localhost" is not a dev origin.
//
// A request with no Origin header (same-origin navigation, server-to-server, curl) gets "*", as
// before; no handler sends Access-Control-Allow-Credentials, so "*" never exposes cookies.

export const PRODUCTION_ORIGINS = ['https://seenjobs.io', 'https://www.seenjobs.io'];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Running as a production build? VERCEL_ENV is Vercel's own flag; NODE_ENV covers `next start`. */
export function isProductionRuntime(env = process.env) {
  return env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';
}

/** A loopback origin, and only outside production. */
export function isLocalDevOrigin(origin, env = process.env) {
  if (!origin || isProductionRuntime(env)) return false;
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** The Access-Control-Allow-Origin value for a request's Origin header. */
export function allowOrigin(origin, env = process.env) {
  const o = String(origin || '');
  if (!o) return '*';
  if (PRODUCTION_ORIGINS.includes(o) || isLocalDevOrigin(o, env)) return o;
  return PRODUCTION_ORIGINS[0];
}
