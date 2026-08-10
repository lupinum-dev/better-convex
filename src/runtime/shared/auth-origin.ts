export type AuthOriginName =
  | 'SITE_URL'
  | 'CONVEX_SITE_URL'
  | 'auth.origin'
  | 'convex.url'
  | 'convex.siteUrl'

/**
 * Return whether a URL parser hostname is one of the three exact development
 * loopback forms supported by the auth boundary.
 *
 * This intentionally does not accept `*.localhost`, the rest of 127/8, IPv4
 * aliases, or expanded/mapped IPv6 forms. Callers must first prove that the
 * complete URL already uses its canonical serialization so the URL parser
 * cannot turn an ambiguous spelling into one of these values.
 */
export function isExactLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** Return one canonical, credential-free HTTP(S) origin or throw. */
export function normalizeAuthOrigin(input: string, name: AuthOriginName): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TypeError(`${name} must be a non-empty string URL origin`)
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new TypeError(`${name} must be a valid URL origin`)
  }

  if (url.username || url.password) {
    throw new TypeError(`${name} must not contain credentials`)
  }
  if (url.search || url.hash) {
    throw new TypeError(`${name} must not contain a query string or fragment`)
  }
  if (url.pathname !== '/') {
    throw new TypeError(`${name} must not contain a path`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${name} must use http or https`)
  }
  if (url.hostname.endsWith('.')) {
    throw new TypeError(`${name} must not use a trailing-dot hostname`)
  }

  // Permit one conventional trailing slash, but reject every other spelling
  // that WHATWG URL parsing would silently rewrite (case, default ports,
  // numeric/octal/hex IPv4, Unicode hosts, expanded IPv6, whitespace, etc.).
  const inputWithoutOneTrailingSlash = input.endsWith('/') ? input.slice(0, -1) : input
  if (inputWithoutOneTrailingSlash !== url.origin) {
    throw new TypeError(`${name} must use its canonical URL serialization`)
  }

  if (url.protocol === 'http:' && !isExactLoopbackHost(url.hostname)) {
    throw new TypeError(`${name} must use https outside exact loopback development hosts`)
  }

  return url.origin
}

/** Read and validate a required auth origin from an environment-like object. */
export function requireAuthOrigin(
  name: 'SITE_URL' | 'CONVEX_SITE_URL',
  env: Readonly<Record<string, string | undefined>>,
): string {
  const value = env[name]
  if (!value) throw new TypeError(`${name} is required`)
  return normalizeAuthOrigin(value, name)
}
