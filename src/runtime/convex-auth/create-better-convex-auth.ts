import { oauthProvider as createOAuthProvider } from '@better-auth/oauth-provider'
import type { Auth, BetterAuthOptions, BetterAuthPlugin, InferAPI, User } from 'better-auth'
import { APIError, betterAuth } from 'better-auth'
import {
  emailOTP,
  organization,
  twoFactor,
  type EmailOTPOptions,
  type OrganizationEndpoints,
  type OrganizationOptions,
  type TeamEndpoints,
  type TwoFactorOptions,
} from 'better-auth/plugins'
import type { GenericDataModel, HttpRouter, PublicHttpAction } from 'convex/server'

import { createAuthJwtPlugin } from './auth-jwt'
import { isWritableAuthCtx, type AuthCtx, type WritableAuthCtx } from './context'
import { createAuthComponent, type BetterConvexSessionHttpHandler } from './create-auth-component'
import {
  AUTH_EMAIL_DELIVERY_FAILED,
  authConfigFailure,
  logAuthEmailFailure,
  type AuthConfigSubCode,
} from './diagnostics'
import { requireMcpPrincipal, type BetterConvexMcpPrincipal } from './mcp-principal'
import {
  canonicalAuthIssuer,
  resolveMcpProfile,
  resolveMcpResource,
  type BetterConvexMcpOptions,
  type ResolvedMcpProfile,
} from './mcp-profile'
import { createOAuthConnections, type BetterConvexOAuthConnections } from './oauth-connections'
import { createOAuthOperator, type BetterConvexOAuthOperator } from './oauth-operator'
import {
  createBetterAuthMcpAccessVerifier,
  type BetterAuthMcpAccessVerifierOptions,
  type BetterConvexMcpAccessVerifier,
} from './oauth-resource'
import type { PinnedOAuthProviderProfile } from './oauth-security'
import { requireAuthOrigin } from './origin'
import { convexAuth, LIBRARY_RATE_LIMIT_RULES } from './plugin'
import { getConvexAuthProvider } from './provider'
import { createConvexAuthRateLimitStorage } from './rate-limit-storage'
import type {
  AuthAdapterComponentApi,
  AuthComponentTriggers,
  AuthFunctions,
  BetterConvexAuthUser,
  CreateAuth,
} from './types'
import { parseVersionedSecrets } from './versioned-secrets'

export { MAX_SESSION_CLAIMS_BYTES } from './plugin'

type BetterAuthEmailAndPasswordOptions = NonNullable<BetterAuthOptions['emailAndPassword']>
type EmailVerificationOptions = NonNullable<BetterAuthOptions['emailVerification']>
type BetterAuthSessionOptions = NonNullable<BetterAuthOptions['session']>
type SocialProviders = NonNullable<BetterAuthOptions['socialProviders']>

type BetterConvexUserCreateDecision =
  | { readonly allowed: false }
  | {
      readonly allowed: true
      readonly user?: {
        readonly email?: string
        readonly id?: string
      }
    }

type BetterConvexPendingUser = Readonly<
  Pick<User, 'email' | 'emailVerified' | 'id' | 'image' | 'name'>
>

const reviewedPasswordOptionKeys = [
  'disableSignUp',
  'maxPasswordLength',
  'onExistingUserSignUp',
  'onPasswordReset',
  'requireEmailVerification',
  'resetPasswordTokenExpiresIn',
  'revokeSessionsOnPasswordReset',
] as const

const reviewedEmailVerificationOptionKeys = [
  'afterEmailVerification',
  'autoSignInAfterVerification',
  'beforeEmailVerification',
  'expiresIn',
  'sendOnSignIn',
  'sendOnSignUp',
] as const

type ReviewedEmailAndPasswordOptions = Partial<
  Pick<BetterAuthEmailAndPasswordOptions, (typeof reviewedPasswordOptionKeys)[number]>
> & {
  /**
   * Offer link-based password reset (`/request-password-reset`,
   * `/reset-password`). Off by default; requires the `email` hook, which then
   * receives `reset-password` messages.
   */
  readonly passwordReset?: boolean
}

type ReviewedEmailVerificationOptions = Partial<
  Pick<EmailVerificationOptions, (typeof reviewedEmailVerificationOptionKeys)[number]>
>

type ReviewedEmailOTPOptions = Omit<EmailOTPOptions, 'sendVerificationOTP'> & {
  readonly sendVerificationOTP?: never
}

type ReviewedTwoFactorOptions = Omit<TwoFactorOptions, 'otpOptions'> & {
  readonly otpOptions?: Omit<NonNullable<TwoFactorOptions['otpOptions']>, 'sendOTP'> & {
    readonly sendOTP?: never
  }
}

type ReviewedOrganizationOptions<Options extends OrganizationOptions = OrganizationOptions> =
  Options & { readonly sendInvitationEmail?: never }

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR

/** Reviewed session lifetime bounds, in seconds. */
export const SESSION_POLICY_BOUNDS = Object.freeze({
  expiresIn: Object.freeze({ min: SECONDS_PER_HOUR, max: 30 * SECONDS_PER_DAY }),
  updateAge: Object.freeze({ min: 5 * SECONDS_PER_MINUTE }),
  cookieCacheMaxAge: Object.freeze({ min: 1, max: 5 * SECONDS_PER_MINUTE }),
})

const COOKIE_CACHE_STRATEGIES = ['compact', 'jwt', 'jwe'] as const
/** Better Auth's own default cookie cache lifetime, in seconds. */
const BETTER_AUTH_DEFAULT_COOKIE_CACHE_MAX_AGE = 5 * SECONDS_PER_MINUTE

const DEFAULT_SESSION_EXPIRES_IN = 7 * SECONDS_PER_DAY
const DEFAULT_SESSION_UPDATE_AGE = SECONDS_PER_DAY

/**
 * Bounded session policy. Lifetimes are seconds:
 * `1h <= expiresIn <= 30d` (default 7d), `5m <= updateAge <= expiresIn` (default 1d).
 *
 * `cookieCache` lets Better Auth endpoints trust a signed session cookie
 * instead of the database for at most `maxAge` seconds (`1..300`, default
 * 300), so a revoked session can still pass them that long. Stateless cache
 * refresh is not supported. Convex tokens always re-read the database.
 */
export interface BetterConvexSessionPolicy {
  readonly expiresIn?: number
  readonly updateAge?: number
  readonly cookieCache?: {
    readonly enabled?: boolean
    readonly maxAge?: number
    readonly strategy?: (typeof COOKIE_CACHE_STRATEGIES)[number]
  }
}

/**
 * Account policy. Everything except `trustedProviders` is owned by the factory:
 * different-email linking, implicit linking, and unlinking the last account stay
 * disabled. `trustedProviders` admits only configured social provider names.
 */
export interface BetterConvexAccountPolicy {
  readonly accountLinking?: {
    readonly trustedProviders?: readonly string[]
  }
}

/** A user as it appears in a transactional email message. */
export interface BetterConvexAuthEmailUser {
  readonly id: string
  readonly email: string
  readonly name: string
}

/**
 * Every transactional email the reviewed capabilities emit. `to` is always the
 * recipient address; the other fields depend on `type`.
 */
export type BetterConvexAuthEmail =
  | {
      readonly type: 'verify-email'
      readonly to: string
      readonly url: string
      readonly token: string
      readonly user: BetterConvexAuthEmailUser
    }
  | {
      readonly type: 'reset-password'
      readonly to: string
      readonly url: string
      readonly token: string
      readonly user: BetterConvexAuthEmailUser
    }
  | {
      readonly type: 'email-otp'
      readonly to: string
      readonly otp: string
      readonly purpose: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email'
    }
  | {
      readonly type: 'two-factor-otp'
      readonly to: string
      readonly otp: string
      readonly user: BetterConvexAuthEmailUser
    }
  | {
      readonly type: 'organization-invitation'
      readonly to: string
      readonly invitationId: string
      readonly role: string
      readonly organization: {
        readonly id: string
        readonly name: string
        readonly slug: string
      }
      readonly inviter: BetterConvexAuthEmailUser
    }

export type BetterConvexAuthEmailType = BetterConvexAuthEmail['type']

/**
 * Deliver one auth email. `ctx` is always a mutation or action context: the
 * library fails with `AUTH_EMAIL_REQUIRES_WRITABLE_CONTEXT` before calling this
 * from a query. The library awaits the returned promise, but Better Auth runs
 * every email send as a background task: a rejection does NOT fail the auth
 * request (the caller still sees success, which also avoids account
 * enumeration). The library logs `AUTH_EMAIL_DELIVERY_FAILED` with the message
 * type and a sanitized cause, never the message or the raw error.
 */
export type BetterConvexAuthEmailSender<DataModel extends GenericDataModel = GenericDataModel> = (
  ctx: WritableAuthCtx<DataModel>,
  message: BetterConvexAuthEmail,
) => Promise<void>

type SessionClaimsDefinition = NonNullable<
  Parameters<typeof convexAuth>[0]['sessionJwt']['definePayload']
>

export interface CreateBetterConvexAuthOptions<DataModel extends GenericDataModel> {
  readonly appName?: string
  readonly account?: BetterConvexAccountPolicy
  readonly authFunctions?: AuthFunctions
  readonly beforeUserCreate?: (input: {
    readonly ctx: AuthCtx<DataModel>
    readonly user: BetterConvexPendingUser
  }) => BetterConvexUserCreateDecision | Promise<BetterConvexUserCreateDecision>
  readonly triggers?: AuthComponentTriggers<DataModel>
  /** The one delivery hook for every auth email. See {@link BetterConvexAuthEmail}. */
  readonly email?: BetterConvexAuthEmailSender<DataModel>
  readonly emailAndPassword?: false | ReviewedEmailAndPasswordOptions
  readonly emailVerification?: ReviewedEmailVerificationOptions
  readonly emailOTP?: false | ReviewedEmailOTPOptions
  readonly organization?: false | ReviewedOrganizationOptions
  readonly twoFactor?: false | ReviewedTwoFactorOptions
  /**
   * OAuth for MCP hosts. `oauth.mcp` configures the OAuth provider with the
   * reviewed MCP profile; it replaces a hand-written `oauthProvider`.
   */
  readonly oauth?: { readonly mcp: BetterConvexMcpOptions }
  readonly oauthProvider?:
    | PinnedOAuthProviderProfile
    | ((
        ctx: AuthCtx<DataModel>,
      ) => PinnedOAuthProviderProfile | Promise<PinnedOAuthProviderProfile>)
  readonly session?: BetterConvexSessionPolicy
  readonly socialProviders?: SocialProviders | (() => SocialProviders)
  /**
   * Add claims to the Convex session token. By default the token carries only
   * the library claims (`sub`, `sid`, `token_use` and the registered JWT
   * claims); profile fields such as `name`, `email`, `emailVerified` or
   * `image` are opt-in here. Prefer `auth.getUser(ctx)` in Convex functions:
   * claims are a snapshot from token issue time. Library claims cannot be
   * overridden, and the serialized claims are bounded.
   */
  readonly defineSessionClaims?: SessionClaimsDefinition
}

export interface BetterConvexAuth<
  DataModel extends GenericDataModel,
  AuthInstance extends BetterConvexAuthInstance = BetterConvexAuthInstance,
> {
  /** Construct the request-scoped Better Auth instance. */
  readonly createAuth: CreateAuth<DataModel, AuthInstance>
  /** Mount the hardened `/api/auth/*` routes on the Convex HTTP router. */
  readonly registerRoutes: (http: HttpRouter) => void
  /**
   * Wrap an application HTTP action that must act as the caller's Better Auth
   * session. It gets the same hardening as the `/api/auth/*` routes (signed
   * client IP, public-origin rewrite, Better Auth rate limiting) plus a
   * same-origin check for unsafe methods and the library's session admission.
   * Denials answer `401 UNAUTHENTICATED` or `403 FORBIDDEN`.
   */
  readonly sessionHttpAction: (
    handler: BetterConvexSessionHttpHandler<DataModel, AuthInstance>,
  ) => PublicHttpAction
  readonly triggerFunctions: () => ReturnType<
    ReturnType<typeof createAuthComponent<DataModel>>['triggerFunctions']
  >
  readonly jwksOperatorFunctions: () => ReturnType<
    ReturnType<typeof createAuthComponent<DataModel>>['jwksOperatorFunctions']
  >
  readonly oauthOperator: BetterConvexOAuthOperator<DataModel>
  /**
   * The live Better Auth user for the calling Convex session, or `null`.
   * Performs exactly one component query; revoked, expired, superseded
   * (security-generation), and non-session tokens resolve to `null`.
   */
  readonly getUser: (ctx: AuthCtx<DataModel>) => Promise<BetterConvexAuthUser | null>
  /**
   * Like {@link BetterConvexAuth.getUser}, but throws
   * `ConvexError({ code: 'UNAUTHENTICATED', message: 'Authentication required' })`.
   */
  readonly requireUser: (ctx: AuthCtx<DataModel>) => Promise<BetterConvexAuthUser>
  /**
   * A Better Auth instance plus headers that act as the caller's admitted
   * session, for server-side `auth.api` calls from a mutation or action.
   */
  readonly getAuth: (
    ctx: WritableAuthCtx<DataModel>,
  ) => Promise<{ readonly auth: AuthInstance; readonly headers: Headers }>
  /**
   * The configured MCP OAuth profile. Every accessor throws
   * `AUTH_OAUTH_MCP_PROFILE_REQUIRED` without `oauth.mcp`.
   */
  readonly mcp: BetterConvexMcp
  /**
   * The access verifier for `handleMcpRequest`: keys from the component, the
   * strict token checks, and one live grant query per token. With `oauth.mcp`,
   * scopes and the resource default to the profile.
   */
  readonly createMcpAccessVerifier: (
    ctx: AuthCtx<DataModel>,
    options?: Partial<BetterAuthMcpAccessVerifierOptions>,
  ) => BetterConvexMcpAccessVerifier
  /**
   * Re-validate an MCP principal in the calling function's transaction (one
   * component query) and check `scope`. Throws `ConvexError` with code
   * `MCP_ACCESS_DENIED` or `MCP_INSUFFICIENT_SCOPE`.
   */
  readonly requireMcpPrincipal: (
    ctx: AuthCtx<DataModel>,
    principal: BetterConvexMcpPrincipal,
    options?: { readonly scope?: string },
  ) => Promise<{
    readonly user: BetterConvexAuthUser
    readonly principal: BetterConvexMcpPrincipal
  }>
  /** List and revoke a user's OAuth grants. The app passes the authenticated user's id. */
  readonly oauthConnections: BetterConvexOAuthConnections<DataModel>
}

/** Accessors for the configured `oauth.mcp` profile. */
export interface BetterConvexMcp {
  /** This deployment's Better Auth issuer, `${SITE_URL}/api/auth`. */
  readonly issuer: () => string
  /** The MCP resource URL, which is also the token audience. */
  readonly resource: () => URL
  /** The MCP scopes with their consent descriptions (without `offline_access`). */
  readonly scopes: () => Readonly<Record<string, string>>
  /**
   * Every scope a token may carry: the MCP scopes, plus `offline_access` when
   * renewal is on. Advertise it as the protected resource's `scopesSupported`.
   */
  readonly scopesSupported: () => readonly string[]
}

/** The stable Better Auth capabilities used at the Convex transport boundary. */
export interface BetterConvexAuthInstance {
  readonly $context: Promise<unknown>
  readonly api: Auth['api']
  readonly handler: (request: Request) => Promise<Response>
}

/** Server APIs available when the reviewed organization capability is enabled. */
export interface BetterConvexOrganizationAuthInstance<
  Options extends OrganizationOptions = OrganizationOptions,
> extends BetterConvexAuthInstance {
  readonly api: BetterConvexAuthInstance['api'] &
    InferAPI<OrganizationEndpoints<Options>> &
    (Options extends { readonly teams: { readonly enabled: true } }
      ? InferAPI<TeamEndpoints<Options>>
      : object)
}

type ReviewedTeamOrganizationOptions = OrganizationOptions & {
  readonly roles: Record<string, NonNullable<NonNullable<OrganizationOptions['roles']>[string]>>
  readonly teams: { readonly enabled: true }
}

/** Stable server APIs for the reviewed organization profile with teams enabled. */
export type BetterConvexTeamOrganizationAuthInstance =
  BetterConvexOrganizationAuthInstance<ReviewedTeamOrganizationOptions>

const OWNED_TOP_LEVEL_OPTIONS = [
  'plugins',
  'database',
  'databaseHooks',
  'user',
  'advanced',
  'rateLimit',
  'baseURL',
  'basePath',
] as const

const REVIEWED_TOP_LEVEL_OPTIONS = new Set([
  'account',
  'appName',
  'authFunctions',
  'beforeUserCreate',
  'defineSessionClaims',
  'email',
  'emailAndPassword',
  'emailOTP',
  'emailVerification',
  'oauth',
  'oauthProvider',
  'organization',
  'session',
  'socialProviders',
  'triggers',
  'twoFactor',
])

function configError(message: string): Error {
  return new Error(`[better-convex] createBetterConvexAuth ${message}`)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertOnlyKeys(value: unknown, allowed: readonly string[], path: string): void {
  if (value === undefined || value === false) return
  if (!isPlainRecord(value)) throw configError(`expected "${path}" to be an object`)
  const admitted = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!admitted.has(key)) throw configError(`does not support "${path}.${key}"`)
  }
}

function rejectEmailCallback(value: unknown, key: string, path: string): void {
  if (isPlainRecord(value) && Object.hasOwn(value, key)) {
    throw configError(`owns "${path}.${key}"; deliver auth email through the "email" option`)
  }
}

function assertSessionSeconds(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw configError(`requires "${path}" to be whole seconds between ${min} and ${max}`)
  }
  return value
}

function resolveCookieCache(cookieCache: BetterConvexSessionPolicy['cookieCache']) {
  if (cookieCache === undefined) return undefined
  if (!isPlainRecord(cookieCache)) {
    throw configError('expected "session.cookieCache" to be an object')
  }
  assertOnlyKeys(cookieCache, ['enabled', 'maxAge', 'strategy'], 'session.cookieCache')
  if (cookieCache.enabled !== undefined && typeof cookieCache.enabled !== 'boolean') {
    throw configError('expected "session.cookieCache.enabled" to be a boolean')
  }
  if (
    cookieCache.strategy !== undefined &&
    !(COOKIE_CACHE_STRATEGIES as readonly unknown[]).includes(cookieCache.strategy)
  ) {
    throw configError(
      `requires "session.cookieCache.strategy" to be one of ${COOKIE_CACHE_STRATEGIES.join(', ')}`,
    )
  }
  const maxAge =
    cookieCache.maxAge === undefined
      ? undefined
      : assertSessionSeconds(
          cookieCache.maxAge,
          'session.cookieCache.maxAge',
          SESSION_POLICY_BOUNDS.cookieCacheMaxAge.min,
          SESSION_POLICY_BOUNDS.cookieCacheMaxAge.max,
        )
  return Object.freeze({
    ...(cookieCache.enabled === undefined ? {} : { enabled: cookieCache.enabled }),
    ...(maxAge === undefined ? {} : { maxAge }),
    ...(cookieCache.strategy === undefined ? {} : { strategy: cookieCache.strategy }),
  })
}

function resolveSessionPolicy(session: BetterConvexSessionPolicy | undefined) {
  assertOnlyKeys(session, ['cookieCache', 'expiresIn', 'updateAge'], 'session')
  const expiresIn =
    session?.expiresIn === undefined
      ? DEFAULT_SESSION_EXPIRES_IN
      : assertSessionSeconds(
          session.expiresIn,
          'session.expiresIn',
          SESSION_POLICY_BOUNDS.expiresIn.min,
          SESSION_POLICY_BOUNDS.expiresIn.max,
        )
  const updateAge = assertSessionSeconds(
    session?.updateAge ?? Math.min(DEFAULT_SESSION_UPDATE_AGE, expiresIn),
    'session.updateAge',
    SESSION_POLICY_BOUNDS.updateAge.min,
    expiresIn,
  )
  return Object.freeze({
    ...(session?.cookieCache === undefined
      ? {}
      : { cookieCache: resolveCookieCache(session.cookieCache) }),
    expiresIn,
    updateAge,
  })
}

function assertTrustedProviderShape(account: BetterConvexAccountPolicy | undefined): void {
  assertOnlyKeys(account, ['accountLinking'], 'account')
  assertOnlyKeys(account?.accountLinking, ['trustedProviders'], 'account.accountLinking')
  const trusted = account?.accountLinking?.trustedProviders
  if (trusted === undefined) return
  if (
    !Array.isArray(trusted) ||
    trusted.some((name) => typeof name !== 'string' || name.length === 0) ||
    new Set(trusted).size !== trusted.length
  ) {
    throw configError(
      'requires "account.accountLinking.trustedProviders" to be unique provider names',
    )
  }
}

function resolveTrustedProviders(
  account: BetterConvexAccountPolicy | undefined,
  socialProviders: SocialProviders | undefined,
): string[] {
  const trusted = account?.accountLinking?.trustedProviders ?? []
  const configured = new Set(
    Object.entries(socialProviders ?? {})
      .filter(([, provider]) => provider !== undefined && provider !== null)
      .map(([name]) => name),
  )
  for (const name of trusted) {
    if (!configured.has(name)) {
      throw configError(
        `admits only configured social providers in "account.accountLinking.trustedProviders"; "${name}" is not configured`,
      )
    }
  }
  return [...trusted]
}

function rejectUnsupportedOptions(options: object): void {
  for (const key of OWNED_TOP_LEVEL_OPTIONS) {
    if (Object.hasOwn(options, key)) {
      throw configError(`owns "${key}"; arbitrary Better Auth configuration is not supported`)
    }
  }
  for (const key of Object.keys(options)) {
    if (!REVIEWED_TOP_LEVEL_OPTIONS.has(key)) throw configError(`does not support "${key}"`)
  }
  const record = options as Record<string, unknown>
  if (record.email !== undefined && typeof record.email !== 'function') {
    throw configError('expected "email" to be a function')
  }
  rejectEmailCallback(record.emailAndPassword, 'sendResetPassword', 'emailAndPassword')
  assertOnlyKeys(
    record.emailAndPassword,
    [...reviewedPasswordOptionKeys, 'passwordReset'],
    'emailAndPassword',
  )
  const passwordReset = isPlainRecord(record.emailAndPassword)
    ? record.emailAndPassword.passwordReset
    : undefined
  if (passwordReset !== undefined && typeof passwordReset !== 'boolean') {
    throw configError('expected "emailAndPassword.passwordReset" to be a boolean')
  }
  if (passwordReset === true && record.email === undefined) {
    throw configError(
      'requires the "email" option when "emailAndPassword.passwordReset" is enabled',
    )
  }
  rejectEmailCallback(record.emailVerification, 'sendVerificationEmail', 'emailVerification')
  assertOnlyKeys(record.emailVerification, reviewedEmailVerificationOptionKeys, 'emailVerification')
  rejectEmailCallback(record.emailOTP, 'sendVerificationOTP', 'emailOTP')
  rejectEmailCallback(record.organization, 'sendInvitationEmail', 'organization')
  rejectEmailCallback(
    isPlainRecord(record.twoFactor) ? record.twoFactor.otpOptions : undefined,
    'sendOTP',
    'twoFactor.otpOptions',
  )
  if (record.emailOTP !== undefined && record.emailOTP !== false) {
    if (!isPlainRecord(record.emailOTP)) throw configError('expected "emailOTP" to be an object')
    if (record.email === undefined) {
      throw configError('requires the "email" option when "emailOTP" is enabled')
    }
  }
  if (record.oauth !== undefined) {
    assertOnlyKeys(record.oauth, ['mcp'], 'oauth')
    if (!isPlainRecord(record.oauth) || record.oauth.mcp === undefined) {
      throw configError('requires "oauth.mcp"')
    }
    if (record.oauthProvider !== undefined) {
      throw configError('accepts either "oauth.mcp" or "oauthProvider", not both')
    }
  }
  assertTrustedProviderShape(record.account as BetterConvexAccountPolicy | undefined)
  // A lazy provider factory is re-validated for every auth construction.
  if (typeof record.socialProviders !== 'function') {
    resolveTrustedProviders(
      record.account as BetterConvexAccountPolicy | undefined,
      record.socialProviders as SocialProviders,
    )
  }
}

function rejectUserCreation(): never {
  throw new APIError('FORBIDDEN', { message: 'AUTH_USER_CREATE_REJECTED' })
}

function requiredIdentityValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

function createBeforeUserCreateHook<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  callback: NonNullable<CreateBetterConvexAuthOptions<DataModel>['beforeUserCreate']>,
) {
  return async (user: User & Record<string, unknown>) => {
    let decision: BetterConvexUserCreateDecision
    try {
      decision = await callback({
        ctx,
        user: Object.freeze({
          email: user.email,
          emailVerified: user.emailVerified,
          id: user.id,
          image: user.image,
          name: user.name,
        }),
      })
    } catch {
      rejectUserCreation()
    }

    if (!decision || typeof decision !== 'object' || decision.allowed !== true) {
      rejectUserCreation()
    }

    const patch = decision.user
    if (patch === undefined) return
    if (
      !patch ||
      typeof patch !== 'object' ||
      (patch.id !== undefined && !requiredIdentityValue(patch.id)) ||
      (patch.email !== undefined && !requiredIdentityValue(patch.email))
    ) {
      rejectUserCreation()
    }

    return {
      data: {
        ...user,
        ...(patch.id === undefined ? {} : { id: patch.id }),
        ...(patch.email === undefined ? {} : { email: patch.email }),
      },
    }
  }
}

function emailUser(user: { id: string; email: string; name: string }): BetterConvexAuthEmailUser {
  return Object.freeze({ id: user.id, email: user.email, name: user.name })
}

function emailCredentials(message: BetterConvexAuthEmail): string[] {
  switch (message.type) {
    case 'verify-email':
    case 'reset-password':
      return [message.url, message.token]
    case 'email-otp':
    case 'two-factor-otp':
      return [message.otp]
    case 'organization-invitation':
      return [message.invitationId]
  }
}

function createEmailDelivery<DataModel extends GenericDataModel>(
  ctx: AuthCtx<DataModel>,
  sender: BetterConvexAuthEmailSender<DataModel>,
) {
  return async (message: BetterConvexAuthEmail): Promise<void> => {
    if (!isWritableAuthCtx(ctx)) throw new Error('AUTH_EMAIL_REQUIRES_WRITABLE_CONTEXT')
    // Awaited so the submission is part of the request, never fire-and-forget.
    // Better Auth logs a rejected email task verbatim. An application error
    // may echo its arguments (the reset URL, token, or code), so only a
    // sanitized cause is logged here and a static error, deliberately without
    // the raw cause, is handed to Better Auth.
    const failed = await Promise.resolve()
      .then(() => sender(ctx, Object.freeze(message)))
      .then(
        () => false,
        (error: unknown) => {
          logAuthEmailFailure(message.type, error, emailCredentials(message))
          return true
        },
      )
    if (failed) throw new Error(AUTH_EMAIL_DELIVERY_FAILED)
  }
}

function cookieCacheWithinBounds(cookieCache: BetterAuthSessionOptions['cookieCache']): boolean {
  if (cookieCache === undefined || cookieCache.enabled !== true) return true
  const maxAge = cookieCache.maxAge ?? BETTER_AUTH_DEFAULT_COOKIE_CACHE_MAX_AGE
  return (
    Number.isSafeInteger(maxAge) &&
    maxAge >= SESSION_POLICY_BOUNDS.cookieCacheMaxAge.min &&
    maxAge <= SESSION_POLICY_BOUNDS.cookieCacheMaxAge.max &&
    (cookieCache.refreshCache === undefined || cookieCache.refreshCache === false)
  )
}

/** Invariants that no option may relax, re-asserted on the final options. */
function assertOwnedInvariants(options: BetterAuthOptions, socialProviderNames: Set<string>): void {
  const disabled = new Set(options.disabledPaths ?? [])
  const linking = options.account?.accountLinking
  if (
    !['/token', '/get-access-token', '/refresh-token'].every((path) => disabled.has(path)) ||
    options.account?.encryptOAuthTokens !== true ||
    options.account.storeAccountCookie !== false ||
    linking?.allowDifferentEmails !== false ||
    linking.allowUnlinkingAll !== false ||
    linking.disableImplicitLinking !== true ||
    !Array.isArray(linking.trustedProviders) ||
    linking.trustedProviders.some((name) => !socialProviderNames.has(name)) ||
    (options.emailAndPassword?.enabled === true &&
      (options.emailAndPassword.autoSignIn !== false ||
        (options.emailAndPassword.minPasswordLength ?? 0) < 15)) ||
    typeof options.session?.expiresIn !== 'number' ||
    options.session.expiresIn < SESSION_POLICY_BOUNDS.expiresIn.min ||
    options.session.expiresIn > SESSION_POLICY_BOUNDS.expiresIn.max ||
    typeof options.session.updateAge !== 'number' ||
    options.session.updateAge < SESSION_POLICY_BOUNDS.updateAge.min ||
    options.session.updateAge > options.session.expiresIn ||
    !cookieCacheWithinBounds(options.session.cookieCache)
  ) {
    throw new Error('AUTH_OWNED_INVARIANT_VIOLATED')
  }
}

/**
 * Create the reviewed Better Auth + Convex integration as one owned unit.
 * This is the only supported way to compose auth.
 *
 * Product authorization remains in application Convex functions. This factory
 * only establishes trustworthy identity, organization data, and OAuth access.
 */
export function createBetterConvexAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(
  component: Api,
  options: Omit<CreateBetterConvexAuthOptions<DataModel>, 'organization'> & {
    readonly organization: ReviewedOrganizationOptions<
      OrganizationOptions & { readonly teams: { readonly enabled: true } }
    >
  },
): BetterConvexAuth<DataModel, BetterConvexTeamOrganizationAuthInstance>
export function createBetterConvexAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
  Options extends OrganizationOptions = OrganizationOptions,
>(
  component: Api,
  options: Omit<CreateBetterConvexAuthOptions<DataModel>, 'organization'> & {
    readonly organization: ReviewedOrganizationOptions<Options>
  },
): BetterConvexAuth<DataModel, BetterConvexOrganizationAuthInstance<Options>>
export function createBetterConvexAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(component: Api, options?: CreateBetterConvexAuthOptions<DataModel>): BetterConvexAuth<DataModel>
export function createBetterConvexAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(
  component: Api,
  options: CreateBetterConvexAuthOptions<DataModel> = {},
): BetterConvexAuth<DataModel> {
  return createBetterConvexAuthOwned(component, options)
}

/**
 * Test-only package entry support.
 * @internal
 */
export function createBetterConvexAuthOwned<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(
  component: Api,
  options: CreateBetterConvexAuthOptions<DataModel> = {},
  extraPlugins: readonly BetterAuthPlugin[] = [],
  assertExtraPluginsAllowed: () => void = () => {},
): BetterConvexAuth<DataModel> {
  rejectUnsupportedOptions(options)
  const sessionPolicy = resolveSessionPolicy(options.session)
  const defineSessionClaims: SessionClaimsDefinition = async (input) => {
    const claims = await options.defineSessionClaims?.(input)
    return claims === undefined ? {} : claims
  }
  const authComponent = createAuthComponent<DataModel, Api>(component, {
    authFunctions: options.authFunctions,
    triggers: options.triggers,
  })

  const mcpProfile: ResolvedMcpProfile | undefined = options.oauth
    ? resolveMcpProfile(options.oauth.mcp)
    : undefined

  const resolveOAuthProfile = async (
    ctx: AuthCtx<DataModel>,
  ): Promise<PinnedOAuthProviderProfile | undefined> => {
    if (mcpProfile) return mcpProfile.provider
    try {
      return typeof options.oauthProvider === 'function'
        ? await options.oauthProvider(ctx)
        : options.oauthProvider
    } catch (error) {
      throw authConfigFailure('AUTH_CONFIG_OAUTH_PROFILE_FAILED', error)
    }
  }

  const createAuthWithProfile = async (
    ctx: AuthCtx<DataModel>,
    oauthProfile: PinnedOAuthProviderProfile | undefined,
  ): Promise<BetterConvexAuthInstance> => {
    let stage: AuthConfigSubCode = 'AUTH_CONFIG_OPTIONS_INVALID'
    try {
      assertExtraPluginsAllowed()
      stage = 'AUTH_CONFIG_SITE_URL_INVALID'
      const siteUrl = requireAuthOrigin('SITE_URL')
      stage = 'AUTH_CONFIG_CONVEX_SITE_URL_INVALID'
      const convexSiteUrl = requireAuthOrigin('CONVEX_SITE_URL')
      stage = 'AUTH_CONFIG_SECRETS_INVALID'
      if (parseVersionedSecrets(process.env.BETTER_AUTH_SECRETS).length === 0) {
        throw new Error('BETTER_AUTH_SECRETS is required')
      }
      stage = 'AUTH_CONFIG_OPTIONS_INVALID'
      const authIssuer = `${siteUrl}/api/auth`
      const socialProviders =
        typeof options.socialProviders === 'function'
          ? options.socialProviders()
          : options.socialProviders
      const trustedProviders = resolveTrustedProviders(options.account, socialProviders)
      const deliver = options.email ? createEmailDelivery(ctx, options.email) : undefined
      const emailAndPassword = options.emailAndPassword
      const { passwordReset = false, ...passwordOptions } = emailAndPassword || {}
      const emailOtpOptions = options.emailOTP

      const featurePlugins = [
        options.organization === false || options.organization === undefined
          ? null
          : organization({
              ...options.organization,
              ...(deliver
                ? {
                    sendInvitationEmail: async (data) =>
                      deliver({
                        type: 'organization-invitation',
                        to: data.email,
                        invitationId: data.id,
                        role: data.role,
                        organization: Object.freeze({
                          id: data.organization.id,
                          name: data.organization.name,
                          slug: data.organization.slug,
                        }),
                        inviter: emailUser(data.inviter.user),
                      }),
                  }
                : {}),
            }),
        options.twoFactor === false || options.twoFactor === undefined
          ? null
          : twoFactor({
              ...options.twoFactor,
              ...(deliver
                ? {
                    otpOptions: {
                      ...options.twoFactor.otpOptions,
                      sendOTP: async ({ user, otp }) =>
                        deliver({
                          type: 'two-factor-otp',
                          to: user.email,
                          otp,
                          user: emailUser(user),
                        }),
                    },
                  }
                : {}),
            }),
        emailOtpOptions === false || emailOtpOptions === undefined || !deliver
          ? null
          : emailOTP({
              ...emailOtpOptions,
              sendVerificationOTP: async ({ email, otp, type }) =>
                deliver({ type: 'email-otp', to: email, otp, purpose: type }),
            }),
      ].filter((plugin) => plugin !== null)
      const jwtPlugin = createAuthJwtPlugin(authIssuer)
      const convexPlugin = convexAuth({
        authConfig: { providers: [getConvexAuthProvider()] },
        oauthProvider: oauthProfile,
        sessionJwt: {
          audience: 'convex',
          expirationTime: '15m',
          issuer: convexSiteUrl,
          definePayload: defineSessionClaims,
        },
      })
      const plugins: BetterAuthPlugin[] = [
        ...featurePlugins,
        ...extraPlugins,
        jwtPlugin,
        convexPlugin,
        ...(oauthProfile ? [createOAuthProvider(oauthProfile)] : []),
      ]
      const maximumConfiguredPluginRateLimitWindow = Math.max(
        0,
        ...plugins.flatMap((plugin) => plugin.rateLimit?.map((rule) => rule.window) ?? []),
      )
      const rateLimitStorage = createConvexAuthRateLimitStorage(
        ctx,
        component,
        maximumConfiguredPluginRateLimitWindow,
      )

      const authOptions = {
        appName: options.appName,
        account: {
          encryptOAuthTokens: true,
          storeAccountCookie: false,
          accountLinking: {
            allowDifferentEmails: false,
            allowUnlinkingAll: false,
            disableImplicitLinking: true,
            trustedProviders,
          },
        },
        advanced: { ipAddress: { ipAddressHeaders: ['x-bcn-verified-client-ip'] } },
        basePath: '/api/auth',
        baseURL: siteUrl,
        database: authComponent.adapter(ctx),
        databaseHooks: options.beforeUserCreate
          ? {
              user: {
                create: {
                  before: createBeforeUserCreateHook(ctx, options.beforeUserCreate),
                },
              },
            }
          : undefined,
        disabledPaths: [
          '/token',
          '/get-access-token',
          '/refresh-token',
          '/.well-known/openid-configuration',
          '/oauth2/register',
          '/oauth2/introspect',
          '/oauth2/userinfo',
          '/oauth2/end-session',
          '/oauth2/create-client',
          '/oauth2/get-client',
          '/oauth2/get-clients',
          '/oauth2/update-client',
          '/oauth2/client/rotate-secret',
          '/oauth2/delete-client',
        ],
        emailAndPassword:
          emailAndPassword === false
            ? { enabled: false }
            : {
                ...passwordOptions,
                ...(deliver && passwordReset
                  ? {
                      sendResetPassword: async ({ user, url, token }) =>
                        deliver({
                          type: 'reset-password',
                          to: user.email,
                          url,
                          token,
                          user: emailUser(user),
                        }),
                    }
                  : {}),
                autoSignIn: false,
                enabled: true,
                minPasswordLength: 15,
              },
        emailVerification:
          options.emailVerification === undefined && !deliver
            ? undefined
            : {
                ...options.emailVerification,
                ...(deliver
                  ? {
                      sendVerificationEmail: async ({ user, url, token }) =>
                        deliver({
                          type: 'verify-email',
                          to: user.email,
                          url,
                          token,
                          user: emailUser(user),
                        }),
                    }
                  : {}),
              },
        plugins,
        rateLimit: {
          customStorage: rateLimitStorage,
          customRules: { ...LIBRARY_RATE_LIMIT_RULES },
          enabled: true,
          modelName: 'rateLimit',
          storage: 'database',
        },
        session: { ...sessionPolicy },
        socialProviders,
        trustedOrigins: [siteUrl],
        verification: { storeIdentifier: 'hashed' },
      } satisfies BetterAuthOptions
      const socialProviderNames = new Set(Object.keys(socialProviders ?? {}))
      assertOwnedInvariants(authOptions, socialProviderNames)

      stage = 'AUTH_CONFIG_CONSTRUCTION_FAILED'
      const auth = betterAuth(authOptions)
      const context = (await auth.$context) as { options?: BetterAuthOptions } | undefined
      // Plugin init may merge options; the final graph must keep every invariant.
      if (context?.options) assertOwnedInvariants(context.options, socialProviderNames)
      return auth
    } catch (error) {
      throw authConfigFailure(stage, error)
    }
  }

  const createAuth: CreateAuth<DataModel, BetterConvexAuthInstance> = async (ctx) =>
    await createAuthWithProfile(ctx, await resolveOAuthProfile(ctx))

  const oauthOperator = createOAuthOperator<DataModel>({
    appName: options.appName,
    component,
    mcp: mcpProfile,
    createAuth: createAuthWithProfile,
    resolveProfile: resolveOAuthProfile,
  })

  const requireMcp = (): ResolvedMcpProfile => {
    if (!mcpProfile) throw new TypeError('AUTH_OAUTH_MCP_PROFILE_REQUIRED')
    return mcpProfile
  }
  const mcp: BetterConvexMcp = Object.freeze({
    issuer: () => {
      requireMcp()
      return canonicalAuthIssuer()
    },
    resource: () => resolveMcpResource(requireMcp()),
    scopes: () => requireMcp().scopes,
    scopesSupported: () => Object.freeze([...(requireMcp().provider.scopes ?? [])]),
  })

  return Object.freeze({
    createAuth,
    registerRoutes(http: HttpRouter) {
      authComponent.registerRoutes(http, createAuth)
    },
    sessionHttpAction(
      handler: BetterConvexSessionHttpHandler<DataModel, BetterConvexAuthInstance>,
    ) {
      return authComponent.sessionHttpAction(createAuth, handler)
    },
    triggerFunctions: authComponent.triggerFunctions,
    jwksOperatorFunctions() {
      return authComponent.jwksOperatorFunctions(createAuth)
    },
    oauthOperator,
    getUser: authComponent.getUser,
    requireUser: authComponent.requireUser,
    getAuth: (ctx: WritableAuthCtx<DataModel>) => authComponent.getAuth(createAuth, ctx),
    mcp,
    createMcpAccessVerifier: (
      ctx: AuthCtx<DataModel>,
      verifierOptions: Partial<BetterAuthMcpAccessVerifierOptions> = {},
    ) => {
      const allowedScopes = verifierOptions.allowedScopes ?? mcpProfile?.provider.scopes
      if (!allowedScopes) throw new TypeError('AUTH_OAUTH_MCP_PROFILE_REQUIRED')
      const resource =
        verifierOptions.resource ?? (mcpProfile ? resolveMcpResource(mcpProfile) : undefined)
      return createBetterAuthMcpAccessVerifier(ctx, component, {
        ...verifierOptions,
        allowedScopes,
        ...(resource === undefined ? {} : { resource }),
      })
    },
    requireMcpPrincipal: (
      ctx: AuthCtx<DataModel>,
      principal: BetterConvexMcpPrincipal,
      principalOptions: { readonly scope?: string } = {},
    ) =>
      requireMcpPrincipal(ctx, component, principal, {
        ...(principalOptions.scope === undefined ? {} : { scope: principalOptions.scope }),
        ...(mcpProfile ? { resource: () => resolveMcpResource(mcpProfile) } : {}),
      }),
    oauthConnections: createOAuthConnections<DataModel>(component),
  })
}
