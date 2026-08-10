import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client'

import type { OAuthLiveAccess } from './oauth-live-access'
import {
  OAuthSecurityError,
  installUrlCanParseCompatibility,
  prepareOAuthAccessTokenVerification,
  type OAuthAccessTokenExpectations,
  type OAuthPrincipal,
} from './oauth-security'

export interface VerifyOAuthBearerTokenOptions extends OAuthAccessTokenExpectations {
  jwksUrl: string
}

export type BetterAuthMcpAccessVerifierOptions = Omit<
  VerifyOAuthBearerTokenOptions,
  'audience' | 'issuer'
> & {
  /**
   * Required request-local Better Auth authority check. The callback runs only on the server and
   * must validate the current session, user, client, consent, and resource grant from canonical
   * state. Provider-private session identity never enters the MCP access context.
   */
  readonly validateLiveAccess: (access: OAuthLiveAccess) => Promise<boolean>
}

const COMPACT_JWT_PATTERN = /^[\w-]+\.[\w-]+\.[\w-]+$/u
const MAX_COMPACT_JWT_BYTES = 8192

function invalidToken(): never {
  throw new OAuthSecurityError('AUTH_OAUTH_TOKEN_INVALID')
}

function decodeVerifiedPayload(token: string): Record<string, unknown> {
  if (token.length > MAX_COMPACT_JWT_BYTES || !COMPACT_JWT_PATTERN.test(token)) invalidToken()
  const encodedPayload = token.split('.')[1]
  if (!encodedPayload || encodedPayload.length % 4 === 1) invalidToken()
  try {
    const base64 = encodedPayload.replaceAll('-', '+').replaceAll('_', '/')
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidToken()
    return value as Record<string, unknown>
  } catch {
    invalidToken()
  }
}

function requireCanonicalJwksUrl(issuer: string, jwksUrl: string): void {
  let parsedIssuer: URL
  let parsedJwks: URL
  try {
    parsedIssuer = new URL(issuer)
    parsedJwks = new URL(jwksUrl)
  } catch {
    throw new OAuthSecurityError('AUTH_OAUTH_TOKEN_INVALID')
  }
  if (
    parsedIssuer.protocol !== 'https:' ||
    parsedIssuer.username ||
    parsedIssuer.password ||
    parsedIssuer.search ||
    parsedIssuer.hash ||
    parsedJwks.href !== jwksUrl ||
    parsedJwks.origin !== parsedIssuer.origin ||
    parsedJwks.username ||
    parsedJwks.password ||
    parsedJwks.search ||
    parsedJwks.hash ||
    jwksUrl !== `${issuer.endsWith('/') ? issuer : `${issuer}/`}jwks`
  ) {
    throw new OAuthSecurityError('AUTH_OAUTH_TOKEN_INVALID')
  }
}

/**
 * Uses the pinned provider's resource client for JOSE/JWKS processing, then
 * applies BCN's stricter beta token-class and exact-binding checks. Live
 * session, client, consent, membership, and operation authorization remain a
 * separate Convex transaction and are deliberately not derived from claims.
 */
export async function verifyOAuthBearerToken(
  token: string | undefined,
  options: VerifyOAuthBearerTokenOptions,
): Promise<OAuthPrincipal> {
  // The resource verifier runs in its own Convex HTTP-action isolate, so the
  // auth-plugin initialization that installs this missing runtime primitive is
  // not guaranteed to have executed here.
  installUrlCanParseCompatibility()
  requireCanonicalJwksUrl(options.issuer, options.jwksUrl)
  if (typeof token !== 'string') invalidToken()
  // Reject malformed/oversized compact values before the verifier performs a
  // JWKS lookup. The decoded value is deliberately not trusted until after the
  // official verifier succeeds below.
  decodeVerifiedPayload(token)
  const maxLifetimeSeconds = options.maxLifetimeSeconds ?? 600
  const verification = prepareOAuthAccessTokenVerification(options)
  const verifyBearerToken = oauthProviderResourceClient().getActions().verifyBearerToken
  await verifyBearerToken(token, {
    jwksUrl: options.jwksUrl,
    verifyOptions: {
      algorithms: ['RS256'],
      audience: options.audience,
      clockTolerance: 0,
      currentDate: verification.currentDate,
      issuer: options.issuer,
      maxTokenAge: `${maxLifetimeSeconds}s`,
      typ: 'at+jwt',
    },
  })

  // The pinned resource client normalizes `client_id` from `azp` on its
  // returned payload. Re-read the now signature-verified compact bytes so a
  // conflicting signed client_id (or another raw unknown claim) cannot be
  // hidden by that normalization.
  return verification.assert(decodeVerifiedPayload(token))
}

/**
 * Adapts BCN's strict Better Auth OAuth access-token profile to the provider-neutral MCP verifier
 * contract without importing the MCP package or exposing provider-private session state.
 */
export function createBetterAuthMcpAccessVerifier(options: BetterAuthMcpAccessVerifierOptions) {
  if (typeof options.validateLiveAccess !== 'function') {
    throw new OAuthSecurityError('AUTH_OAUTH_CONFIG_INVALID')
  }
  const fixedOptions: BetterAuthMcpAccessVerifierOptions = Object.freeze({
    allowedScopes: Object.freeze([...options.allowedScopes]),
    jwksUrl: options.jwksUrl,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.maxLifetimeSeconds === undefined
      ? {}
      : { maxLifetimeSeconds: options.maxLifetimeSeconds }),
    ...(options.requiredScopes === undefined
      ? {}
      : { requiredScopes: Object.freeze([...options.requiredScopes]) }),
    ...(options.subject === undefined ? {} : { subject: options.subject }),
    validateLiveAccess: options.validateLiveAccess,
  })
  const { validateLiveAccess, ...verificationOptions } = fixedOptions

  return Object.freeze({
    async verifyAccessToken(
      token: string,
      expected: { readonly issuer: string; readonly resource: URL },
    ) {
      if (
        !expected ||
        typeof expected.issuer !== 'string' ||
        !(expected.resource instanceof URL) ||
        expected.resource.protocol !== 'https:' ||
        expected.resource.username ||
        expected.resource.password ||
        expected.resource.search ||
        expected.resource.hash
      ) {
        invalidToken()
      }
      const resource = expected.resource.href
      const principal = await verifyOAuthBearerToken(token, {
        ...verificationOptions,
        audience: resource,
        issuer: expected.issuer,
      })
      let live = false
      try {
        live = await validateLiveAccess(
          Object.freeze({
            clientId: principal.clientId,
            issuer: expected.issuer,
            resource,
            scopes: Object.freeze([...principal.scopes]),
            sessionId: principal.sessionId,
            subject: principal.subject,
          }),
        )
      } catch {
        invalidToken()
      }
      if (live !== true) invalidToken()
      return Object.freeze({
        access: Object.freeze({
          issuer: expected.issuer,
          subject: principal.subject,
          clientId: principal.clientId,
          resource,
          scopes: Object.freeze([...principal.scopes]),
        }),
        expiresAt: principal.expiresAt,
      })
    },
  })
}
