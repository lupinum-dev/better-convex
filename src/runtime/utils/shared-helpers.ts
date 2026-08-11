/**
 * Shared helper functions used across composables
 *
 * These utilities are extracted to avoid code duplication and ensure
 * consistent behavior across the module.
 */

import { isBetterAuthCookieName } from '../shared/auth-cookie'

export { hasBetterAuthCookie, isBetterAuthCookieName } from '../shared/auth-cookie'

// ============================================================================
// Deep Equality & Comparison
// ============================================================================

/**
 * Check if two values are deeply equal using structured comparison.
 * More performant than JSON.stringify for simple cases, handles edge cases better.
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns True if values are deeply equal
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  // Same reference or primitive equality
  if (a === b) return true

  // Handle null/undefined
  if (a == null || b == null) return a === b

  // Handle different types
  if (typeof a !== typeof b) return false

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  // Handle objects (but not arrays which were handled above)
  if (typeof a === 'object' && typeof b === 'object') {
    // Don't compare array to object
    if (Array.isArray(a) !== Array.isArray(b)) return false

    const aKeys = Object.keys(a as object)
    const bKeys = Object.keys(b as object)

    if (aKeys.length !== bKeys.length) return false

    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false
      }
    }
    return true
  }

  // Primitive comparison (already handled by === above)
  return false
}

/**
 * Check if query args match filter args (partial match).
 * Used for optimistic update helpers to filter which queries to update.
 *
 * @param queryArgs - The full args of a query
 * @param filterArgs - Partial args to match against
 * @param skipKeys - Keys to skip during comparison (e.g., 'paginationOpts')
 * @returns True if all filterArgs match corresponding queryArgs
 */
export function argsMatch(
  queryArgs: Record<string, unknown>,
  filterArgs: Record<string, unknown>,
  skipKeys: string[] = [],
): boolean {
  for (const key of Object.keys(filterArgs)) {
    // Skip specified keys
    if (skipKeys.includes(key)) continue

    const filterValue = filterArgs[key]
    const queryValue = queryArgs[key]

    // Use deep equality for comparison
    if (!deepEqual(filterValue, queryValue)) {
      return false
    }
  }
  return true
}

/**
 * Compare two Convex JSON values for sorting.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 *
 * Handles all Convex value types including arrays (for multi-key sorts),
 * numbers, strings, booleans, BigInts, and null/undefined.
 *
 * @param a - First value (convexToJson format)
 * @param b - Second value (convexToJson format)
 * @returns Comparison result (-1, 0, or 1)
 */
export function compareJsonValues(a: unknown, b: unknown): number {
  // Handle arrays (multi-key sort)
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const comparison = compareJsonValues(a[i], b[i])
      if (comparison !== 0) return comparison
    }
    return 0
  }

  // Handle null/undefined
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1

  // Handle numbers
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  // Handle strings
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b)
  }

  // Handle booleans
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (a ? 1 : 0) - (b ? 1 : 0)
  }

  // Handle BigInt ($integer format from convexToJson)
  if (
    typeof a === 'object' &&
    a !== null &&
    '$integer' in a &&
    typeof b === 'object' &&
    b !== null &&
    '$integer' in b
  ) {
    const aInt = a as { $integer: string }
    const bInt = b as { $integer: string }
    return Number(BigInt(aInt.$integer) - BigInt(bInt.$integer))
  }

  // Fallback to string comparison
  return String(a).localeCompare(String(b))
}

// ============================================================================
// Cookie Parsing
// ============================================================================

export const BETTER_AUTH_SESSION_COOKIE_NAME = 'better-auth.session_token'
export const BETTER_AUTH_SECURE_SESSION_COOKIE_NAME = '__Secure-better-auth.session_token'

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^`|~\w]+$/
const COOKIE_VALUE_PATTERN = /^[\x20\x21\x23-\x3A\x3C-\x5B\x5D-\x7E]*$/

interface ParsedCookiePair {
  name: string
  value: string
  wire: string
}

// This file also ships in the auth-disabled runtime graph, so importing Better
// Auth's parser here would make Better Auth mandatory. Keep the supported
// boundary small and verify this parser against the pinned Better Auth parser.

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

/** Domain cookies are outside the supported host-only Better Auth contract. */
export function hasSetCookieDomainAttribute(setCookie: string): boolean {
  const segments = setCookie.split(';')
  for (let index = 1; index < segments.length; index += 1) {
    const attribute = trimOptionalWhitespace(segments[index] ?? '')
    const separator = attribute.indexOf('=')
    const name = trimOptionalWhitespace(
      separator === -1 ? attribute : attribute.slice(0, separator),
    ).toLowerCase()
    if (name === 'domain') return true
  }
  return false
}
