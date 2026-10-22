import type { GenericActionCtx, GenericDataModel } from 'convex/server'

import { isExactLoopbackHost } from './origin'

/** The verified ID-token claims of one sign-in, frozen. Any other claim the IdP adds (`groups`, `roles`, `hd`, `tid`) is there too. */
export type BetterConvexOidcClaims = Readonly<Record<string, unknown>> & {
  readonly iss: string
  readonly sub: string
  readonly aud: string | readonly string[]
}

/** What `oidc.onSignIn` receives. */
export interface BetterConvexOidcSignIn<DataModel extends GenericDataModel = GenericDataModel> {
  /** The auth HTTP action's context: use `ctx.runMutation` to write your own tables. */
  readonly ctx: GenericActionCtx<DataModel>
  /** The Better Auth user id, the same as `auth.getUser(ctx)` returns as `id`. */
  readonly userId: string
  readonly claims: BetterConvexOidcClaims
}

/** Sign-in through one OpenID Connect identity provider. The provider id is always `oidc`. */
export interface BetterConvexOidcOptions<DataModel extends GenericDataModel = GenericDataModel> {
  /**
   * The issuer identifier, exactly as the provider publishes it in its discovery document,
   * for example `https://sso.example.com/realms/acme`. https only; http only for
   * localhost, 127.0.0.1 or [::1]. The issuer is part of every user's account key:
   * changing it unlinks every user.
   */
  readonly issuer: string
  /** The confidential client's id at the provider. */
  readonly clientId: string
  /** The confidential client's secret. Read it from an environment variable. */
  readonly clientSecret: string
  /**
   * More scopes to request besides `openid email profile`, which are always requested.
   * Add `offline_access` where the IdP issues a refresh token only with it (Microsoft
   * Entra ID, Okta, authentik), and an API scope where the access token must be meant
   * for your own services. Leave `offline_access` out on Keycloak: there it creates
   * offline tokens that outlive the SSO session.
   */
  readonly scopes?: readonly string[]
  /**
   * Runs at every sign-in through the IdP, after the user and its `oidc` account
   * exist and before the session is created. Copy roles or groups from `claims`
   * into your own tables with `ctx.runMutation`, or throw to refuse the sign-in:
   * then no session is created (the user row stays). Linking the IdP to a
   * signed-in user is not a sign-in and does not run it.
   */
  readonly onSignIn?: (input: BetterConvexOidcSignIn<DataModel>) => void | Promise<void>
}

/** What `auth.getOidcAccessToken(ctx)` returns. */
export interface BetterConvexOidcAccessToken {
  readonly accessToken: string
  /** Milliseconds since the epoch. */
  readonly expiresAt: number
}

/** The validated values that identify one IdP client; the client caches are keyed by them. */
export interface OidcClientConfig {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  /** `openid email profile`, then the extra scopes, without duplicates. */
  readonly scopes: readonly string[]
  /** The issuer is http on a loopback host, so the IdP's own endpoints may be too. */
  readonly loopbackHttp: boolean
}

/** A validated `oidc` option. */
export interface ResolvedOidcConfig extends OidcClientConfig {
  readonly onSignIn?: (input: BetterConvexOidcSignIn) => void | Promise<void>
}

export const OIDC_PROVIDER_ID = 'oidc'
export const OIDC_BACKCHANNEL_LOGOUT_PATH = '/oidc/backchannel-logout'
const OIDC_BASE_SCOPES = ['openid', 'email', 'profile']

const ALLOWED_KEYS = new Set(['issuer', 'clientId', 'clientSecret', 'scopes', 'onSignIn'])
const MAX_EXTRA_SCOPES = 20
const MAX_SCOPE_LENGTH = 256
// RFC 6749 section 3.3 scope-token: printable ASCII without space, `"` and `\`.
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/u
const MAX_ISSUER_LENGTH = 2048
const MAX_CLIENT_ID_LENGTH = 256
const MAX_CLIENT_SECRET_LENGTH = 1024
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/u

const ISSUER_MESSAGE =
  'requires "oidc.issuer" to be an https URL without credentials, query or fragment (http only for localhost, 127.0.0.1 or [::1])'

// Same prefix as the factory's other configuration errors. Messages name the
// rule, never the value, so the client secret cannot reach a message.
function configError(message: string): Error {
  return new Error(`[better-convex] createBetterConvexAuth ${message}`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * True for an absolute URL the IdP may use: https, or http on a loopback host
 * when `allowLoopbackHttp` is set. No credentials and no fragment.
 */
export function isAllowedIdpUrl(value: string, allowLoopbackHttp: boolean): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') return false
  if (url.protocol === 'https:') return true
  return allowLoopbackHttp && url.protocol === 'http:' && isExactLoopbackHost(url.hostname)
}

function isValidIssuer(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.trim() !== value || value.length > MAX_ISSUER_LENGTH) return false
  if (!isAllowedIdpUrl(value, true)) return false
  if (value.endsWith('#') || value.endsWith('?')) return false
  return new URL(value).search === ''
}

function isValidClientId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_CLIENT_ID_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  )
}

function isValidClientSecret(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_CLIENT_SECRET_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  )
}

/**
 * Validate the `oidc` option (for the function form: what the function
 * returned). Throws a configuration error that names the broken rule.
 */
export function resolveOidcConfig(value: unknown): ResolvedOidcConfig {
  if (!isPlainObject(value)) throw configError('expected "oidc" to be an object or a function')
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) throw configError(`does not support "oidc.${key}"`)
  }
  const { issuer, clientId, clientSecret, scopes, onSignIn } = value
  if (!isValidIssuer(issuer)) throw configError(ISSUER_MESSAGE)
  if (!isValidClientId(clientId)) {
    throw configError('requires "oidc.clientId" to be a non-empty string')
  }
  if (!isValidClientSecret(clientSecret)) {
    throw configError('requires "oidc.clientSecret" to be a non-empty string')
  }
  if (onSignIn !== undefined && typeof onSignIn !== 'function') {
    throw configError('requires "oidc.onSignIn" to be a function')
  }
  return Object.freeze({
    issuer,
    clientId,
    clientSecret,
    scopes: resolveScopes(scopes),
    loopbackHttp: new URL(issuer).protocol === 'http:',
    ...(onSignIn === undefined
      ? {}
      : { onSignIn: onSignIn as NonNullable<ResolvedOidcConfig['onSignIn']> }),
  })
}

function resolveScopes(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([...OIDC_BASE_SCOPES])
  if (
    !Array.isArray(value) ||
    value.length > MAX_EXTRA_SCOPES ||
    !value.every(
      (scope) =>
        typeof scope === 'string' && scope.length <= MAX_SCOPE_LENGTH && SCOPE_TOKEN.test(scope),
    )
  ) {
    throw configError(
      `requires "oidc.scopes" to be at most ${MAX_EXTRA_SCOPES} scope names without spaces or quotes`,
    )
  }
  return Object.freeze([...new Set([...OIDC_BASE_SCOPES, ...(value as string[])])])
}
