import {
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  oauthMetadataResponse,
  requireBearerAuth,
  type AuthInfo,
  type AuthMetadataOptions,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server'

export const LAB_OAUTH_ISSUER = 'https://issuer.example/api/auth'
export const LAB_OAUTH_SCOPES = Object.freeze(['notes:read', 'notes:write'] as const)
export const LAB_OAUTH_TOKENS = Object.freeze({
  alice: 'lab-oauth-access-alice',
  bob: 'lab-oauth-access-bob',
  expired: 'lab-oauth-expired',
  insufficientScope: 'lab-oauth-insufficient-scope',
  readOnly: 'lab-oauth-read-only',
  revoked: 'lab-oauth-revoked',
  sessionClass: 'lab-session-token',
  wrongClient: 'lab-oauth-wrong-client',
  wrongIssuer: 'lab-oauth-wrong-issuer',
  wrongResource: 'lab-oauth-wrong-resource',
})

interface LabTokenRecord {
  readonly clientId: string
  readonly expiresAt: number
  readonly issuer: string
  readonly resource: 'expected' | 'wrong'
  readonly revoked?: boolean
  readonly scopes: readonly string[]
  readonly subject: string
  readonly tokenUse: 'oauth-access' | 'session'
}

const records: Readonly<Record<string, LabTokenRecord>> = Object.freeze({
  [LAB_OAUTH_TOKENS.alice]: {
    clientId: 'client-a',
    expiresAt: 4_102_444_800,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'expected',
    scopes: LAB_OAUTH_SCOPES,
    subject: 'alice',
    tokenUse: 'oauth-access',
  },
  [LAB_OAUTH_TOKENS.bob]: {
    clientId: 'client-b',
    expiresAt: 4_102_444_800,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'expected',
    scopes: LAB_OAUTH_SCOPES,
    subject: 'bob',
    tokenUse: 'oauth-access',
  },
  [LAB_OAUTH_TOKENS.expired]: {
    clientId: 'client-a',
    expiresAt: 1,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'expected',
    scopes: LAB_OAUTH_SCOPES,
    subject: 'alice',
    tokenUse: 'oauth-access',
  },
  [LAB_OAUTH_TOKENS.insufficientScope]: {
    clientId: 'client-a',
    expiresAt: 4_102_444_800,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'expected',
    scopes: ['notes:write'],
    subject: 'alice',
    tokenUse: 'oauth-access',
  },
  [LAB_OAUTH_TOKENS.readOnly]: {
    clientId: 'client-a',
    expiresAt: 4_102_444_800,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'expected',
    scopes: ['notes:read'],
    subject: 'alice',
    tokenUse: 'oauth-access',
  },
  [LAB_OAUTH_TOKENS.revoked]: {
    clientId: 'client-a',
    expiresAt: 4_102_444_800,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'expected',
    revoked: true,
    scopes: LAB_OAUTH_SCOPES,
    subject: 'alice',
    tokenUse: 'oauth-access',
  },
  [LAB_OAUTH_TOKENS.sessionClass]: {
    clientId: 'client-a',
    expiresAt: 4_102_444_800,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'expected',
    scopes: LAB_OAUTH_SCOPES,
    subject: 'alice',
    tokenUse: 'session',
  },
  [LAB_OAUTH_TOKENS.wrongClient]: {
    clientId: 'unregistered-client',
    expiresAt: 4_102_444_800,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'expected',
    scopes: LAB_OAUTH_SCOPES,
    subject: 'alice',
    tokenUse: 'oauth-access',
  },
  [LAB_OAUTH_TOKENS.wrongIssuer]: {
    clientId: 'client-a',
    expiresAt: 4_102_444_800,
    issuer: 'https://other-issuer.example/api/auth',
    resource: 'expected',
    scopes: LAB_OAUTH_SCOPES,
    subject: 'alice',
    tokenUse: 'oauth-access',
  },
  [LAB_OAUTH_TOKENS.wrongResource]: {
    clientId: 'client-a',
    expiresAt: 4_102_444_800,
    issuer: LAB_OAUTH_ISSUER,
    resource: 'wrong',
    scopes: LAB_OAUTH_SCOPES,
    subject: 'alice',
    tokenUse: 'oauth-access',
  },
})

const allowedClients = new Set(['client-a', 'client-b'])

function invalidToken(): never {
  throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token')
}

function canonicalResource(resourceServerUrl: URL): URL {
  const resource = new URL(resourceServerUrl.href)
  if (resource.hash || resource.search) throw new TypeError('Lab OAuth resource must be exact')
  return resource
}

export function createLabOAuthVerifier(resourceServerUrl: URL): OAuthTokenVerifier {
  const expectedResource = canonicalResource(resourceServerUrl)

  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      const record = records[token]
      if (
        !record ||
        record.revoked ||
        record.tokenUse !== 'oauth-access' ||
        record.issuer !== LAB_OAUTH_ISSUER ||
        !allowedClients.has(record.clientId)
      ) {
        invalidToken()
      }

      const resource =
        record.resource === 'expected'
          ? new URL(expectedResource.href)
          : new URL('https://other-resource.example/mcp')
      if (resource.href !== expectedResource.href) invalidToken()

      return {
        clientId: record.clientId,
        expiresAt: record.expiresAt,
        extra: { issuer: record.issuer, subject: record.subject },
        resource,
        scopes: [...record.scopes],
        token,
      }
    },
  }
}

export function labOAuthMetadataOptions(resourceServerUrl: URL): AuthMetadataOptions {
  const resource = canonicalResource(resourceServerUrl)
  return {
    oauthMetadata: {
      authorization_endpoint: `${LAB_OAUTH_ISSUER}/authorize`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code'],
      issuer: LAB_OAUTH_ISSUER,
      response_types_supported: ['code'],
      revocation_endpoint: `${LAB_OAUTH_ISSUER}/revoke`,
      scopes_supported: [...LAB_OAUTH_SCOPES],
      token_endpoint: `${LAB_OAUTH_ISSUER}/token`,
      token_endpoint_auth_methods_supported: ['none'],
    },
    resourceName: 'Better Convex notes topology lab',
    resourceServerUrl: resource,
    scopesSupported: [...LAB_OAUTH_SCOPES],
  }
}

export function labOAuthMetadataResponse(
  request: Request,
  resourceServerUrl: URL,
): Response | undefined {
  return oauthMetadataResponse(request, labOAuthMetadataOptions(resourceServerUrl))
}

export function labOAuthResourceMetadataUrl(resourceServerUrl: URL): string {
  return getOAuthProtectedResourceMetadataUrl(canonicalResource(resourceServerUrl))
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

export async function requireLabOAuthAccess(
  request: Request,
  resourceServerUrl: URL,
): Promise<AuthInfo | Response> {
  const resource = canonicalResource(resourceServerUrl)
  const gate = requireBearerAuth({
    requiredScopes: ['notes:read'],
    resourceMetadataUrl: labOAuthResourceMetadataUrl(resource),
    verifier: createLabOAuthVerifier(resource),
  })
  const result = await gate(request)
  return result instanceof Response ? noStore(result) : result
}

export function labOAuthSubject(authInfo: AuthInfo): string {
  const subject = authInfo.extra?.subject
  const issuer = authInfo.extra?.issuer
  if (issuer !== LAB_OAUTH_ISSUER || typeof subject !== 'string' || !subject) invalidToken()
  return subject
}
