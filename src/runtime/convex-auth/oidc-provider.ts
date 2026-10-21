/**
 * The `oidc` Better Auth provider: a plain, frozen `OAuthProvider` object.
 *
 * It needs no network to build. Each method that needs discovery awaits the
 * per-isolate cache of the client. Profile fields come only from the verified
 * ID token, never from the userinfo endpoint.
 */
import { APIError } from 'better-auth/api'
import { createAuthorizationURL, type OAuthProvider } from 'better-auth/oauth2'
import type { JWTPayload } from 'jose'

import { logOidcFailure } from './diagnostics'
import { OidcError, oidcDeadline } from './oidc-fetch'
import { OIDC_ID_TOKEN_MAX_AGE_SECONDS, type OidcClient } from './oidc-metadata'
import { OIDC_PROVIDER_ID } from './oidc-options'

/** The verified ID-token claims that `getUserInfo` returns as `data`. */
export type OidcIdTokenClaims = JWTPayload & { readonly sub: string }

// Fixed: the client's `scopes` never reach the IdP.
const OIDC_SCOPES = ['openid', 'email', 'profile']
const ID_TOKEN_CLAIMS = ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce']
const MAX_SUBJECT_LENGTH = 255

const ownedProviders = new WeakSet<object>()

function oidcCode(error: unknown): string {
  return error instanceof OidcError ? error.code : 'AUTH_OIDC_TRANSPORT'
}

function displayName(claims: JWTPayload): string {
  if (typeof claims.name === 'string' && claims.name.trim() !== '') return claims.name
  const parts = [claims.given_name, claims.family_name].filter(
    (part): part is string => typeof part === 'string',
  )
  const joined = parts.join(' ').trim()
  if (joined !== '') return joined
  return typeof claims.preferred_username === 'string' ? claims.preferred_username : ''
}

function httpsUrlOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

/** Build the frozen `oidc` provider for one client. */
export function createOidcProvider(client: OidcClient): OAuthProvider<OidcIdTokenClaims> {
  const { clientId, clientSecret } = client.config
  const options = Object.freeze({
    clientId,
    clientSecret,
    disableIdTokenSignIn: true,
    overrideUserInfoOnSignIn: false,
  })

  const provider: OAuthProvider<OidcIdTokenClaims> = {
    id: OIDC_PROVIDER_ID,
    name: 'OIDC',
    issuer: client.config.issuer,
    requiresIdTokenNonce: true,
    options,
    accountSubject: async ({ profile }) => client.accountKey(profile.sub),
    // Ignores the client's `scopes`, `loginHint`, `display` and `additionalParams`.
    createAuthorizationURL: async (data) => {
      if (!data.codeVerifier || !data.idTokenNonce) {
        throw new OidcError('AUTH_OIDC_DISCOVERY_INVALID', 'request')
      }
      let authorizationEndpoint: string
      try {
        authorizationEndpoint = (await client.metadata(oidcDeadline())).authorizationEndpoint
      } catch (error) {
        logOidcFailure(oidcCode(error), { cause: error })
        throw new APIError('SERVICE_UNAVAILABLE', {
          code: 'OIDC_UNAVAILABLE',
          message: 'OIDC_UNAVAILABLE',
        })
      }
      return createAuthorizationURL({
        id: OIDC_PROVIDER_ID,
        options: { clientId, clientSecret },
        authorizationEndpoint,
        state: data.state,
        codeVerifier: data.codeVerifier,
        redirectURI: data.redirectURI,
        scopes: OIDC_SCOPES,
        nonce: data.idTokenNonce,
      })
    },
    // BA maps any throw here to `error=invalid_code`.
    validateAuthorizationCode: async ({ code, codeVerifier, redirectURI }) => {
      if (!codeVerifier) throw new OidcError('AUTH_OIDC_TOKEN_REQUEST_FAILED', 'request')
      const result = await client.requestTokens(
        { type: 'authorization_code', code, codeVerifier, redirectURI },
        oidcDeadline(),
      )
      if (!result.ok) throw new OidcError('AUTH_OIDC_TOKEN_REQUEST_FAILED', String(result.status))
      if (typeof result.tokens.idToken !== 'string') {
        throw new OidcError('AUTH_OIDC_ID_TOKEN_INVALID', 'missing')
      }
      return result.tokens
    },
    // Never calls the userinfo endpoint. `null` makes BA answer `unable_to_get_user_info`.
    getUserInfo: async (tokens) => {
      const reject = (reason: string) => {
        logOidcFailure(`AUTH_OIDC_ID_TOKEN_INVALID:${reason}`)
        return null
      }
      // Also refuses BA paths without a nonce: id-token sign-in and `/account-info`.
      if (typeof tokens.idToken !== 'string' || typeof tokens.expectedIdTokenNonce !== 'string')
        return reject('missing')
      let result: Awaited<ReturnType<OidcClient['verifyJwt']>>
      try {
        result = await client.verifyJwt(
          tokens.idToken,
          {
            typ: 'id_token',
            requiredClaims: ID_TOKEN_CLAIMS,
            maxTokenAgeSeconds: OIDC_ID_TOKEN_MAX_AGE_SECONDS,
          },
          oidcDeadline(),
        )
      } catch {
        return reject('malformed')
      }
      if (!result.ok) return reject(result.reason)
      const claims = result.payload
      // prettier-ignore
      if (typeof claims.nonce !== 'string' || claims.nonce !== tokens.expectedIdTokenNonce) return reject('nonce')
      if (
        typeof claims.sub !== 'string' ||
        claims.sub.length === 0 ||
        claims.sub.length > MAX_SUBJECT_LENGTH
      ) {
        return reject('subject')
      }
      // Only these four keys, so no ID-token claim reaches an additional user field.
      return {
        user: {
          email:
            typeof claims.email === 'string' && claims.email.length > 0 ? claims.email : undefined,
          emailVerified: claims.email_verified === true,
          name: displayName(claims),
          image: httpsUrlOrUndefined(claims.picture),
        },
        data: { ...claims, sub: claims.sub },
      }
    },
    // One refresh owner: the upstream helper. BA's own refresh paths always fail here.
    // prettier-ignore
    refreshAccessToken: async () => { throw new OidcError('AUTH_OIDC_REFRESH_DELEGATED') },
    createEndSessionURL: async ({ idToken, postLogoutRedirectURI, state }) => {
      let endSessionEndpoint: string | null
      try {
        endSessionEndpoint = (await client.metadata(oidcDeadline())).endSessionEndpoint
      } catch (error) {
        logOidcFailure(oidcCode(error), { cause: error })
        return null
      }
      if (endSessionEndpoint === null) return null
      const url = new URL(endSessionEndpoint)
      url.searchParams.set('client_id', clientId)
      if (typeof idToken === 'string' && idToken !== '')
        url.searchParams.set('id_token_hint', idToken)
      if (postLogoutRedirectURI)
        url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectURI)
      if (state) url.searchParams.set('state', state)
      return url
    },
  }

  Object.freeze(provider)
  ownedProviders.add(provider)
  return provider
}

/** `true` only for an object that `createOidcProvider` built. */
export function isOwnedOidcProvider(value: unknown): boolean {
  return typeof value === 'object' && value !== null && ownedProviders.has(value)
}
