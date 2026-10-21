/** Sign-in through one OpenID Connect identity provider. The provider id is always `oidc`. */
export interface BetterConvexOidcOptions {
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
}

/** What `auth.getOidcAccessToken(ctx)` returns. */
export interface BetterConvexOidcAccessToken {
  readonly accessToken: string
  /** Milliseconds since the epoch. */
  readonly expiresAt: number
}

/** A validated `oidc` option. */
export interface ResolvedOidcConfig {
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret: string
  /** The issuer is http on a loopback host, so the IdP's own endpoints may be too. */
  readonly loopbackHttp: boolean
}

export const OIDC_PROVIDER_ID = 'oidc'
export const OIDC_BACKCHANNEL_LOGOUT_PATH = '/oidc/backchannel-logout'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const ALLOWED_KEYS = new Set(['issuer', 'clientId', 'clientSecret'])
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
  return allowLoopbackHttp && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
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
  const { issuer, clientId, clientSecret } = value
  if (!isValidIssuer(issuer)) throw configError(ISSUER_MESSAGE)
  if (!isValidClientId(clientId)) {
    throw configError('requires "oidc.clientId" to be a non-empty string')
  }
  if (!isValidClientSecret(clientSecret)) {
    throw configError('requires "oidc.clientSecret" to be a non-empty string')
  }
  return Object.freeze({
    issuer,
    clientId,
    clientSecret,
    loopbackHttp: new URL(issuer).protocol === 'http:',
  })
}
