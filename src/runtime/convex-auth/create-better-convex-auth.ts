import { oauthProvider as createOAuthProvider } from '@better-auth/oauth-provider'
import type { Auth, BetterAuthOptions, InferAPI, User } from 'better-auth'
import { APIError, betterAuth } from 'better-auth'
import {
  emailOTP,
  jwt,
  organization,
  twoFactor,
  type EmailOTPOptions,
  type OrganizationEndpoints,
  type OrganizationOptions,
  type TeamEndpoints,
  type TwoFactorOptions,
} from 'better-auth/plugins'
import type { GenericDataModel, HttpRouter } from 'convex/server'

import type { AuthCtx } from './context'
import { createAuthComponent } from './create-auth-component'
import { createOAuthOperator, type BetterConvexOAuthOperator } from './oauth-operator'
import type { PinnedOAuthProviderProfile } from './oauth-security'
import { requireAuthOrigin } from './origin'
import { convexAuth } from './plugin'
import { getConvexAuthProvider } from './provider'
import type {
  AuthAdapterComponentApi,
  AuthComponentTriggers,
  AuthFunctions,
  CreateAuth,
} from './types'

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

type ReviewedEmailAndPasswordOptions = Partial<
  Pick<
    BetterAuthEmailAndPasswordOptions,
    | 'disableSignUp'
    | 'maxPasswordLength'
    | 'onExistingUserSignUp'
    | 'onPasswordReset'
    | 'requireEmailVerification'
    | 'resetPasswordTokenExpiresIn'
    | 'revokeSessionsOnPasswordReset'
    | 'sendResetPassword'
  >
>

type ReviewedSessionOptions = Partial<Pick<BetterAuthSessionOptions, 'cookieCache'>>

export interface CreateBetterConvexAuthOptions<DataModel extends GenericDataModel> {
  readonly appName?: string
  readonly authFunctions?: AuthFunctions
  readonly beforeUserCreate?: (input: {
    readonly ctx: AuthCtx<DataModel>
    readonly user: BetterConvexPendingUser
  }) => BetterConvexUserCreateDecision | Promise<BetterConvexUserCreateDecision>
  readonly triggers?: AuthComponentTriggers<DataModel>
  readonly emailAndPassword?: false | ReviewedEmailAndPasswordOptions
  readonly emailVerification?: EmailVerificationOptions
  readonly emailOTP?: false | EmailOTPOptions
  readonly organization?: false | OrganizationOptions
  readonly twoFactor?: false | TwoFactorOptions
  readonly oauthProvider?:
    | PinnedOAuthProviderProfile
    | ((
        ctx: AuthCtx<DataModel>,
      ) => PinnedOAuthProviderProfile | Promise<PinnedOAuthProviderProfile>)
  readonly session?: ReviewedSessionOptions
  readonly socialProviders?: SocialProviders | (() => SocialProviders)
  readonly defineSessionClaims?: NonNullable<
    Parameters<typeof convexAuth>[0]['sessionJwt']['definePayload']
  >
}

type OwnedAuthComponent<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi,
> = ReturnType<typeof createAuthComponent<DataModel, Api>>

export interface BetterConvexAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
  AuthInstance extends BetterConvexAuthInstance = BetterConvexAuthInstance,
> {
  readonly authComponent: OwnedAuthComponent<DataModel, Api>
  readonly createAuth: CreateAuth<DataModel, AuthInstance>
  readonly registerRoutes: (http: HttpRouter) => void
  readonly triggerFunctions: OwnedAuthComponent<DataModel, Api>['triggerFunctions']
  readonly jwksOperatorFunctions: () => ReturnType<
    OwnedAuthComponent<DataModel, Api>['jwksOperatorFunctions']
  >
  readonly oauthOperator: BetterConvexOAuthOperator<DataModel>
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

function rejectUnsupportedOptions(options: object): void {
  for (const key of [
    'plugins',
    'database',
    'databaseHooks',
    'user',
    'advanced',
    'rateLimit',
    'baseURL',
    'basePath',
  ]) {
    if (Object.hasOwn(options, key)) {
      throw new Error(
        `[better-convex] createBetterConvexAuth owns "${key}"; arbitrary Better Auth configuration is not supported`,
      )
    }
  }
  const record = options as Record<string, unknown>
  assertOnlyKeys(
    record.emailAndPassword,
    [
      'disableSignUp',
      'maxPasswordLength',
      'onExistingUserSignUp',
      'onPasswordReset',
      'requireEmailVerification',
      'resetPasswordTokenExpiresIn',
      'revokeSessionsOnPasswordReset',
      'sendResetPassword',
    ],
    'emailAndPassword',
  )
  assertOnlyKeys(record.session, ['cookieCache'], 'session')
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

function assertOnlyKeys(value: unknown, allowed: readonly string[], path: string): void {
  if (value === undefined || value === false) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[better-convex] createBetterConvexAuth expected "${path}" to be an object`)
  }
  const admitted = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!admitted.has(key)) {
      throw new Error(`[better-convex] createBetterConvexAuth does not support "${path}.${key}"`)
    }
  }
}

function assertVersionedSecrets(raw: string | undefined): void {
  if (!raw) throw new Error('BETTER_AUTH_SECRETS is required')
  const versions = new Set<number>()
  for (const entry of raw.split(',')) {
    const separator = entry.indexOf(':')
    const versionText = separator < 0 ? '' : entry.slice(0, separator).trim()
    const value = separator < 0 ? '' : entry.slice(separator + 1).trim()
    const version = Number(versionText)
    if (
      !/^(?:0|[1-9]\d*)$/u.test(versionText) ||
      !Number.isSafeInteger(version) ||
      versions.has(version) ||
      value.length < 32
    ) {
      throw new Error('BETTER_AUTH_SECRETS must contain unique versioned secrets of 32 characters')
    }
    versions.add(version)
  }
}

/**
 * Create the reviewed Better Auth + Convex integration as one owned unit.
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
    readonly organization: OrganizationOptions & {
      readonly teams: { readonly enabled: true }
    }
  },
): BetterConvexAuth<DataModel, Api, BetterConvexTeamOrganizationAuthInstance>
export function createBetterConvexAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
  Options extends OrganizationOptions = OrganizationOptions,
>(
  component: Api,
  options: Omit<CreateBetterConvexAuthOptions<DataModel>, 'organization'> & {
    readonly organization: Options
  },
): BetterConvexAuth<DataModel, Api, BetterConvexOrganizationAuthInstance<Options>>
export function createBetterConvexAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(
  component: Api,
  options?: CreateBetterConvexAuthOptions<DataModel>,
): BetterConvexAuth<DataModel, Api>
export function createBetterConvexAuth<
  DataModel extends GenericDataModel,
  Api extends AuthAdapterComponentApi = AuthAdapterComponentApi,
>(
  component: Api,
  options: CreateBetterConvexAuthOptions<DataModel> = {},
): BetterConvexAuth<DataModel, Api> {
  rejectUnsupportedOptions(options)
  const authComponent = createAuthComponent<DataModel, Api>(component, {
    authFunctions: options.authFunctions,
    triggers: options.triggers,
  })

  const resolveOAuthProfile = async (
    ctx: AuthCtx<DataModel>,
  ): Promise<PinnedOAuthProviderProfile | undefined> => {
    try {
      return typeof options.oauthProvider === 'function'
        ? await options.oauthProvider(ctx)
        : options.oauthProvider
    } catch {
      throw new Error('AUTH_CONFIG_INVALID')
    }
  }

  const createAuthWithProfile = async (
    ctx: AuthCtx<DataModel>,
    oauthProfile: PinnedOAuthProviderProfile | undefined,
  ): Promise<BetterConvexAuthInstance> => {
    try {
      const siteUrl = requireAuthOrigin('SITE_URL')
      const convexSiteUrl = requireAuthOrigin('CONVEX_SITE_URL')
      assertVersionedSecrets(process.env.BETTER_AUTH_SECRETS)
      const authIssuer = `${siteUrl}/api/auth`
      const featurePlugins = [
        options.organization === false || options.organization === undefined
          ? null
          : organization(options.organization),
        options.twoFactor === false || options.twoFactor === undefined
          ? null
          : twoFactor(options.twoFactor),
        options.emailOTP === false || options.emailOTP === undefined
          ? null
          : emailOTP(options.emailOTP),
      ].filter((plugin) => plugin !== null)
      const jwtPlugin = jwt({
        disableSettingJwtHeader: true,
        jwks: {
          disablePrivateKeyEncryption: false,
          gracePeriod: 21 * 60,
          keyPairConfig: { alg: 'RS256' },
        },
        jwt: { audience: authIssuer, expirationTime: '10m', issuer: authIssuer },
      })
      const convexPlugin = convexAuth({
        authConfig: { providers: [getConvexAuthProvider()] },
        oauthProvider: oauthProfile,
        sessionJwt: {
          audience: 'convex',
          expirationTime: '15m',
          issuer: convexSiteUrl,
          definePayload: options.defineSessionClaims,
        },
      })
      const plugins = [
        ...featurePlugins,
        jwtPlugin,
        convexPlugin,
        ...(oauthProfile ? [createOAuthProvider(oauthProfile)] : []),
      ]

      const auth = betterAuth({
        appName: options.appName,
        account: {
          encryptOAuthTokens: true,
          storeAccountCookie: false,
          accountLinking: {
            allowDifferentEmails: false,
            allowUnlinkingAll: false,
            disableImplicitLinking: true,
            trustedProviders: [],
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
          options.emailAndPassword === false
            ? { enabled: false }
            : {
                ...options.emailAndPassword,
                autoSignIn: false,
                enabled: true,
                minPasswordLength: 15,
              },
        emailVerification: options.emailVerification,
        plugins,
        rateLimit: { enabled: true, modelName: 'rateLimit', storage: 'database' },
        session: {
          expiresIn: 7 * 24 * 60 * 60,
          updateAge: 24 * 60 * 60,
          ...options.session,
        },
        socialProviders:
          typeof options.socialProviders === 'function'
            ? options.socialProviders()
            : options.socialProviders,
        trustedOrigins: [siteUrl],
        verification: { storeIdentifier: 'hashed' },
      })
      await auth.$context
      return auth
    } catch {
      throw new Error('AUTH_CONFIG_INVALID')
    }
  }

  const createAuth: CreateAuth<DataModel, BetterConvexAuthInstance> = async (ctx) =>
    await createAuthWithProfile(ctx, await resolveOAuthProfile(ctx))

  const oauthOperator = createOAuthOperator<DataModel>({
    createAuth: createAuthWithProfile,
    resolveProfile: resolveOAuthProfile,
  })

  return Object.freeze({
    authComponent,
    createAuth,
    registerRoutes(http: HttpRouter) {
      authComponent.registerRoutes(http, createAuth)
    },
    triggerFunctions: authComponent.triggerFunctions,
    jwksOperatorFunctions() {
      return authComponent.jwksOperatorFunctions(createAuth)
    },
    oauthOperator,
  })
}
