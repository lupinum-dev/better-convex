const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^`|~\w]+$/

function trimOptionalWhitespace(value: string): string {
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
