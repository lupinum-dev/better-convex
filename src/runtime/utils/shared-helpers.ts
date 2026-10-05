/**
 * Better Auth cookie helpers shared by the SSR plugin, the auth proxy, and
 * server utilities.
 */

import {
  BETTER_AUTH_SESSION_COOKIE_NAME,
  BETTER_AUTH_SECURE_SESSION_COOKIE_NAME,
  COOKIE_NAME_PATTERN,
  hasSetCookieAttribute,
  isBetterAuthCookieName,
  trimOptionalWhitespace,
} from '../shared/auth-cookie'

export {
  BETTER_AUTH_SESSION_COOKIE_NAME,
  BETTER_AUTH_SECURE_SESSION_COOKIE_NAME,
  hasBetterAuthCookie,
  isBetterAuthCookieName,
} from '../shared/auth-cookie'

const COOKIE_VALUE_PATTERN = /^[\x20\x21\x23-\x3A\x3C-\x5B\x5D-\x7E]*$/

interface ParsedCookiePair {
  name: string
  value: string
  wire: string
}

// This file also ships in the auth-disabled runtime graph, so importing Better
// Auth's parser here would make Better Auth mandatory. Keep the supported
// boundary small and verify this parser against the pinned Better Auth parser.

function parseCookiePair(input: string): ParsedCookiePair | null {
  const wire = trimOptionalWhitespace(input)
  const separator = wire.indexOf('=')
  if (separator < 1) return null

  const name = trimOptionalWhitespace(wire.slice(0, separator))
  let encodedValue = trimOptionalWhitespace(wire.slice(separator + 1))
  if (encodedValue.length >= 2 && encodedValue.startsWith('"') && encodedValue.endsWith('"')) {
    encodedValue = encodedValue.slice(1, -1)
  }
  if (!COOKIE_NAME_PATTERN.test(name) || !COOKIE_VALUE_PATTERN.test(encodedValue)) return null

  let value = encodedValue
  if (encodedValue.includes('%')) {
    try {
      value = decodeURIComponent(encodedValue)
    } catch {
      // Match Better Auth: malformed percent encoding remains an opaque value.
    }
  }
  return { name, value, wire }
}

function parseCookiePairs(cookieHeader: string | null | undefined): ParsedCookiePair[] {
  const parsed: ParsedCookiePair[] = []
  if (!cookieHeader) return parsed
  for (const chunk of cookieHeader.split(';')) {
    const pair = parseCookiePair(chunk)
    if (pair) parsed.push(pair)
  }
  return parsed
}

function parseCookieHeader(cookieHeader: string | null | undefined): Map<string, ParsedCookiePair> {
  return new Map(parseCookiePairs(cookieHeader).map((pair) => [pair.name, pair]))
}

export function getBetterAuthSessionToken(cookieHeader: string | null | undefined): string | null {
  const cookies = parseCookieHeader(cookieHeader)
  if (cookies.has(BETTER_AUTH_SECURE_SESSION_COOKIE_NAME)) {
    return cookies.get(BETTER_AUTH_SECURE_SESSION_COOKIE_NAME)?.value ?? null
  }
  return cookies.get(BETTER_AUTH_SESSION_COOKIE_NAME)?.value ?? null
}

export function filterBetterAuthCookies(cookieHeader: string | null | undefined): string | null {
  const authCookies = parseCookiePairs(cookieHeader)
    .filter((pair) => isBetterAuthCookieName(pair.name))
    .map((pair) => pair.wire)

  return authCookies.length > 0 ? authCookies.join('; ') : null
}

/** Whether a raw Set-Cookie field belongs to the supported Better Auth namespace. */
export function isBetterAuthSetCookie(setCookie: string): boolean {
  const cookiePair = parseCookiePair(setCookie.split(';', 1)[0] ?? '')
  return cookiePair ? isBetterAuthCookieName(cookiePair.name) : false
}

export function getSetCookieName(setCookie: string): string | null {
  return parseCookiePair(setCookie.split(';', 1)[0] ?? '')?.name ?? null
}

/** Keep the final Set-Cookie value for each exact cookie name. */
export function deduplicateSetCookies(cookies: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (let index = cookies.length - 1; index >= 0; index -= 1) {
    const cookie = cookies[index]!
    const name = getSetCookieName(cookie)
    if (name === null || seen.has(name)) continue
    seen.add(name)
    result.push(cookie)
  }
  return result.reverse()
}

/** Domain cookies are outside the supported host-only Better Auth contract. */
export function hasSetCookieDomainAttribute(setCookie: string): boolean {
  return hasSetCookieAttribute(setCookie, 'domain')
}
