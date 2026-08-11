export function isSameOrigin(origin: string, publicOrigin: string): boolean {
  try {
    return new URL(origin).origin === publicOrigin && origin === new URL(origin).origin
  } catch {
    return false
  }
}

export const OAUTH_TOKEN_CORS_PATH = '/oauth2/token'
export const OAUTH_TOKEN_CORS_MAX_BODY_BYTES = 16 * 1024

const FORBIDDEN_OAUTH_TOKEN_CORS_HEADERS = [
  'authorization',
  'cookie',
  'dpop',
  'proxy-authorization',
] as const

function isCanonicalBrowserOrigin(origin: string | null): origin is string {
  if (origin === null) return false
  try {
    const url = new URL(origin)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      origin === url.origin
    )
  } catch {
    return false
  }
}

export function hasPublicAuthCorsCredentials(headers: Headers): boolean {
  return FORBIDDEN_OAUTH_TOKEN_CORS_HEADERS.some((header) => headers.has(header))
}

function isCrossOriginBrowserOrigin(headers: Headers, publicOrigin: string): boolean {
  const origin = headers.get('origin')
  return isCanonicalBrowserOrigin(origin) && !isSameOrigin(origin, publicOrigin)
}

function hasBoundedContentLength(headers: Headers): boolean {
  const value = headers.get('content-length')
  if (value === null) return true
  if (!/^\d+$/u.test(value)) return false
  const length = Number(value)
  return Number.isSafeInteger(length) && length <= OAUTH_TOKEN_CORS_MAX_BODY_BYTES
}

/**
 * The one browser CORS exception in the auth proxy. It carries no ambient or
 * explicit client credential; the provider guard still validates the stored
 * public `none` client, PKCE, redirect URI, resource, and grant.
 */
export function isAllowedPublicOAuthTokenCorsPost(
  headers: Headers,
  method: string,
  publicOrigin: string,
  authPath: string,
  hasQuery: boolean,
): boolean {
  if (
    method !== 'POST' ||
    authPath !== OAUTH_TOKEN_CORS_PATH ||
    hasQuery ||
    !isCrossOriginBrowserOrigin(headers, publicOrigin) ||
    hasPublicAuthCorsCredentials(headers) ||
    headers.has('access-control-request-method') ||
    headers.has('access-control-request-headers') ||
    !hasBoundedContentLength(headers)
  ) {
    return false
  }

  const contentType = headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return contentType === 'application/x-www-form-urlencoded'
}

/** Accept only the preflight needed by a public form token exchange. */
export function isAllowedPublicOAuthTokenCorsPreflight(
  headers: Headers,
  method: string,
  publicOrigin: string,
  authPath: string,
  hasQuery: boolean,
): boolean {
  if (
    method !== 'OPTIONS' ||
    authPath !== OAUTH_TOKEN_CORS_PATH ||
    hasQuery ||
    !isCrossOriginBrowserOrigin(headers, publicOrigin) ||
    hasPublicAuthCorsCredentials(headers) ||
    headers.has('access-control-request-private-network') ||
    headers.get('access-control-request-method') !== 'POST'
  ) {
    return false
  }

  const requestedHeaders = (headers.get('access-control-request-headers') || '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)
  return requestedHeaders.every((header) => header === 'content-type')
}

function hasCrossSiteFetchMetadata(value: string | null): boolean {
  return (value || '')
    .split(',')
    .some((entry) => ['cross-site', 'same-site'].includes(entry.trim().toLowerCase()))
}

function isSameOriginReferer(referer: string, publicOrigin: string): boolean {
  try {
    const url = new URL(referer)
    return !url.username && !url.password && url.origin === publicOrigin
  } catch {
    return false
  }
}

function isCoreOAuthPostCallbackPath(path: string): boolean {
  const match = /^\/callback\/([^/]+)$/.exec(path)
  if (!match?.[1]) return false
  try {
    const providerId = decodeURIComponent(match[1])
    return (
      providerId.length > 0 &&
      providerId !== '.' &&
      providerId !== '..' &&
      !providerId.includes('%') &&
      !providerId.includes('/') &&
      !providerId.includes('\\') &&
      ![...providerId].some((character) => {
        const code = character.charCodeAt(0)
        return code <= 31 || code === 127
      })
    )
  } catch {
    return false
  }
}

/** Reject explicit cross-origin browser evidence without excluding headerless server clients. */
export function isCrossOriginAuthRequest(
  headers: Headers,
  method: string,
  publicOrigin: string,
  authPath: string,
): boolean {
  // Core social providers such as Apple POST their OAuth result cross-site.
  // Better Auth owns the state/PKCE ceremony on this one exact endpoint shape.
  if (method === 'POST' && isCoreOAuthPostCallbackPath(authPath)) return false

  const origin = headers.get('origin')
  if (origin !== null && !isSameOrigin(origin, publicOrigin)) return true

  if (method !== 'POST') return false
  if (hasCrossSiteFetchMetadata(headers.get('sec-fetch-site'))) return true

  const referer = headers.get('referer')
  return origin === null && referer !== null && !isSameOriginReferer(referer, publicOrigin)
}
