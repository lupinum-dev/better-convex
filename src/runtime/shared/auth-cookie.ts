export const BETTER_AUTH_SESSION_COOKIE_NAME = 'better-auth.session_token'
export const BETTER_AUTH_SECURE_SESSION_COOKIE_NAME = '__Secure-better-auth.session_token'

export const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^`|~\w]+$/

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

/**
 * The flags every Better Auth cookie must carry at the Nuxt boundary. Better
 * Auth sets all of its cookies HttpOnly and SameSite=Lax under this factory, so
 * a cookie without them is an upstream fault, not a choice. A deletion (empty
 * value or `Max-Age=0`) carries no secret and is checked only for `Secure`.
 */
export function getAuthCookieFlagViolation(
  cookie: string,
  name: string,
): CookieFlagViolation | null {
  if (name.startsWith('__Secure-') && !hasSetCookieAttribute(cookie, 'secure')) {
    return 'secure-missing'
  }
  if (isCookieDeletion(cookie)) return null
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

function isCookieDeletion(cookie: string): boolean {
  const [pair = '', ...attributes] = cookie.split(';')
  const separator = pair.indexOf('=')
  if (separator !== -1 && trimOptionalWhitespace(pair.slice(separator + 1)) === '') return true
  return attributes.some((segment) => {
    const [rawName, ...rest] = segment.split('=')
    return (
      trimOptionalWhitespace(rawName ?? '').toLowerCase() === 'max-age' &&
      Number(trimOptionalWhitespace(rest.join('='))) <= 0
    )
  })
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
