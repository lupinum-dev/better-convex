import type { McpAccessContext, McpAccessVerifier, VerifiedMcpAccess } from './index.js'

const maximumIdentityLength = 512
const maximumScopeCount = 128
const maximumScopeLength = 256

export class McpAccessVerificationFailure extends Error {
  constructor() {
    super('MCP access token verification failed')
    this.name = 'McpAccessVerificationFailure'
  }
}

export async function verifyAndNormalizeMcpAccess(options: {
  verifier: McpAccessVerifier
  token: string
  expectedIssuer: string
  expectedResource: URL
  now?: () => number
}): Promise<VerifiedMcpAccess> {
  const issuer = canonicalMcpIssuer(options.expectedIssuer)
  const resource = canonicalResource(options.expectedResource)
  let verified: VerifiedMcpAccess

  try {
    verified = await options.verifier.verifyAccessToken(options.token, new URL(resource))
  } catch {
    throw new McpAccessVerificationFailure()
  }

  try {
    return normalizeVerifiedAccess(
      verified,
      issuer,
      resource,
      options.now?.() ?? Date.now() / 1_000,
    )
  } catch {
    throw new McpAccessVerificationFailure()
  }
}

function normalizeVerifiedAccess(
  verified: VerifiedMcpAccess,
  expectedIssuer: string,
  expectedResource: string,
  nowSeconds: number,
): VerifiedMcpAccess {
  assertExactObject(verified, ['access', 'expiresAt'])
  assertExactObject(verified.access, ['issuer', 'subject', 'clientId', 'resource', 'scopes'])

  if (
    !Number.isFinite(nowSeconds) ||
    !Number.isSafeInteger(verified.expiresAt) ||
    verified.expiresAt <= nowSeconds
  ) {
    throw new TypeError('Invalid access expiration')
  }

  const issuer = canonicalMcpIssuer(verified.access.issuer)
  if (issuer !== expectedIssuer) throw new TypeError('Unexpected access issuer')
  const subject = safeIdentity(verified.access.subject)
  const clientId = safeIdentity(verified.access.clientId)
  const resource = canonicalResourceString(verified.access.resource)
  if (resource !== expectedResource) throw new TypeError('Unexpected access resource')
  const scopes = normalizeScopes(verified.access.scopes)
  const access: McpAccessContext = Object.freeze({
    issuer,
    subject,
    clientId,
    resource,
    scopes,
  })

  return Object.freeze({ access, expiresAt: verified.expiresAt })
}

export function canonicalMcpIssuer(value: string): string {
  const issuer = new URL(value)
  if (
    !isSecureResource(issuer) ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.href !== value
  ) {
    throw new TypeError('Invalid access issuer')
  }
  return value
}

function canonicalResource(value: URL): string {
  if (!(value instanceof URL)) throw new TypeError('Invalid expected resource')
  if (!isSecureResource(value) || value.username || value.password || value.hash) {
    throw new TypeError('Invalid access resource')
  }
  return value.href
}

function isSecureResource(value: URL): boolean {
  return (
    value.protocol === 'https:' ||
    (value.protocol === 'http:' &&
      (value.hostname === '127.0.0.1' ||
        value.hostname === 'localhost' ||
        value.hostname === '[::1]'))
  )
}

function canonicalResourceString(value: string): string {
  const resource = new URL(value)
  if (resource.href !== value) throw new TypeError('Noncanonical access resource')
  return canonicalResource(resource)
}

function safeIdentity(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumIdentityLength ||
    value.trim() !== value ||
    hasUnsafeTextCharacter(value)
  ) {
    throw new TypeError('Invalid access identity')
  }
  return value
}

function normalizeScopes(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumScopeCount) {
    throw new TypeError('Invalid access scopes')
  }
  const scopes = value.map((scope) => {
    if (
      typeof scope !== 'string' ||
      scope.length === 0 ||
      scope.length > maximumScopeLength ||
      scope.trim() !== scope ||
      hasUnsafeTextCharacter(scope) ||
      /\s/u.test(scope)
    ) {
      throw new TypeError('Invalid access scope')
    }
    return scope
  })
  return Object.freeze([...new Set(scopes)].sort())
}

function hasUnsafeTextCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

function assertExactObject(
  value: unknown,
  fields: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== [...fields].sort().join(',')
  ) {
    throw new TypeError('Invalid verified access object')
  }
}
