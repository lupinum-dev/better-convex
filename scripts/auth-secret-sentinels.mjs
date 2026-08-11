import { createHash, createHmac } from 'node:crypto'

const RUN_ID_PATTERN = /^[\w-]{16,128}$/u
const TEST_CLIENT_IP = '192.0.2.61'

/**
 * The one closed raw-location registry for the Section 9.6 gate. Locations are
 * semantic leaf paths, not caller-provided exceptions. Adding a location here
 * is therefore a security-design change that must update plan.md first.
 */
export const secretSentinelDefinitions = Object.freeze([
  definition('better-auth-current-secret', [
    'secret-manager.BETTER_AUTH_SECRETS.current',
    'process.environment.BETTER_AUTH_SECRETS.current',
    'process.memory.better-auth-secret.current',
  ]),
  definition('better-auth-prior-secret', [
    'secret-manager.BETTER_AUTH_SECRETS.prior',
    'process.environment.BETTER_AUTH_SECRETS.prior',
    'process.memory.better-auth-secret.prior',
  ]),
  definition('proxy-ip-secret', [
    'secret-manager.BCN_AUTH_PROXY_IP_SECRET',
    'process.environment.BCN_AUTH_PROXY_IP_SECRET',
    'process.memory.proxy-ip-hmac.secret',
  ]),
  definition('proxy-ip-signature', [
    'process.memory.proxy-ip-hmac.signature',
    'http.request.private-nuxt-convex.headers.x-bcn-client-ip-signature',
  ]),
  definition('session-token', [
    'database.export.session[].token',
    'http.response.session.headers.set-cookie',
    'http.request.session.headers.cookie',
    'browser.cookie-jar.session-token',
  ]),
  definition('social-access-token', [
    'http.response.social-provider.body.access_token',
    'process.memory.social-provider.access-token',
  ]),
  definition('social-refresh-token', [
    'http.response.social-provider.body.refresh_token',
    'process.memory.social-provider.refresh-token',
  ]),
  definition('social-id-token', [
    'http.response.social-provider.body.id_token',
    'process.memory.social-provider.id-token',
  ]),
  definition('oauth-client-secret', [
    'http.response.oauth-client-create.body.client_secret',
    'secret-manager.oauth-client-secret',
    'http.request.oauth-token.headers.authorization',
  ]),
  definition('authorization-code', [
    'http.response.oauth-authorize.headers.location',
    'http.request.oauth-token.body.code',
    'process.memory.oauth-client.authorization-code',
  ]),
  definition('pkce-code-verifier', [
    'http.request.oauth-token.body.code_verifier',
    'process.memory.oauth-client.pkce-code-verifier',
  ]),
  definition('oauth-access-token', [
    'http.response.oauth-token.body.access_token',
    'ephemeral-store.oauth-client.access-token',
    'process.memory.oauth-client.access-token',
    'http.request.oauth-resource.headers.authorization',
  ]),
  definition('convex-session-jwt', [
    'http.response.convex-token.body.token',
    'process.memory.convex-auth-client.token',
    'http.request.convex.headers.authorization',
  ]),
  definition('private-jwk-member', ['process.memory.jwk-key-generation.private-member']),
  definition('inspector-proxy-token', [
    'process.environment.MCP_PROXY_AUTH_TOKEN',
    'process.memory.inspector-proxy-token',
    'browser.inspector-profile.proxy-token',
    'http.request.localhost-inspector.headers.authorization',
  ]),
  definition('auth-error-message', ['process.memory.test-auth-error.message']),
  definition('auth-error-cause', ['process.memory.test-auth-error.cause']),
])

/**
 * Refresh-token grants and DPoP are disabled in the first beta. Section 9.6
 * explicitly forbids adding their sentinels or raw-location exceptions before
 * a future reviewed phase extends the plan.
 */
export const disabledSentinelPhases = Object.freeze([
  Object.freeze({ id: 'oauth-refresh-token', authorizedLocations: Object.freeze([]) }),
  Object.freeze({ id: 'dpop-private-key', authorizedLocations: Object.freeze([]) }),
])

const definitionsById = new Map(secretSentinelDefinitions.map((entry) => [entry.id, entry]))

export class SecretSentinelLeakError extends Error {
  constructor(findings) {
    const summary = findings
      .map((finding) => `${finding.id} at ${finding.location} (${finding.encoding})`)
      .join(', ')
    super(`AUTH_SECRET_SENTINEL_LEAK: ${summary}`)
    this.name = 'SecretSentinelLeakError'
    this.findings = Object.freeze(findings.map((finding) => Object.freeze({ ...finding })))
  }
}

function definition(id, authorizedLocations) {
  return Object.freeze({ id, authorizedLocations: Object.freeze([...authorizedLocations]) })
}

function requireRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    throw new TypeError('Secret sentinel run ID must be 16-128 URL-safe characters')
  }
  return runId
}

function derive(runId, id) {
  const digest = createHash('sha256').update(`better-convex-nuxt\0${runId}\0${id}`).digest('hex')
  return `BCN_SENTINEL_${id.replaceAll('-', '_').toUpperCase()}_${digest}`
}

/** Generate one per-run, pairwise-distinct raw canary for every active class. */
export function createSecretSentinels(runId) {
  const validatedRunId = requireRunId(runId)
  const values = Object.fromEntries(
    secretSentinelDefinitions.map(({ id }) => [id, derive(validatedRunId, id)]),
  )
  values['proxy-ip-signature'] = createHmac('sha256', values['proxy-ip-secret'])
    .update(`v1\n${TEST_CLIENT_IP}`)
    .digest('base64url')

  if (new Set(Object.values(values)).size !== secretSentinelDefinitions.length) {
    throw new Error('AUTH_SECRET_SENTINEL_COLLISION')
  }
  return Object.freeze(values)
}

export function replaceSecretSentinel(sentinels, id, value) {
  if (!definitionsById.has(id)) throw new TypeError(`Unknown secret sentinel class: ${id}`)
  if (typeof value !== 'string' || value.length < 16) {
    throw new TypeError(`Replacement secret sentinel ${id} must be at least 16 characters`)
  }
  const next = { ...sentinels, [id]: value }
  if (new Set(Object.values(next)).size !== secretSentinelDefinitions.length) {
    throw new Error('AUTH_SECRET_SENTINEL_COLLISION')
  }
  return Object.freeze(next)
}

export function sentinelTestClientIp() {
  return TEST_CLIENT_IP
}

function normalizeLeafPath(path) {
  return path.replace(/\[\d+\]/gu, '[]')
}

function appendPath(path, key, array) {
  if (array) return `${path}[${key}]`
  const label = String(key)
  return /^[A-Za-z_$][\w$-]*$/u.test(label)
    ? `${path}.${label}`
    : `${path}[${JSON.stringify(label)}]`
}

function* leaves(value, path, seen = new WeakSet()) {
  if (typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array) {
    yield { location: normalizeLeafPath(path), value }
    return
  }
  if (value === null || value === undefined || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (value instanceof URL) {
    yield { location: normalizeLeafPath(path), value: value.toString() }
    return
  }
  if (value instanceof Headers) {
    for (const [name, headerValue] of value.entries()) {
      yield {
        location: normalizeLeafPath(appendPath(path, name.toLowerCase(), false)),
        value: headerValue,
      }
    }
    return
  }
  if (value instanceof Error) {
    // Public/serialized error scans must pass their actual serialization. Raw
    // Error objects are runtime memory and intentionally not silently flattened.
    return
  }

  const array = Array.isArray(value)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') continue
    let child
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) continue
      child = descriptor.value
    } catch {
      continue
    }
    yield* leaves(child, appendPath(path, key, array), seen)
  }
}

export function sentinelEncodings(value) {
  const encoded = [
    ['raw', value],
    ['percent', encodeURIComponent(value)],
    ['base64', Buffer.from(value).toString('base64')],
    ['base64url', Buffer.from(value).toString('base64url')],
  ]
  const unique = new Map()
  for (const [name, candidate] of encoded) {
    if (!unique.has(candidate)) unique.set(candidate, name)
  }
  return [...unique].map(([candidate, name]) => ({ name, value: candidate }))
}

function contains(haystack, needle) {
  const source = Buffer.isBuffer(haystack)
    ? haystack
    : haystack instanceof Uint8Array
      ? Buffer.from(haystack)
      : Buffer.from(haystack)
  return source.includes(Buffer.from(needle))
}

function leafHaystacks(leaf) {
  const values = [leaf.value]
  if (
    typeof leaf.value === 'string' &&
    leaf.location.endsWith('.headers.authorization') &&
    /^Basic\s+/iu.test(leaf.value)
  ) {
    try {
      values.push(Buffer.from(leaf.value.replace(/^Basic\s+/iu, ''), 'base64'))
    } catch {
      // A malformed Basic header is still scanned byte-for-byte above.
    }
  }
  return values
}

/**
 * Scan structured or byte surfaces. The thrown error identifies only the
 * canary class, semantic location, and encoding; it never repeats raw bytes.
 */
export function scanSecretSentinelSurfaces(sentinels, surfaces) {
  const findings = []
  const authorizedOccurrences = []
  let leavesScanned = 0

  for (const surface of surfaces) {
    if (!surface || typeof surface.category !== 'string' || typeof surface.location !== 'string') {
      throw new TypeError('Every secret sentinel surface needs category and location')
    }
    for (const leaf of leaves(surface.value, surface.location)) {
      leavesScanned += 1
      for (const definition of secretSentinelDefinitions) {
        const raw = sentinels[definition.id]
        if (typeof raw !== 'string') {
          throw new TypeError(`Missing secret sentinel class: ${definition.id}`)
        }
        for (const encoding of sentinelEncodings(raw)) {
          if (!leafHaystacks(leaf).some((value) => contains(value, encoding.value))) continue
          const occurrence = {
            category: surface.category,
            encoding: encoding.name,
            id: definition.id,
            location: leaf.location,
          }
          if (definition.authorizedLocations.includes(leaf.location)) {
            authorizedOccurrences.push(occurrence)
          } else {
            findings.push(occurrence)
          }
        }
      }
    }
  }

  if (findings.length > 0) throw new SecretSentinelLeakError(findings)
  return Object.freeze({
    authorizedOccurrences: Object.freeze(authorizedOccurrences),
    categories: Object.freeze([...new Set(surfaces.map((surface) => surface.category))].sort()),
    leavesScanned,
    surfacesScanned: surfaces.length,
  })
}

export function assertSentinelCategories(report, expectedCategories) {
  const actual = new Set(report.categories)
  const missing = expectedCategories.filter((category) => !actual.has(category))
  if (missing.length > 0) {
    throw new Error(`AUTH_SECRET_SENTINEL_COVERAGE_MISSING: ${missing.join(', ')}`)
  }
}
