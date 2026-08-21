const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^`|~\w]+$/

export function trimOptionalWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && (value.charCodeAt(start) === 0x20 || value.charCodeAt(start) === 0x09)) {
    start += 1
  }
  while (
    end > start &&
    (value.charCodeAt(end - 1) === 0x20 || value.charCodeAt(end - 1) === 0x09)
  ) {
    end -= 1
  }
  return start === 0 && end === value.length ? value : value.slice(start, end)
}

export function hasSetCookieAttribute(cookie: string, attribute: string): boolean {
  const target = attribute.toLowerCase()
  return cookie
    .split(';')
    .slice(1)
    .some(
      (segment) => trimOptionalWhitespace(segment.split('=', 1)[0] ?? '').toLowerCase() === target,
    )
}

export type CookieFlagViolation =
  | 'secure-missing'
  | 'httponly-missing'
  | 'samesite-none-unsupported'

export function getSessionCookieFlagViolation(
  cookie: string,
  name: string,
): CookieFlagViolation | null {
  const isSession =
    name === 'better-auth.session_token' || name === '__Secure-better-auth.session_token'
  if (name.startsWith('__Secure-') && !hasSetCookieAttribute(cookie, 'secure')) {
    return 'secure-missing'
  }
  if (!isSession) return null
  if (!hasSetCookieAttribute(cookie, 'httponly')) return 'httponly-missing'
  for (const segment of cookie.split(';').slice(1)) {
    const [rawName, ...rest] = segment.split('=')
    if (trimOptionalWhitespace(rawName ?? '').toLowerCase() !== 'samesite') continue
    if (trimOptionalWhitespace(rest.join('=')).toLowerCase() === 'none') {
      return 'samesite-none-unsupported'
    }
  }
  return null
}

/** The only cookie namespace supported by the Nuxt auth boundary. */
export function isBetterAuthCookieName(name: string): boolean {
  if (!COOKIE_NAME_PATTERN.test(name)) return false
  const unprefixed = name.startsWith('__Secure-') ? name.slice('__Secure-'.length) : name
  return unprefixed.startsWith('better-auth.') && unprefixed.length > 'better-auth.'.length
}

/** Whether a request presents any supported Better Auth cookie name, even malformed. */
export function hasBetterAuthCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false
  return cookieHeader.split(';').some((chunk) => {
    const separator = chunk.indexOf('=')
    const name = trimOptionalWhitespace(separator === -1 ? chunk : chunk.slice(0, separator))
    return isBetterAuthCookieName(name)
  })
}
